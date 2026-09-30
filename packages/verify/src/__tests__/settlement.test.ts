/**
 * bitgraph-settlement/1, the pointer layer, on REAL data. Base block
 * 51,979,918 (the ceiling transaction 0x72cc…9450, 2026-09-30 06:19:43 UTC)
 * was batched to Ethereum in block 26,088,463 (06:20:35 UTC, 52 s later) by
 * the batcher transactions 0xcb57…a63a (index 18, 6 blobs) and 0x6165…0190
 * (index 19, 1 blob). The fixtures were captured from the chain by the
 * settlement prototype on 2026-09-30. Nothing here touches a network.
 *
 *   cd packages/verify && npx tsc -p . && node --test dist/__tests__/settlement.test.js
 */

import { test } from "node:test";
import * as assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  BASE_MAINNET_SETTLEMENT_PINS, SETTLEMENT_VERSION, verifySettlementPointer, decodeEip4844, versionedHashOf, checkSettlementOnline,
  type SettlementPointer, type SettlementPins,
} from "../settlement.js";
import { bytesToHex, hexToBytes, keccak256, decodeHeader, rlpEncode, rlpDecode } from "../ceiling-evm.js";

const fix = (name: string): string => readFileSync(new URL(`../../src/__tests__/fixtures/settlement/${name}`, import.meta.url), "utf8");
const pointer = JSON.parse(fix("pointer-51979918.json")) as SettlementPointer;
const pointerTx1 = JSON.parse(fix("pointer-51979918-tx1.json")) as SettlementPointer;
const clone = <T>(x: T): T => JSON.parse(JSON.stringify(x)) as T;

const PINS = BASE_MAINNET_SETTLEMENT_PINS;
const BATCHER = "0x5050f69a9786f081509234f1a7f4684b5e5b76c9";
const INBOX = "0xff00000000000000000000000000000000008453";
const L1 = { number: 26088463, hash: "0x8608654cd9d6d66c2ce8a80108db7e5202a6d9ad0072f8c81353cc988d3a93f2", timestamp: 1790749235 };
const TX0 = "0xcb575f2482a33ce5678997adcb082d4b68f7927c932a07a7a89090e61c6ea63a";
const TX1 = "0x6165d90f2133ad9154d99c46fdc734af9ab5e84ce63710b5997363e222db0190";

test("the real pointer verifies: the ceiling transaction's batch existed by Ethereum block 26,088,463 at 06:20:35 UTC", () => {
  const r = verifySettlementPointer(pointer, PINS);
  assert.equal(r.ok, true, r.reason);
  assert.deepEqual(r.existedBy, { blockNumber: L1.number, blockHash: L1.hash, blockTimestamp: L1.timestamp });
  assert.equal(new Date(L1.timestamp * 1000).toISOString(), "2026-09-30T06:20:35.000Z");
  assert.equal(r.headerCheckedAgainstChain, false);
  assert.deepEqual(r.checks.map((c) => c.name), ["header", "inclusion", "blobs"]);
  assert.ok(r.checks.every((c) => c.ok));
  assert.match(r.checks[2]!.detail!, /^6 blob commitments/);
  assert.equal(pointer.baseBlockNumber, 51979918);
  assert.equal(pointer.l1.txHash, TX0);
  assert.equal(pointer.l1.txIndex, 18);
  assert.equal(pointer.l1.txInclusionProof.length, 3);
  // The pointer describes the find for readers of the blob layer.
  assert.deepEqual(pointer.channel, { id: "0x42b5f4f4249919699b40a61bc497f4b5", frames: 7, compression: "brotli", firstBaseBlock: 51979915, lastBaseBlock: 51979939 });
  assert.deepEqual(pointer.located, { baseTxIndex: 38, txHash: "0x72cc33632237a96db749836905e92e45bd5cc4167403bc7970a69f250b3e9450" });
});

