/**
 * The writer against an in-memory chain that signs real transactions and
 * returns real inclusion evidence (a header over the rebuilt trie). Covers the
 * behaviours the build prompt names: one transaction in flight, coalescing,
 * replacement after 3 blocks, reorg re-queue, restart without loss, duplicates.
 *
 *   node --import tsx/esm --test src/ceiling/__tests__/writer.test.ts
 */

import { test } from "node:test";
import * as assert from "node:assert/strict";
import { mkdtempSync, readFileSync, appendFileSync, readdirSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { keccak256 as vk, type Hex } from "viem";
import {
  MerkleTree, ceilingLeaf, decodeCeilingPayload, decodeEip1559, evmBytesToHex, evmHexToBytes, keccak256,
  mptVerify, rlpEncode, txTrieKey, txTrieProof, merkleRootFromPath, ceilingPayloadHash,
  type CeilingSidecar,
} from "@mikeargento/bitgraph-verify";
import { EPOCH_CLOSE_REQUEST_FORMAT, type CloseResult } from "../close.js";
import { CeilingWriter, type Chain, type Inclusion } from "../writer.js";
import type { CeilingQueueItem } from "../../parent/ceiling-queue.js";

const u = (n: number | bigint): Uint8Array => {
  let h = BigInt(n).toString(16);
  if (h === "0") return new Uint8Array(0);
  if (h.length % 2) h = "0" + h;
  return evmHexToBytes(h);
};

class FakeChain implements Chain {
  chainId = 84532;
  writer: string;
  private account = privateKeyToAccount(generatePrivateKey());
  height = 100;
  mempool = new Map<number, string>(); // nonce -> raw (latest replacement wins)
  mined = new Map<string, Inclusion>(); // txHash -> inclusion
  blocks = new Map<number, string>(); // height -> hash
  nonce = 0;
  /** When false, sends sit in the mempool (to force replacement). */
  mining = true;
  safe = 0;
  finalized = 0;
  broadcasts = 0;
  constructor() { this.writer = this.account.address.toLowerCase(); }
  async head() { return this.height; }
  async nextNonce() { return this.nonce; }
  async sign(data: Uint8Array, nonce: number, bump: number) {
    const tip = 1_000_000n * BigInt(1 + bump);
    const rawTx = await this.account.signTransaction({
      type: "eip1559", chainId: this.chainId, nonce, to: this.account.address, value: 0n,
      data: evmBytesToHex(data) as Hex, gas: 30_000n, maxFeePerGas: 2_000_000_000n + tip, maxPriorityFeePerGas: tip,
    });
    return { rawTx, txHash: vk(rawTx), maxFeePerGas: String(2_000_000_000n + tip), maxPriorityFeePerGas: String(tip) };
  }
  async broadcast(rawTx: string) {
    this.broadcasts++;
    const n = Number(decodeEip1559(evmHexToBytes(rawTx)).nonce);
    this.mempool.set(n, rawTx);
  }
  /** Advance one block; include the pending tx for the next nonce if mining. */
  step() {
    this.height++;
    const raw = this.mining ? this.mempool.get(this.nonce) : undefined;
    const txs = [evmHexToBytes("0x7e01")];
    if (raw) txs.push(evmHexToBytes(raw));
    const { root, proof } = txTrieProof(txs, txs.length - 1);
    const hdr = rlpEncode([new Uint8Array(32), new Uint8Array(32), new Uint8Array(20), new Uint8Array(32), root, new Uint8Array(32),
      new Uint8Array(256), u(0), u(this.height), u(1), u(1), u(1_790_000_000 + this.height * 2), new Uint8Array(0), new Uint8Array(32), new Uint8Array(8)]);
    const hash = evmBytesToHex(keccak256(hdr));
    this.blocks.set(this.height, hash);
    if (raw) {
      this.mempool.delete(this.nonce);
      this.nonce++;
      this.mined.set(vk(raw as Hex), {
        blockNumber: this.height, blockHash: hash, blockTimestamp: 1_790_000_000 + this.height * 2, headerRlp: evmBytesToHex(hdr),
        txIndex: 1, txInclusionProof: proof.map(evmBytesToHex),
        fees: { l2Wei: "21000", l1Wei: "5", totalWei: "21005", gasUsed: "21000" },
      });
    }
  }
  async inclusion(txHash: string) {
    const inc = this.mined.get(txHash.toLowerCase()) ?? null;
    if (inc && this.blocks.get(inc.blockNumber) !== inc.blockHash) return null; // reorged away
    return inc;
  }
  async blockHashAt(n: number) { return this.blocks.get(n) ?? null; }
  async safeHead() { return this.safe; }
  async finalizedHead() { return this.finalized; }
  async balanceWei() { return 10n ** 18n; }
  async floorHeader() { return null; }
  /** Replace block n with a different one (the tx it held is gone). */
  reorg(n: number) {
    this.blocks.set(n, "0x" + "ee".repeat(32));
  }
}

let seq = 0;
function item(epoch = "E1", chain = "bitgraph:main"): CeilingQueueItem {
  seq++;
  return {
    proofHash: createHash("sha256").update(`p${seq}`).digest("base64"),
    position: String(1000 + seq), epochId: epoch, chainId: chain,
    committedAt: new Date(Date.UTC(2026, 8, 29) + seq).toISOString(), floor: null,
  };
}

function setup() {
  const dir = mkdtempSync(join(tmpdir(), "ceiling-writer-"));
  const queuePath = join(dir, "queue.jsonl");
  const chain = new FakeChain();
  const mk = () => new CeilingWriter({ stateDir: dir, queuePath, chain, log: () => {} });
  const push = (...items: CeilingQueueItem[]) => appendFileSync(queuePath, items.map((i) => JSON.stringify(i) + "\n").join(""));
  const sidecar = (i: CeilingQueueItem) =>
    JSON.parse(readFileSync(join(dir, "sidecars", i.proofHash.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "") + ".ceiling.json"), "utf8")) as CeilingSidecar;
  const events = () => (existsSync(join(dir, "events.jsonl")) ? readFileSync(join(dir, "events.jsonl"), "utf8") : "").trim().split("\n").filter(Boolean).map((l) => JSON.parse(l) as Record<string, unknown>);
  return { dir, chain, mk, push, sidecar, events };
}

