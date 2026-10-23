/**
 * bitgraph-epoch-genesis/1: the record an epoch's first BitGraph binds when the epoch opens with a Base write.
 *
 *   cd packages/verify && npx tsc -p . && node --test dist/__tests__/epoch-genesis.test.js
 */

import { test } from "node:test";
import { strict as assert } from "node:assert";
import { sha256 } from "@noble/hashes/sha256";
import {
  EPOCH_GENESIS_FORMAT, checkEpochGenesis, epochGenesisCalldata, epochGenesisCalldataHex, epochGenesisFileText,
  epochIdOfCalldata, parseEpochGenesisFile,
} from "../epoch-genesis.js";
import type { BitGraphProof } from "../types.js";

const epochId = Buffer.from(Array.from({ length: 32 }, (_, i) => (i * 7 + 3) & 0xff)).toString("base64");
const writer = "0x" + "ab".repeat(20);
const txHash = "0x" + "cd".repeat(32);
const blockHash = "0x" + "ef".repeat(32);
const file = epochGenesisFileText({ epochId, chainId: 8453, writer, txHash, blockNumber: 52_000_000, blockHash, blockTimestamp: 1_790_000_000 });

function proofFor(text: string, over: Partial<{ counter: string; slotCounter: string; epochId: string }> = {}): BitGraphProof {
  return {
    version: "bitgraph/1",
    artifact: { hashAlg: "sha256", digestB64: Buffer.from(sha256(new TextEncoder().encode(text))).toString("base64") },
    commit: { nonceB64: "x", counter: "2", slotCounter: "1", epochId, atomic: true, ...over },
    signer: { publicKeyB64: "k", signatureB64: "s" },
    environment: { enforcement: "measured-tee", measurement: "m" },
  } as unknown as BitGraphProof;
}

test("calldata is the magic and the epoch id, and reads back", () => {
  const data = epochGenesisCalldata(epochId);
  assert.equal(data.length, 36);
  assert.equal(Buffer.from(data.slice(0, 4)).toString(), "BGE1");
  assert.equal(epochIdOfCalldata(data), epochId);
  assert.equal(epochIdOfCalldata(epochGenesisCalldataHex(epochId)), epochId);
  assert.equal(epochIdOfCalldata("0x"), null);
  assert.equal(epochIdOfCalldata("0x" + "00".repeat(36)), null);
  assert.throws(() => epochGenesisCalldata("short"));
});

test("the file round-trips and is strict", () => {
  const g = parseEpochGenesisFile(file);
  assert.ok(g);
  assert.equal(g.format, EPOCH_GENESIS_FORMAT);
  assert.equal(g.chain, "base-mainnet");
  assert.equal(g.writer, writer);
  assert.match(g.note, /mined in block 52000000/);
  assert.equal(parseEpochGenesisFile(file.replace("base-mainnet", "base-sepolia")), null);
  assert.equal(parseEpochGenesisFile(file.replace(txHash, "0x1234")), null);
  assert.equal(parseEpochGenesisFile("{}"), null);
  assert.equal(parseEpochGenesisFile("not json"), null);
});

test("the offline check: file against the epoch's first proof", () => {
  assert.deepEqual(checkEpochGenesis({ file, proof: proofFor(file) }).reasons, []);
  assert.match(checkEpochGenesis({ file, proof: proofFor(file + " ") }).reasons.join(), /does not hash/);
  assert.match(checkEpochGenesis({ file, proof: proofFor(file, { counter: "9", slotCounter: "8" }) }).reasons.join(), /first BitGraph/);
  assert.match(checkEpochGenesis({ file, proof: proofFor(file, { epochId: "other" }) }).reasons.join(), /not of the epoch/);
});

test("the online check: the transaction and the block as Base reports them", () => {
  const tx = { from: writer.toUpperCase().replace("0X", "0x"), to: writer, input: epochGenesisCalldataHex(epochId), blockHash, blockNumber: 52_000_000 };
  const block = { hash: blockHash, number: 52_000_000, timestamp: 1_790_000_000 };
  assert.equal(checkEpochGenesis({ file, proof: proofFor(file), tx, block }).ok, true);
  assert.match(checkEpochGenesis({ file, proof: proofFor(file), tx: { ...tx, input: "0x00" }, block }).reasons.join(), /carry this epoch/);
  assert.match(checkEpochGenesis({ file, proof: proofFor(file), tx: { ...tx, to: "0x" + "11".repeat(20) }, block }).reasons.join(), /self-addressed/);
  assert.match(checkEpochGenesis({ file, proof: proofFor(file), tx: { ...tx, blockHash: "0x" + "00".repeat(32) }, block }).reasons.join(), /not in the block/);
  assert.match(checkEpochGenesis({ file, proof: proofFor(file), tx, block: { ...block, timestamp: 1 } }).reasons.join(), /block time/);
});
