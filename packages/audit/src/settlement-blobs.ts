// Copyright (c) 2024-2026 Argento Computing Inc. Licensed under the MIT License. See LICENSE.

/**
 * The BLOB layer of a Base ceiling's settlement on Ethereum
 * (bitgraph-settlement/1). The pointer layer, in bitgraph-verify, shows that
 * an Ethereum block includes a batcher transaction listing some blob
 * commitments. This layer closes the loop from those commitments to the
 * ceiling transaction's bytes, offline, from blob bytes kept beside the
 * package:
 *
 *   blob bytes ─KZG commit→  == pointer.blobs[i].kzgCommitment (the versioned
 *                               hash the signed transaction lists is
 *                               0x01 || SHA-256(commitment)[1:])
 *   blob ─OP blob decode→ frames ─assemble→ channel ─brotli/zlib→ batches
 *   batch ─timestamp, parent hash→ the Base block
 *   transaction_list[i] ─keccak256→ the ceiling transaction's hash
 *
 * A channel is one compressed stream split into frames, so decoding needs
 * frame 0 and every frame after it up to the one holding the bytes. With
 * every frame present the channel is decoded whole. With a PREFIX of the
 * frames (a pointer names one transaction's blobs, and a channel can span
 * two transactions), the stream is decompressed as far as it goes and only
 * the batches and transactions complete inside that prefix are read. That is
 * sound because a compressed stream is sequential: a prefix of its input
 * yields a prefix of its output, and an RLP item complete in the prefix is
 * the same item the whole stream holds. What a prefix cannot show is that
 * the channel as a whole is well formed.
 *
 * Node only: KZG is micro-eth-signer over @noble/curves with the mainnet
 * trusted setup from @paulmillr/trusted-setups (loaded on first use, about
 * 0.3 s per blob to recompute a commitment), and decompression is node:zlib.
 * No network, like the rest of the audit.
 */

import { brotliDecompressSync, inflateSync, constants as zlibConstants } from "node:zlib";
import {
  keccak256, rlpEncode, versionedHashOf,
  evmHexToBytes as hexToBytes, evmBytesToHex as bytesToHex,
  type SettlementPointer, type RlpItem,
} from "@mikeargento/bitgraph-verify";

/** Base mainnet: block number = (timestamp - l2GenesisTime) / blockTime. */
export const BASE_MAINNET_ROLLUP = Object.freeze({ l2GenesisTime: 1686789347, blockTime: 2 });

export const BLOB_BYTES = 131072;
/** OP Stack blob encoding version 0: (4 * 31 + 3) * 1024 - 4 bytes of data per blob. */
export const MAX_BLOB_DATA_BYTES = 130044;
/** Fjord's cap on a channel's decompressed size; decoding refuses to grow past it. */
const MAX_CHANNEL_BYTES = 100_000_000;

export interface SettlementBlobsCheck {
  name: string;
  ok: boolean;
  detail?: string;
}

export interface SettlementLocated {
  /** The Base block the batch places the transaction in, read from the batch's timestamp. */
  baseBlockNumber: number;
  baseBlockTimestamp: number;
  /** The batch's parent_hash (the hash of the block before), when the batch form carries one. */
  baseParentHash: string | null;
  /** Index in the batch's transaction_list: the block's non-deposit transactions, in order. */
  baseTxIndex: number;
  txHash: string;
  /** The transaction's exact bytes as the batch carries them, 0x hex. */
  rawTx: string;
  /** Whether the batch holding the block was complete in the decoded bytes (false past the end of a frame prefix). */
  batchComplete: boolean;
}

export interface SettlementBlobsResult {
  ok: boolean;
  reason?: string;
  checks: SettlementBlobsCheck[];
  /** What was decoded: frames 0..framesDecoded-1 of the channel, whole or as a prefix. */
  channel?: {
    id: string;
    framesDecoded: number;
    /** The channel's frame count when known (complete, or stated by the pointer). */
    framesTotal: number | null;
    complete: boolean;
    compression: "brotli" | "zlib";
    decodedBytes: number;
    /** Base blocks whose batches were complete in the decoded bytes. */
    baseBlocks: number[];
  };
  located?: SettlementLocated;
}

export interface SettlementBlobsOptions {
  /** How the rollup turns a batch timestamp into a block number. Base mainnet by default. */
  rollup?: { l2GenesisTime: number; blockTime: number };
  /** The L2 chain id, for rebuilding transactions out of span batches. Base mainnet by default. */
  chainId?: bigint;
  /** What the ceiling record says, each matched against what the batch says when given. */
  expect?: {
    /** The ceiling transaction to locate (else the pointer's `located.txHash`). */
    txHash?: string;
    /** Its exact bytes, 0x hex. */
    rawTx?: string;
    /** The Base block's parent hash, from the ceiling's carried header. */
    baseParentHash?: string;
  };
}

