/**
 * Output-root settlement (bitgraph-output-root/1) in the writer's loop, against
 * mocked RPCs. Nothing here touches a network.
 *
 * Real data first: the RPC mocks replay spec/vectors/output-root-1.json (the
 * ceiling transaction in Base block 52,107,106, summary block P = 52,109,160,
 * its claim in Ethereum block 26,110,095) and fixtures/output-root/
 * live-52109160.json (P's header fields and message-passer proof, the seven
 * real DisputeGameCreated logs around the claim, each game's
 * l2SequenceNumber, gameAtIndex). The claim block's full transaction list
 * (about 700 KB) is not carried: its evidence (header, inclusion proof, raw
 * transaction) comes from the vector through the settler's `evidence` hook,
 * and is checked by verifyOutputRootSettlement like any other.
 *
 * Then a synthetic world, built here: Base blocks whose state tries hold the
 * message passer and the EIP-2935 history contract, and Ethereum blocks
 * carrying claims. It covers B = P, ceilings falling out of the window, missed
 * windows, a mismatching rootClaim, restarts and the create-only store.
 *
 *   node --import tsx/esm --test src/ceiling/__tests__/output-root.test.ts
 */

import { test, describe } from "node:test";
import * as assert from "node:assert/strict";
import { readFileSync, existsSync, mkdtempSync, appendFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHash, randomBytes } from "node:crypto";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { keccak256 as vk, type Hex } from "viem";
import {
  computeOutputRoot, historySlot, keccak256, rlpEncode, txTrieProof, verifyOutputRootSettlement,
  evmBytesToHex as bytesToHex, evmHexToBytes as hexToBytes,
  HISTORY_STORAGE_ADDRESS, BASE_DISPUTE_GAME_FACTORY,
  type OutputRootSettlement, type RlpItem, type SettlementPointer,
} from "@mikeargento/bitgraph-verify";
import { encodeHeaderRlp, type BlockEvidence, type Rpc, type RpcBlock } from "../block.js";
import { captureAtP, captureWindow, learnCadence, nextSummaryBlock, MESSAGE_PASSER_ADDRESS, DISPUTE_GAME_CREATED_TOPIC, SELECTORS, type GameSeen } from "../output-root-capture.js";
import { settlementKey, windowKey, type CreateOnlyStore, type OutputRootOptions } from "../output-root-settler.js";
import { rpcPool, rpcErrorKind, classifyRpcError, endpointList, RpcError } from "../rpc-pool.js";
import { CeilingWriter, type Batch, type Chain, type Inclusion, type SettlementTarget } from "../writer.js";
import type { FetchLike, SettlementFound } from "../settlement.js";
import type { CeilingQueueItem } from "../../parent/ceiling-queue.js";

// ── shared ─────────────────────────────────────────────────────────────────

const VECTOR = JSON.parse(readFileSync(new URL("../../../../../spec/vectors/output-root-1.json", import.meta.url), "utf8")) as {
  ceilingTx: { txHash: string; rawTx: string; from: string; blockNumber: number; blockHash: string; blockTimestamp: number; header: string; txIndex: number; txInclusionProof: string[] };
  settlement: OutputRootSettlement & { game: NonNullable<OutputRootSettlement["game"]> };
  expected: { outputRoot: string; existedBy: { chainId: number; blockNumber: number; blockHash: string; blockTimestamp: number } };
};
const LIVE = JSON.parse(readFileSync(new URL("./fixtures/output-root/live-52109160.json", import.meta.url), "utf8")) as {
  base: { block: RpcBlock; messagePasserProof: { storageHash: string; accountProof: string[] } };
  l1: { logs: Array<{ blockNumber: string; topics: string[] }>; l2SequenceNumber: Record<string, string>; gameCount: number; gameAtIndex: Record<string, string> };
};
const B_REAL = VECTOR.ceilingTx.blockNumber;
const P_REAL = VECTOR.settlement.outputRoot.blockNumber;
const BASE_GENESIS = 1686789347;

const hex = (n: number | bigint): string => "0x" + BigInt(n).toString(16);
const word = (n: number | bigint): string => BigInt(n).toString(16).padStart(64, "0");
const u = (n: number | bigint): Uint8Array => {
  let h = BigInt(n).toString(16);
  if (h === "0") return new Uint8Array(0);
  if (h.length % 2) h = "0" + h;
  return hexToBytes(h);
};
const stripZeros = (b: Uint8Array): Uint8Array => { let i = 0; while (i < b.length && b[i] === 0) i++; return b.subarray(i); };

let seq = 0;
function item(): CeilingQueueItem {
  seq++;
  return { proofHash: createHash("sha256").update(`or${seq}`).digest("base64"), position: String(5000 + seq), epochId: "E1", chainId: "bitgraph:main", committedAt: new Date(Date.UTC(2026, 9, 3) + seq).toISOString(), floor: null };
}

/** A Map behind the create-only contract, counting every call. */
function memStore(initial: Record<string, string> = {}): CreateOnlyStore & { objects: Map<string, string>; calls: string[]; failNext: number } {
  const objects = new Map(Object.entries(initial));
  const s = {
    objects, calls: [] as string[], failNext: 0,
    async createOnly(key: string, body: string): Promise<"created" | "exists"> {
      s.calls.push(`create:${key}`);
      if (s.failNext > 0) { s.failNext--; throw new Error("S3: service unavailable"); }
      if (objects.has(key)) return "exists";
      objects.set(key, body);
      return "created";
    },
    async read(key: string): Promise<string | null> { s.calls.push(`read:${key}`); return objects.get(key) ?? null; },
  };
  return s;
}

/** A blob settlement for any target, as the blob finder would return it (the writer's other settlement). */
const VH = "0x01" + "aa".repeat(31);
function blobFound(t: SettlementTarget): SettlementFound {
  const pointer: SettlementPointer = {
    version: "bitgraph-settlement/1", baseBlockNumber: t.blockNumber, baseBlockHash: t.blockHash,
    l1: { chainId: 1, txHash: "0x" + "11".repeat(32), rawTx: "0x03c0", blockNumber: 26109000, blockHash: "0x" + "22".repeat(32), blockTimestamp: t.blockTimestamp + 60, blockHeader: "0xc0", txIndex: 3, txInclusionProof: ["0xc0"] },
    blobs: [{ versionedHash: VH, kzgCommitment: "0x" + "c0".repeat(48), index: 0 }],
    channel: { id: "0x" + "33".repeat(16), frames: 1, compression: "brotli", firstBaseBlock: t.blockNumber - 1, lastBaseBlock: t.blockNumber + 1 },
    located: { baseTxIndex: 0, txHash: t.txHash },
  };
  return { pointer, blobs: [{ versionedHash: VH, kzgCommitment: pointer.blobs[0]!.kzgCommitment, index: 0, bytes: new Uint8Array([1, 2, 3]) }] };
}

interface Rig {
  dir: string;
  mk: () => CeilingWriter;
  push: (...items: CeilingQueueItem[]) => void;
  events: () => Array<Record<string, unknown>>;
  alerts: Array<Record<string, unknown>>;
  sidecar: (i: CeilingQueueItem) => { settlement: SettlementPointer | null; status: string; anchor: { blockNumber: number; blockHash: string } | null };
  batches: () => Batch[];
  setClock: (ms: number) => void;
  published: string[];
}

