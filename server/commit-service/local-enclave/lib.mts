// Shared helpers for harness drivers: start both processes, wait, stop.
import { spawn, type ChildProcess } from "node:child_process";
import { getPublicKeyAsync, signAsync, utils as edUtils } from "@noble/ed25519";
import { sha256 } from "@noble/hashes/sha256";
import { connect } from "node:net";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

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

export async function startStack(opts: { enclavePort?: number; parentPort?: number; parentEnv?: Record<string, string>; quiet?: boolean; anchor?: boolean } = {}): Promise<Stack> {
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
  const parent = spawn(process.execPath, [join(here, "run-local-parent.mjs")], {
    stdio, env: { ...process.env, ENCLAVE_PORT: String(enclavePort), PORT: String(parentPort), ...(opts.parentEnv ?? {}) },
  });
  const parentUrl = `http://127.0.0.1:${parentPort}`;
  await waitKey(parentUrl);
  if (anchorSeed) await landFirstAnchor(parentUrl, anchorSeed, 25_000_000);
  return { enclave, parent, parentUrl, stop() { parent.kill(); enclave.kill(); } };
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
