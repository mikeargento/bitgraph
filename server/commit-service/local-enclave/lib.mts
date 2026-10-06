// Shared helpers for harness drivers: start both processes, wait, stop.
import { spawn, type ChildProcess } from "node:child_process";
import { getPublicKeyAsync, signAsync, utils as edUtils } from "@noble/ed25519";
import { sha256 } from "@noble/hashes/sha256";
import { connect } from "node:net";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createServer, type Server } from "node:http";
import { keccak_256 } from "@noble/hashes/sha3";
import { encodeBaseHeaderRlp, type RpcBlock } from "../src/parent/base-head.ts";

const here = dirname(fileURLToPath(import.meta.url));
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export interface Stack { enclave: ChildProcess; parent: ChildProcess; parentUrl: string; stop(): void }

/**
 * The anchored chain (enclave v8) serves nothing until its first authenticated
 * anchor of the epoch, so a driver that commits on bitgraph:main has to play
 * the anchor service first. startStack({ anchor: true }) swaps a harness key
 * into the measured constant and lands one anchor, exactly as production's
 * anchor service does on its first tick after an epoch begins.
 */
export const ANCHORED_CHAIN = "bitgraph:main";
const utf8 = (s: string) => new TextEncoder().encode(s);
const b64 = (u: Uint8Array) => Buffer.from(u).toString("base64");

async function landFirstAnchor(parentUrl: string, seed: Uint8Array, blockNumber: number): Promise<void> {
  const r = await fetch(`${parentUrl}/key`);
  const { epochId } = (await r.json()) as { epochId?: string };
  if (!epochId) throw new Error("harness anchor: /key returned no epochId");
  const blockHash = "0x" + Buffer.from(sha256(utf8(`harness-anchor-${blockNumber}`))).toString("hex");
  const sig = await signAsync(utf8(`bitgraph-anchor/1\n${epochId}\n${ANCHORED_CHAIN}\n${blockNumber}\n${blockHash}`), seed);
  const res = await post(`${parentUrl}/commit`, {
    digests: [{ digestB64: b64(sha256(utf8(blockHash))), hashAlg: "sha256" }],
    chainId: ANCHORED_CHAIN,
    attribution: { name: "Ethereum Anchor", message: blockHash, title: `https://etherscan.io/block/${blockNumber}` },
    anchor: { blockNumber, blockHash, signatureB64: b64(sig) },
  });
  if (res.status !== 200) throw new Error(`harness anchor failed: ${res.status} ${JSON.stringify(res.json).slice(0, 200)}`);
}

async function waitTcp(port: number, ms = 30_000): Promise<void> {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    const ok = await new Promise<boolean>((res) => {
      const s = connect({ host: "127.0.0.1", port }, () => { s.destroy(); res(true); });
      s.on("error", () => res(false));
    });
    if (ok) return;
    await sleep(150);
  }
  throw new Error(`port ${port} never came up`);
}

async function waitKey(url: string, ms = 30_000): Promise<void> {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    try {
      const r = await fetch(`${url}/key`);
      const j = (await r.json()) as { epochId?: string };
      if (j.epochId) return;
    } catch { /* not yet */ }
    await sleep(150);
  }
  throw new Error("parent never answered /key");
}

/**
 * A stand-in Base node (enclave v10): answers eth_getBlockByNumber("latest")
 * with a real-format OP Stack header whose hash is its true keccak, one block
 * every 2 s of wall time, each naming its parent. Drivers can freeze the head
 * (a halt) or skew the next block's stamp (a header from the future).
 */
export interface FakeBase {
  url: string;
  /** The block "latest" returns now. */
  head(): RpcBlock;
  /** Stop producing blocks (a halt); resume() picks up at wall time, refilling with past-stamped blocks. */
  halt(): void;
  resume(): void;
  /** Add this many seconds to every stamp from now on (negative: past). */
  skew(seconds: number): void;
  close(): void;
}

const hex = (u: Uint8Array) => "0x" + Buffer.from(u).toString("hex");
const zeros = (n: number) => "0x" + "00".repeat(n);