function rig(chain: Chain, outputRoot: Omit<OutputRootOptions, "alert" | "everyMs" | "scanEveryMs">, opts: { blobs?: boolean; clockMs: number }): Rig {
  const dir = mkdtempSync(join(tmpdir(), "ceiling-output-root-"));
  const queuePath = join(dir, "queue.jsonl");
  let clock = opts.clockMs;
  const alerts: Array<Record<string, unknown>> = [];
  const published: string[] = [];
  const mk = () => new CeilingWriter({
    stateDir: dir, queuePath, chain, log: () => {}, now: () => new Date(clock),
    ...(opts.blobs ? { settlement: { find: async (t: SettlementTarget) => blobFound(t), everyMs: -1, publishBlob: async (name: string) => { published.push(name); } } } : {}),
    outputRoot: { ...outputRoot, everyMs: -1, scanEveryMs: -1, alert: (e) => alerts.push(e) },
  });
  const push = (...items: CeilingQueueItem[]) => appendFileSync(queuePath, items.map((i) => JSON.stringify(i) + "\n").join(""));
  const events = () => (existsSync(join(dir, "events.jsonl")) ? readFileSync(join(dir, "events.jsonl"), "utf8") : "").trim().split("\n").filter(Boolean).map((l) => JSON.parse(l) as Record<string, unknown>);
  const sidecar = (i: CeilingQueueItem) => JSON.parse(readFileSync(join(dir, "sidecars", i.proofHash.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "") + ".ceiling.json"), "utf8"));
  const batches = () => {
    const w = new CeilingWriter({ stateDir: dir, queuePath, chain, log: () => {} });
    return w.snapshot().batches;
  };
  return { dir, mk, push, events, alerts, sidecar, batches, setClock: (ms) => { clock = ms; }, published };
}

const forceStatusPoll = (w: CeilingWriter) => { (w as unknown as { lastStatusPoll: number }).lastStatusPoll = 0; };

// ── real data ──────────────────────────────────────────────────────────────

/** The writer's chain for the vector: its one transaction lands in Base block 52,107,106, exactly as on mainnet. */
class VectorChain implements Chain {
  chainId = 8453;
  writer = VECTOR.ceilingTx.from;
  mined = false;
  safe = 0;
  finalized = 0;
  async head() { return B_REAL + (this.mined ? 1 : -1); }
  async nextNonce() { return 0; }
  async sign() { return { rawTx: VECTOR.ceilingTx.rawTx, txHash: VECTOR.ceilingTx.txHash, maxFeePerGas: "1", maxPriorityFeePerGas: "1" }; }
  async broadcast() { /* the bytes are already on Base */ }
  async inclusion(txHash: string): Promise<Inclusion | null> {
    if (!this.mined || txHash.toLowerCase() !== VECTOR.ceilingTx.txHash) return null;
    const c = VECTOR.ceilingTx;
    return { blockNumber: c.blockNumber, blockHash: c.blockHash, blockTimestamp: c.blockTimestamp, headerRlp: c.header, txIndex: c.txIndex, txInclusionProof: c.txInclusionProof, fees: { l2Wei: "1", l1Wei: "1", totalWei: "2", gasUsed: "29169" } };
  }
  async blockHashAt(n: number) { return n === B_REAL ? VECTOR.ceilingTx.blockHash : null; }
  async safeHead() { return this.safe; }
  async finalizedHead() { return this.finalized; }
  async balanceWei() { return 10n ** 18n; }
  async floorHeader() { return null; }
}

/** Base as mainnet.base.org answered: P = 52,109,160 from the fixture and the vector, every other summary block's state gone. */
function realBase(clock: () => number, calls: string[]): Rpc {
  const tagP = hex(P_REAL);
  return async (method, params) => {
    calls.push(`${method}:${String(params[0])}`);
    if (method === "eth_blockNumber") return hex(Math.floor((clock() / 1000 - BASE_GENESIS) / 2));
    if (method === "eth_getProof") {
      const [address, slots, tag] = params as [string, string[], string];
      if (tag !== tagP) throw new Error(`eth_getProof: no state found for block number ${parseInt(tag, 16)}`);
      if (address === MESSAGE_PASSER_ADDRESS) return { ...LIVE.base.messagePasserProof, storageProof: [] };
      if (address === HISTORY_STORAGE_ADDRESS && slots[0] === VECTOR.settlement.history!.slot) {
        return { accountProof: VECTOR.settlement.history!.accountProof, storageHash: "0x", storageProof: [{ key: slots[0], value: VECTOR.ceilingTx.blockHash, proof: VECTOR.settlement.history!.storageProof }] };
      }
      throw new Error("eth_getProof: not in this fixture");
    }
    if (method === "eth_getBlockByNumber" && params[0] === tagP) return LIVE.base.block;
    throw new Error(`base mock: ${method} ${JSON.stringify(params)}`);
  };
}

/** Ethereum as publicnode answered, with a movable finalized head. */
function realL1(calls: string[]): { rpc: Rpc; finalized: number } {
  const st = { finalized: 0, rpc: (async () => null) as Rpc };
  st.rpc = async (method, params) => {
    calls.push(method);
    if (method === "eth_getBlockByNumber" && params[0] === "finalized") return { number: hex(st.finalized) };
    if (method === "eth_getLogs") {
      const f = params[0] as { address: string; fromBlock: string; toBlock: string; topics: string[] };
      assert.equal(f.address, BASE_DISPUTE_GAME_FACTORY);
      assert.equal(f.topics[0], DISPUTE_GAME_CREATED_TOPIC);
      const from = parseInt(f.fromBlock, 16);
      const to = parseInt(f.toBlock, 16);
      assert.ok(to <= st.finalized, "the scan never reads past the finalized block");
      assert.ok(to - from < 500, "one request covers at most 500 blocks");
      return LIVE.l1.logs.filter((l) => parseInt(l.blockNumber, 16) >= from && parseInt(l.blockNumber, 16) <= to);
    }
    if (method === "eth_call") {
      const { to, data } = params[0] as { to: string; data: string };
      if (data === SELECTORS.l2SequenceNumber && LIVE.l1.l2SequenceNumber[to]) return LIVE.l1.l2SequenceNumber[to];
      if (data === SELECTORS.l2BlockNumber) throw new RpcError("eth_call: execution reverted", "rpc");
      if (to === BASE_DISPUTE_GAME_FACTORY && data === SELECTORS.gameCount) return "0x" + word(LIVE.l1.gameCount);
      if (to === BASE_DISPUTE_GAME_FACTORY && data.startsWith(SELECTORS.gameAtIndex)) {
        const i = Number(BigInt("0x" + data.slice(10)));
        const r = LIVE.l1.gameAtIndex[String(i)];
        if (r) return r;
      }
      throw new RpcError("eth_call: execution reverted", "rpc");
    }
    throw new Error(`l1 mock: ${method}`);
  };
  return st;
}

/** The claim transaction's evidence, from the vector (its block's 226 transactions are not carried). */
async function vectorEvidence(blockHash: string, txHash: string): Promise<BlockEvidence> {
  const e = VECTOR.settlement.ethereum;
  assert.equal(blockHash, e.blockHash);
  assert.equal(txHash, e.txHash);
  return { blockNumber: e.blockNumber, blockHash: e.blockHash, blockTimestamp: e.blockTimestamp, headerRlp: e.header, txIndex: e.txIndex, txInclusionProof: e.txInclusionProof, rawTx: e.rawTx };
}

const timeOf = (n: number) => (BASE_GENESIS + 2 * n) * 1000;

function realRig(store = memStore()) {
  const chain = new VectorChain();
  const baseCalls: string[] = [];
  const l1Calls: string[] = [];
  let clockMs = timeOf(B_REAL) + 4000;
  const l1 = realL1(l1Calls);
  const r = rig(chain, { base: realBase(() => clockMs, baseCalls), l1: (m, p) => l1.rpc(m, p), store, evidence: vectorEvidence }, { blobs: true, clockMs });
  const setClock = (ms: number) => { clockMs = ms; r.setClock(ms); };
  return { ...r, chain, store, l1, baseCalls, l1Calls, setClock };
}

