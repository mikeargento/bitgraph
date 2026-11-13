// Copyright (c) 2025-2026 Argento Computing Inc.

/**
 * Hourly publication: the write's calldata, the hour's tree, the floor note, and the offline check of a proof's
 * publication block against a real signed transaction in a real header and transaction trie (built here, not mocked).
 */

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { Transaction, addr } from "micro-eth-signer";
import { rlpEncode, keccak256, txTrieProof, evmBytesToHex, evmHexToBytes, bytesToB64 } from "@mikeargento/bitgraph-verify";
import {
  encodeHourCalldata, decodeHourCalldata, hourLink, hourTree, floorNoteText, parseFloorNote, floorNoteDigestB64,
  publishedChainHash, checkPublication, checkHourChain, PUBLICATION_METADATA_KEY, HOUR_RECORD_FORMAT,
  type HourWrite, type PublicationBlock, type WriteEvidence, type HourRecord,
} from "../publication.ts";

const EPOCH = bytesToB64(new Uint8Array(32).fill(7));
const OTHER_EPOCH = bytesToB64(new Uint8Array(32).fill(9));
const KEY = bytesToB64(new Uint8Array(32).fill(3));
const ZERO = "0".repeat(64);
const writer = addr.random();
const stranger = addr.random();

function fakeProof(counter: number, epochId = EPOCH, digestB64 = bytesToB64(new Uint8Array(32).fill(counter & 255))): Record<string, unknown> {
  return {
    version: "bitgraph/1",
    artifact: { hashAlg: "sha256", digestB64 },
    commit: { nonceB64: bytesToB64(new Uint8Array(32).fill((counter * 3) & 255)), counter: String(counter), slotCounter: String(counter - 1), epochId, atomic: true },
    signer: { publicKeyB64: KEY, signatureB64: "AA==" },
  };
}

/** A signed self-addressed write, in a block of its own plus a neighbor, with header and trie evidence. */
function publish(calldata: Uint8Array, opts: { from?: { privateKey: string; address: string }; chainId?: bigint; blockNumber?: number } = {}): WriteEvidence {
  const from = opts.from ?? writer;
  const tx = Transaction.prepare({ to: from.address, value: 0n, nonce: 0n, maxFeePerGas: 1_000_000n, maxPriorityFeePerGas: 1n, gasLimit: 60_000n, chainId: opts.chainId ?? 8453n, data: evmBytesToHex(calldata) } as never);
  const raw = evmHexToBytes(tx.signBy(from.privateKey).toHex(true));
  const neighbor = evmHexToBytes(Transaction.prepare({ to: stranger.address, value: 1n, nonce: 4n, maxFeePerGas: 1_000_000n, maxPriorityFeePerGas: 1n, gasLimit: 21_000n, chainId: 8453n } as never).signBy(stranger.privateKey).toHex(true));
  const txs = [neighbor, raw];
  const { root, proof } = txTrieProof(txs, 1);
  const number = opts.blockNumber ?? 38_000_000;
  const timestamp = 1_794_000_000 + number;
  const n = (v: number): Uint8Array => { const h = v.toString(16); return evmHexToBytes((h.length % 2 ? "0" : "") + h); };
  const header = rlpEncode([
    new Uint8Array(32).fill(1), new Uint8Array(32).fill(2), new Uint8Array(20).fill(4), new Uint8Array(32).fill(5), root,
    new Uint8Array(32).fill(6), new Uint8Array(256), new Uint8Array(0), n(number), n(30_000_000), n(100_000), n(timestamp),
    new Uint8Array(0), new Uint8Array(32).fill(8), new Uint8Array(8), n(1000),
  ]);
  return {
    chain: "base", chainId: 8453, writer: from.address.toLowerCase(),
    txHash: evmBytesToHex(keccak256(raw)), blockNumber: number, blockHash: evmBytesToHex(keccak256(header)), blockTimestamp: timestamp,
    headerRlp: evmBytesToHex(header), txIndex: 1, txInclusionProof: proof.map(evmBytesToHex), rawTx: evmBytesToHex(raw),
  };
}