export async function startFakeBase(startNumber = 36_000_000): Promise<FakeBase> {
  const t0 = Math.floor(Date.now() / 1000);
  let halted = false;
  let haltedAt = 0;
  let skewS = 0;
  const chain: RpcBlock[] = [];
  const blockAt = (n: number, parentHash: string, ts: number): RpcBlock => {
    const b: RpcBlock = {
      hash: "", parentHash, sha3Uncles: hex(keccak_256(Uint8Array.of(0xc0))), miner: zeros(20),
      stateRoot: hex(keccak_256(utf8(`state-${n}`))), transactionsRoot: hex(keccak_256(utf8(`tx-${n}`))),
      receiptsRoot: hex(keccak_256(utf8(`rc-${n}`))), logsBloom: zeros(256), difficulty: "0x0",
      number: "0x" + n.toString(16), gasLimit: "0x" + (240_000_000).toString(16), gasUsed: "0x" + (12_345_678).toString(16),
      timestamp: "0x" + ts.toString(16), extraData: "0x", mixHash: hex(keccak_256(utf8(`mix-${n}`))), nonce: zeros(8),
      baseFeePerGas: "0x" + (1_000_000).toString(16), withdrawalsRoot: hex(keccak_256(utf8(`w-${n}`))),
      blobGasUsed: "0x0", excessBlobGas: "0x0", parentBeaconBlockRoot: hex(keccak_256(utf8(`pb-${n}`))),
      requestsHash: hex(keccak_256(utf8(`rq-${n}`))),
    };
    b.hash = hex(keccak_256(encodeBaseHeaderRlp(b)));
    return b;
  };
  chain.push(blockAt(startNumber, hex(keccak_256(utf8("genesis-parent"))), t0));
  // Base stamps by height: block n is t0 + 2(n - start). The head is the block for wall time.
  const advance = () => {
    const wall = halted ? haltedAt : Math.floor(Date.now() / 1000);
    const want = startNumber + Math.floor((wall - t0) / 2);
    while (startNumber + chain.length - 1 < want) {
      const prev = chain[chain.length - 1]!;
      const n = parseInt(prev.number, 16) + 1;
      chain.push(blockAt(n, prev.hash, t0 + 2 * (n - startNumber) + skewS));
    }
    return chain[chain.length - 1]!;
  };
  const server: Server = createServer((req, res) => {
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => {
      const j = JSON.parse(body || "{}") as { id?: number; method?: string; params?: unknown[] };
      const result = j.method === "eth_getBlockByNumber" ? { ...advance(), transactions: [] } : null;
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify(result ? { jsonrpc: "2.0", id: j.id ?? 1, result } : { jsonrpc: "2.0", id: j.id ?? 1, error: { message: "unsupported" } }));
    });
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const port = (server.address() as { port: number }).port;
  return {
    url: `http://127.0.0.1:${port}`,
    head: () => advance(),
    halt() { advance(); halted = true; haltedAt = Math.floor(Date.now() / 1000); },
    resume() { halted = false; },
    skew(seconds: number) { skewS = seconds; },
    close() { server.close(); },
  };
}

export async function startStack(opts: { enclavePort?: number; parentPort?: number; parentEnv?: Record<string, string>; quiet?: boolean; anchor?: boolean; base?: FakeBase | false } = {}): Promise<Stack & { base?: FakeBase }> {
  const enclavePort = opts.enclavePort ?? 59000 + Math.floor(Math.random() * 500);
  const parentPort = opts.parentPort ?? 58000 + Math.floor(Math.random() * 500);
  const stdio = opts.quiet ? "ignore" : "inherit";
  // With { anchor: true }, the enclave is built with a harness anchor key so
  // this process can land the epoch's first anchor below.
  const anchorSeed = opts.anchor ? edUtils.randomPrivateKey() : undefined;
  const enclaveEnv = { ...process.env, ENCLAVE_PORT: String(enclavePort) } as Record<string, string>;
  if (anchorSeed) enclaveEnv["HARNESS_ANCHOR_PUBKEY_B64"] = b64(await getPublicKeyAsync(anchorSeed));
  const enclave = spawn(process.execPath, [join(here, "run-local-enclave.mjs")], { stdio, env: enclaveEnv });
  await waitTcp(enclavePort);
  // Enclave v10: allocations on the anchored chain need a Base header, so every
  // stack gets a stand-in Base node unless a driver passes base: false.
  const base = opts.base === false ? undefined : (opts.base ?? await startFakeBase());
  const baseEnv: Record<string, string> = base ? { BASE_FLOOR: "on", BASE_FLOOR_RPC_URLS: base.url, BASE_FLOOR_POLL_MS: "250" } : {};
  const parent = spawn(process.execPath, [join(here, "run-local-parent.mjs")], {
    stdio, env: { ...process.env, ENCLAVE_PORT: String(enclavePort), PORT: String(parentPort), ...baseEnv, ...(opts.parentEnv ?? {}) },
  });
  const parentUrl = `http://127.0.0.1:${parentPort}`;
  await waitKey(parentUrl);
  if (base) await sleep(600); // let the parent read its first Base header
  if (anchorSeed) await landFirstAnchor(parentUrl, anchorSeed, 25_000_000);
  return { enclave, parent, parentUrl, base, stop() { parent.kill(); enclave.kill(); if (base && opts.base === undefined) base.close(); } };
}

export async function post(url: string, body: unknown, headers: Record<string, string> = {}): Promise<{ status: number; json: any; headers: Headers }> {
  const r = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...headers },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await r.text();
  let json: unknown;
  try { json = JSON.parse(text); } catch { json = text; }
  return { status: r.status, json, headers: r.headers };
}

export function randomDigestB64(): string {
  const b = new Uint8Array(32);
  crypto.getRandomValues(b);
  return Buffer.from(b).toString("base64");
}
