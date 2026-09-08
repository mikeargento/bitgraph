// Copyright (c) 2024-2026 Mike Argento.

/**
 * The anchor's block header, and the one property that makes it safe.
 *
 * An anchor's metadata now carries the RLP header its signed block hash
 * covers, so the anchor can be checked with nothing but itself. The header is
 * UNSIGNED, which is fine precisely because it is self-proving: a reader
 * recomputes keccak256 of it and compares against the signed hash, so a
 * tampered header cannot pass.
 *
 * ⚠️ The property under test is that a header this encoder cannot represent
 * yields NOTHING rather than something wrong. Ethereum adds header fields at
 * hard forks, and an encoder that guessed at an unknown one would produce a
 * confident wrong answer; abstaining leaves the anchor exactly as every
 * anchor before this change, checkable from an RPC.
 *
 * The fixture is a REAL mainnet block (Prague-era: base fee, withdrawals,
 * blob gas, parent beacon root, requests hash all present).
 *
 * Run: node --test src/__tests__/eth-header.test.ts
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { keccak_256 } from "@noble/hashes/sha3";
import { encodeHeaderRlp, headerRlpFor, toHex0x, type RpcBlockHeader } from "../eth-header.ts";

const BLOCK: RpcBlockHeader = {
  "parentHash": "0xf8905e811d10e5e7ac05a8a195121867db054cefe3ef8d5dc507f7f5605a6d1a",
  "sha3Uncles": "0x1dcc4de8dec75d7aab85b567b6ccd41ad312451b948a7413f0a142fd40d49347",
  "miner": "0x4838b106fce9647bdf1e7877bf73ce8b0bad5f97",
  "stateRoot": "0x9253e9ef711228f1bc2db88ea20bcbb0c5ec2e5ce11479f0a0efad946d90fe9b",
  "transactionsRoot": "0x0caa872b49a456eeb384b5356a380ae978341e2034da03dcb335e3dc01a95791",
  "receiptsRoot": "0xdcf2b51471e19ee97b55390e5ee90ecf9593f38cd0633c81c43a24d8239acb18",
  "logsBloom": "0xa4ebdae7c7ec6ffdbf54dffee6bf3fc7dbd69d1c76e4a798ed4beadebc76faf7bfd9efefe17fd1b6ffd37fbb6e3f3fcb6fafe3fcfebb7fdefefdff9eb57f9f67dff6d76445e6cffeefdaa9efaffbb3ef7fa97637bbffa735ff76dff4f73d5dfdbf16f75fb3f4654bff55b9f99fbffe6fe62be67eedb6bf67abd66bbf177ee7f1eb79eefdf75c37fbfebff77957bbdffae6dddef7ff6f6d5ee6e5f96671dffda74fd63babf7c9e65ffffde7f5ff7f5fcbdfd6ab7ffe52ff9fd2ed5776772d91d3ffe57fd7dececdff18c7afd3e97eefcd23ffafc3efeff3ff11df8bd73ff8eae7feb3af2efbef7dbede7a7fce7ef5fd677ff7f7afffb08fcb071bf7fff9dbf5f7",
  "difficulty": "0x0",
  "number": "0x18baa5a",
  "gasLimit": "0x3938700",
  "gasUsed": "0x1db7e4d",
  "timestamp": "0x6a9f9253",
  "extraData": "0x546974616e2028746974616e6275696c6465722e78797a29",
  "mixHash": "0x2345d8e57dca5c309071def74a6e0348587de0a7fe3f5156d23485004772e3d7",
  "nonce": "0x0000000000000000",
  "baseFeePerGas": "0x3fdeb01",
  "withdrawalsRoot": "0xcd50d01122559312624f0b42b77ceebfce6eb78c6fd7ae7755ac51d122eb1ce0",
  "blobGasUsed": "0xa0000",
  "excessBlobGas": "0xa93e499",
  "parentBeaconBlockRoot": "0xabbdecf3bc81408f562e123ea02b307c224f945eda14397f06775cfef1119ad6",
  "requestsHash": "0xe3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
  "hash": "0xd0821d79e728073edcb128821c5c532decb6eb860796a88266fd379f4ef3f12a"
} as RpcBlockHeader;

test("a real mainnet header re-encodes to its own block hash", () => {
  const rlp = encodeHeaderRlp(BLOCK);
  assert.equal(toHex0x(keccak_256(rlp)).toLowerCase(), BLOCK.hash.toLowerCase());
});

test("headerRlpFor returns the encoding when it reproduces the hash", () => {
  const hex = headerRlpFor(BLOCK, BLOCK.hash);
  assert.ok(hex && hex.startsWith("0x"));
  assert.equal(toHex0x(keccak_256(Uint8Array.from(hex!.slice(2).match(/../g)!.map((x) => parseInt(x, 16))))).toLowerCase(),
    BLOCK.hash.toLowerCase());
  // Roughly 600 bytes on the wire, which is what this costs per anchor.
  assert.ok(hex!.length / 2 < 800, `header is ${hex!.length / 2} bytes`);
});

test("NEGATIVE: a header that does not reproduce the hash yields null", () => {
  // The case that must never emit anything: one field off by a byte.
  const tampered = { ...BLOCK, stateRoot: BLOCK.stateRoot.replace(/.$/, (c) => (c === "0" ? "1" : "0")) };
  assert.equal(headerRlpFor(tampered, BLOCK.hash), null);
});

test("NEGATIVE: a header missing a fork field yields null, never a guess", () => {
  // Dropping requestsHash is what an encoder one hard fork behind would do.
  const older = { ...BLOCK };
  delete (older as Record<string, unknown>).requestsHash;
  assert.equal(headerRlpFor(older as RpcBlockHeader, BLOCK.hash), null,
    "an encoding that cannot reproduce the hash must abstain");
});

test("NEGATIVE: nothing in, null out", () => {
  assert.equal(headerRlpFor(null, BLOCK.hash), null);
  assert.equal(headerRlpFor(undefined, BLOCK.hash), null);
  assert.equal(headerRlpFor({} as RpcBlockHeader, BLOCK.hash), null);
});

test("the hash comparison is case-insensitive", () => {
  assert.ok(headerRlpFor(BLOCK, BLOCK.hash.toUpperCase().replace("0X", "0x")));
});