function checkSidecar(s: CeilingSidecar, writer: string) {
  const root = merkleRootFromPath(ceilingLeaf(s.proofHash), s.leafIndex, s.leafCount, s.merklePath.map(evmHexToBytes));
  assert.equal(evmBytesToHex(root!), s.root);
  const p = decodeCeilingPayload(evmHexToBytes(s.anchor!.payload));
  assert.equal(evmBytesToHex(p.root), s.root);
  const tx = decodeEip1559(evmHexToBytes(s.anchor!.rawTx));
  assert.equal(tx.from, writer);
  assert.equal(tx.to, writer);
  const hdrRoot = (evmHexToBytes(s.anchor!.blockHeader));
  assert.ok(hdrRoot.length > 0);
  const val = mptVerify(
    (rlpDecodeTxRoot(s.anchor!.blockHeader)), txTrieKey(s.anchor!.txIndex), s.anchor!.txInclusionProof.map(evmHexToBytes),
  );
  assert.equal(evmBytesToHex(val!), s.anchor!.rawTx.toLowerCase());
}
import { decodeHeader } from "@mikeargento/bitgraph-verify";
function rlpDecodeTxRoot(h: string): Uint8Array { return evmHexToBytes(decodeHeader(evmHexToBytes(h)).transactionsRoot); }