function attach(proof: Record<string, unknown>, block: PublicationBlock): Record<string, unknown> {
  return { ...proof, metadata: { ...((proof["metadata"] as object | undefined) ?? {}), [PUBLICATION_METADATA_KEY]: block } };
}

/** Two published hours of one epoch: hour A covers 2..6, its floor is #8, hour B covers 8..12. */
function scenario() {
  const a = [2, 4, 6].map((c) => fakeProof(c));
  const treeA = hourTree(a.map(publishedChainHash));
  const wA: HourWrite = { epochId: EPOCH, first: 2, last: 6, leaves: 3, rootHex: treeA.rootHex, prevLinkHex: ZERO, epochPublicKeyB64: KEY };
  const cdA = encodeHourCalldata(wA);
  const evA = publish(cdA, { blockNumber: 38_000_000 });
  const note = floorNoteText({ chainId: 8453, blockNumber: evA.blockNumber, blockHash: evA.blockHash, blockTimestamp: evA.blockTimestamp, txHash: evA.txHash, writeLinkHex: hourLink(cdA) });
  const floor = fakeProof(8, EPOCH, floorNoteDigestB64(note));
  const b = [floor, fakeProof(10), fakeProof(12)];
  const treeB = hourTree(b.map(publishedChainHash));
  const wB: HourWrite = { epochId: EPOCH, first: 8, last: 12, leaves: 3, rootHex: treeB.rootHex, prevLinkHex: hourLink(cdA) };
  const cdB = encodeHourCalldata(wB);
  const evB = publish(cdB, { blockNumber: 38_001_800 });
  return { a, treeA, cdA, evA, note, floor, b, treeB, cdB, evB };
}

function blockFor(proof: Record<string, unknown>, index: number, tree: { paths: string[] }, calldata: Uint8Array, write: WriteEvidence, floor: PublicationBlock["floor"]): PublicationBlock {
  const c = proof["commit"] as { epochId: string; counter: string };
  return { format: PUBLICATION_METADATA_KEY, epochId: c.epochId, counter: c.counter, chainHashB64: publishedChainHash(proof), leafIndex: index, path: tree.paths[index]!, calldata: evmBytesToHex(calldata), write, floor };
}

describe("the hourly write", () => {
  test("calldata round-trips, with and without the epoch key", () => {
    const w: HourWrite = { epochId: EPOCH, first: 2, last: 40, leaves: 20, rootHex: "ab".repeat(32), prevLinkHex: "cd".repeat(32) };
    const cd = encodeHourCalldata(w);
    assert.equal(cd.length, 121);
    assert.deepEqual(decodeHourCalldata(cd), w);
    const wk = { ...w, epochPublicKeyB64: KEY };
    const cdk = encodeHourCalldata(wk);
    assert.equal(cdk.length, 153);
    assert.deepEqual(decodeHourCalldata(cdk), wk);
  });

  test("a quiet hour has no leaves and a zero root; a nonzero root with no leaves is refused", () => {
    const q: HourWrite = { epochId: EPOCH, first: 40, last: 40, leaves: 0, rootHex: ZERO, prevLinkHex: "cd".repeat(32) };
    assert.deepEqual(decodeHourCalldata(encodeHourCalldata(q)), q);
    assert.throws(() => encodeHourCalldata({ ...q, rootHex: "ab".repeat(32) }));
  });

  test("anything else does not decode", () => {
    const cd = encodeHourCalldata({ epochId: EPOCH, first: 2, last: 4, leaves: 2, rootHex: "ab".repeat(32), prevLinkHex: ZERO });
    const bad = cd.slice(); bad[0] = 0x41;
    assert.equal(decodeHourCalldata(bad), null);
    const flag = cd.slice(); flag[4] = 1; // says it carries a key but is 121 bytes
    assert.equal(decodeHourCalldata(flag), null);
    assert.equal(decodeHourCalldata(cd.subarray(0, 120)), null);
  });

  test("the floor note round-trips and its digest is SHA-256 of its text", () => {
    const n = { chainId: 8453, blockNumber: 38_000_000, blockHash: "0x" + "ab".repeat(32), blockTimestamp: 1_794_000_000, txHash: "0x" + "cd".repeat(32), writeLinkHex: "ef".repeat(32) };
    const t = floorNoteText(n);
    assert.deepEqual(parseFloorNote(t), n);
    assert.equal(parseFloorNote(t.replace("block: ", "block:  ")), null);
    assert.equal(floorNoteDigestB64(t).length, 44);
  });

  test("a proof publishes under the same leaf with or without unsigned metadata", () => {
    const p = fakeProof(10);
    const withMember = { ...p, metadata: { "bitgraph-tree-member/1": { format: "bitgraph-tree-member/1", files: 2, index: 0, path: "", rootText: "x" } } };
    assert.equal(publishedChainHash(withMember), publishedChainHash(p));
  });
});

