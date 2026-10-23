// Copyright (c) 2024-2026 Argento Computing Inc.

/**
 * The blob layer of a ceiling's settlement on Ethereum, on REAL data.
 *
 * Base block 51,979,918 holds the ceiling transaction 0x72cc…9450. Its batch
 * went to Ethereum block 26,088,463 in channel 0x42b5…f4b5: 7 frames in 7
 * blobs across two batcher transactions (0xcb57…a63a carries frames 0-5,
 * 0x6165…0190 frame 6). The bundle carries ONE blob, frame 0 (131,072
 * bytes): the prototype showed that frame 0 alone decompresses to 577,321
 * bytes, past the ceiling transaction at offset 501,594, so the transaction
 * is located from that one blob while the batch holding it is cut (it ends
 * at 650,075). Decoding the whole channel needs all 7 blobs, which the repo
 * does not carry. Nothing here touches a network.
 *
 * Run, after `npm run build` in packages/audit:
 *   node --test packages/audit/src/__tests__/settlement.test.ts
 */
import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  verifySettlementBlobs, decodeOpBlob, parseFrames, decodeSpanBatch, verifyCeilings, ingestEntries, runAudit, computeExitFlags,
  buildMarkdownReport, BASE_MAINNET_ROLLUP, BLOB_BYTES,
} from "@mikeargento/bitgraph-audit";
import type { SettlementBlobsOptions } from "@mikeargento/bitgraph-audit";
import {
  verifySettlementPointer, BASE_MAINNET_SETTLEMENT_PINS, evmHexToBytes as hexToBytes, evmBytesToHex as bytesToHex, keccak256, rlpEncode,
  type SettlementPointer,
} from "@mikeargento/bitgraph-verify";

const fixtureUrl = (name: string): URL => new URL(`./fixtures/settlement/${name}`, import.meta.url);
const pointer = JSON.parse(readFileSync(fixtureUrl("pointer-51979918.json"), "utf8")) as SettlementPointer;
const ceilingText = readFileSync(fixtureUrl("ceiling-51979918.json"), "utf8");
const ceiling = JSON.parse(ceilingText) as { anchor: { txHash: string; rawTx: string; blockNumber: number; blockHash: string } };
const VH0 = "0x018efc046e94610e2530344caf1574e507a3182e1a975fb25b032ec1434a3f5c";
const BLOB_FILE = `${VH0}.bin`;
const blob0 = new Uint8Array(readFileSync(fixtureUrl(BLOB_FILE)));
const CHANNEL = "0x42b5f4f4249919699b40a61bc497f4b5";
const CEILING_TX = "0x72cc33632237a96db749836905e92e45bd5cc4167403bc7970a69f250b3e9450";
const BASE_PARENT = "0xd2b1d2cece1bd23dcd34da3463ce2aa9b78da0f3234d1a5bd2d6c328b3a597da";
const clone = <T>(x: T): T => JSON.parse(JSON.stringify(x)) as T;
const blobs = (bytes: Uint8Array = blob0, vh = VH0): Map<string, Uint8Array> => new Map([[vh, bytes]]);
const expect: SettlementBlobsOptions["expect"] = { txHash: ceiling.anchor.txHash, rawTx: ceiling.anchor.rawTx, baseParentHash: BASE_PARENT };