test("the second batcher transaction (one blob, the channel's last frame) verifies as a pointer too", () => {
  const r = verifySettlementPointer(pointerTx1, PINS);
  assert.equal(r.ok, true, r.reason);
  assert.equal(pointerTx1.l1.txHash, TX1);
  assert.equal(pointerTx1.l1.txIndex, 19);
  assert.equal(pointerTx1.blobs.length, 1);
  assert.equal(r.existedBy!.blockNumber, L1.number);
});

test("decodeEip4844 recovers the batcher 0x5050f69a…76c9 from the real raw transaction", () => {
  const tx = decodeEip4844(hexToBytes(pointer.l1.rawTx));
  assert.equal(tx.from, BATCHER);
  assert.equal(tx.to, INBOX);
  assert.equal(tx.chainId, 1n);
  assert.equal(tx.nonce, 0x2571d5n);
  assert.equal(tx.hash, TX0);
  assert.equal(tx.data.length, 0);
  assert.deepEqual(tx.blobVersionedHashes, pointer.blobs.map((b) => b.versionedHash));
  const tx1 = decodeEip4844(hexToBytes(pointerTx1.l1.rawTx));
  assert.equal(tx1.from, BATCHER);
  assert.equal(tx1.nonce, 0x2571d6n);
  assert.equal(tx1.hash, TX1);
  assert.deepEqual(tx1.blobVersionedHashes, [pointerTx1.blobs[0]!.versionedHash]);
});

test("every versioned hash is 0x01 || SHA-256(commitment)[1:]", () => {
  for (const b of [...pointer.blobs, ...pointerTx1.blobs]) {
    assert.equal(versionedHashOf(hexToBytes(b.kzgCommitment)), b.versionedHash);
    assert.equal(hexToBytes(b.kzgCommitment).length, 48);
  }
});

test("the header decodes to the block the pointer names, and hashes to its hash", () => {
  const h = decodeHeader(hexToBytes(pointer.l1.blockHeader));
  assert.equal(h.number, L1.number);
  assert.equal(h.timestamp, L1.timestamp);
  assert.equal(h.hash, L1.hash);
  assert.equal(bytesToHex(keccak256(hexToBytes(pointer.l1.blockHeader))), L1.hash);
  assert.equal(bytesToHex(keccak256(hexToBytes(pointer.l1.rawTx))), TX0);
});

test("decodeEip4844 refuses other transaction types and the blob-carrying wrapper", () => {
  assert.throws(() => decodeEip4844(new Uint8Array([0x02, 0xc0])), /not an EIP-4844/);
  const raw = hexToBytes(pointer.l1.rawTx);
  const wrapper = new Uint8Array([0x03, ...rlpEncode([raw.slice(1), [], [], []])]);
  assert.throws(() => decodeEip4844(wrapper), /14 fields|expected/);
});

