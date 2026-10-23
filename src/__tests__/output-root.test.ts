// Copyright (c) 2024-2026 Argento Computing Inc. Licensed under the MIT License. See LICENSE.

/**
 * bitgraph-output-root/1 against a vector captured from the live chains on
 * 2026-10-03: a BitGraph ceiling transaction in Base block 52,107,106,
 * settled through Base's output root for block 52,109,160, whose claim is
 * carried by an Ethereum transaction in block 26,110,095. Every mutation of
 * any link must fail, and B = P must pass without a history proof.
 */

import { describe, test } from "node:test";
import * as assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
  computeOutputRoot,
  decodeCeilingPayload,
  decodeEip1559,
  decodeHeader,
  evmHexToBytes,
  historySlot,
  keccak256,
  mptVerify,
  txTrieKey,
  verifyOutputRootSettlement,
  HISTORY_SERVE_WINDOW,
  evmBytesToHex,
} from "@mikeargento/bitgraph-verify";
import type { OutputRootSettlement } from "@mikeargento/bitgraph-verify";

const VEC = JSON.parse(readFileSync(fileURLToPath(new URL("../../spec/vectors/output-root-1.json", import.meta.url)), "utf8")) as {
  ceilingTx: { txHash: string; rawTx: string; payloadRoot: string; blockNumber: number; blockHash: string; header: string; txIndex: number; txInclusionProof: string[]; from: string };
  settlement: OutputRootSettlement;
  expected: { outputRoot: string; existedBy: { blockNumber: number; blockHash: string; blockTimestamp: number } };
};
const clone = (): OutputRootSettlement => JSON.parse(JSON.stringify(VEC.settlement)) as OutputRootSettlement;
const flip = (hex: string, at = 10) => hex.slice(0, at) + (hex[at] === "0" ? "1" : "0") + hex.slice(at + 1);

describe("output-root/1, the live vector", () => {
  test("the settlement verifies and names the Ethereum block", () => {
    const r = verifyOutputRootSettlement(VEC.settlement);
    assert.equal(r.ok, true, r.reason);
    assert.equal(r.outputRootHex, VEC.expected.outputRoot);
    assert.deepEqual(r.existedBy, VEC.expected.existedBy);
  });

  test("the ceiling transaction is a BGC1 payload from the writer, inside Base block B, whose hash the settlement proves", () => {
    const c = VEC.ceilingTx;
    const h = decodeHeader(evmHexToBytes(c.header));
    assert.equal(h.hash, c.blockHash);
    assert.equal(h.hash, VEC.settlement.base.blockHash);
    assert.equal(h.number, VEC.settlement.base.blockNumber);
    const inBlock = mptVerify(evmHexToBytes(h.transactionsRoot), txTrieKey(c.txIndex), c.txInclusionProof.map(evmHexToBytes));
    assert.ok(inBlock);
    assert.equal(evmBytesToHex(inBlock!), c.rawTx);
    const tx = decodeEip1559(evmHexToBytes(c.rawTx));
    assert.equal(tx.from, "0xf3972408d853c975f86351c311f4310220bbf2a3");
    assert.equal(evmBytesToHex(decodeCeilingPayload(tx.data).root), c.payloadRoot);
  });

  test("the output root is keccak256 over the four 32-byte fields", () => {
    const o = VEC.settlement.outputRoot;
    const pre = new Uint8Array(128);
    [o.version, o.stateRoot, o.messagePasserStorageRoot, o.blockHash].forEach((x, i) => pre.set(evmHexToBytes(x), i * 32));
    assert.equal(evmBytesToHex(keccak256(pre)), VEC.expected.outputRoot);
    assert.equal(evmBytesToHex(computeOutputRoot(o)), VEC.expected.outputRoot);
  });

  test("the history slot is B mod 8191, big-endian in 32 bytes", () => {
    assert.equal(evmBytesToHex(historySlot(VEC.settlement.base.blockNumber)), VEC.settlement.history!.slot);
    assert.equal(evmBytesToHex(historySlot(8191)), "0x" + "00".repeat(32));
    assert.equal(evmBytesToHex(historySlot(8192)), "0x" + "00".repeat(31) + "01");
    assert.equal(evmBytesToHex(historySlot(52107106)), "0x" + (52107106 % 8191).toString(16).padStart(64, "0"));
  });
});