describe("a proof's publication block", () => {
  test("a proof in the first hour of an epoch checks, with no floor", () => {
    const s = scenario();
    const p = attach(s.a[1]!, blockFor(s.a[1]!, 1, s.treeA, s.cdA, s.evA, null));
    const r = checkPublication(p, { writer: writer.address.toLowerCase() });
    assert.deepEqual(r.problems, []);
    assert.equal(r.ok, true);
    assert.equal(r.ceiling?.blockNumber, 38_000_000);
    assert.equal(r.floor, null);
  });

  test("a proof after the floor checks, with the floor in the same tree", () => {
    const s = scenario();
    const floor = { proof: s.floor, note: s.note, hourCalldata: evmBytesToHex(s.cdB), leafIndex: 0, path: s.treeB.paths[0]! };
    const p = attach(s.b[2]!, blockFor(s.b[2]!, 2, s.treeB, s.cdB, s.evB, floor));
    const r = checkPublication(p, { writer: writer.address.toLowerCase() });
    assert.deepEqual(r.problems, []);
    assert.equal(r.floor?.blockNumber, 38_000_000, "after the first hour's block");
    assert.equal(r.ceiling?.blockNumber, 38_001_800, "by the second hour's block");
  });

  test("a floor in the tree the write links back to also checks", () => {
    // A third hour whose proof's floor is #8, published in hour B's tree.
    const s = scenario();
    const c = [fakeProof(14)];
    const treeC = hourTree(c.map(publishedChainHash));
    const cdC = encodeHourCalldata({ epochId: EPOCH, first: 14, last: 14, leaves: 1, rootHex: treeC.rootHex, prevLinkHex: hourLink(s.cdB) });
    const evC = publish(cdC, { blockNumber: 38_003_600 });
    const floor = { proof: s.floor, note: s.note, hourCalldata: evmBytesToHex(s.cdB), leafIndex: 0, path: s.treeB.paths[0]! };
    const r = checkPublication(attach(c[0]!, blockFor(c[0]!, 0, treeC, cdC, evC, floor)), { writer: writer.address.toLowerCase() });
    assert.deepEqual(r.problems, []);
  });

  test("tampering anywhere is caught", () => {
    const s = scenario();
    const floor = { proof: s.floor, note: s.note, hourCalldata: evmBytesToHex(s.cdB), leafIndex: 0, path: s.treeB.paths[0]! };
    const good = blockFor(s.b[2]!, 2, s.treeB, s.cdB, s.evB, floor);
    const w = writer.address.toLowerCase();
    const bad = (blk: PublicationBlock, proof = s.b[2]!, o: { writer?: string } = { writer: w }) => checkPublication(attach(proof, blk), o);

    assert.equal(bad({ ...good, path: s.treeB.paths[1]! }).ok, false, "a wrong path");
    assert.equal(bad(good, s.b[1]!).ok, false, "another proof under this block");
    assert.equal(bad({ ...good, calldata: evmBytesToHex(s.cdA) }).ok, false, "another write's calldata");
    assert.equal(bad({ ...good, write: { ...good.write, txIndex: 0 } }).ok, false, "the wrong trie position");
    assert.equal(bad({ ...good, write: { ...good.write, blockTimestamp: good.write.blockTimestamp + 1 } }).ok, false, "a time the header does not say");
    assert.equal(bad({ ...good, write: { ...good.write, headerRlp: s.evA.headerRlp } }).ok, false, "another block's header");
    assert.equal(bad(good, s.b[2]!, { writer: stranger.address.toLowerCase() }).ok, false, "a different expected writer");
    const forged = publish(s.cdB, { from: stranger });
    assert.equal(bad({ ...good, write: forged }, s.b[2]!).ok, false, "the same calldata sent by someone else");
    assert.equal(bad({ ...good, floor: { ...floor, note: s.note.replace("block: 38000000", "block: 37999999") } }).ok, false, "a floor note that is not what the floor binds");
    assert.equal(bad({ ...good, floor: { ...floor, proof: fakeProof(14, EPOCH, floorNoteDigestB64(s.note)) } }).ok, false, "a floor after the proof");
    assert.equal(bad({ ...good, floor: { ...floor, proof: fakeProof(8, OTHER_EPOCH, floorNoteDigestB64(s.note)) } }).ok, false, "a floor from another epoch");
    assert.equal(bad({ ...good, floor: { ...floor, hourCalldata: evmBytesToHex(s.cdA) } }).ok, false, "a floor in a tree that is not this write's nor the one before");
    const otherKey = { ...s.floor, signer: { publicKeyB64: bytesToB64(new Uint8Array(32).fill(5)), signatureB64: "AA==" } };
    assert.equal(bad({ ...good, floor: { ...floor, proof: otherKey } }).ok, false, "a floor signed by another key (anyone can make one)");
    assert.deepEqual(bad({ ...good, floor: { ...floor, proof: null as never } }).problems, ["the floor is malformed"], "a malformed floor is a problem, not a throw");
    assert.deepEqual(bad(good).problems, [], "and the untouched block still checks");
  });

  test("a proof outside the write's range is refused", () => {
    const s = scenario();
    const outside = attach(s.b[2]!, { ...blockFor(s.b[2]!, 2, s.treeB, s.cdB, s.evB, null), calldata: evmBytesToHex(encodeHourCalldata({ epochId: EPOCH, first: 8, last: 10, leaves: 3, rootHex: s.treeB.rootHex, prevLinkHex: hourLink(s.cdA) })) });
    assert.equal(checkPublication(outside).ok, false);
  });

  test("no block, no check", () => {
    assert.equal(checkPublication(fakeProof(2)).ok, false);
  });
});