// ── KZG, loaded on first use ───────────────────────────────────────────────

interface Kzg { blobToKzgCommitment(blob: string): string }
let kzgPromise: Promise<Kzg> | null = null;

function loadKzg(): Promise<Kzg> {
  if (!kzgPromise) {
    kzgPromise = Promise.all([import("micro-eth-signer/kzg.js"), import("@paulmillr/trusted-setups/fast-kzg.js")])
      .then(([{ KZG }, { trustedSetup }]) => new KZG(trustedSetup));
  }
  return kzgPromise;
}

/**
 * Commitments already computed, by keccak256 of the blob bytes: the batches
 * of some 25 Base blocks share one channel's blobs, so an audit of many
 * ceilings meets the same bytes again and again. A commitment is 0.3 s; a
 * keccak of the bytes is a millisecond.
 */
const commitments = new Map<string, string>();
const COMMITMENT_CACHE_MAX = 256;

function commitmentOf(kzg: Kzg, bytes: Uint8Array): string {
  const key = bytesToHex(keccak256(bytes));
  const known = commitments.get(key);
  if (known) return known;
  const c = kzg.blobToKzgCommitment(bytesToHex(bytes)).toLowerCase();
  if (commitments.size >= COMMITMENT_CACHE_MAX) commitments.delete(commitments.keys().next().value as string);
  commitments.set(key, c);
  return c;
}

// ── OP Stack blob encoding (version 0) ─────────────────────────────────────

/**
 * The data a blob carries: 4 field elements per round, each a 6-bit byte
 * and 31 data bytes, the first round's first element holding the version
 * and a 24-bit length. Padding past the length must be zero. A field
 * element with its top two bits set is not a blob this encoding produced.
 */
export function decodeOpBlob(blob: Uint8Array): Uint8Array {
  if (blob.length !== BLOB_BYTES) throw new TypeError(`blob: ${blob.length} bytes, expected ${BLOB_BYTES}`);
  if (blob[1] !== 0) throw new TypeError(`blob: encoding version ${blob[1]}, expected 0`);
  const outLen = (blob[2]! << 16) | (blob[3]! << 8) | blob[4]!;
  if (outLen > MAX_BLOB_DATA_BYTES) throw new TypeError(`blob: data length ${outLen} exceeds ${MAX_BLOB_DATA_BYTES}`);
  const out = new Uint8Array(MAX_BLOB_DATA_BYTES + 4 * 32);
  out.set(blob.subarray(5, 32), 0);
  let opos = 28;
  let ipos = 32;
  const enc = [blob[0]!, 0, 0, 0];
  if (enc[0]! & 0xc0) throw new TypeError("blob: field element 0 has its high bits set");
  const fe = (): number => {
    const b = blob[ipos]!;
    if (b & 0xc0) throw new TypeError(`blob: field element at ${ipos} has its high bits set`);
    out.set(blob.subarray(ipos + 1, ipos + 32), opos);
    opos += 32;
    ipos += 32;
    return b;
  };
  const reassemble = (): void => {
    opos--;
    const x = (enc[0]! & 0x3f) | ((enc[1]! & 0x30) << 2);
    const y = (enc[1]! & 0x0f) | ((enc[3]! & 0x0f) << 4);
    const z = (enc[2]! & 0x3f) | ((enc[3]! & 0x30) << 2);
    out[opos - 32] = z;
    out[opos - 64] = y;
    out[opos - 96] = x;
  };
  for (let i = 1; i < 4; i++) enc[i] = fe();
  reassemble();
  for (let round = 1; round < 1024 && opos < outLen; round++) {
    for (let j = 0; j < 4; j++) enc[j] = fe();
    reassemble();
  }
  for (let i = outLen; i < opos; i++) if (out[i] !== 0) throw new TypeError("blob: non-zero bytes where padding was expected");
  for (; ipos < BLOB_BYTES; ipos++) if (blob[ipos] !== 0) throw new TypeError(`blob: non-zero field element at ${ipos} past the data`);
  return out.slice(0, outLen);
}

// ── Frames ─────────────────────────────────────────────────────────────────

export interface ChannelFrame {
  channelId: string;
  frameNumber: number;
  frameData: Uint8Array;
  isLast: boolean;
}