test("a burst coalesces: one transaction in flight, the rest ride the next", async () => {
  const { dir, chain, mk, push, sidecar, events } = setup();
  const w = mk();
  const first = item();
  push(first);
  await w.tick(); // batch 1 sent (1 record)
  const burst = Array.from({ length: 50 }, () => item());
  push(...burst);
  await w.tick(); // still pending: no new tx
  assert.equal(chain.broadcasts, 1);
  chain.step(); // batch 1 mined
  await w.tick(); // batch 1 included
  await w.tick(); // batch 2 (50 records) sent
  chain.step();
  await w.tick();
  const writes = events().filter((e) => e["type"] === "write");
  assert.deepEqual(writes.map((e) => e["records"]), [1, 50]);
  checkSidecar(sidecar(first), chain.writer);
  for (const i of burst) checkSidecar(sidecar(i), chain.writer);
  // The anchors chain: batch 2's prev is the hash of batch 1's payload.
  const p1 = evmHexToBytes(sidecar(first).anchor!.payload);
  const p2 = decodeCeilingPayload(evmHexToBytes(sidecar(burst[0]!).anchor!.payload));
  assert.equal(evmBytesToHex(p2.prev), evmBytesToHex(ceilingPayloadHash(p1)));
  assert.equal(p2.firstPos, BigInt(burst[0]!.position));
  assert.equal(p2.lastPos, BigInt(burst[49]!.position));
  // One write record per transaction, filed under the block's UTC day.
  const days = readdirSync(join(dir, "writes"));
  const recs = days.flatMap((d) => readdirSync(join(dir, "writes", d)).map((f) => JSON.parse(readFileSync(join(dir, "writes", d, f), "utf8"))));
  assert.deepEqual(recs.map((r) => r.records).sort((a, b) => a - b), [1, 50]);
  assert.equal(recs.find((r) => r.records === 50).items.length, 50);
});

test("a sidecar says pending until inclusion", async () => {
  const { mk, push, sidecar } = setup();
  const w = mk();
  const i = item();
  push(i);
  await w.tick();
  const s = sidecar(i);
  assert.equal(s.status, "pending");
  assert.equal(s.anchor, null);
});

test("an unmined transaction is replaced after 3 blocks, same nonce, higher tip", async () => {
  const { chain, mk, push, events, sidecar } = setup();
  chain.mining = false;
  const w = mk();
  const i = item();
  push(i);
  await w.tick();
  chain.step(); chain.step();
  await w.tick();
  assert.equal(events().filter((e) => e["type"] === "replace").length, 0);
  chain.step();
  await w.tick();
  const rep = events().filter((e) => e["type"] === "replace");
  assert.equal(rep.length, 1);
  assert.equal(rep[0]!["nonce"], 0);
  chain.mining = true;
  chain.step();
  await w.tick();
  const s = sidecar(i);
  assert.equal(s.status, "included");
  assert.equal(decodeEip1559(evmHexToBytes(s.anchor!.rawTx)).nonce, 0n);
  assert.ok(BigInt(rep[0]!["maxPriorityFeePerGas"] as string) > 1_000_000n);
});

test("a reorg before safe re-queues the records and writes them again", async () => {
  const { chain, mk, push, events, sidecar } = setup();
  const w = mk();
  const i = item();
  push(i);
  await w.tick();
  chain.step();
  await w.tick();
  const firstBlock = sidecar(i).anchor!.blockNumber;
  chain.reorg(firstBlock);
  // The fake's mempool no longer has it; the writer must send a new batch.
  (w as unknown as { lastStatusPoll: number }).lastStatusPoll = 0;
  await w.tick(); // status poll sees the reorg, re-queues
  assert.equal(sidecar(i).status, "pending");
  assert.equal(events().filter((e) => e["type"] === "reorg").length, 1);
  await w.tick(); // new batch sent
  chain.step();
  await w.tick();
  const s = sidecar(i);
  assert.equal(s.status, "included");
  assert.notEqual(s.anchor!.blockNumber, firstBlock);
  checkSidecar(s, chain.writer);
});

test("safe then finalized are observed and recorded", async () => {
  const { chain, mk, push, sidecar } = setup();
  const w = mk();
  const i = item();
  push(i);
  await w.tick();
  chain.step();
  await w.tick();
  const n = sidecar(i).anchor!.blockNumber;
  chain.safe = n;
  (w as unknown as { lastStatusPoll: number }).lastStatusPoll = 0;
  await w.tick();
  assert.equal(sidecar(i).status, "safe");
  assert.ok(sidecar(i).statusObserved.safe);
  chain.finalized = n;
  (w as unknown as { lastStatusPoll: number }).lastStatusPoll = 0;
  await w.tick();
  assert.equal(sidecar(i).status, "finalized");
  assert.ok(sidecar(i).statusObserved.finalized);
});

