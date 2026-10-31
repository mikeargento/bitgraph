// The block timeline end to end on this machine: the unmodified enclave (run-local-enclave.mjs), the real parent
// with TIMELINE=on, and stand-in Base and Ethereum nodes, two per chain, on loopback. No ledger, no production.
//
// It binds a file while the genesis write is still pending, then supplies the genesis result as the ceiling writer
// would, and checks: every block of both chains bound in order with no gap, one unbroken counter run, and the file's
// bundle from GET /timeline/bundle verified by verifyTimelineBundle (with the stand-in attestation's time in place
// of Nitro's).
//
//   cd server/commit-service && node --import tsx/esm local-enclave/timeline-smoke.mts
import { createServer, type Server } from "node:http";
import { mkdtempSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { keccak_256 } from "@noble/hashes/sha3";
import { sha256 } from "@noble/hashes/sha256";
import {
  verifyTimelineBundle, verifyStretch, verifyProofIntegrity, parseBlockReadFile, epochGenesisFileText, epochGenesisCalldataHex,
  type TimelineBundle, type AttestedResult,
} from "@mikeargento/bitgraph-verify";
import type { BitGraphProof } from "bitgraph";
import { encodeBaseHeaderRlp, type RpcBlock } from "../src/parent/base-head.js";
import { startStack, post, randomDigestB64 } from "./lib.mts";

const hex = (u: Uint8Array) => "0x" + Buffer.from(u).toString("hex");
const utf8 = (s: string) => new TextEncoder().encode(s);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
let failures = 0;
const check = (ok: boolean, what: string) => { console.log(`${ok ? "PASS" : "FAIL"}  ${what}`); if (!ok) failures++; };

/** A chain that makes a block every `spacingS`, stamped with wall time, served by two nodes on two ports. */
async function fakeChain(chainId: number, spacingS: number) {
  const blocks: RpcBlock[] = [];
  const make = (n: number, parentHash: string, ts: number): RpcBlock => {
    const b: RpcBlock = {
      hash: "", parentHash, sha3Uncles: hex(keccak_256(Uint8Array.of(0xc0))), miner: "0x" + "00".repeat(20),
      stateRoot: hex(keccak_256(utf8(`${chainId} state ${n}`))), transactionsRoot: hex(keccak_256(utf8(`tx ${n}`))), receiptsRoot: hex(keccak_256(utf8(`rc ${n}`))),
      logsBloom: "0x" + "00".repeat(256), difficulty: "0x0", number: "0x" + n.toString(16), gasLimit: "0x1c9c380", gasUsed: "0x5208",
      timestamp: "0x" + ts.toString(16), extraData: "0x", mixHash: hex(keccak_256(utf8(`mix ${n}`))), nonce: "0x" + "00".repeat(8),
      baseFeePerGas: "0x3b9aca00", withdrawalsRoot: hex(keccak_256(utf8(`w ${n}`))), blobGasUsed: "0x0", excessBlobGas: "0x0",
      parentBeaconBlockRoot: hex(keccak_256(utf8(`pb ${n}`))), requestsHash: hex(keccak_256(utf8(`rq ${n}`))),
    };
    b.hash = hex(keccak_256(encodeBaseHeaderRlp(b)));
    return b;
  };
  const start = 1000;
  const t0 = Math.floor(Date.now() / 1000);
  blocks.push(make(start, "0x" + "11".repeat(32), t0));
  const advance = () => {
    const want = start + Math.floor((Math.floor(Date.now() / 1000) - t0) / spacingS);
    while (start + blocks.length - 1 < want) {
      const prev = blocks[blocks.length - 1]!;
      const n = parseInt(prev.number, 16) + 1;
      blocks.push(make(n, prev.hash, t0 + spacingS * (n - start)));
    }
  };
  const serve = (): Promise<{ server: Server; url: string }> => new Promise((resolve) => {
    const server = createServer((req, res) => {
      let body = "";
      req.on("data", (c) => (body += c));
      req.on("end", () => {
        advance();
        const j = JSON.parse(body || "{}") as { id?: number; method?: string; params?: unknown[] };
        let result: unknown = null;
        if (j.method === "eth_chainId") result = "0x" + chainId.toString(16);
        if (j.method === "eth_getBlockByNumber") {
          const tag = j.params?.[0] as string;
          const b = tag === "latest" ? blocks[blocks.length - 1] : blocks[parseInt(tag, 16) - start];
          result = b ? { ...b, transactions: [] } : null;
        }
        if (j.method === "eth_getBlockByHash") { const b = blocks.find((x) => x.hash === j.params?.[0]); result = b ? { ...b, transactions: [] } : null; }
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify({ jsonrpc: "2.0", id: j.id ?? 1, result }));
      });
    });
    server.listen(0, "127.0.0.1", () => resolve({ server, url: `http://127.0.0.1:${(server.address() as { port: number }).port}` }));
  });
  const [a, b] = [await serve(), await serve()];
  return {
    urls: `${a.url},${b.url}`,
    lookup: (hash: string) => { advance(); const x = blocks.find((y) => y.hash === hash); return x ? { hash: x.hash, number: parseInt(x.number, 16), timestamp: parseInt(x.timestamp, 16) } : null; },
    close: () => { a.server.close(); b.server.close(); },
  };
}