test("checkSettlementOnline confirms, refutes, or reports a missing block", async () => {
  assert.equal((await checkSettlementOnline(pointer, async () => L1.hash.toUpperCase())).ok, true);
  const other = await checkSettlementOnline(pointer, async () => "0x" + "ab".repeat(32));
  assert.equal(other.ok, false);
  assert.match(other.detail, /not the record's header/);
  const none = await checkSettlementOnline(pointer, async () => null);
  assert.equal(none.ok, false);
  assert.match(none.detail, /no block/);
});

// ── tampers: every one is refused, and at the layer that catches it ──

const rejects = (name: string, mk: () => { p: SettlementPointer; pins?: SettlementPins }, re: RegExp): void => {
  test(`rejects: ${name}`, () => {
    const { p, pins } = mk();
    const r = verifySettlementPointer(p, pins ?? PINS);
    assert.equal(r.ok, false, `accepted: ${name}`);
    assert.match(r.reason!, re);
    assert.equal(r.existedBy, null);
    assert.equal(r.checks[r.checks.length - 1]!.ok, false);
  });
};

rejects("a header byte flipped", () => {
  const p = clone(pointer);
  const h = hexToBytes(p.l1.blockHeader);
  h[300] = h[300]! ^ 1;
  p.l1.blockHeader = bytesToHex(h);
  return { p };
}, /^header: .*does not hash/);

rejects("the block time moved (record field)", () => {
  const p = clone(pointer);
  p.l1.blockTimestamp -= 60;
  return { p };
}, /^header: .*timestamp/);

rejects("the block number moved (record field)", () => {
  const p = clone(pointer);
  p.l1.blockNumber += 1;
  return { p };
}, /^header: .*block/);

rejects("a rebuilt header with a moved timestamp does not hash to blockHash", () => {
  const p = clone(pointer);
  // Header field 11 is the timestamp; re-encoding it changes the hash, which blockHash still pins.
  const f = rlpDecode(hexToBytes(p.l1.blockHeader)) as Uint8Array[];
  f[11] = hexToBytes((L1.timestamp - 3600).toString(16));
  p.l1.blockHeader = bytesToHex(rlpEncode(f));
  p.l1.blockTimestamp = L1.timestamp - 3600;
  return { p };
}, /^header: .*does not hash/);

rejects("the transaction index of the other batcher transaction", () => {
  const p = clone(pointer);
  p.l1.txIndex = 19;
  return { p };
}, /^inclusion:/);

rejects("a raw transaction byte flipped", () => {
  const p = clone(pointer);
  const t = hexToBytes(p.l1.rawTx);
  t[200] = t[200]! ^ 1;
  p.l1.rawTx = bytesToHex(t);
  return { p };
}, /^transaction: .*does not hash/);

rejects("the other batcher transaction's bytes under this proof", () => {
  const p = clone(pointer);
  p.l1.rawTx = pointerTx1.l1.rawTx;
  p.l1.txHash = pointerTx1.l1.txHash;
  return { p };
}, /^inclusion:/);

rejects("the wrong batcher (pin)", () => ({ p: clone(pointer), pins: { ...PINS, batcher: "0x" + "11".repeat(20) } }), /^batcher:/);

rejects("the wrong batch inbox (pin)", () => ({ p: clone(pointer), pins: { ...PINS, batchInbox: "0x" + "22".repeat(20) } }), /^inbox:/);

rejects("the wrong chain (pin)", () => ({ p: clone(pointer), pins: { ...PINS, l1ChainId: 11155111 } }), /^chain:/);

rejects("a versioned hash the transaction does not list", () => {
  const p = clone(pointer);
  p.blobs[0]!.versionedHash = pointerTx1.blobs[0]!.versionedHash;
  p.blobs[0]!.kzgCommitment = pointerTx1.blobs[0]!.kzgCommitment;
  return { p };
}, /^blobs: .*not listed/);

rejects("a commitment that does not hash to its versioned hash", () => {
  const p = clone(pointer);
  const c = hexToBytes(p.blobs[2]!.kzgCommitment);
  c[10] = c[10]! ^ 1;
  p.blobs[2]!.kzgCommitment = bytesToHex(c);
  return { p };
}, /^blobs: .*0x01 \|\| SHA-256/);

rejects("no blobs named", () => {
  const p = clone(pointer);
  p.blobs = [];
  return { p };
}, /^blobs: .*no blobs/);

rejects("another format", () => {
  const p = clone(pointer) as unknown as { version: string };
  p.version = "bitgraph-settlement/2";
  return { p: p as unknown as SettlementPointer };
}, /^format:/);

rejects("no l1 section", () => {
  const p = clone(pointer) as unknown as Record<string, unknown>;
  delete p["l1"];
  return { p: p as unknown as SettlementPointer };
}, /^format:/);

test("SETTLEMENT_VERSION is the fixtures' version", () => {
  assert.equal(pointer.version, SETTLEMENT_VERSION);
  assert.equal(SETTLEMENT_VERSION, "bitgraph-settlement/1");
});