test("a restart mid-flight loses nothing and sends no second nonce", async () => {
  const { chain, mk, push, sidecar } = setup();
  chain.mining = false;
  let w = mk();
  const a = item();
  push(a);
  await w.tick(); // sent, not mined
  const b = item();
  push(b); // queued, not yet read
  w = mk(); // restart
  chain.mining = true;
  chain.step(); // the original bytes get mined
  await w.tick(); // included
  await w.tick(); // b's batch
  chain.step();
  await w.tick();
  assert.equal(sidecar(a).status, "included");
  assert.equal(sidecar(b).status, "included");
  assert.equal(decodeEip1559(evmHexToBytes(sidecar(b).anchor!.rawTx)).nonce, 1n);
});

test("a half-written queue line waits; a duplicate is logged and not re-anchored", async () => {
  const { dir, chain, mk, push, events } = setup();
  const w = mk();
  const a = item();
  appendFileSync(join(dir, "queue.jsonl"), JSON.stringify(a).slice(0, 20));
  await w.tick();
  assert.equal(chain.broadcasts, 0);
  appendFileSync(join(dir, "queue.jsonl"), JSON.stringify(a).slice(20) + "\n");
  await w.tick();
  assert.equal(chain.broadcasts, 1);
  chain.step();
  await w.tick();
  push(a);
  await w.tick();
  assert.equal(chain.broadcasts, 1);
  assert.equal(events().filter((e) => e["type"] === "duplicate").length, 1);
});

test("batches never span two epochs", async () => {
  const { chain, mk, push, events } = setup();
  const w = mk();
  push(item("E1"), item("E2"), item("E1"));
  await w.tick();
  chain.step();
  await w.tick();
  await w.tick();
  chain.step();
  await w.tick();
  assert.deepEqual(events().filter((e) => e["type"] === "write").map((e) => e["records"]), [2, 1]);
  assert.ok(readdirSync(join(setup().dir)).length >= 0);
});

// ── Roll mode: one write per closed roll ─────────────────────────────────────────────────────────────────────────

import { writeFileSync, mkdirSync } from "node:fs";
import { computeProofHash, verifyCeiling, EPOCH_GENESIS_REQUEST_FORMAT, epochIdOfCalldata } from "@mikeargento/bitgraph-verify";

const epochOf = (n: number): string => Buffer.from(Array.from({ length: 32 }, (_, i) => (i * 7 + n) & 0xff)).toString("base64");
const safeB64 = (b64: string): string => b64.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const DAY = 24 * 60 * 60 * 1000;
const DAY0 = Date.UTC(2026, 10, 1);

/** A record with a proof behind it, so the sidecar can go through verifyCeiling. Bound `ms` into day `day`. */
function record(epochId: string, day: number, ms: number): { item: CeilingQueueItem; proof: Record<string, unknown> } {
  seq++;
  const proof = {
    version: "bitgraph/1",
    artifact: { hashAlg: "sha256", digestB64: createHash("sha256").update(`file${seq}`).digest("base64") },
    commit: { nonceB64: createHash("sha256").update(`nonce${seq}`).digest("base64"), counter: String(seq), epochId },
    signer: { publicKeyB64: "test-key" },
    environment: { enforcement: "stub", measurement: "test" },
  };
  return {
    proof,
    item: { proofHash: computeProofHash(proof), position: String(seq), epochId, chainId: "bitgraph:main", committedAt: new Date(DAY0 + day * DAY + ms).toISOString(), floor: null },
  };
}