describe("real data: the vector's ceiling, settled by the writer", () => {
  test("a full run: three windows missed, P = 52,109,160 captured, its claim attached; the stored settlement is the vector's byte for byte, and the blob settlement still runs", async () => {
    const r = realRig();
    const w = r.mk();
    const it = item();
    r.push(it);
    r.l1.finalized = 26109450; // before any of the fixture's games
    await w.tick(); // sent
    r.chain.mined = true;
    await w.tick(); // included in Base block 52,107,106
    assert.equal(r.sidecar(it).anchor!.blockNumber, B_REAL);
    r.chain.safe = B_REAL;
    forceStatusPoll(w);
    await w.tick(); // safe: the blob settlement is found and its blob published
    assert.equal(r.sidecar(it).status, "safe");
    assert.ok(r.sidecar(it).settlement, "the blob settlement pointer is on the sidecar");
    assert.deepEqual(r.published, [`blobs/${VH}.bin`]);
    const start = r.events().find((e) => e["type"] === "output-root-start")!;
    assert.ok((start["trackFrom"] as number) < B_REAL);
    assert.equal(r.store.objects.size, 0, "nothing is due yet: P's are ahead of the clock");

    // An hour later, as if the writer had been away: the three summary blocks before
    // 52,109,160 are gone from the node, and Ethereum has finalized five of the games.
    r.setClock(timeOf(P_REAL) + 40_000);
    r.l1.finalized = 26109900;
    await w.tick();
    const missed = r.events().filter((e) => e["type"] === "output-root-missed");
    assert.deepEqual(missed.map((e) => e["p"]), [52107360, 52107960, 52108560]);
    for (const m of missed) assert.match(String(m["error"]), /no state found for block number/);
    const cads = r.events().filter((e) => e["type"] === "output-root-cadence");
    assert.equal(cads[0]!["learned"], false, "before any game: the fallback");
    const cad = cads[cads.length - 1]!;
    assert.equal(cad["spacing"], 600, "the spacing is learned from the real games");
    assert.equal(cad["learned"], true);
    const win = r.events().find((e) => e["type"] === "output-root-window")!;
    assert.equal(win["p"], P_REAL);
    assert.equal(win["outputRoot"], VECTOR.expected.outputRoot, "the computed output root is the one Base claimed");
    assert.deepEqual(win["ceilings"], [B_REAL]);
    const stored = JSON.parse(r.store.objects.get(windowKey(P_REAL))!) as Record<string, unknown> & { ceilings: Array<{ blockNumber: number; history: unknown }> };
    assert.equal(stored["version"], "bitgraph-output-root-window/1");
    assert.equal(stored["outputRoot"], VECTOR.expected.outputRoot);
    assert.deepEqual(stored.ceilings[0]!.history, VECTOR.settlement.history);
    assert.ok(!r.store.objects.has(settlementKey(B_REAL)), "no settlement before the claim");

    // The claim lands and is finalized.
    r.l1.finalized = 26110165;
    await w.tick();
    const body = r.store.objects.get(settlementKey(B_REAL));
    assert.ok(body, "the settlement is stored at ceilings/settlements/output-root/<B>.json");
    const s = JSON.parse(body!) as OutputRootSettlement;
    assert.deepEqual(s, VECTOR.settlement, "the writer rebuilt exactly the captured vector, game index included");
    const v = verifyOutputRootSettlement(s);
    assert.equal(v.ok, true);
    assert.deepEqual(v.existedBy, VECTOR.expected.existedBy);
    const ev = r.events().find((e) => e["type"] === "output-root-settlement")!;
    assert.deepEqual(ev["ceilings"], [B_REAL]);
    assert.equal(ev["l1BlockNumber"], 26110095);
    assert.equal(ev["gameIndex"], 23386);
    assert.deepEqual(ev["latencySeconds"], [VECTOR.expected.existedBy.blockTimestamp - VECTOR.ceilingTx.blockTimestamp]);
    const b = r.batches()[0]!;
    assert.equal(b.outputRoot?.status, "settled");
    assert.equal(b.outputRoot?.status === "settled" ? b.outputRoot.l1BlockNumber : 0, 26110095);
    assert.ok(b.settlement, "the batch keeps its blob settlement too");
    assert.equal(r.alerts.length, 0);

    // Nothing more to do: no capture, no store write, no claim lookup.
    const before = { base: r.baseCalls.length, store: r.store.calls.length, objects: r.store.objects.size };
    await w.tick();
    await w.tick();
    assert.equal(r.baseCalls.length, before.base);
    assert.equal(r.store.calls.length, before.store);
    assert.equal(r.store.objects.size, 2);
  });

  test("captureWindow keeps the good ceilings and lists the bad one; captureAtP throws on it", async () => {
    const calls: string[] = [];
    const base = realBase(() => timeOf(P_REAL) + 40_000, calls);
    const wrong = "0x" + "ee".repeat(32);
    const res = await captureWindow(base, P_REAL, [{ blockNumber: B_REAL, blockHash: VECTOR.ceilingTx.blockHash }, { blockNumber: B_REAL, blockHash: wrong }], { skipBad: true });
    assert.equal(res.window.outputRoot, VECTOR.expected.outputRoot);
    assert.deepEqual(res.window.ceilings.map((c) => c.blockHash), [VECTOR.ceilingTx.blockHash]);
    assert.equal(res.skipped.length, 1);
    assert.match(res.skipped[0]!.reason, /does not verify/);
    await assert.rejects(captureAtP(base, P_REAL, [{ blockNumber: B_REAL, blockHash: wrong }]), /does not verify/);
    assert.equal(calls[0], `eth_getProof:${MESSAGE_PASSER_ADDRESS}`, "the state-dependent call goes first");
  });

  test("captureWindow refuses a block that does not reproduce its hash, and a message-passer root its proof does not give", async () => {
    const good = realBase(() => 0, []);
    const tampered: Rpc = async (m, p) => (m === "eth_getBlockByNumber" ? { ...LIVE.base.block, stateRoot: "0x" + "11".repeat(32) } : good(m, p));
    await assert.rejects(captureWindow(tampered, P_REAL, []), /does not reproduce its hash/);
    const lying: Rpc = async (m, p) => (m === "eth_getProof" && (p[0] as string) === MESSAGE_PASSER_ADDRESS ? { ...LIVE.base.messagePasserProof, storageHash: "0x" + "22".repeat(32) } : good(m, p));
    await assert.rejects(captureWindow(lying, P_REAL, []), /not the one its account proof gives/);
  });

  test("the cadence of the real games: 600 blocks, anchored at the newest P", () => {
    const games: GameSeen[] = LIVE.l1.logs.map((l, i) => ({
      txHash: "0x" + i, l1BlockNumber: parseInt(l.blockNumber, 16), l1BlockHash: "0x", logIndex: 0,
      proxy: "0x" + l.topics[1]!.slice(26), gameType: parseInt(l.topics[2]!, 16), rootClaim: l.topics[3]!,
      p: Number(BigInt(LIVE.l1.l2SequenceNumber["0x" + l.topics[1]!.slice(26)]!)),
    }));
    assert.deepEqual(learnCadence(games), { anchor: P_REAL, spacing: 600, learned: true, irregular: false });
    assert.equal(nextSummaryBlock(P_REAL, B_REAL, 600), 52107360, "the first summary block at or after the vector's B");
    assert.deepEqual(learnCadence([]), { anchor: 52109160, spacing: 600, learned: false, irregular: false }, "no games: the fallback");
    const one = learnCadence(games.slice(-1));
    assert.equal(one.learned, false);
    assert.equal(one.anchor, P_REAL);
    const odd = learnCadence([...games, { ...games[0]!, proxy: "0xodd", l1BlockNumber: 26110200, p: P_REAL + 650 }]);
    assert.equal(odd.spacing, 600);
    assert.equal(odd.irregular, true);
  });
});

// ── a synthetic world ──────────────────────────────────────────────────────