/** Frames out of a blob's data: derivation version 0, then channel_id(16) frame_number(2) length(4) data is_last(1), repeated. */
export function parseFrames(data: Uint8Array): ChannelFrame[] {
  if (data.length === 0) throw new TypeError("frames: empty data");
  if (data[0] !== 0) throw new TypeError(`frames: derivation version ${data[0]}, expected 0`);
  const frames: ChannelFrame[] = [];
  let p = 1;
  while (p < data.length) {
    if (p + 23 > data.length) throw new TypeError(`frames: truncated frame header at ${p}`);
    const channelId = bytesToHex(data.subarray(p, p + 16));
    const frameNumber = (data[p + 16]! << 8) | data[p + 17]!;
    const len = ((data[p + 18]! << 24) >>> 0) + (data[p + 19]! << 16) + (data[p + 20]! << 8) + data[p + 21]!;
    if (p + 22 + len + 1 > data.length) throw new TypeError(`frames: frame ${frameNumber} runs past the data`);
    const frameData = data.subarray(p + 22, p + 22 + len);
    const last = data[p + 22 + len]!;
    if (last > 1) throw new TypeError(`frames: frame ${frameNumber} has is_last ${last}`);
    frames.push({ channelId, frameNumber, frameData, isLast: last === 1 });
    p += 23 + len;
  }
  return frames;
}

// ── RLP at a position (strict about lengths, tolerant of a cut stream) ─────

interface RlpSpan { isList: boolean; start: number; end: number }

function readLen(buf: Uint8Array, pos: number, lenOfLen: number): number {
  if (buf[pos] === 0) throw new TypeError("rlp: length with a leading zero");
  let n = 0;
  for (let i = 0; i < lenOfLen; i++) n = n * 256 + buf[pos + i]!;
  if (n < 56) throw new TypeError("rlp: long form for a short length");
  return n;
}

/** The item at `pos`, or null when its header runs past `limit` (a cut stream). The item's own bytes may still run past `limit`. */
function rlpSpan(buf: Uint8Array, pos: number, limit: number): RlpSpan | null {
  if (pos >= limit) return null;
  const b = buf[pos]!;
  if (b < 0x80) return { isList: false, start: pos, end: pos + 1 };
  if (b <= 0xb7) {
    const len = b - 0x80;
    if (len === 1 && pos + 1 < limit && buf[pos + 1]! < 0x80) throw new TypeError("rlp: single byte should encode as itself");
    return { isList: false, start: pos + 1, end: pos + 1 + len };
  }
  if (b <= 0xbf) {
    const lenOfLen = b - 0xb7;
    if (pos + 1 + lenOfLen > limit) return null;
    const len = readLen(buf, pos + 1, lenOfLen);
    return { isList: false, start: pos + 1 + lenOfLen, end: pos + 1 + lenOfLen + len };
  }
  if (b <= 0xf7) return { isList: true, start: pos + 1, end: pos + 1 + (b - 0xc0) };
  const lenOfLen = b - 0xf7;
  if (pos + 1 + lenOfLen > limit) return null;
  const len = readLen(buf, pos + 1, lenOfLen);
  return { isList: true, start: pos + 1 + lenOfLen, end: pos + 1 + lenOfLen + len };
}

function uintOf(bytes: Uint8Array, what: string): bigint {
  if (bytes.length > 0 && bytes[0] === 0) throw new TypeError(`${what}: integer with a leading zero`);
  let n = 0n;
  for (const x of bytes) n = (n << 8n) | BigInt(x);
  return n;
}

/** A complete byte-string item at `pos` inside `limit`, or null when cut. Lists are refused. */
function bytesItem(buf: Uint8Array, pos: number, limit: number, what: string): { bytes: Uint8Array; end: number } | null {
  const s = rlpSpan(buf, pos, limit);
  if (!s) return null;
  if (s.isList) throw new TypeError(`${what}: expected bytes, found a list`);
  if (s.end > limit) return null;
  return { bytes: buf.subarray(s.start, s.end), end: s.end };
}

// ── Channel: decompression and batches ─────────────────────────────────────

export function decompressChannel(data: Uint8Array, complete: boolean): { compression: "brotli" | "zlib"; bytes: Uint8Array } {
  if (data.length === 0) throw new TypeError("channel: empty");
  if (data[0] === 0x01) {
    const body = data.subarray(1);
    const bytes = complete
      ? brotliDecompressSync(body, { maxOutputLength: MAX_CHANNEL_BYTES })
      : brotliDecompressSync(body, { maxOutputLength: MAX_CHANNEL_BYTES, finishFlush: zlibConstants.BROTLI_OPERATION_FLUSH });
    return { compression: "brotli", bytes: new Uint8Array(bytes.buffer, bytes.byteOffset, bytes.byteLength) };
  }
  if ((data[0]! & 0x0f) === 8) {
    const bytes = inflateSync(data, { maxOutputLength: MAX_CHANNEL_BYTES, finishFlush: zlibConstants.Z_SYNC_FLUSH });
    return { compression: "zlib", bytes: new Uint8Array(bytes.buffer, bytes.byteOffset, bytes.byteLength) };
  }
  throw new TypeError(`channel: unknown compression byte 0x${data[0]!.toString(16)}`);
}