function rollSetup() {
  const dir = mkdtempSync(join(tmpdir(), "ceiling-roll-"));
  const queuePath = join(dir, "queue.jsonl");
  const genesisDir = join(dir, "genesis");
  const closeDir = join(dir, "close");
  const chain = new FakeChain();
  const mk = (now?: () => Date) => new CeilingWriter({ stateDir: dir, queuePath, chain, log: () => {}, rollRoot: true, genesisDir, closeDir, ...(now ? { now } : {}) });
  /** The rotation's ask to close an epoch, made `ms` into `day`. */
  const ask = (epochId: string, day: number, ms: number) => {
    mkdirSync(closeDir, { recursive: true });
    writeFileSync(join(closeDir, `${safeB64(epochId)}.request.json`), JSON.stringify({ format: EPOCH_CLOSE_REQUEST_FORMAT, epochId, requestedAt: new Date(DAY0 + day * DAY + ms).toISOString() }));
  };
  const closed = (epochId: string): CloseResult | null => {
    const path = join(closeDir, `${safeB64(epochId)}.json`);
    return existsSync(path) ? JSON.parse(readFileSync(path, "utf8")) as CloseResult : null;
  };
  const push = (...items: CeilingQueueItem[]) => appendFileSync(queuePath, items.map((i) => JSON.stringify(i) + "\n").join(""));
  /** The parent's ask for an epoch's genesis, made at the start of `day`. */
  const open = (epochId: string, day: number) =>
    writeFileSync(join(genesisDir, `${safeB64(epochId)}.request.json`), JSON.stringify({ format: EPOCH_GENESIS_REQUEST_FORMAT, epochId, requestedAt: new Date(DAY0 + day * DAY).toISOString() }));
  const sidecarPath = (i: CeilingQueueItem) => join(dir, "sidecars", `${safeB64(i.proofHash)}.ceiling.json`);
  const sidecar = (i: CeilingQueueItem) => JSON.parse(readFileSync(sidecarPath(i), "utf8")) as CeilingSidecar;
  const events = () => (existsSync(join(dir, "events.jsonl")) ? readFileSync(join(dir, "events.jsonl"), "utf8") : "").trim().split("\n").filter(Boolean).map((l) => JSON.parse(l) as Record<string, unknown>);
  /** Open an epoch and see its genesis mined. */
  const born = async (w: CeilingWriter, epochId: string, day: number) => { open(epochId, day); await w.tick(); chain.step(); await w.tick(); };
  return { dir, genesisDir, chain, mk, push, open, born, ask, closed, sidecar, sidecarPath, events };
}

test("roll mode: a roll's records are held, then written as one root when the next roll's genesis is mined", async () => {
  const { chain, mk, push, open, born, sidecar, sidecarPath, events } = rollSetup();
  const A = epochOf(1), B = epochOf(2);
  let w = mk();
  await born(w, A, 0);
  assert.equal(chain.broadcasts, 1, "the genesis of A");
  const recs = [record(A, 0, 1000), record(A, 0, 2000), record(A, 0, 3000)];
  for (const r of recs) { push(r.item); await w.tick(); chain.step(); }
  await w.tick();
  assert.equal(chain.broadcasts, 1, "nothing is written while the roll is open");
  assert.equal(w.snapshot().backlog, 3);
  assert.ok(!existsSync(sidecarPath(recs[0]!.item)), "no sidecar before the roll closes");
  w = mk(); // a restart holds them still
  await w.tick();
  assert.equal(chain.broadcasts, 1);
  open(B, 1);
  await w.tick(); // B's genesis sent
  assert.equal(chain.broadcasts, 2);
  await w.tick(); // not mined yet: A stays held
  assert.equal(chain.broadcasts, 2);
  chain.step(); // B's genesis mined
  await w.tick(); // the result is written and A's roll is cut in the same pass
  assert.equal(chain.broadcasts, 3, "one transaction for the whole roll");
  chain.step();
  await w.tick();
  const writes = events().filter((e) => e["type"] === "write");
  assert.deepEqual(writes.map((e) => e["records"]), [3]);
  assert.equal(events().filter((e) => e["type"] === "roll-close").length, 1);
  for (const r of recs) {
    const s = sidecar(r.item);
    assert.equal(s.leafCount, 3);
    const v = await verifyCeiling(r.proof as never, s, { writerAddress: chain.writer, chainId: 84532, proofAlreadyVerified: true });
    assert.equal(v.ok, true, v.reason);
  }
  // On Base in order: A's genesis, B's genesis, then A's root right behind it.
  const rootTx = decodeEip1559(evmHexToBytes(sidecar(recs[0]!.item).anchor!.rawTx));
  assert.equal(rootTx.nonce, 2n);
  const p = decodeCeilingPayload(rootTx.data);
  assert.equal(p.firstPos, BigInt(recs[0]!.item.position));
  assert.equal(p.lastPos, BigInt(recs[2]!.item.position));
  // B's own records wait for the roll after it.
  const later = record(B, 1, 5000);
  push(later.item);
  await w.tick(); chain.step(); await w.tick();
  assert.equal(chain.broadcasts, 3);
  assert.equal(w.snapshot().backlog, 1);
});