describe("the real blob (frame 0 of the channel)", () => {
  test("decodes to one frame of the channel, the pointer layer accepts the pointer", () => {
    assert.equal(blob0.length, BLOB_BYTES);
    const data = decodeOpBlob(blob0);
    assert.equal(data.length, 130044);
    const frames = parseFrames(data);
    assert.equal(frames.length, 1);
    assert.deepEqual({ ...frames[0], frameData: frames[0].frameData.length }, { channelId: CHANNEL, frameNumber: 0, frameData: 130020, isLast: false });
    assert.equal(verifySettlementPointer(pointer, BASE_MAINNET_SETTLEMENT_PINS).ok, true);
  });

  test("KZG-verified, decoded as a prefix, the ceiling transaction is located in Base block 51,979,918 at index 38", async () => {
    const r = await verifySettlementBlobs(pointer, blobs(), { expect });
    assert.equal(r.ok, true, r.reason);
    assert.deepEqual(r.checks.map((c) => c.name), ["blob 0", "channel", "decompress", "batches", "block", "transaction"]);
    assert.ok(r.checks.every((c) => c.ok));
    assert.match(r.checks[0].detail!, /KZG commitment matches/);
    assert.deepEqual(r.channel, { id: CHANNEL, framesDecoded: 1, framesTotal: 7, complete: false, compression: "brotli", decodedBytes: 577321, baseBlocks: [51979915, 51979916, 51979917] });
    assert.deepEqual(r.located, {
      baseBlockNumber: 51979918, baseBlockTimestamp: 1790749183, baseParentHash: BASE_PARENT, baseTxIndex: 38, txHash: CEILING_TX,
      rawTx: ceiling.anchor.rawTx, batchComplete: false,
    });
    assert.match(r.checks[5].detail!, /bytes equal the ceiling's rawTx/);
    assert.match(r.checks[4].detail!, /parent 0xd2b1d2ce…97da as the ceiling's header says/);
  });

  test("without expectations, the pointer's own located.txHash is what gets located", async () => {
    const r = await verifySettlementBlobs(pointer, blobs());
    assert.equal(r.ok, true, r.reason);
    assert.equal(r.located!.baseTxIndex, 38);
  });

  test("the 4,067,670-byte channel is not decodable whole from one blob, and the audit says so", async () => {
    const p = clone(pointer);
    p.baseBlockNumber = 51979930; // in the channel, past what frame 0 reaches
    const r = await verifySettlementBlobs(p, blobs());
    assert.equal(r.ok, false);
    assert.match(r.reason!, /^block: Base block 51979930 is not among the decoded batches/);
  });
});

describe("rejects", () => {
  const rejects = (name: string, mk: () => { p?: SettlementPointer; b?: Map<string, Uint8Array>; o?: SettlementBlobsOptions }, re: RegExp): void => {
    test(name, async () => {
      const { p, b, o } = mk();
      const r = await verifySettlementBlobs(p ?? pointer, b ?? blobs(), o ?? { expect });
      assert.equal(r.ok, false, `accepted: ${name}`);
      assert.match(r.reason!, re);
      assert.equal(r.located, undefined);
    });
  };
  rejects("a flipped blob byte (KZG)", () => { const x = blob0.slice(); x[5000] ^= 1; return { b: blobs(x) }; }, /^blob 0: .*do not commit to the listed KZG commitment/);
  rejects("a blob of the wrong size", () => ({ b: blobs(blob0.slice(0, 1000)) }), /^blob 0: 1000 bytes, a blob is 131072/);
  rejects("bytes under a versioned hash the pointer does not list", () => ({ b: blobs(blob0, "0x01" + "ab".repeat(31)) }), /^blobs: no bytes were supplied/);
  rejects("no blobs at all", () => ({ b: new Map() }), /^blobs: no bytes/);
  rejects("a pointer naming no blobs", () => { const p = clone(pointer); p.blobs = []; return { p }; }, /^blobs: the pointer names no blobs/);
  rejects("a listed commitment that is not the blob's", () => {
    const p = clone(pointer);
    const c = hexToBytes(p.blobs[0].kzgCommitment); c[20] ^= 1; p.blobs[0].kzgCommitment = bytesToHex(c);
    return { p };
  }, /^blob 0: .*do not commit/);
  rejects("a pointer naming another channel", () => { const p = clone(pointer); p.channel!.id = "0x" + "11".repeat(16); return { p }; }, /^channel: no supplied blob carries a frame of channel/);
  rejects("a pointer claiming zlib", () => { const p = clone(pointer); p.channel!.compression = "zlib"; return { p }; }, /^decompress: the channel is brotli, the pointer says zlib/);
  rejects("a Base block not in the channel", () => { const p = clone(pointer); p.baseBlockNumber = 51979900; return { p }; }, /^block: .*not among/);
  rejects("a parent hash the batch does not carry", () => ({ o: { expect: { ...expect, baseParentHash: "0x" + "ee".repeat(32) } } }), /^block: the batch's parent_hash is/);
  rejects("a ceiling transaction that is not in the batch", () => ({ o: { expect: { txHash: "0x" + "cd".repeat(32) } } }), /^transaction: 0xcdcdcdcd…cdcd is not among the \d+ transactions readable before the cut/);
  rejects("a located index the pointer states wrongly", () => { const p = clone(pointer); p.located!.baseTxIndex = 37; return { p }; }, /^transaction: located at index 38, the pointer says 37/);
  rejects("raw bytes that are not the ceiling's", () => ({ o: { expect: { txHash: CEILING_TX, rawTx: "0x02c0" } } }), /^transaction: the bytes in the batch are not the ceiling's rawTx/);
});

describe("through the audit's ceiling check", () => {
  const entries = (files: Record<string, string | Uint8Array>) =>
    ingestEntries(Object.entries(files).map(([path, v]) => ({ path, open: () => (typeof v === "string" ? new TextEncoder().encode(v) : v) })));

  test("a ceiling with a pointer and no blob bytes: pointer ok, blobs not in bundle, never a failure", async () => {
    const ingest = await entries({ "base-ceiling/ceiling.json": ceilingText });
    const r = await verifyCeilings(ingest);
    const c = r.checks[0];
    assert.equal(c.status, "unmatched"); // the proof is not in this bundle; the settlement is checked all the same
    assert.equal(c.settlement!.status, "pointer-only");
    assert.deepEqual(c.settlement!.lines, [
      "settlement: pointer ok, Ethereum block 26088463 at 2026-09-30 06:20:35 UTC",
      "settlement: blobs not in bundle",
    ]);
    assert.deepEqual(c.settlement!.pointer.existedBy, { blockNumber: 26088463, blockHash: "0x8608654cd9d6d66c2ce8a80108db7e5202a6d9ad0072f8c81353cc988d3a93f2", blockTimestamp: 1790749235 });
    assert.deepEqual(c.settlement!.blobs, { status: "absent", detail: "blobs not in bundle", listed: 6, supplied: 0 });
  });

  test("the blob next to the ceiling file: both layers verified, one line each", async () => {
    const ingest = await entries({ "base-ceiling/ceiling.json": ceilingText, [`base-ceiling/${BLOB_FILE}`]: blob0 });
    const c = (await verifyCeilings(ingest)).checks[0];
    assert.equal(c.settlement!.status, "verified");
    assert.equal(c.settlement!.lines[1], "settlement: blobs decoded (frames 0..0 of 7), ceiling tx located in Base block 51979918 (batch cut at the last frame supplied)");
    assert.deepEqual(c.settlement!.blobs.located, { baseBlockNumber: 51979918, baseTxIndex: 38, txHash: CEILING_TX, batchComplete: false, framesDecoded: 1, framesTotal: 7 });
    assert.equal(c.settlement!.blobs.supplied, 1);
    assert.equal(c.status, "unmatched");
  });

  test("the blob under blobs/ at the bundle root is found too", async () => {
    const ingest = await entries({ "base-ceiling/ceiling.json": ceilingText, [`blobs/${BLOB_FILE}`]: blob0 });
    assert.equal((await verifyCeilings(ingest)).checks[0].settlement!.status, "verified");
  });

  test("a tampered pointer fails the ceiling", async () => {
    const s = JSON.parse(ceilingText);
    const h = hexToBytes(s.settlement.l1.blockHeader); h[300] ^= 1; s.settlement.l1.blockHeader = bytesToHex(h);
    const c = (await verifyCeilings(await entries({ "c.json": JSON.stringify(s) }))).checks[0];
    assert.equal(c.status, "failed");
    assert.match(c.reason!, /^settlement: pointer FAILED \(header: /);
    assert.equal(c.settlement!.status, "failed");
    assert.equal(c.settlement!.blobs.status, "absent");
  });

  test("a pointer for another Base block than the ceiling's fails the ceiling", async () => {
    const s = JSON.parse(ceilingText);
    s.anchor.blockNumber = 51967531;
    const c = (await verifyCeilings(await entries({ "c.json": JSON.stringify(s) }))).checks[0];
    assert.equal(c.status, "failed");
    assert.match(c.reason!, /the pointer names Base block 51979918 .* this ceiling is in block 51967531/);
  });

  test("a wrong blob in the bundle fails the ceiling", async () => {
    const bad = blob0.slice(); bad[70000] ^= 1;
    const c = (await verifyCeilings(await entries({ "c.json": ceilingText, [BLOB_FILE]: bad }))).checks[0];
    assert.equal(c.status, "failed");
    assert.match(c.reason!, /^settlement: blobs FAILED \(blob 0: /);
  });

  test("other pins refuse the pointer", async () => {
    const c = (await verifyCeilings(await entries({ "c.json": ceilingText }), { settlementPins: { ...BASE_MAINNET_SETTLEMENT_PINS, batcher: "0x" + "11".repeat(20) } })).checks[0];
    assert.equal(c.status, "failed");
    assert.match(c.reason!, /pointer FAILED \(batcher:/);
  });
});

describe("through runAudit on a directory bundle", () => {
  let dir: string;
  before(async () => { dir = await mkdtemp(join(tmpdir(), "audit-settlement-")); });
  after(async () => { await rm(dir, { recursive: true, force: true }); });

  test("exit 0, and the markdown report carries both settlement lines", async () => {
    const b = join(dir, "ok");
    await mkdir(join(b, "base-ceiling", "blobs"), { recursive: true });
    await writeFile(join(b, "base-ceiling", "ceiling.json"), ceilingText);
    await writeFile(join(b, "base-ceiling", "blobs", BLOB_FILE), blob0);
    const r = await runAudit(b);
    const c = r.ceilings!.checks[0];
    assert.equal(c.settlement!.status, "verified");
    assert.equal(computeExitFlags(r).code, 0);
    const md = buildMarkdownReport(r);
    assert.match(md, /  - settlement: pointer ok, Ethereum block 26088463 at 2026-09-30 06:20:35 UTC/);
    assert.match(md, /  - settlement: blobs decoded \(frames 0\.\.0 of 7\), ceiling tx located in Base block 51979918/);
  });

  test("a bad pointer sets exit bit 2", async () => {
    const b = join(dir, "bad");
    await mkdir(b, { recursive: true });
    const s = JSON.parse(ceilingText);
    s.settlement.l1.txIndex = 19;
    await writeFile(join(b, "ceiling.json"), JSON.stringify(s));
    const r = await runAudit(b);
    assert.equal(r.ceilings!.checks[0].status, "failed");
    assert.equal(computeExitFlags(r).code & 2, 2);
  });
});

describe("span batches (type 1), synthetic", () => {
  const uvarint = (n: bigint): number[] => { const out: number[] = []; for (;;) { const b = Number(n & 0x7fn); n >>= 7n; if (n === 0n) { out.push(b); return out; } out.push(b | 0x80); } };
  const bitsBytes = (bits: number[]): number[] => { let v = 0n; bits.forEach((b, i) => { if (b) v |= 1n << BigInt(i); }); const n = Math.ceil(bits.length / 8); const out = new Array<number>(n).fill(0); for (let i = n - 1; i >= 0; i--) { out[i] = Number(v & 0xffn); v >>= 8n; } return out; };
  const u = (n: bigint): Uint8Array => { if (n === 0n) return new Uint8Array(0); let h = n.toString(16); if (h.length % 2) h = "0" + h; return hexToBytes(h); };

  test("a block with a type-2 and a protected legacy transaction is rebuilt into the same raw transactions", () => {
    const chainId = 8453n;
    const to = hexToBytes("0x" + "ab".repeat(20));
    const r1 = hexToBytes("0x" + "11".repeat(32)), s1 = hexToBytes("0x" + "22".repeat(32));
    const r2 = hexToBytes("0x" + "33".repeat(32)), s2 = hexToBytes("0x" + "44".repeat(32));
    const input = hexToBytes("0xdeadbeef");
    // The raw transactions a Base block would carry.
    const type2 = new Uint8Array([0x02, ...rlpEncode([u(chainId), u(7n), u(1000n), u(2000n), u(21000n), to, u(5n), input, [], u(1n), r1, s1])]);
    const legacy = rlpEncode([u(8n), u(3000n), u(50000n), to, u(0n), new Uint8Array(0), u(chainId * 2n + 35n + 0n), r2, s2]);
    // The span batch: prefix, then columns.
    const relTimestamp = 2n * 1000n;
    const bytes = Uint8Array.from([
      ...uvarint(relTimestamp), ...uvarint(123n), ...new Array(20).fill(1), ...new Array(20).fill(2),
      ...uvarint(1n), ...bitsBytes([0]), ...uvarint(2n),
      ...bitsBytes([0, 0]), ...bitsBytes([1, 0]),
      ...r1, ...s1, ...r2, ...s2,
      ...to, ...to,
      0x02, ...rlpEncode([u(5n), u(1000n), u(2000n), input, []]),
      ...rlpEncode([u(0n), u(3000n), new Uint8Array(0)]),
      ...uvarint(7n), ...uvarint(8n),
      ...uvarint(21000n), ...uvarint(50000n),
      ...bitsBytes([1]),
    ]);
    const blocks = decodeSpanBatch(bytes, BASE_MAINNET_ROLLUP, chainId);
    assert.equal(blocks.length, 1);
    assert.equal(blocks[0].number, 1000);
    assert.equal(blocks[0].timestamp, BASE_MAINNET_ROLLUP.l2GenesisTime + 2000);
    assert.deepEqual(blocks[0].txs.map((t) => t.hash), [type2, legacy].map((raw) => bytesToHex(keccak256(raw))));
    assert.deepEqual(blocks[0].txs.map((t) => bytesToHex(t.raw)), [type2, legacy].map(bytesToHex));
  });

  test("trailing bytes are refused", () => {
    assert.throws(() => decodeSpanBatch(Uint8Array.from([...[0, 0], ...new Array(40).fill(0), 1, 0, 0, 0, 0, 0, 0, 0, 0]), BASE_MAINNET_ROLLUP, 8453n), /span batch/);
  });
});