const base = await fakeChain(8453, 2);
const eth = await fakeChain(1, 4);
const state = mkdtempSync(join(tmpdir(), "timeline-smoke-"));
const genesisDir = join(state, "genesis");
const stack = await startStack({
  base: false,
  quiet: true,
  parentEnv: {
    TIMELINE: "on", TIMELINE_STATE_DIR: state, EPOCH_GENESIS_DIR: genesisDir,
    TIMELINE_BASE_RPC_URLS: base.urls, TIMELINE_ETHEREUM_RPC_URLS: eth.urls, TIMELINE_ETHEREUM_POLL_MS: "1000", TIMELINE_HARNESS_TIME: "on",
  },
});

try {
  await sleep(7000);
  // A file, bound while the genesis write is pending: /commit is not held.
  const fileDigest = randomDigestB64();
  const c = await post(`${stack.parentUrl}/commit`, { digests: [{ digestB64: fileDigest, hashAlg: "sha256" }] });
  check(c.status === 200, `a file binds while the genesis write is pending (HTTP ${c.status})`);
  const b64url = fileDigest.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  const early = await fetch(`${stack.parentUrl}/timeline/bundle?digest=${b64url}`);
  check(early.status === 409, `right after the bind its bundle is not ready yet (HTTP ${early.status}, retry after ${early.headers.get("retry-after")} s)`);
  await sleep(5000);

  // The ceiling writer's part: the genesis transaction is mined, and its result file appears.
  const req = readdirSync(genesisDir).find((f) => f.endsWith(".request.json"))!;
  const epochId = (JSON.parse(readFileSync(join(genesisDir, req), "utf8")) as { epochId: string }).epochId;
  const writer = "0x" + "f3".repeat(20);
  const g = { blockNumber: 53_400_000, blockHash: "0x" + "d2".repeat(32), blockTimestamp: Math.floor(Date.now() / 1000) - 3, txHash: "0x" + "8f".repeat(32) };
  writeFileSync(join(genesisDir, req.replace(".request.json", ".json")), epochGenesisFileText({ epochId, chainId: 8453, writer, ...g }));
  await sleep(6000);

  const health = (await (await fetch(`${stack.parentUrl}/health`)).json()) as { timeline?: { chains: Array<{ chain: string; reads: number; behind: number | null; lastError: string | null; lastReadAtMs: number | null; lagS: number | null; medianLag5mS: number | null; outOfRange: number }>; problems: string[] } };
  for (const ch of health.timeline?.chains ?? []) {
    console.log(`      /health ${ch.chain}: ${ch.reads} reads, last ${ch.lastReadAtMs ? new Date(ch.lastReadAtMs).toISOString() : "none"}, lag ${ch.lagS?.toFixed(2)} s, 5-min median ${ch.medianLag5mS?.toFixed(2)} s, out of range ${ch.outOfRange}, behind ${ch.behind}, error ${ch.lastError}`);
  }
  check((health.timeline?.chains.length ?? 0) === 2, "/health reports both chains");
  check((health.timeline?.chains ?? []).every((c) => typeof c.lagS === "number" && typeof c.medianLag5mS === "number" && c.outOfRange === 0), "/health gives each chain's lag, 5-minute median and out-of-range count");

  const lines = readFileSync(join(state, "journal", "pending.jsonl"), "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l) as { kind: string; proof: BitGraphProof; blockFile?: string; genesisFile?: string });
  lines.sort((x, y) => Number(x.proof.commit.counter) - Number(y.proof.commit.counter));
  for (const chain of ["base", "ethereum"]) {
    const nums = lines.filter((l) => l.kind === "block" && parseBlockReadFile(l.blockFile!)!.chain === chain).map((l) => parseBlockReadFile(l.blockFile!)!.number);
    check(nums.length > 1 && nums.every((n, i) => i === 0 || n === nums[i - 1]! + 1), `${chain}: ${nums.length} blocks bound in order with no gap (${nums[0]}..${nums[nums.length - 1]})`);
  }
  const stretch = verifyStretch(lines.map((l) => l.proof));
  check(stretch.ok, `one unbroken run of ${lines.length} records, counts ${stretch.from}..${stretch.to}${stretch.ok ? "" : ": " + stretch.reasons.join("; ")}`);
  const genesisLine = lines.find((l) => l.kind === "genesis");
  const fileIdx = lines.findIndex((l) => l.proof.artifact.digestB64 === fileDigest);
  check(!!genesisLine && Number(genesisLine.proof.commit.counter) > Number(lines[fileIdx]!.proof.commit.counter), "the genesis record is bound, after the pre-genesis file");

  // The bundle, as GET /timeline/bundle exports it.
  const exp = await fetch(`${stack.parentUrl}/timeline/bundle?digest=${b64url}`);
  const got = (await exp.json()) as { bundle: TimelineBundle; chain: string; notes: string[] };
  check(exp.status === 200 && got.bundle?.genesis !== undefined, `GET /timeline/bundle exports it (HTTP ${exp.status}, ${got.bundle?.proofs.length} proofs on ${got.chain}, genesis included)`);
  const bundle = got.bundle;
  const run = bundle.proofs;
  const harnessTime = (p: BitGraphProof) => Number(new TextDecoder().decode(Buffer.from(p.environment.attestation!.reportB64, "base64")).split(":")[2]);
  const r = await verifyTimelineBundle({
    bundle,
    attested: async (o): Promise<AttestedResult> => {
      const base = { checks: [], pcr0: null, image: null, artifactBinding: o.bytes ? "checked" as const : "not-checked" as const };
      if (o.bytes && Buffer.from(sha256(o.bytes)).toString("base64") !== o.proof.artifact.digestB64) return { ...base, valid: false, reason: "bytes", attestedAtMs: null };
      const v = await verifyProofIntegrity({ proof: o.proof, trustAnchors: { requireAtomic: true } });
      return v.valid ? { ...base, valid: true, attestedAtMs: harnessTime(o.proof) } : { ...base, valid: false, reason: v.reason ?? "invalid", attestedAtMs: null };
    },
    lookups: {
      block: async (chain, chainId, hash) => { const x = (chain === "base" ? base : eth).lookup(hash); return x ? { chainId, ...x, canonical: true } : null; },
      genesisTx: async (h) => (h === g.txHash ? { from: writer, to: writer, input: epochGenesisCalldataHex(epochId), blockHash: g.blockHash, blockNumber: g.blockNumber } : null),
      genesisBlock: async (h) => (h === g.blockHash ? { hash: h, number: g.blockNumber, timestamp: g.blockTimestamp } : null),
    },
  });
  console.log(`      bundle: ${run.length} proofs; floor: ${r.floor?.claim ?? "none"} (lag ${r.floor?.lagS})`);
  console.log(`      ceiling: ${r.ceiling?.claim ?? "none"}`);
  for (const x of [...r.reasons, ...r.unconfirmed, ...r.flags]) console.log(`      ${x}`);
  check(r.status === "verified", `the file's bundle verifies (${r.status}; genesis ${r.genesis}, pre-genesis ${r.preGenesis})`);
} finally {
  stack.stop();
  base.close();
  eth.close();
}
console.log(failures === 0 ? "\nall checks pass" : `\n${failures} check(s) failed`);
process.exit(failures === 0 ? 0 : 1);