/** A Merkle-Patricia trie over 32-byte keys (secure tries: state and storage), and proofs from it. */
type TNode = { kind: "leaf"; path: number[]; value: Uint8Array } | { kind: "ext"; path: number[]; child: TNode } | { kind: "branch"; children: Array<TNode | null> };
const nib = (b: Uint8Array): number[] => [...b].flatMap((x) => [x >> 4, x & 15]);
function hp(n: number[], leaf: boolean): Uint8Array {
  const odd = n.length % 2;
  const all = odd ? [(leaf ? 2 : 0) + 1, ...n] : [leaf ? 2 : 0, 0, ...n];
  const out = new Uint8Array(all.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = (all[2 * i]! << 4) | all[2 * i + 1]!;
  return out;
}
function buildTrie(es: Array<{ key: number[]; value: Uint8Array }>, depth: number): TNode {
  if (es.length === 1) return { kind: "leaf", path: es[0]!.key.slice(depth), value: es[0]!.value };
  let common = 0;
  for (;;) {
    const n = es[0]!.key[depth + common];
    if (n === undefined || es.some((e) => e.key[depth + common] !== n)) break;
    common++;
  }
  if (common > 0) return { kind: "ext", path: es[0]!.key.slice(depth, depth + common), child: buildTrie(es, depth + common) };
  const groups: Array<Array<{ key: number[]; value: Uint8Array }>> = Array.from({ length: 16 }, () => []);
  for (const e of es) groups[e.key[depth]!]!.push(e);
  return { kind: "branch", children: groups.map((g) => (g.length ? buildTrie(g, depth + 1) : null)) };
}
const EMPTY_TRIE = keccak256(rlpEncode(new Uint8Array(0)));
function secureTrie(entries: Array<{ key: Uint8Array; value: Uint8Array }>): { root: Uint8Array; proof: (key: Uint8Array) => string[] } {
  if (entries.length === 0) return { root: EMPTY_TRIE, proof: () => { throw new Error("empty trie"); } };
  const root = buildTrie(entries.map((e) => ({ key: nib(e.key), value: e.value })), 0);
  const memo = new Map<TNode, Uint8Array>();
  const item = (n: TNode): RlpItem => (n.kind === "leaf" ? [hp(n.path, true), n.value] : n.kind === "ext" ? [hp(n.path, false), ref(n.child)] : [...n.children.map((c) => (c ? ref(c) : new Uint8Array(0))), new Uint8Array(0)]);
  const enc = (n: TNode): Uint8Array => { let e = memo.get(n); if (!e) { e = rlpEncode(item(n)); memo.set(n, e); } return e; };
  const ref = (n: TNode): RlpItem => { const e = enc(n); return e.length < 32 ? item(n) : keccak256(e); };
  return {
    root: keccak256(enc(root)),
    proof(key) {
      const target = nib(key);
      const out = [enc(root)];
      let node = root;
      let depth = 0;
      while (node.kind !== "leaf") {
        let next: TNode | null;
        if (node.kind === "ext") { depth += node.path.length; next = node.child; } else { next = node.children[target[depth]!] ?? null; depth++; }
        if (!next) throw new Error("key not in trie");
        const e = enc(next);
        if (e.length >= 32) out.push(e);
        node = next;
      }
      return out.map(bytesToHex);
    },
  };
}

const SYN_GENESIS = 1_790_000_000;
const synTime = (n: number) => (SYN_GENESIS + 2 * n) * 1000;

/** Base: blocks whose state holds the message passer and the history contract (the ceiling blocks' hashes). */
class SynthBase {
  head = 0;
  calls: string[] = [];
  /** Summary blocks whose state the node no longer holds. */
  unserved: (p: number) => boolean = () => false;
  /** Thrown once by the next eth_getProof (a rate limit, say). */
  failNext: Error | null = null;
  /** Asked before every eth_getProof: an error to refuse it with, or null to answer. */
  proofGate: (() => Error | null) | null = null;
  /** Every eth_getProof answered, as "address:slot:P". */
  served: string[] = [];
  readonly hashes = new Map<number, string>();
  private readonly txs = new Map<number, Uint8Array[]>();
  private readonly blocks = new Map<number, { json: RpcBlock; hash: string; rlp: Uint8Array; state: ReturnType<SynthBase["stateFor"]> }>();
  private readonly mpStorageRoot = randomBytes(32);
  private readonly codeHash = randomBytes(32);

  private stateFor(h: number) {
    const inWindow = [...this.hashes].filter(([b]) => h - b >= 1 && h - b <= 8191);
    const storage = secureTrie(inWindow.map(([b, hash]) => ({ key: keccak256(historySlot(b)), value: rlpEncode(stripZeros(hexToBytes(hash))) })));
    const account = (storageRoot: Uint8Array) => rlpEncode([new Uint8Array(0), new Uint8Array(0), storageRoot, this.codeHash]);
    const state = secureTrie([
      { key: keccak256(hexToBytes(MESSAGE_PASSER_ADDRESS)), value: account(this.mpStorageRoot) },
      { key: keccak256(hexToBytes(HISTORY_STORAGE_ADDRESS)), value: account(storage.root) },
    ]);
    return { state, storage, inWindow: new Map(inWindow) };
  }

  block(h: number) {
    let b = this.blocks.get(h);
    if (b) return b;
    const state = this.stateFor(h);
    const txs = this.txs.get(h) ?? [hexToBytes("0x7e01")];
    const zero = (n: number) => "0x" + "00".repeat(n);
    const json: RpcBlock = {
      hash: "", parentHash: "0x" + "ab".repeat(32), sha3Uncles: zero(32), miner: zero(20), stateRoot: bytesToHex(state.state.root),
      transactionsRoot: bytesToHex(txTrieProof(txs, 0).root), receiptsRoot: zero(32), logsBloom: zero(256), difficulty: "0x0", number: hex(h),
      gasLimit: "0x1c9c380", gasUsed: "0x5208", timestamp: hex(SYN_GENESIS + 2 * h), extraData: "0x", mixHash: zero(32), nonce: zero(8), transactions: [],
    };
    const rlp = encodeHeaderRlp(json);
    json.hash = bytesToHex(keccak256(rlp));
    b = { json, hash: json.hash, rlp, state };
    this.blocks.set(h, b);
    return b;
  }

  /** The ceiling transaction lands in block h: the header carries it, the history contract will hold its hash. */
  mine(h: number, raw: Uint8Array): Omit<Inclusion, "fees"> {
    assert.ok(!this.blocks.has(h), "a block is built once");
    const txs = [hexToBytes("0x7e01"), raw];
    this.txs.set(h, txs);
    const b = this.block(h);
    this.hashes.set(h, b.hash);
    const { proof } = txTrieProof(txs, 1);
    return { blockNumber: h, blockHash: b.hash, blockTimestamp: SYN_GENESIS + 2 * h, headerRlp: bytesToHex(b.rlp), txIndex: 1, txInclusionProof: proof.map(bytesToHex) };
  }

  outputRoot(p: number): string {
    const b = this.block(p);
    return bytesToHex(computeOutputRoot({ blockNumber: p, version: "0x" + "00".repeat(32), stateRoot: b.json.stateRoot, messagePasserStorageRoot: bytesToHex(this.mpStorageRoot), blockHash: b.hash }));
  }

  rpc: Rpc = async (method, params) => {
    this.calls.push(`${method}:${typeof params[2] === "string" ? parseInt(params[2], 16) : String(params[0])}`);
    if (method === "eth_blockNumber") return hex(this.head);
    if (method === "eth_getBlockByNumber") {
      const h = parseInt(params[0] as string, 16);
      return h <= this.head ? this.block(h).json : null;
    }
    if (method === "eth_getProof") {
      const [address, slots, tag] = params as [string, string[], string];
      const p = parseInt(tag, 16);
      if (this.failNext) { const e = this.failNext; this.failNext = null; throw e; }
      const gated = this.proofGate?.();
      if (gated) throw gated;
      if (this.unserved(p)) throw new Error(`eth_getProof: no state found for block number ${p}`);
      this.served.push(`${address}:${slots[0] ?? ""}:${p}`);
      const { state, storage, inWindow } = this.block(p).state;
      if (address === MESSAGE_PASSER_ADDRESS) return { accountProof: state.proof(keccak256(hexToBytes(address))), storageHash: bytesToHex(this.mpStorageRoot), storageProof: [] };
      const slot = slots[0]!;
      const b = [...inWindow.keys()].find((x) => bytesToHex(historySlot(x)) === slot);
      assert.ok(b !== undefined, "asked for a block the world does not hold");
      return { accountProof: state.proof(keccak256(hexToBytes(address))), storageHash: bytesToHex(storage.root), storageProof: [{ key: slot, value: inWindow.get(b), proof: storage.proof(keccak256(hexToBytes(slot))) }] };
    }
    throw new Error(`synthetic base: ${method}`);
  };
}

/** Ethereum: the factory's games, each in its own block with a claim transaction carrying the root. */
class SynthL1 {
  finalized = 10_000;
  calls: string[] = [];
  private readonly logs: Array<{ address: string; topics: string[]; blockNumber: string; blockHash: string; transactionHash: string; logIndex: string; removed: boolean }> = [];
  private readonly proxies: Array<{ proxy: string; p: number }> = [];
  private readonly evidence = new Map<string, BlockEvidence>();

  /** A game for summary block p claiming `root`, created in Ethereum block `at`. */
  game(p: number, root: string, at: number): { txHash: string; proxy: string } {
    const n = this.proxies.length + 1;
    const proxy = "0x" + n.toString(16).padStart(40, "0");
    const raw = new Uint8Array([0x02, ...rlpEncode([u(1), u(n), hexToBytes(root), u(p)])]);
    const { root: txRoot, proof } = txTrieProof([raw], 0);
    const ts = 1_790_100_000 + at * 12;
    const header = rlpEncode([new Uint8Array(32), new Uint8Array(32), new Uint8Array(20), new Uint8Array(32), txRoot, new Uint8Array(32), new Uint8Array(256), u(0), u(at), u(30_000_000), u(21_000), u(ts), new Uint8Array(0), new Uint8Array(32), new Uint8Array(8)]);
    const blockHash = bytesToHex(keccak256(header));
    const txHash = bytesToHex(keccak256(raw));
    this.evidence.set(txHash, { blockNumber: at, blockHash, blockTimestamp: ts, headerRlp: bytesToHex(header), txIndex: 0, txInclusionProof: proof.map(bytesToHex), rawTx: bytesToHex(raw) });
    this.logs.push({ address: BASE_DISPUTE_GAME_FACTORY, topics: [DISPUTE_GAME_CREATED_TOPIC, "0x" + proxy.slice(2).padStart(64, "0"), "0x" + word(621), root], blockNumber: hex(at), blockHash, transactionHash: txHash, logIndex: "0x0", removed: false });
    this.proxies.push({ proxy, p });
    return { txHash, proxy };
  }

  /** Applied to every evidence answer (to serve bytes that do not hold together). */
  tamper: ((e: BlockEvidence) => BlockEvidence) | null = null;

  evidenceFor = async (blockHash: string, txHash: string): Promise<BlockEvidence> => {
    const e = this.evidence.get(txHash);
    assert.ok(e && e.blockHash === blockHash);
    return this.tamper ? this.tamper(e) : e;
  };

  rpc: Rpc = async (method, params) => {
    this.calls.push(method);
    if (method === "eth_getBlockByNumber" && params[0] === "finalized") return { number: hex(this.finalized) };
    if (method === "eth_getLogs") {
      const f = params[0] as { fromBlock: string; toBlock: string };
      assert.ok(parseInt(f.toBlock, 16) <= this.finalized);
      return this.logs.filter((l) => parseInt(l.blockNumber, 16) >= parseInt(f.fromBlock, 16) && parseInt(l.blockNumber, 16) <= parseInt(f.toBlock, 16));
    }
    if (method === "eth_call") {
      const { to, data } = params[0] as { to: string; data: string };
      const g = this.proxies.find((x) => x.proxy === to);
      if (g && data === SELECTORS.l2SequenceNumber) return "0x" + word(g.p);
      if (to === BASE_DISPUTE_GAME_FACTORY && data === SELECTORS.gameCount) return "0x" + word(this.proxies.length);
      if (to === BASE_DISPUTE_GAME_FACTORY && data.startsWith(SELECTORS.gameAtIndex)) {
        const x = this.proxies[Number(BigInt("0x" + data.slice(10)))];
        if (x) return "0x" + word(621) + word(0) + x.proxy.slice(2).padStart(64, "0");
      }
      throw new RpcError("eth_call: execution reverted", "rpc");
    }
    throw new Error(`synthetic l1: ${method}`);
  };
}

/** The writer's chain over the synthetic Base: real signed transactions, mined at the height the test names. */
class SynthChain implements Chain {
  chainId = 8453;
  writer: string;
  private account = privateKeyToAccount(generatePrivateKey());
  private pending: string | null = null;
  private nonce = 0;
  private mined = new Map<string, Inclusion>();
  safe = 0;
  finalized = 0;
  constructor(private readonly world: SynthBase) { this.writer = this.account.address.toLowerCase(); }
  async head() { return this.world.head; }
  async nextNonce() { return this.nonce; }
  async sign(data: Uint8Array, nonce: number, bump: number) {
    const tip = 1_000_000n * BigInt(1 + bump);
    const rawTx = await this.account.signTransaction({ type: "eip1559", chainId: 8453, nonce, to: this.account.address, value: 0n, data: bytesToHex(data) as Hex, gas: 30_000n, maxFeePerGas: 2_000_000_000n + tip, maxPriorityFeePerGas: tip });
    return { rawTx, txHash: vk(rawTx), maxFeePerGas: String(2_000_000_000n + tip), maxPriorityFeePerGas: String(tip) };
  }
  async broadcast(rawTx: string) { this.pending = rawTx; }
  /** Mine the pending transaction in block h. */
  mine(h: number) {
    assert.ok(this.pending, "nothing to mine");
    const raw = this.pending;
    this.mined.set(vk(raw as Hex), { ...this.world.mine(h, hexToBytes(raw)), fees: { l2Wei: "1", l1Wei: "1", totalWei: "2", gasUsed: "21000" } });
    this.pending = null;
    this.nonce++;
    if (this.world.head < h) this.world.head = h;
  }
  async inclusion(txHash: string) { return this.mined.get(txHash.toLowerCase()) ?? null; }
  async blockHashAt(n: number) { return this.world.hashes.get(n) ?? null; }
  async safeHead() { return this.safe; }
  async finalizedHead() { return this.finalized; }
  async balanceWei() { return 10n ** 18n; }
  async floorHeader() { return null; }
}

function synthRig(o: { store?: ReturnType<typeof memStore>; blobs?: boolean } = {}) {
  const world = new SynthBase();
  const l1 = new SynthL1();
  const chain = new SynthChain(world);
  const store = o.store ?? memStore();
  let clockMs = synTime(0);
  const r = rig(chain, { base: world.rpc, l1: l1.rpc, store, evidence: l1.evidenceFor, rollup: { l2GenesisTime: SYN_GENESIS, blockTime: 2 } }, { blobs: o.blobs ?? false, clockMs });
  /** Base reaches block h (the clock with it). */
  const reach = (h: number, extraMs = 0) => { world.head = Math.max(world.head, h); clockMs = synTime(h) + extraMs; r.setClock(clockMs); };
  /** Two older games on the 600 grid (P = 4800, 5400), so the cadence is learned, not assumed. */
  l1.game(4800, "0x" + "01".repeat(32), 9_150);
  l1.game(5400, "0x" + "02".repeat(32), 9_200);
  /** One record anchored in Base block h. */
  const anchorAt = async (w: CeilingWriter, h: number): Promise<CeilingQueueItem> => {
    const it = item();
    r.push(it);
    reach(h - 1);
    await w.tick(); // sent
    chain.mine(h);
    reach(h, 2000);
    await w.tick(); // included
    assert.equal(r.sidecar(it).anchor!.blockNumber, h);
    return it;
  };
  return { ...r, world, l1, chain, store, reach, anchorAt };
}

describe("synthetic world", () => {
  test("B = P: the ceiling's own block is the summary block; the output root names it directly, no history proof", async () => {
    const r = synthRig();
    const w = r.mk();
    await r.anchorAt(w, 6000);
    assert.equal(r.events().filter((e) => e["type"] === "output-root-window").length, 0, "not yet: 15 blocks of margin");
    r.reach(6020);
    await w.tick();
    const win = r.events().find((e) => e["type"] === "output-root-window")!;
    assert.equal(win["p"], 6000);
    assert.deepEqual(win["ceilings"], [6000]);
    const stored = JSON.parse(r.store.objects.get(windowKey(6000))!) as { ceilings: Array<{ history: unknown }> };
    assert.equal(stored.ceilings[0]!.history, null);
    r.l1.game(6000, r.world.outputRoot(6000), 10_050);
    r.l1.finalized = 10_100;
    await w.tick();
    const s = JSON.parse(r.store.objects.get(settlementKey(6000))!) as OutputRootSettlement;
    assert.equal(s.history, null);
    assert.equal(s.outputRoot.blockNumber, 6000);
    assert.equal(s.outputRoot.blockHash, s.base.blockHash);
    assert.equal(s.base.blockHash, r.world.hashes.get(6000));
    const v = verifyOutputRootSettlement(s);
    assert.equal(v.ok, true, v.reason);
    assert.equal(v.existedBy!.blockNumber, 10_050);
    assert.equal(s.game!.index, 2, "the third game the factory made");
  });

  test("B < P inside the window: the history proof settles it, and a ceiling sits in each window until a claim settles it", async () => {
    const r = synthRig();
    const w = r.mk();
    await r.anchorAt(w, 6100);
    r.reach(6620);
    await w.tick(); // window 6600
    r.reach(7220);
    await w.tick(); // window 7200: the block is still unsettled, so it is in this one too
    const wins = r.events().filter((e) => e["type"] === "output-root-window");
    assert.deepEqual(wins.map((e) => [e["p"], e["ceilings"]]), [[6600, [6100]], [7200, [6100]]]);
    r.l1.game(6600, r.world.outputRoot(6600), 10_200);
    r.l1.game(7200, r.world.outputRoot(7200), 10_300);
    r.l1.finalized = 10_400;
    await w.tick();
    const s = JSON.parse(r.store.objects.get(settlementKey(6100))!) as OutputRootSettlement;
    assert.equal(s.outputRoot.blockNumber, 6600, "the first claim settles it");
    assert.ok(s.history);
    assert.equal(verifyOutputRootSettlement(s).ok, true);
    const claims = r.events().filter((e) => e["type"] === "output-root-claim");
    assert.equal(claims.length, 1, "the second window's claim finds nothing left to settle");
    assert.equal(claims[0]!["p"], 7200);
    assert.equal(r.store.calls.filter((c) => c === `create:${settlementKey(6100)}`).length, 1, "one settlement per block, written once");
  });

  test("a ceiling anchored between two summary blocks waits for the next window; it is not dropped", async () => {
    const r = synthRig();
    const w = r.mk();
    await r.anchorAt(w, 6100);
    r.reach(6620);
    await w.tick(); // window 6600 for 6100
    await r.anchorAt(w, 6700); // after 6600 was handled, before 7200
    r.reach(6800);
    await w.tick();
    await w.tick();
    assert.equal(r.events().filter((e) => e["type"] === "output-root-out-of-window").length, 0);
    assert.equal(r.batches().find((b) => b.inclusion!.blockNumber === 6700)!.outputRoot, undefined);
    r.reach(7220);
    await w.tick();
    const win = r.events().filter((e) => e["type"] === "output-root-window").pop()!;
    assert.equal(win["p"], 7200);
    assert.deepEqual(win["ceilings"], [6100, 6700]);
    r.l1.game(6600, r.world.outputRoot(6600), 10_200);
    r.l1.game(7200, r.world.outputRoot(7200), 10_300);
    r.l1.finalized = 10_400;
    await w.tick();
    assert.equal((JSON.parse(r.store.objects.get(settlementKey(6100))!) as OutputRootSettlement).outputRoot.blockNumber, 6600);
    assert.equal((JSON.parse(r.store.objects.get(settlementKey(6700))!) as OutputRootSettlement).outputRoot.blockNumber, 7200);
    const settled = r.events().filter((e) => e["type"] === "output-root-settlement").map((e) => [e["p"], e["ceilings"]]);
    assert.deepEqual(settled, [[6600, [6100]], [7200, [6700]]], "the second claim settles only what the first did not");
  });

  test("a missed window moves to the next summary block; a rate limit is not a miss", async () => {
    const r = synthRig();
    const w = r.mk();
    await r.anchorAt(w, 6100);
    r.world.unserved = (p) => p === 6600;
    r.world.failNext = new RpcError("eth_getProof: over rate limit", "rate");
    r.reach(7220, 0);
    r.setClock(synTime(7220) + 10 * 60_000); // ten minutes on: 6600 is old enough to count as gone
    await w.tick();
    const err = r.events().find((e) => e["type"] === "output-root-capture-error")!;
    assert.equal(err["kind"], "rate");
    assert.equal(r.events().filter((e) => e["type"] === "output-root-missed").length, 0, "a rate limit is asked again, not given up");
    await w.tick();
    const missed = r.events().filter((e) => e["type"] === "output-root-missed");
    assert.deepEqual(missed.map((e) => e["p"]), [6600]);
    assert.deepEqual(missed[0]!["ceilings"], [6100]);
    const win = r.events().find((e) => e["type"] === "output-root-window")!;
    assert.equal(win["p"], 7200, "the next summary block, in the same pass");
    r.l1.game(7200, r.world.outputRoot(7200), 10_300);
    r.l1.finalized = 10_400;
    await w.tick();
    const s = JSON.parse(r.store.objects.get(settlementKey(6100))!) as OutputRootSettlement;
    assert.equal(s.outputRoot.blockNumber, 7200);
    assert.equal(verifyOutputRootSettlement(s).ok, true);
  });

  test("after an outage: a summary block whose claim is not among the games read is skipped without a request; one whose claim is read is captured late and settled at once", async () => {
    const r = synthRig();
    const w = r.mk();
    await r.anchorAt(w, 6100);
    // Away for 1.4 hours: Ethereum has finalized the games for 7200 and 7800, the one for 6600 fell outside the scan.
    r.reach(8650);
    r.l1.finalized = 10_400;
    const g7200 = r.world.outputRoot(7200);
    r.l1.game(7200, g7200, 10_300);
    r.l1.game(7800, "0x" + "78".repeat(32), 10_350);
    const before = r.world.calls.filter((c) => c.startsWith("eth_getProof")).length;
    await w.tick();
    const missed = r.events().filter((e) => e["type"] === "output-root-missed");
    assert.deepEqual(missed.map((e) => [e["p"], e["reason"]]), [[6600, "no-claim"]]);
    assert.ok(!r.world.calls.slice(before).some((c) => c === "eth_getProof:6600"), "no request for 6600");
    const win = r.events().find((e) => e["type"] === "output-root-window")!;
    assert.equal(win["p"], 7200);
    await w.tick(); // the window is matched against the game already read
    const s = JSON.parse(r.store.objects.get(settlementKey(6100))!) as OutputRootSettlement;
    assert.equal(s.outputRoot.blockNumber, 7200);
    assert.equal(verifyOutputRootSettlement(s).ok, true);
  });

  test("a capture cut short by rate limits resumes where it stopped: no proof is fetched twice", async () => {
    const r = synthRig();
    const w = r.mk();
    await r.anchorAt(w, 6100);
    await r.anchorAt(w, 6200);
    await r.anchorAt(w, 6300);
    let k = 0;
    r.world.proofGate = () => (k++ % 2 === 1 ? new RpcError("eth_getProof: over rate limit", "rate") : null);
    r.reach(6620);
    let passes = 0;
    while (!r.events().some((e) => e["type"] === "output-root-window") && passes < 8) { await w.tick(); passes++; }
    const win = r.events().find((e) => e["type"] === "output-root-window")!;
    assert.deepEqual(win["ceilings"], [6100, 6200, 6300]);
    assert.equal(passes, 4, "one more proof per pass: message passer and 6100, then 6200, then 6300");
    assert.equal(new Set(r.world.served).size, r.world.served.length, "each proof was answered once");
    assert.equal(r.world.served.length, 4);
    assert.equal(r.world.calls.filter((c) => c === `eth_getBlockByNumber:${hex(6600)}`).length, 1, "P's header was asked once");
    assert.equal(r.events().filter((e) => e["type"] === "output-root-missed").length, 0);
  });

  test("a 'state not held' answer for a summary block younger than five minutes is retried, not a miss", async () => {
    const r = synthRig();
    const w = r.mk();
    await r.anchorAt(w, 6100);
    let refuse = true;
    r.world.unserved = (p) => refuse && p === 6600;
    r.reach(6620);
    await w.tick();
    assert.equal(r.events().filter((e) => e["type"] === "output-root-missed").length, 0);
    assert.equal(r.events().find((e) => e["type"] === "output-root-capture-error")!["kind"], "state");
    refuse = false;
    await w.tick();
    assert.equal(r.events().find((e) => e["type"] === "output-root-window")!["p"], 6600);
  });

  test("P - B > 8191: once no window can reach a ceiling it is logged out of the window, and keeps its blob settlement", async () => {
    const r = synthRig({ blobs: true });
    const w = r.mk();
    const it = await r.anchorAt(w, 6100);
    r.chain.safe = 6100;
    forceStatusPoll(w);
    await w.tick();
    assert.ok(r.sidecar(it).settlement, "the blob settlement");
    r.world.unserved = () => true; // the writer was away for five hours
    r.reach(6100 + 8191 + 700);
    await w.tick();
    const missed = r.events().filter((e) => e["type"] === "output-root-missed").map((e) => e["p"]);
    assert.deepEqual(missed, [6600, 7200, 7800, 8400, 9000, 9600, 10200, 10800, 11400, 12000, 12600, 13200, 13800]);
    const out = r.events().filter((e) => e["type"] === "output-root-out-of-window");
    assert.equal(out.length, 1);
    assert.equal(out[0]!["blockNumber"], 6100);
    assert.equal(out[0]!["blobSettlement"], true);
    assert.deepEqual(out[0]!["windows"], []);
    const b = r.batches()[0]!;
    assert.equal(b.outputRoot?.status, "out-of-window");
    assert.ok(b.settlement);
    assert.ok(r.sidecar(it).settlement, "the sidecar keeps its blob pointer");
    assert.equal([...r.store.objects.keys()].length, 0, "nothing stored");
    const calls = r.world.calls.length;
    await w.tick();
    assert.equal(r.world.calls.length, calls, "a dropped ceiling costs no more requests");
  });

  test("a claim with another root is logged loudly and settles nothing; the next window's claim settles the ceiling", async () => {
    const r = synthRig();
    const w = r.mk();
    await r.anchorAt(w, 6100);
    r.reach(6620);
    await w.tick(); // window 6600
    const wrong = "0x" + "66".repeat(32);
    r.l1.game(6600, wrong, 10_200);
    r.l1.finalized = 10_250;
    await w.tick();
    assert.equal(r.alerts.length, 1);
    const a = r.alerts[0]!;
    assert.equal(a["type"], "output-root-mismatch");
    assert.equal(a["severity"], "alert");
    assert.equal(a["p"], 6600);
    assert.equal(a["claimed"], wrong);
    assert.equal(a["computed"], r.world.outputRoot(6600));
    assert.ok(r.events().some((e) => e["type"] === "output-root-mismatch" && e["severity"] === "alert"), "and in the event log");
    assert.ok(!r.store.objects.has(settlementKey(6100)));
    r.reach(7220);
    await w.tick(); // window 7200 carries the block too
    r.l1.game(7200, r.world.outputRoot(7200), 10_300);
    r.l1.game(7800, "0x" + "78".repeat(32), 10_350);
    r.l1.finalized = 10_400;
    await w.tick();
    const s = JSON.parse(r.store.objects.get(settlementKey(6100))!) as OutputRootSettlement;
    assert.equal(s.outputRoot.blockNumber, 7200);
    assert.equal(verifyOutputRootSettlement(s).ok, true);
    const ended = r.events().find((e) => e["type"] === "output-root-window-ended")!;
    assert.equal(ended["p"], 6600);
    assert.equal(ended["reason"], "contradicted", "games two summary blocks on end the contradicted window");
    assert.equal(r.alerts.length, 1, "logged once");
  });

  test("a restart picks up where it stopped: no window captured twice, one settlement, and a lost mark is repaired from disk", async () => {
    const r = synthRig();
    let w = r.mk();
    await r.anchorAt(w, 6100);
    r.reach(6620);
    await w.tick(); // window 6600
    const proofsBefore = r.world.calls.filter((c) => c.startsWith("eth_getProof")).length;
    // A stop after the window record, before lastP was saved: the record alone keeps 6600 from a second capture.
    const statePath = join(r.dir, "output-root", "state.json");
    writeFileSync(statePath, JSON.stringify({ ...JSON.parse(readFileSync(statePath, "utf8")), lastP: null }));
    w = r.mk(); // restart
    await w.tick();
    await w.tick();
    assert.equal(r.world.calls.filter((c) => c.startsWith("eth_getProof")).length, proofsBefore, "the window is not captured again");
    assert.equal(w.snapshot().outputRoot!.lastP, 6600);
    assert.equal(r.alerts.length, 0);
    r.l1.game(6600, r.world.outputRoot(6600), 10_200);
    r.l1.finalized = 10_300;
    await w.tick();
    assert.ok(r.store.objects.has(settlementKey(6100)));
    const creates = r.store.calls.filter((c) => c.startsWith("create:")).length;
    w = r.mk(); // restart again
    await w.tick();
    await w.tick();
    assert.equal(r.store.calls.filter((c) => c.startsWith("create:")).length, creates, "nothing is written twice");
    assert.equal(r.events().filter((e) => e["type"] === "output-root-settlement").length, 1);
    // A stop between the window record and the batch's mark: the next start marks it from the file on disk.
    const b = r.batches()[0]!;
    const path = join(r.dir, "batches", `${b.id}.json`);
    const raw = JSON.parse(readFileSync(path, "utf8")) as Batch;
    delete raw.outputRoot;
    writeFileSync(path, JSON.stringify(raw));
    w = r.mk();
    assert.equal(w.snapshot().batches[0]!.outputRoot?.status, "settled");
    assert.ok(r.events().some((e) => e["type"] === "output-root-repair"));
  });

  test("the store is create-only: an object already there is never overwritten, and other content raises an alert", async () => {
    const theirs = '{"not":"ours"}';
    const store = memStore({ [settlementKey(6100)]: theirs, [windowKey(6600)]: theirs });
    const r = synthRig({ store });
    const w = r.mk();
    await r.anchorAt(w, 6100);
    r.reach(6620);
    await w.tick();
    r.l1.game(6600, r.world.outputRoot(6600), 10_200);
    r.l1.finalized = 10_300;
    await w.tick();
    assert.equal(store.objects.get(settlementKey(6100)), theirs, "left as it was");
    assert.equal(store.objects.get(windowKey(6600)), theirs);
    const differs = r.alerts.filter((e) => e["type"] === "output-root-store-differs").map((e) => e["key"]).sort();
    assert.deepEqual(differs, [settlementKey(6100), windowKey(6600)].sort());
    const local = JSON.parse(readFileSync(join(r.dir, settlementKey(6100)), "utf8")) as OutputRootSettlement;
    assert.equal(verifyOutputRootSettlement(local).ok, true, "the writer's own copy is on disk");
    assert.equal(r.batches()[0]!.outputRoot?.status, "settled");
    const calls = store.calls.length;
    await w.tick();
    assert.equal(store.calls.length, calls, "an existing object counts as stored: not asked again");
  });

  test("a store that fails keeps the files queued; they go out on a later pass", async () => {
    const store = memStore();
    const r = synthRig({ store });
    const w = r.mk();
    await r.anchorAt(w, 6100);
    r.reach(6620);
    store.failNext = 1;
    await w.tick();
    assert.ok(r.events().some((e) => e["type"] === "output-root-store-error"));
    assert.ok(existsSync(join(r.dir, windowKey(6600))), "the local copy is the journal");
    await w.tick();
    assert.ok(store.objects.has(windowKey(6600)));
  });

  test("a claim whose evidence never holds together is retried, then the window ends after watchMs; the ceiling moves on", async () => {
    const r = synthRig();
    const w = r.mk();
    await r.anchorAt(w, 6100);
    r.reach(6620);
    await w.tick(); // window 6600
    const { txHash } = r.l1.game(6600, r.world.outputRoot(6600), 10_200);
    r.l1.finalized = 10_300;
    r.l1.tamper = (e) => ({ ...e, rawTx: "0x02c0" }); // bytes that do not hash to the claim
    await w.tick();
    await w.tick();
    const errs = () => r.events().filter((e) => e["type"] === "output-root-attach-error");
    assert.equal(errs().length, 2, "asked again each pass");
    assert.equal(errs()[0]!["l1TxHash"], txHash);
    assert.match(String(errs()[0]!["error"]), /do not hash to its hash/);
    assert.ok(!r.store.objects.has(settlementKey(6100)), "nothing written from evidence that does not hold");
    assert.ok(!existsSync(join(r.dir, settlementKey(6100))));
    r.setClock(synTime(6620) + 25 * 3600_000);
    await w.tick();
    const ended = r.events().find((e) => e["type"] === "output-root-window-ended")!;
    assert.deepEqual([ended["p"], ended["reason"]], [6600, "timeout"]);
    const n = errs().length;
    await w.tick();
    await w.tick();
    assert.equal(errs().length, n, "an ended window is not asked about again");
    assert.equal(r.batches()[0]!.outputRoot, undefined, "the ceiling is still unsettled, for the next windows");
  });

  test("an idle writer asks nothing", async () => {
    const r = synthRig();
    const w = r.mk();
    await w.tick();
    await w.tick();
    assert.equal(r.world.calls.length, 0);
    assert.equal(r.l1.calls.length, 0);
  });
});

// ── the RPC pool ───────────────────────────────────────────────────────────

function fakeFetch(handlers: Record<string, Array<(body: { method: string }) => { status: number; json?: unknown; text?: string }>>): FetchLike & { log: string[] } {
  const log: string[] = [];
  const f = (async (url: string, init?: { body?: string }) => {
    const body = JSON.parse(init?.body ?? "{}") as { method: string };
    log.push(`${new URL(url).host}:${body.method}`);
    const queue = handlers[url]!;
    const h = queue.length > 1 ? queue.shift()! : queue[0]!;
    const r = h(body);
    return {
      ok: r.status >= 200 && r.status < 300, status: r.status,
      json: async () => { if (r.json === undefined) throw new SyntaxError("Unexpected token <"); return r.json; },
      text: async () => r.text ?? JSON.stringify(r.json),
    };
  }) as FetchLike & { log: string[] };
  f.log = log;
  return f;
}

describe("rpcPool", () => {
  const A = "https://a.example/v2/SECRETKEY";
  const Bu = "https://b.example";
  const ok = (result: unknown) => () => ({ status: 200, json: { jsonrpc: "2.0", id: 1, result } });
  const fail = (status: number, code: number, message: string) => () => ({ status, json: { jsonrpc: "2.0", id: 1, error: { code, message } } });
  const fastOpts = { sleep: async () => {}, minIntervalMs: 0 };

  test("a rate-limited endpoint cools down and the next answers; the one that answered is asked first next time", async () => {
    const f = fakeFetch({ [A]: [fail(429, -32016, "over rate limit")], [Bu]: [ok("0x10")] });
    const logs: Array<Record<string, unknown>> = [];
    const rpc = rpcPool([A, Bu], { ...fastOpts, fetch: f, log: (e) => logs.push(e) });
    assert.equal(await rpc("eth_blockNumber", []), "0x10");
    assert.equal(await rpc("eth_blockNumber", []), "0x10");
    assert.deepEqual(f.log, ["a.example:eth_blockNumber", "b.example:eth_blockNumber", "b.example:eth_blockNumber"]);
    assert.equal(logs[0]!["kind"], "rate");
    assert.equal(logs[0]!["endpoint"], "https://a.example", "only the origin is logged, never a key in the path");
    assert.ok(!JSON.stringify(logs).includes("SECRETKEY"));
  });

  test("when every endpoint says the state is gone, the call fails as 'state' after asking each once", async () => {
    const f = fakeFetch({
      [A]: [fail(200, -32603, "no state found for block number 50111073")],
      [Bu]: [fail(403, -32602, "Archive requests require a personal token. Get one at: https://www.allnodes.com/publicnode")],
    });
    const rpc = rpcPool([A, Bu], { ...fastOpts, fetch: f });
    await assert.rejects(rpc("eth_getProof", []), (e: unknown) => rpcErrorKind(e) === "state");
    assert.equal(f.log.length, 2);
  });

  test("a revert is an answer: returned at once, no other endpoint asked", async () => {
    const f = fakeFetch({ [A]: [fail(200, 3, "execution reverted")], [Bu]: [ok("0x1")] });
    const rpc = rpcPool([A, Bu], { ...fastOpts, fetch: f });
    await assert.rejects(rpc("eth_call", []), (e: unknown) => rpcErrorKind(e) === "rpc");
    assert.equal(f.log.length, 1);
  });

  test("a challenge page or a network error is transient: retried after a backoff, then given up within the wait cap", async () => {
    let calls = 0;
    const f = (async () => { calls++; if (calls === 1) throw new TypeError("fetch failed"); return { ok: false, status: 403, json: async () => { throw new SyntaxError("<html>"); }, text: async () => "<html>" }; }) as unknown as FetchLike;
    const slept: number[] = [];
    let now = 0;
    const rpc = rpcPool([A], { fetch: f, sleep: async (ms) => { slept.push(ms); now += ms; }, clock: () => now, minIntervalMs: 0, rounds: 3, backoffMs: 1000, maxWaitMs: 6000, transientCooldownMs: 500 });
    await assert.rejects(rpc("eth_blockNumber", []), (e: unknown) => rpcErrorKind(e) === "transient");
    assert.ok(calls >= 2, "asked again after the backoff");
    assert.ok(slept.reduce((a, b) => a + b, 0) <= 6000, "never waits past the cap");
  });

  test("requests to one endpoint are spaced by minIntervalMs", async () => {
    const f = fakeFetch({ [A]: [ok("0x1")] });
    let now = 1_000;
    const slept: number[] = [];
    const rpc = rpcPool([A], { fetch: f, minIntervalMs: 400, clock: () => now, sleep: async (ms) => { slept.push(ms); now += ms; } });
    await rpc("eth_blockNumber", []);
    now += 100;
    await rpc("eth_blockNumber", []);
    assert.deepEqual(slept, [300]);
  });

  test("errors are classified the way the live endpoints answer them", () => {
    assert.equal(classifyRpcError(429, -32016, "over rate limit"), "rate");
    assert.equal(classifyRpcError(200, -32603, "no state found for block number 1"), "state");
    assert.equal(classifyRpcError(403, -32602, "Archive requests require a personal token"), "state");
    assert.equal(classifyRpcError(200, -32000, "missing trie node abc (path ) state 0x is not available"), "state");
    assert.equal(classifyRpcError(403, null, "HTTP 403"), "transient");
    assert.equal(classifyRpcError(502, null, "HTTP 502"), "transient");
    assert.equal(classifyRpcError(200, 3, "execution reverted"), "rpc");
    assert.equal(rpcErrorKind(new Error("eth_getProof: no state found for block number 7")), "state");
    assert.equal(rpcErrorKind(new Error("fetch failed")), "transient");
    assert.equal(rpcErrorKind(new RpcError("x", "rate")), "rate");
    assert.deepEqual(endpointList(" https://x , ,https://y ", ["d"]), ["https://x", "https://y"]);
    assert.deepEqual(endpointList(undefined, ["d"]), ["d"]);
    assert.deepEqual(endpointList("", ["d"]), ["d"]);
  });
});