test("roll mode: a roll with no records writes nothing", async () => {
  const { chain, mk, born, events } = rollSetup();
  const w = mk();
  await born(w, epochOf(1), 0);
  await born(w, epochOf(2), 1);
  await w.tick(); chain.step(); await w.tick();
  assert.equal(chain.broadcasts, 2, "two genesis transactions and no root");
  assert.equal(events().filter((e) => e["type"] === "write").length, 0);
  const sent = [...chain.mined.values()].map((m) => m.blockNumber);
  assert.equal(sent.length, 2);
});

test("roll mode: rolls that closed while the writer was away are written one each, oldest first", async () => {
  const { chain, mk, push, born, sidecar, events } = rollSetup();
  const A = epochOf(1), B = epochOf(2), C = epochOf(3);
  const w = mk();
  await born(w, A, 0);
  const a = [record(A, 0, 1000), record(A, 0, 2000)];
  push(...a.map((r) => r.item));
  await born(w, B, 1); // A's root goes out in this pass
  const b = [record(B, 1, 1000)];
  push(...b.map((r) => r.item));
  chain.step(); await w.tick(); // A's root included
  await born(w, C, 2); // and B's root
  const c = record(C, 2, 1000);
  push(c.item);
  chain.step(); await w.tick();
  await w.tick(); chain.step(); await w.tick();
  const closes = events().filter((e) => e["type"] === "roll-close");
  assert.deepEqual(closes.map((e) => [e["epochId"], e["records"]]), [[A, 2], [B, 1]]);
  assert.equal(sidecar(a[0]!.item).leafCount, 2);
  assert.equal(sidecar(b[0]!.item).leafCount, 1);
  assert.equal(w.snapshot().backlog, 1, "C is still open");
});

test("roll mode: a restart between the close and the write sends the roll once", async () => {
  const { chain, mk, push, open, born, sidecar, events } = rollSetup();
  const A = epochOf(1), B = epochOf(2);
  let w = mk();
  await born(w, A, 0);
  const r = record(A, 0, 1000);
  push(r.item);
  await w.tick();
  open(B, 1);
  await w.tick();
  chain.step(); // B's genesis is mined, and the writer stops before it looks
  w = mk();
  chain.mining = false;
  await w.tick(); // result written, roll cut and sent, not mined
  w = mk(); // stopped again with the root in flight
  await w.tick();
  chain.mining = true;
  chain.step();
  await w.tick();
  await w.tick();
  assert.deepEqual(events().filter((e) => e["type"] === "write").map((e) => e["records"]), [1]);
  assert.equal(events().filter((e) => e["type"] === "roll-close").length, 1);
  assert.equal(decodeEip1559(evmHexToBytes(sidecar(r.item).anchor!.rawTx)).nonce, 2n);
});

test("roll mode: a reorg of the root's block writes the same roll again", async () => {
  const { chain, mk, push, born, sidecar, events } = rollSetup();
  const A = epochOf(1), B = epochOf(2);
  const w = mk();
  await born(w, A, 0);
  const recs = [record(A, 0, 1000), record(A, 0, 2000)];
  push(...recs.map((r) => r.item));
  await born(w, B, 1);
  chain.step(); await w.tick();
  const first = sidecar(recs[0]!.item).anchor!.blockNumber;
  chain.reorg(first);
  (w as unknown as { lastStatusPoll: number }).lastStatusPoll = 0;
  await w.tick(); // the reorg is seen, the records go back
  await w.tick(); // the roll is still closed: cut again
  chain.step(); await w.tick();
  const s = sidecar(recs[1]!.item);
  assert.equal(s.status, "included");
  assert.notEqual(s.anchor!.blockNumber, first);
  assert.equal(s.leafCount, 2);
  const v = await verifyCeiling(recs[1]!.proof as never, s, { writerAddress: chain.writer, chainId: 84532, proofAlreadyVerified: true });
  assert.equal(v.ok, true, v.reason);
  assert.equal(events().filter((e) => e["type"] === "reorg").length, 1);
});

test("roll mode: an unmined genesis closes nothing", async () => {
  const { chain, mk, push, open, born, events } = rollSetup();
  const A = epochOf(1), B = epochOf(2);
  const w = mk();
  await born(w, A, 0);
  push(record(A, 0, 1000).item);
  chain.mining = false;
  open(B, 1);
  for (let n = 0; n < 5; n++) { await w.tick(); chain.step(); }
  assert.equal(events().filter((e) => e["type"] === "write").length, 0);
  assert.equal(events().filter((e) => e["type"] === "roll-close").length, 0);
  assert.equal(w.snapshot().backlog, 1);
});

