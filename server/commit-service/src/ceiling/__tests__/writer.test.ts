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
  const { chain, mk, push, sidecar, events } = setup();
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