describe("output-root/1, every link broken", () => {
  const mutations: Array<[string, (s: OutputRootSettlement) => void, RegExp]> = [
    ["version", (s) => { s.version = "bitgraph-output-root/2" as never; }, /format/],
    ["a non-zero output-root version", (s) => { s.outputRoot.version = "0x" + "00".repeat(31) + "01"; }, /version 0/],
    ["the state root", (s) => { s.outputRoot.stateRoot = flip(s.outputRoot.stateRoot); }, /history|ethereum/],
    ["the message-passer root", (s) => { s.outputRoot.messagePasserStorageRoot = flip(s.outputRoot.messagePasserStorageRoot); }, /ethereum.*output root/],
    ["P's block hash", (s) => { s.outputRoot.blockHash = flip(s.outputRoot.blockHash); }, /ethereum.*output root/],
    ["B's hash", (s) => { s.base.blockHash = flip(s.base.blockHash); }, /history/],
    ["B's number", (s) => { s.base.blockNumber += 1; }, /history/],
    ["P - B = 8,192", (s) => { s.base.blockNumber = s.outputRoot.blockNumber - (HISTORY_SERVE_WINDOW + 1); }, /history.*8191/],
    ["P - B = 0 with a history proof", (s) => { s.base.blockNumber = s.outputRoot.blockNumber; }, /B = P/],
    ["B after P", (s) => { s.base.blockNumber = s.outputRoot.blockNumber + 5; }, /history/],
    ["a dropped history proof", (s) => { s.history = null; }, /history storage proof/],
    ["the history slot", (s) => { s.history!.slot = flip(s.history!.slot, 64); }, /slot/],
    ["the history contract address", (s) => { s.history!.address = "0x" + "11".repeat(20); }, /EIP-2935/],
    ["an account-proof node", (s) => { s.history!.accountProof[1] = flip(s.history!.accountProof[1]!, 40); }, /account proof/],
    ["a storage-proof node", (s) => { s.history!.storageProof[0] = flip(s.history!.storageProof[0]!, 40); }, /storage proof/],
    ["the Ethereum header", (s) => { s.ethereum.header = flip(s.ethereum.header, 20); }, /ethereum/],
    ["the Ethereum block hash", (s) => { s.ethereum.blockHash = flip(s.ethereum.blockHash); }, /ethereum.*hash/],
    ["the Ethereum block number", (s) => { s.ethereum.blockNumber += 1; }, /ethereum/],
    ["the Ethereum timestamp", (s) => { s.ethereum.blockTimestamp += 1; }, /ethereum/],
    ["the claim transaction", (s) => { s.ethereum.rawTx = flip(s.ethereum.rawTx, 200); }, /ethereum/],
    ["the transaction index", (s) => { s.ethereum.txIndex += 1; }, /ethereum.*not in this block/],
    ["an inclusion-proof node", (s) => { s.ethereum.txInclusionProof[0] = flip(s.ethereum.txInclusionProof[0]!, 40); }, /ethereum.*not in this block/],
  ];
  for (const [label, mutate, why] of mutations) {
    test(`changing ${label} fails`, () => {
      const s = clone();
      mutate(s);
      const r = verifyOutputRootSettlement(s);
      assert.equal(r.ok, false, `${label} passed`);
      assert.match(r.reason ?? "", why, `${label}: ${r.reason}`);
    });
  }

  test("a transaction that is in the block but does not carry the output root fails", () => {
    // Re-point the settlement at another output root: same chain evidence, different claim.
    const s = clone();
    s.outputRoot.messagePasserStorageRoot = "0x" + "00".repeat(32);
    const r = verifyOutputRootSettlement(s);
    assert.equal(r.ok, false);
    assert.match(r.reason ?? "", /do not contain the output root/);
  });
});

describe("output-root/1, B = P", () => {
  test("passes with no history proof, using the output root's own block hash", () => {
    const s = clone();
    s.base = { chainId: 8453, blockNumber: s.outputRoot.blockNumber, blockHash: s.outputRoot.blockHash };
    s.history = null;
    const r = verifyOutputRootSettlement(s);
    assert.equal(r.ok, true, r.reason);
    assert.match(r.checks.find((c) => c.name === "history")!.detail ?? "", /B = P/);
  });

  test("fails when B = P but the hash is not P's", () => {
    const s = clone();
    s.base = { chainId: 8453, blockNumber: s.outputRoot.blockNumber, blockHash: flip(s.outputRoot.blockHash) };
    s.history = null;
    assert.equal(verifyOutputRootSettlement(s).ok, false);
  });

  test("P - B = 1 and P - B = 8,191 are inside the window (boundary arithmetic)", () => {
    for (const d of [1, 8191]) {
      const s = clone();
      s.base.blockNumber = s.outputRoot.blockNumber - d;
      const r = verifyOutputRootSettlement(s);
      // The live proof is for a different slot, so the proof itself fails; what must not fail is the window rule.
      assert.doesNotMatch(r.reason ?? "", /holds blocks 1 to/, `d=${d}`);
    }
  });
});