test("roll mode: a hold longer than a roll should last is logged, once an hour and never every tick", async () => {
  const { mk, push, born, events } = rollSetup();
  const A = epochOf(1);
  const early = mk(() => new Date(DAY0 + 60 * 60 * 1000)); // an hour into the roll
  await born(early, A, 0);
  push(record(A, 0, 1000).item);
  await early.tick(); await early.tick();
  assert.equal(events().filter((e) => e["type"] === "roll-held").length, 0, "an open roll within its day is not news");
  const late = mk(() => new Date(DAY0 + 2 * DAY)); // two days on, and no later epoch has opened
  await late.tick(); await late.tick(); await late.tick();
  const held = events().filter((e) => e["type"] === "roll-held");
  assert.equal(held.length, 1);
  assert.equal(held[0]!["records"], 1);
  assert.equal(held[0]!["heldHours"], 48);
});

test("roll mode needs the genesis directory, and the genesis transaction is unchanged", async () => {
  const dir = mkdtempSync(join(tmpdir(), "ceiling-roll-"));
  assert.throws(() => new CeilingWriter({ stateDir: dir, queuePath: join(dir, "queue.jsonl"), chain: new FakeChain(), log: () => {}, rollRoot: true }), /genesisDir/);
  const { genesisDir, mk, born } = rollSetup();
  const A = epochOf(1);
  await born(mk(), A, 0);
  // BGE1 and the epoch id, 36 bytes, which every published verifier checks byte for byte.
  const sent = JSON.parse(readFileSync(join(genesisDir, `${safeB64(A)}.sent.json`), "utf8")) as { sends: { rawTx: string }[] };
  const data = decodeEip1559(evmHexToBytes(sent.sends[0]!.rawTx)).data;
  assert.equal(data.length, 36);
  assert.equal(epochIdOfCalldata(evmBytesToHex(data)), A);
});

// ── The roll check: is the write correct, and does it carry everything ───────────────────────────────────────────

import { unlinkSync } from "node:fs";
import { checkRoll, formatRollReport } from "../roll-check.js";

test("roll check: a closed roll passes, and an open one says what is still waiting", async () => {
  const { dir, chain, mk, push, born, sidecarPath } = rollSetup();
  const A = epochOf(1), B = epochOf(2);
  const w = mk();
  await born(w, A, 0);
  const recs = [record(A, 0, 1000), record(A, 0, 2000), record(A, 0, 3000), record(A, 0, 4000), record(A, 0, 5000)];
  push(...recs.map((r) => r.item));
  await w.tick();
  const open = await checkRoll({ stateDir: dir, epochId: A });
  assert.equal(open.ok, false);
  assert.equal(open.queued, 5);
  assert.equal(open.waiting.length, 5, "held: the roll is open");
  await born(w, B, 1); // A's root goes out
  chain.step(); await w.tick();
  const r = await checkRoll({ stateDir: dir, writer: chain.writer });
  assert.equal(r.ok, true, r.problems.join("; "));
  assert.equal(r.epochId, A, "the newest write's epoch by default");
  assert.equal(r.queued, 5);
  assert.equal(r.written, 5);
  assert.equal(r.writes.length, 1);
  assert.equal(r.writes[0]!.sidecarsOk, 5);
  assert.equal(r.writes[0]!.firstPos, recs[0]!.item.position);
  assert.equal(r.writes[0]!.lastPos, recs[4]!.item.position);
  assert.match(formatRollReport(r), /PASS/);
  // What Base says is compared when asked: the same payload passes, another fails.
  const inc = w.snapshot().batches[0]!.inclusion!;
  const same = await checkRoll({ stateDir: dir, onChain: async () => ({ from: chain.writer, to: chain.writer, input: w.snapshot().batches[0]!.payload, blockHash: inc.blockHash, blockNumber: inc.blockNumber }) });
  assert.equal(same.ok, true, same.problems.join("; "));
  const other = await checkRoll({ stateDir: dir, onChain: async () => ({ from: chain.writer, to: chain.writer, input: "0x00", blockHash: inc.blockHash, blockNumber: inc.blockNumber }) });
  assert.equal(other.ok, false);
  // A record queued for the roll after its write is found missing, and so is a sidecar taken away.
  const late = record(A, 0, 6000);
  push(late.item);
  const short = await checkRoll({ stateDir: dir, epochId: A });
  assert.equal(short.ok, false);
  assert.deepEqual(short.waiting, [late.item.proofHash]);
  unlinkSync(sidecarPath(recs[2]!.item));
  const gone = await checkRoll({ stateDir: dir, epochId: A });
  assert.equal(gone.writes[0]!.sidecarsOk, 4);
  assert.ok(gone.problems.some((p) => /sidecar/.test(p)));
  assert.match(formatRollReport(gone), /FAIL/);
});