export interface BatchTx { raw: Uint8Array; hash: string }
export interface DecodedBatch {
  /** 0 singular, 1 span. */
  type: number;
  /** Offset of the batch's RLP item in the decompressed channel. */
  offset: number;
  /** Base blocks in this batch. A cut singular batch has one block with the transactions read so far. */
  blocks: Array<{ number: number; timestamp: number; parentHash: string | null; txs: BatchTx[]; complete: boolean }>;
}

/**
 * Batches out of a decompressed channel. Each is an RLP byte string
 * `batch_version ++ content`. When `complete` is false the stream may be cut:
 * the last batch is then read as far as it goes and marked incomplete.
 */
export function decodeBatches(
  channel: Uint8Array,
  complete: boolean,
  rollup: { l2GenesisTime: number; blockTime: number },
  chainId: bigint,
): DecodedBatch[] {
  const out: DecodedBatch[] = [];
  const limit = channel.length;
  let p = 0;
  while (p < limit) {
    const s = rlpSpan(channel, p, limit);
    if (!s) {
      if (complete) throw new TypeError(`batches: truncated batch header at ${p}`);
      break;
    }
    if (s.isList) throw new TypeError(`batches: the batch at ${p} is a list, expected a byte string`);
    if (s.end - s.start < 1) throw new TypeError(`batches: the batch at ${p} is empty`);
    if (s.start >= limit) break;
    const type = channel[s.start]!;
    const cut = s.end > limit;
    if (cut && complete) throw new TypeError(`batches: the batch at ${p} runs past the channel`);
    const contentStart = s.start + 1;
    const contentEnd = Math.min(s.end, limit);
    if (type === 0) {
      const sb = parseSingularBatch(channel, contentStart, contentEnd, !cut, rollup);
      if (sb) out.push({ type, offset: p, blocks: [sb] });
    } else if (type === 1) {
      if (!cut) out.push({ type, offset: p, blocks: decodeSpanBatch(channel.subarray(contentStart, contentEnd), rollup, chainId) });
    } else if (!cut) {
      throw new TypeError(`batches: unknown batch type ${type} at ${p}`);
    }
    if (cut) break;
    p = s.end;
  }
  return out;
}

/**
 * rlp([parent_hash, epoch_number, epoch_hash, timestamp, transaction_list]).
 * `limit` is where readable bytes end; with `complete` the list must end
 * exactly there. Returns null when not even the header fields are readable.
 */
function parseSingularBatch(
  buf: Uint8Array, start: number, limit: number, complete: boolean, rollup: { l2GenesisTime: number; blockTime: number },
): DecodedBatch["blocks"][number] | null {
  const outer = rlpSpan(buf, start, limit);
  if (!outer) return null;
  if (!outer.isList) throw new TypeError("singular batch: expected a list");
  if (complete && outer.end !== limit) throw new TypeError("singular batch: trailing bytes");
  const inner = Math.min(outer.end, limit);
  let pos = outer.start;
  const parent = bytesItem(buf, pos, inner, "singular batch.parent_hash");
  if (!parent) return null;
  if (parent.bytes.length !== 32) throw new TypeError("singular batch: parent_hash is not 32 bytes");
  pos = parent.end;
  const epochNumber = bytesItem(buf, pos, inner, "singular batch.epoch_number");
  if (!epochNumber) return null;
  uintOf(epochNumber.bytes, "singular batch.epoch_number");
  pos = epochNumber.end;
  const epochHash = bytesItem(buf, pos, inner, "singular batch.epoch_hash");
  if (!epochHash) return null;
  if (epochHash.bytes.length !== 32) throw new TypeError("singular batch: epoch_hash is not 32 bytes");
  pos = epochHash.end;
  const ts = bytesItem(buf, pos, inner, "singular batch.timestamp");
  if (!ts) return null;
  const timestamp = uintOf(ts.bytes, "singular batch.timestamp");
  pos = ts.end;
  const list = rlpSpan(buf, pos, inner);
  if (!list) return null;
  if (!list.isList) throw new TypeError("singular batch: transaction_list is not a list");
  const listEnd = Math.min(list.end, inner);
  const txs: BatchTx[] = [];
  let q = list.start;
  let listComplete = list.end <= inner;
  while (q < listEnd) {
    const item = rlpSpan(buf, q, listEnd);
    if (!item) { listComplete = false; break; }
    if (item.isList) throw new TypeError("singular batch: a transaction is a list, expected bytes");
    if (item.end > listEnd) { listComplete = false; break; }
    const raw = buf.subarray(item.start, item.end);
    txs.push({ raw, hash: bytesToHex(keccak256(raw)) });
    q = item.end;
  }
  if (listComplete && q !== list.end) throw new TypeError("singular batch: transaction_list overran its length");
  if (complete && list.end !== outer.end) throw new TypeError("singular batch: bytes after transaction_list");
  const number = blockNumberOf(Number(timestamp), rollup);
  return { number, timestamp: Number(timestamp), parentHash: bytesToHex(parent.bytes), txs, complete: listComplete };
}