describe("the chain of hourly writes", () => {
  test("writes link in order, quiet hours count, and a broken link or wrong members show", () => {
    const s = scenario();
    const quiet = encodeHourCalldata({ epochId: EPOCH, first: 12, last: 12, leaves: 0, rootHex: ZERO, prevLinkHex: hourLink(s.cdB) });
    const rec = (cd: Uint8Array, ev: WriteEvidence, members: Record<string, unknown>[]): HourRecord => ({
      format: HOUR_RECORD_FORMAT, calldata: evmBytesToHex(cd), link: hourLink(cd), write: ev,
      members: members.map((m) => ({ counter: (m["commit"] as { counter: string }).counter, chainHashB64: publishedChainHash(m) })), missing: [], writtenAt: "2026-11-13T00:00:00.000Z",
    });
    const run = [rec(s.cdA, s.evA, s.a), rec(s.cdB, s.evB, s.b), rec(quiet, publish(quiet), [])];
    const ok = checkHourChain(run);
    assert.deepEqual(ok.problems, []);
    assert.equal(ok.quietHours, 1);
    assert.equal(checkHourChain([run[0]!, run[2]!]).ok, false, "a missing hour breaks the links");
    assert.equal(checkHourChain([run[0]!, { ...run[1]!, members: run[1]!.members.slice(1) }]).ok, false, "members that do not make the root");
  });
});