test("roll mode: a close request writes the roll's root at once, before any later epoch opens, and the answer names the write", async () => {
  const { chain, mk, push, born, ask, closed, sidecar, events } = rollSetup();
  const A = epochOf(1), B = epochOf(2);
  let w = mk();
  await born(w, A, 0);
  const recs = [record(A, 0, 1000), record(A, 0, 2000), record(A, 0, 3000)];
  for (const r of recs) push(r.item);
  await w.tick();
  assert.equal(chain.broadcasts, 1, "held while the roll is open");
  ask(A, 0, 4000);
  await w.tick();
  assert.equal(chain.broadcasts, 2, "the root goes out on the tick that sees the request");
  assert.equal(closed(A), null, "no answer until the write is mined");
  w = mk(); // a restart in between answers once, and sends nothing twice
  await w.tick();
  assert.equal(closed(A), null);
  chain.step();
  await w.tick();
  assert.equal(chain.broadcasts, 2);
  const res = closed(A)!;
  assert.equal(res.format, "bitgraph-epoch-close/1");
  assert.equal(res.records, 3);
  assert.equal(res.firstPos, recs[0]!.item.position);
  assert.equal(res.lastPos, recs[2]!.item.position);
  const s0 = sidecar(recs[0]!.item);
  assert.equal(res.blockNumber, s0.anchor!.blockNumber);
  assert.equal(res.root, s0.root);
  // On Base in order: A's genesis, then A's root. Nothing of a later epoch is needed.
  assert.equal(decodeEip1559(evmHexToBytes(s0.anchor!.rawTx)).nonce, 1n);
  for (const r of recs) {
    const v = await verifyCeiling(r.proof as never, sidecar(r.item), { writerAddress: chain.writer, chainId: 84532, proofAlreadyVerified: true });
    assert.equal(v.ok, true, v.reason);
  }
  assert.equal(events().filter((e) => e["type"] === "roll-closed").length, 1);
  // The next epoch opens with its own genesis and writes nothing more for A.
  await born(w, B, 1);
  await w.tick(); chain.step(); await w.tick();
  assert.equal(chain.broadcasts, 3);
  assert.deepEqual(events().filter((e) => e["type"] === "write").map((e) => e["records"]), [3]);
});

test("roll mode: a close asked for before the roll's newest record cuts nothing; the next genesis closes it and the request is answered then", async () => {
  const { chain, mk, push, born, ask, closed } = rollSetup();
  const A = epochOf(1), B = epochOf(2);
  const w = mk();
  await born(w, A, 0);
  ask(A, 0, 1500);
  push(record(A, 0, 1000).item, record(A, 0, 2000).item);
  await w.tick(); chain.step(); await w.tick();
  assert.equal(chain.broadcasts, 1, "a record bound after the ask keeps the roll open");
  assert.equal(closed(A), null);
  await born(w, B, 1);
  await w.tick(); // A's roll is cut behind B's genesis
  chain.step();
  await w.tick();
  assert.equal(chain.broadcasts, 3);
  assert.equal(closed(A)!.records, 2);
});

test("roll mode: a close request for an epoch with nothing queued is answered at once, with no write", async () => {
  const { chain, mk, born, ask, closed } = rollSetup();
  const A = epochOf(1);
  const w = mk();
  await born(w, A, 0);
  ask(A, 0, 1000);
  await w.tick();
  assert.equal(chain.broadcasts, 1);
  assert.deepEqual(closed(A), { format: "bitgraph-epoch-close/1", epochId: A, requestedAt: new Date(DAY0 + 1000).toISOString(), records: 0 });
});