function blockNumberOf(timestamp: number, rollup: { l2GenesisTime: number; blockTime: number }): number {
  const n = (timestamp - rollup.l2GenesisTime) / rollup.blockTime;
  if (!Number.isInteger(n) || n < 0) throw new TypeError(`batch timestamp ${timestamp} is not on the rollup's block grid`);
  return n;
}

// ── Span batches (type 1), rebuilt into raw transactions ───────────────────

class Reader {
  p = 0;
  private readonly b: Uint8Array;
  constructor(b: Uint8Array) { this.b = b; }
  bytes(n: number): Uint8Array {
    if (this.p + n > this.b.length) throw new TypeError("span batch: read past the end");
    const r = this.b.subarray(this.p, this.p + n);
    this.p += n;
    return r;
  }
  uvarint(): bigint {
    let x = 0n;
    let s = 0n;
    for (let i = 0; i < 10; i++) {
      if (this.p >= this.b.length) throw new TypeError("span batch: read past the end");
      const c = this.b[this.p++]!;
      x |= BigInt(c & 0x7f) << s;
      if (c < 0x80) return x;
      s += 7n;
    }
    throw new TypeError("span batch: varint too long");
  }
  /** A big-endian, byte-aligned bit field of `n` bits; returns a reader of bit i. */
  bits(n: number): (i: number) => number {
    const buf = this.bytes(Math.ceil(n / 8));
    let v = 0n;
    for (const x of buf) v = (v << 8n) | BigInt(x);
    return (i) => Number((v >> BigInt(i)) & 1n);
  }
  get done(): boolean { return this.p === this.b.length; }
}

/**
 * A span batch (OP Stack Delta): prefix (rel_timestamp, l1_origin_num,
 * parent_check, l1_origin_check) then payload (block_count, origin_bits,
 * block_tx_counts, txs). Transactions are stored by column (signatures,
 * recipients, data, nonces, gas limits, protected bits) and are rebuilt
 * here into their raw form so they can be hashed.
 */
export function decodeSpanBatch(
  data: Uint8Array, rollup: { l2GenesisTime: number; blockTime: number }, chainId: bigint,
): DecodedBatch["blocks"] {
  const r = new Reader(data);
  const relTimestamp = r.uvarint();
  r.uvarint(); // l1_origin_num
  r.bytes(20); // parent_check
  r.bytes(20); // l1_origin_check
  const blockCount = Number(r.uvarint());
  if (blockCount === 0) throw new TypeError("span batch: no blocks");
  r.bits(blockCount); // origin_bits
  const txCounts: number[] = [];
  for (let i = 0; i < blockCount; i++) txCounts.push(Number(r.uvarint()));
  const total = txCounts.reduce((a, b) => a + b, 0);
  const contractCreation = r.bits(total);
  const yParity = r.bits(total);
  const sigs: Array<{ r: Uint8Array; s: Uint8Array }> = [];
  for (let i = 0; i < total; i++) sigs.push({ r: r.bytes(32), s: r.bytes(32) });
  const tos: Array<Uint8Array | null> = [];
  for (let i = 0; i < total; i++) tos.push(contractCreation(i) ? null : r.bytes(20));
  const datas: Array<{ type: number; fields: RlpItem[] }> = [];
  for (let i = 0; i < total; i++) {
    let type = 0;
    if (data[r.p]! < 0xc0) { type = data[r.p]!; r.p++; }
    const s = rlpSpan(data, r.p, data.length);
    if (!s || !s.isList || s.end > data.length) throw new TypeError("span batch: bad tx_data");
    datas.push({ type, fields: listItems(data, s) });
    r.p = s.end;
  }
  const nonces: bigint[] = [];
  for (let i = 0; i < total; i++) nonces.push(r.uvarint());
  const gases: bigint[] = [];
  for (let i = 0; i < total; i++) gases.push(r.uvarint());
  const legacyCount = datas.filter((d) => d.type === 0).length;
  const protectedBits = r.bits(legacyCount);
  if (!r.done) throw new TypeError(`span batch: ${data.length - r.p} trailing bytes`);
  const u = (n: bigint): Uint8Array => {
    if (n === 0n) return new Uint8Array(0);
    let h = n.toString(16);
    if (h.length % 2) h = "0" + h;
    return hexToBytes(h);
  };
  let legacyIndex = 0;
  const txs: BatchTx[] = datas.map((d, i) => {
    const to = tos[i] ?? new Uint8Array(0);
    const yp = BigInt(yParity(i));
    const sig = sigs[i]!;
    const f = d.fields;
    let raw: Uint8Array;
    if (d.type === 0) {
      const [value, gasPrice, input] = f as [Uint8Array, Uint8Array, Uint8Array];
      const prot = protectedBits(legacyIndex++);
      const v = prot ? chainId * 2n + 35n + yp : 27n + yp;
      raw = rlpEncode([u(nonces[i]!), gasPrice, u(gases[i]!), to, value, input, u(v), sig.r, sig.s]);
    } else {
      let body: RlpItem[];
      if (d.type === 1) { const [value, gasPrice, input, acl] = f as [Uint8Array, Uint8Array, Uint8Array, RlpItem[]]; body = [u(chainId), u(nonces[i]!), gasPrice, u(gases[i]!), to, value, input, acl]; }
      else if (d.type === 2) { const [value, tip, maxFee, input, acl] = f as [Uint8Array, Uint8Array, Uint8Array, Uint8Array, RlpItem[]]; body = [u(chainId), u(nonces[i]!), tip, maxFee, u(gases[i]!), to, value, input, acl]; }
      else if (d.type === 4) { const [value, tip, maxFee, input, acl, auth] = f as [Uint8Array, Uint8Array, Uint8Array, Uint8Array, RlpItem[], RlpItem[]]; body = [u(chainId), u(nonces[i]!), tip, maxFee, u(gases[i]!), to, value, input, acl, auth]; }
      else throw new TypeError(`span batch: unsupported transaction type ${d.type}`);
      const enc = rlpEncode([...body, u(yp), sig.r, sig.s]);
      raw = new Uint8Array(1 + enc.length);
      raw[0] = d.type;
      raw.set(enc, 1);
    }
    return { raw, hash: bytesToHex(keccak256(raw)) };
  });
  const firstTimestamp = rollup.l2GenesisTime + Number(relTimestamp);
  const firstBlock = blockNumberOf(firstTimestamp, rollup);
  const blocks: DecodedBatch["blocks"] = [];
  let k = 0;
  for (let b = 0; b < blockCount; b++) {
    blocks.push({ number: firstBlock + b, timestamp: firstTimestamp + b * rollup.blockTime, parentHash: null, txs: txs.slice(k, k + txCounts[b]!), complete: true });
    k += txCounts[b]!;
  }
  return blocks;
}

/** The items of a complete RLP list span, as byte strings or nested lists (strict). */
function listItems(buf: Uint8Array, s: RlpSpan): RlpItem[] {
  const items: RlpItem[] = [];
  let p = s.start;
  while (p < s.end) {
    const it = rlpSpan(buf, p, s.end);
    if (!it || it.end > s.end) throw new TypeError("rlp: list item runs past its list");
    items.push(it.isList ? listItems(buf, it) : buf.slice(it.start, it.end));
    p = it.end;
  }
  return items;
}

// ── The check ──────────────────────────────────────────────────────────────

function short(h: string): string {
  return `${h.slice(0, 10)}…${h.slice(-4)}`;
}

/**
 * Verify blob bytes against a settlement pointer and locate the ceiling
 * transaction inside them. `blobBytesByVersionedHash` holds the bytes the
 * caller has (keyed by 0x hex versioned hash, any case); blobs the pointer
 * lists without bytes are skipped, and the channel is decoded from the
 * frames that are present, as a whole when they are all there and as a
 * prefix otherwise. Every check runs in order; the first failure is `reason`.
 */
export async function verifySettlementBlobs(
  pointer: SettlementPointer,
  blobBytesByVersionedHash: ReadonlyMap<string, Uint8Array>,
  options: SettlementBlobsOptions = {},
): Promise<SettlementBlobsResult> {
  const checks: SettlementBlobsCheck[] = [];
  const fail = (name: string, detail: string): SettlementBlobsResult => {
    checks.push({ name, ok: false, detail });
    return { ok: false, reason: `${name}: ${detail}`, checks };
  };
  const pass = (name: string, detail: string): void => { checks.push({ name, ok: true, detail }); };
  const rollup = options.rollup ?? BASE_MAINNET_ROLLUP;
  const chainId = options.chainId ?? 8453n;

  if (!Array.isArray(pointer?.blobs) || pointer.blobs.length === 0) return fail("blobs", "the pointer names no blobs");
  const supplied = new Map<string, Uint8Array>();
  for (const [k, v] of blobBytesByVersionedHash) supplied.set(k.toLowerCase(), v);
  const present = pointer.blobs.filter((b) => supplied.has(b.versionedHash.toLowerCase()));
  if (present.length === 0) return fail("blobs", "no bytes were supplied for any blob the pointer names");

  // 1. Each supplied blob commits to the listed commitment.
  let kzg: Kzg;
  try {
    kzg = await loadKzg();
  } catch (e) {
    return fail("kzg", `the KZG trusted setup could not be loaded (${(e as Error).message})`);
  }
  const frames: ChannelFrame[] = [];
  const decodedBlobs: string[] = [];
  for (const ref of [...present].sort((a, b) => a.index - b.index)) {
    const vh = ref.versionedHash.toLowerCase();
    const bytes = supplied.get(vh)!;
    const name = `blob ${ref.index}`;
    if (bytes.length !== BLOB_BYTES) return fail(name, `${bytes.length} bytes, a blob is ${BLOB_BYTES}`);
    let commitment: string;
    try {
      commitment = commitmentOf(kzg, bytes);
    } catch (e) {
      return fail(name, `not a valid blob (${(e as Error).message})`);
    }
    if (commitment !== ref.kzgCommitment.toLowerCase()) return fail(name, "the bytes do not commit to the listed KZG commitment");
    if (versionedHashOf(hexToBytes(commitment)) !== vh) return fail(name, "the commitment does not hash to the versioned hash");
    let fs: ChannelFrame[];
    try {
      fs = parseFrames(decodeOpBlob(bytes));
    } catch (e) {
      return fail(name, `commitment matches, but the blob does not decode (${(e as Error).message})`);
    }
    frames.push(...fs);
    decodedBlobs.push(vh);
    pass(name, `${short(vh)}: KZG commitment matches; ${fs.length} frame${fs.length === 1 ? "" : "s"} (${fs.map((f) => `${short(f.channelId)}#${f.frameNumber}${f.isLast ? " last" : ""}`).join(", ")})`);
  }

  // 2. The channel's frames, 0 upward, whole or as a prefix.
  const ids = [...new Set(frames.map((f) => f.channelId))];
  const wanted = pointer.channel?.id?.toLowerCase();
  let id: string;
  if (wanted) {
    if (!ids.includes(wanted)) return fail("channel", `no supplied blob carries a frame of channel ${short(wanted)}`);
    id = wanted;
  } else if (ids.length === 1) {
    id = ids[0]!;
  } else {
    const withZero = ids.filter((c) => frames.some((f) => f.channelId === c && f.frameNumber === 0));
    if (withZero.length !== 1) return fail("channel", `the blobs carry frames of ${ids.length} channels and the pointer names none`);
    id = withZero[0]!;
  }
  const byNumber = new Map<number, ChannelFrame>();
  for (const f of frames.filter((x) => x.channelId === id)) {
    if (byNumber.has(f.frameNumber)) return fail("channel", `frame ${f.frameNumber} appears twice`);
    byNumber.set(f.frameNumber, f);
  }
  if (!byNumber.has(0)) return fail("channel", `frame 0 of channel ${short(id)} is not among the supplied blobs, so the stream cannot be decoded (frames present: ${[...byNumber.keys()].sort((a, b) => a - b).join(", ")})`);
  const ordered: ChannelFrame[] = [];
  for (let i = 0; byNumber.has(i); i++) ordered.push(byNumber.get(i)!);
  const lastPresent = ordered[ordered.length - 1]!;
  const complete = lastPresent.isLast && byNumber.size === ordered.length;
  if (complete && ordered.filter((f) => f.isLast).length !== 1) return fail("channel", "is_last is set on more than one frame");
  if (!complete && ordered.some((f) => f.isLast)) return fail("channel", "a frame before the last one has is_last set");
  const framesTotal = complete ? ordered.length : (typeof pointer.channel?.frames === "number" ? pointer.channel.frames : null);
  pass("channel", complete
    ? `${short(id)}: all ${ordered.length} frames present, one is_last`
    : `${short(id)}: frames 0..${ordered.length - 1}${framesTotal ? ` of ${framesTotal}` : ""} present (a prefix)`);

  // 3. Decompress and read the batches.
  const joined = new Uint8Array(ordered.reduce((n, f) => n + f.frameData.length, 0));
  let o = 0;
  for (const f of ordered) { joined.set(f.frameData, o); o += f.frameData.length; }
  let decomp: { compression: "brotli" | "zlib"; bytes: Uint8Array };
  try {
    decomp = decompressChannel(joined, complete);
  } catch (e) {
    return fail("decompress", (e as Error).message);
  }
  if (pointer.channel?.compression && pointer.channel.compression !== decomp.compression) return fail("decompress", `the channel is ${decomp.compression}, the pointer says ${pointer.channel.compression}`);
  let batches: DecodedBatch[];
  try {
    batches = decodeBatches(decomp.bytes, complete, rollup, chainId);
  } catch (e) {
    return fail("batches", (e as Error).message);
  }
  const blocks = batches.flatMap((b) => b.blocks);
  if (blocks.length === 0) return fail("batches", "no batch is complete in the decoded bytes");
  const completeBlocks = blocks.filter((b) => b.complete).map((b) => b.number);
  pass("decompress", `${decomp.compression}, ${decomp.bytes.length.toLocaleString("en-US")} bytes${complete ? "" : " (prefix)"}`);
  pass("batches", `${batches.length} batch${batches.length === 1 ? "" : "es"}, Base blocks #${blocks[0]!.number}..#${blocks[blocks.length - 1]!.number}${blocks[blocks.length - 1]!.complete ? "" : " (the last one cut)"}`);

  // 4. The Base block.
  const target = blocks.find((b) => b.number === pointer.baseBlockNumber);
  if (!target) return fail("block", `Base block ${pointer.baseBlockNumber} is not among the decoded batches`);
  const expectParent = options.expect?.baseParentHash?.toLowerCase();
  if (expectParent && target.parentHash && target.parentHash !== expectParent) return fail("block", `the batch's parent_hash is ${short(target.parentHash)}, the ceiling's header says ${short(expectParent)}`);
  const next = blocks.find((b) => b.number === pointer.baseBlockNumber + 1);
  const hashBound = next?.parentHash ? next.parentHash === pointer.baseBlockHash.toLowerCase() : null;
  if (hashBound === false) return fail("block", `the next batch's parent_hash is ${short(next!.parentHash!)}, not this block's hash ${short(pointer.baseBlockHash)}`);
  pass("block", `Base block ${target.number} at ${target.timestamp}${target.parentHash ? `, parent ${short(target.parentHash)}${expectParent ? " as the ceiling's header says" : ""}` : ""}${hashBound ? "; the next batch's parent_hash is this block's hash" : ""}${target.complete ? `, ${target.txs.length} transactions` : `, ${target.txs.length} transactions read before the cut`}`);
  const channel = {
    id, framesDecoded: ordered.length, framesTotal, complete, compression: decomp.compression, decodedBytes: decomp.bytes.length, baseBlocks: completeBlocks,
  };

  // 5. The ceiling transaction, its hash recomputed from the batch's bytes.
  const txHash = (options.expect?.txHash ?? pointer.located?.txHash)?.toLowerCase();
  if (!txHash) return { ok: true, checks, channel };
  const index = target.txs.findIndex((t) => t.hash === txHash);
  if (index < 0) {
    return fail("transaction", target.complete
      ? `${short(txHash)} is not among the ${target.txs.length} transactions of the batch`
      : `${short(txHash)} is not among the ${target.txs.length} transactions readable before the cut; more frames are needed`);
  }
  const tx = target.txs[index]!;
  if (pointer.located && pointer.located.baseTxIndex !== index) return fail("transaction", `located at index ${index}, the pointer says ${pointer.located.baseTxIndex}`);
  const expectRaw = options.expect?.rawTx?.toLowerCase();
  if (expectRaw && bytesToHex(tx.raw) !== expectRaw) return fail("transaction", "the bytes in the batch are not the ceiling's rawTx");
  pass("transaction", `${short(txHash)} at index ${index} of Base block ${target.number}, hash recomputed from the batch bytes${expectRaw ? ", bytes equal the ceiling's rawTx" : ""}`);
  return {
    ok: true,
    checks,
    channel,
    located: {
      baseBlockNumber: target.number,
      baseBlockTimestamp: target.timestamp,
      baseParentHash: target.parentHash,
      baseTxIndex: index,
      txHash,
      rawTx: bytesToHex(tx.raw),
      batchComplete: target.complete,
    },
  };
}
