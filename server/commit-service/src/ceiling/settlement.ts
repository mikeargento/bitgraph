// Copyright (c) Argento Computing Inc. All rights reserved. See LICENSE.

/**
 * Settlement of a Base ceiling on Ethereum: where the L1 batch data that
 * carries a Base block is. Read-only lookups only (an Ethereum JSON-RPC and
 * a beacon API), and a bitgraph-settlement/1 pointer built from bytes that
 * are checked against hashes the chain supplied, the way block.ts builds a
 * ceiling's evidence:
 *
 *   1. The first Ethereum block at or after the Base block's time (a binary
 *      search on timestamps), then a scan forward, and back when a channel
 *      turns out to have opened earlier, for the batcher's blob transactions
 *      to the batch inbox.
 *   2. Their blobs from the beacon API. Each blob's KZG commitment must hash
 *      to the versioned hash the SIGNED transaction lists; `verifyBlob` can
 *      check the bytes against that commitment when a KZG implementation is
 *      supplied, and the audit always does.
 *   3. Blobs decode to frames; a channel whose frames are all present is
 *      decompressed and its batches read until one holds the Base block. Its
 *      timestamp, its parent hash, and the next batch's parent hash (this
 *      block's own hash) must agree with what the writer saw on Base, and the
 *      ceiling transaction must be in it, hash recomputed from the bytes.
 *   4. The pointer names ONE transaction: the one carrying frame 0 when its
 *      frames reach the ceiling transaction's bytes (a reader can then decode
 *      them from that transaction's blobs alone), else the one carrying the
 *      frame that completes them. The header is re-encoded from the RPC's
 *      block and must hash to the block hash; every transaction of the block
 *      is re-encoded and must hash to its listed hash; the rebuilt trie's
 *      root must be the header's transactionsRoot.
 *
 * `located.baseTxIndex` is the index in the batch's transaction_list, which
 * holds the block's non-deposit transactions in order (deposits are derived
 * from L1, not batched), so it is the Base block index minus the deposits
 * before it.
 */

import { brotliDecompressSync, inflateSync, constants as zlibConstants } from "node:zlib";
import {
  SETTLEMENT_VERSION, versionedHashOf, keccak256, rlpEncode, txTrieProof,
  evmBytesToHex as bytesToHex, evmHexToBytes as hexToBytes,
  type SettlementPointer, type SettlementPins, type RlpItem,
} from "@mikeargento/bitgraph-verify";
import { checkedHeaderRlp, type RpcBlock } from "./block.js";

export const DEFAULT_L1_RPC = "https://ethereum-rpc.publicnode.com";
export const DEFAULT_BEACON_API = "https://ethereum-beacon-api.publicnode.com";

export interface SettlementEndpoints { l1Rpc: string; beaconApi: string }

/** CEILING_L1_RPC_URL and CEILING_BEACON_URL, with publicnode as the defaults. */
export function settlementEndpointsFromEnv(env: Record<string, string | undefined> = process.env): SettlementEndpoints {
  return { l1Rpc: env["CEILING_L1_RPC_URL"] ?? DEFAULT_L1_RPC, beaconApi: env["CEILING_BEACON_URL"] ?? DEFAULT_BEACON_API };
}

/** Base mainnet: block number = (timestamp - l2GenesisTime) / blockTime. */
export const BASE_MAINNET_ROLLUP = Object.freeze({ l2GenesisTime: 1686789347, blockTime: 2 });
/** Ethereum mainnet's beacon chain: slot = (timestamp - genesis) / 12. */
export const ETHEREUM_MAINNET_BEACON = Object.freeze({ genesisTime: 1606824023, secondsPerSlot: 12 });

export const BLOB_BYTES = 131072;
export const MAX_BLOB_DATA_BYTES = 130044;
const MAX_CHANNEL_BYTES = 100_000_000;

export type FetchLike = (
  url: string,
  init?: { method?: string; headers?: Record<string, string>; body?: string; signal?: AbortSignal },
) => Promise<{ ok: boolean; status: number; json(): Promise<unknown>; text(): Promise<string> }>;

export interface FindSettlementOptions {
  l1Rpc: string;
  beaconApi: string;
  /** The batch inbox and batcher a transaction must have; never read from anything the network returns. */
  pins: SettlementPins;
  /** Base mainnet by default. */
  rollup?: { l2GenesisTime: number; blockTime: number };
  /** The L2 chain id, for rebuilding transactions out of span batches (default 8453). */
  l2ChainId?: bigint;
  /** Ethereum mainnet by default. */
  beacon?: { genesisTime: number; secondsPerSlot: number };
  /** What the writer saw on Base; each is checked against the batch when given, and `txHash` is located. */
  base?: { blockTimestamp?: number; parentHash?: string; txHash?: string };
  /** L1 blocks to scan after the first block at the Base block's time (default 300) and before it (default 150). */
  scanForward?: number;
  scanBack?: number;
  /** Check a blob's bytes against its KZG commitment. Absent, the commitment is taken as the beacon serves it (it is still bound to the signed transaction by its versioned hash). */
  verifyBlob?: (blob: Uint8Array, kzgCommitment: Uint8Array) => boolean;
  fetch?: FetchLike;
  /** Scanned L1 blocks kept across calls (the batches of many Base blocks share a channel). */
  cache?: SettlementCache;
  log?: (event: Record<string, unknown>) => void;
}

export interface SettlementBlob { versionedHash: string; kzgCommitment: string; index: number; bytes: Uint8Array }

export interface SettlementFound {
  pointer: SettlementPointer;
  /** The bytes of every blob the pointer names, in the pointer's order. */
  blobs: SettlementBlob[];
}

// ── RPC shapes ─────────────────────────────────────────────────────────────

interface L1Tx {
  hash: string; type: string; from: string; to: string | null; transactionIndex: string;
  nonce: string; gas: string; value: string; input: string; chainId?: string;
  gasPrice?: string; maxFeePerGas?: string; maxPriorityFeePerGas?: string;
  accessList?: Array<{ address: string; storageKeys: string[] }>;
  blobVersionedHashes?: string[]; maxFeePerBlobGas?: string;
  authorizationList?: Array<{ chainId: string; address: string; nonce: string; yParity: string; r: string; s: string }>;
  v?: string; yParity?: string; r: string; s: string;
}
type L1Block = Omit<RpcBlock, "transactions"> & { transactions: L1Tx[] };
interface BeaconSidecar { index: string; blob: string; kzg_commitment: string; kzg_proof: string }

interface ScannedBlob { index: number; versionedHash: string; kzgCommitment: string; bytes: Uint8Array; frames: Frame[] }
interface ScannedTx { hash: string; txIndex: number; blobs: ScannedBlob[] }
interface ScannedBlock { number: number; block: L1Block; batcher: ScannedTx[] }

export interface SettlementCache { blocks: Map<number, ScannedBlock | null>; max: number }
export function createSettlementCache(max = 64): SettlementCache { return { blocks: new Map(), max }; }

// ── Transport ──────────────────────────────────────────────────────────────

function rpcClient(url: string, fetchImpl: FetchLike): (method: string, params: unknown[]) => Promise<unknown> {
  let id = 0;
  return async (method, params) => {
    const res = await fetchImpl(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: ++id, method, params }),
      signal: AbortSignal.timeout(30_000),
    });
    if (!res.ok) throw new Error(`${method}: HTTP ${res.status}`);
    const j = (await res.json()) as { result?: unknown; error?: { message?: string } };
    if (j.error) throw new Error(`${method}: ${j.error.message ?? "rpc error"}`);
    return j.result;
  };
}

async function beaconGet(base: string, path: string, fetchImpl: FetchLike): Promise<unknown> {
  const res = await fetchImpl(`${base.replace(/\/$/, "")}${path}`, { signal: AbortSignal.timeout(60_000) });
  if (!res.ok) throw new Error(`beacon ${path}: HTTP ${res.status}`);
  return res.json();
}

// ── L1 transactions, re-encoded from JSON and checked by hash ──────────────

function u(hex: string | undefined | null): Uint8Array {
  if (hex == null) return new Uint8Array(0);
  const h = hex.replace(/^0x/, "").replace(/^0+/, "");
  return h === "" ? new Uint8Array(0) : hexToBytes(h);
}
function d(hex: string | undefined | null): Uint8Array {
  return hex ? hexToBytes(hex) : new Uint8Array(0);
}
function accessList(list: L1Tx["accessList"]): RlpItem[] {
  return (list ?? []).map((e) => [d(e.address), e.storageKeys.map(d)]);
}

/** The exact bytes of a type 0-4 transaction from its RPC object; the caller checks the hash. */
export function rawTxFromJson(t: L1Tx): Uint8Array {
  const type = Number(t.type);
  const sig: RlpItem[] = [u(t.yParity ?? t.v), u(t.r), u(t.s)];
  const typed = (fields: RlpItem[]): Uint8Array => {
    const enc = rlpEncode(fields);
    const out = new Uint8Array(1 + enc.length);
    out[0] = type;
    out.set(enc, 1);
    return out;
  };
  switch (type) {
    case 0: return rlpEncode([u(t.nonce), u(t.gasPrice), u(t.gas), d(t.to), u(t.value), d(t.input), u(t.v), u(t.r), u(t.s)]);
    case 1: return typed([u(t.chainId), u(t.nonce), u(t.gasPrice), u(t.gas), d(t.to), u(t.value), d(t.input), accessList(t.accessList), ...sig]);
    case 2: return typed([u(t.chainId), u(t.nonce), u(t.maxPriorityFeePerGas), u(t.maxFeePerGas), u(t.gas), d(t.to), u(t.value), d(t.input), accessList(t.accessList), ...sig]);
    case 3: return typed([u(t.chainId), u(t.nonce), u(t.maxPriorityFeePerGas), u(t.maxFeePerGas), u(t.gas), d(t.to), u(t.value), d(t.input), accessList(t.accessList), u(t.maxFeePerBlobGas), (t.blobVersionedHashes ?? []).map(d), ...sig]);
    case 4: return typed([u(t.chainId), u(t.nonce), u(t.maxPriorityFeePerGas), u(t.maxFeePerGas), u(t.gas), d(t.to), u(t.value), d(t.input), accessList(t.accessList),
      (t.authorizationList ?? []).map((a) => [u(a.chainId), d(a.address), u(a.nonce), u(a.yParity), u(a.r), u(a.s)]), ...sig]);
    default: throw new Error(`transaction type ${t.type} is not re-encoded here`);
  }
}

// ── OP Stack blobs, frames, channels, batches ──────────────────────────────

/** Blob encoding version 0: 4 field elements per round, a 6-bit byte and 31 data bytes each; the first holds the version and a 24-bit length. */
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
    out[opos - 32] = (enc[2]! & 0x3f) | ((enc[3]! & 0x30) << 2);
    out[opos - 64] = (enc[1]! & 0x0f) | ((enc[3]! & 0x0f) << 4);
    out[opos - 96] = (enc[0]! & 0x3f) | ((enc[1]! & 0x30) << 2);
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

export interface Frame { channelId: string; frameNumber: number; frameData: Uint8Array; isLast: boolean }

/** Derivation version 0, then channel_id(16) frame_number(2) length(4) data is_last(1), repeated. */
export function parseFrames(data: Uint8Array): Frame[] {
  if (data.length === 0) throw new TypeError("frames: empty data");
  if (data[0] !== 0) throw new TypeError(`frames: derivation version ${data[0]}, expected 0`);
  const frames: Frame[] = [];
  let p = 1;
  while (p < data.length) {
    if (p + 23 > data.length) throw new TypeError(`frames: truncated frame header at ${p}`);
    const channelId = bytesToHex(data.subarray(p, p + 16));
    const frameNumber = (data[p + 16]! << 8) | data[p + 17]!;
    const len = ((data[p + 18]! << 24) >>> 0) + (data[p + 19]! << 16) + (data[p + 20]! << 8) + data[p + 21]!;
    if (p + 22 + len + 1 > data.length) throw new TypeError(`frames: frame ${frameNumber} runs past the data`);
    const last = data[p + 22 + len]!;
    if (last > 1) throw new TypeError(`frames: frame ${frameNumber} has is_last ${last}`);
    frames.push({ channelId, frameNumber, frameData: data.subarray(p + 22, p + 22 + len), isLast: last === 1 });
    p += 23 + len;
  }
  return frames;
}

interface RlpSpan { isList: boolean; start: number; end: number }

function readLen(buf: Uint8Array, pos: number, lenOfLen: number): number {
  if (buf[pos] === 0) throw new TypeError("rlp: length with a leading zero");
  let n = 0;
  for (let i = 0; i < lenOfLen; i++) n = n * 256 + buf[pos + i]!;
  if (n < 56) throw new TypeError("rlp: long form for a short length");
  return n;
}

/** The item at `pos`; null when its header runs past `limit`. Its bytes may still run past `limit` (a cut stream). */
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

function bytesItem(buf: Uint8Array, pos: number, limit: number, what: string): { bytes: Uint8Array; end: number } | null {
  const s = rlpSpan(buf, pos, limit);
  if (!s) return null;
  if (s.isList) throw new TypeError(`${what}: expected bytes, found a list`);
  if (s.end > limit) return null;
  return { bytes: buf.subarray(s.start, s.end), end: s.end };
}

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

export interface BatchTx { raw: Uint8Array; hash: string; /** End offset of the transaction's bytes in the decompressed channel. */ end: number }
export interface BatchBlock { number: number; timestamp: number; parentHash: string | null; txs: BatchTx[]; /** End offset of the batch in the decompressed channel. */ end: number }

/** Every batch of a complete channel, as Base blocks. Each batch is an RLP byte string `batch_version ++ content`. */
export function decodeBatches(channel: Uint8Array, rollup: { l2GenesisTime: number; blockTime: number }, chainId: bigint): BatchBlock[] {
  const blocks: BatchBlock[] = [];
  const limit = channel.length;
  let p = 0;
  while (p < limit) {
    const s = rlpSpan(channel, p, limit);
    if (!s) throw new TypeError(`batches: truncated batch header at ${p}`);
    if (s.isList) throw new TypeError(`batches: the batch at ${p} is a list, expected a byte string`);
    if (s.end > limit) throw new TypeError(`batches: the batch at ${p} runs past the channel`);
    if (s.end - s.start < 1) throw new TypeError(`batches: the batch at ${p} is empty`);
    const type = channel[s.start]!;
    if (type === 0) blocks.push(parseSingularBatch(channel, s.start + 1, s.end, rollup));
    else if (type === 1) blocks.push(...decodeSpanBatch(channel.subarray(s.start + 1, s.end), rollup, chainId).map((b) => ({ ...b, end: s.end, txs: b.txs.map((t) => ({ ...t, end: s.end })) })));
    else throw new TypeError(`batches: unknown batch type ${type} at ${p}`);
    p = s.end;
  }
  return blocks;
}

/** rlp([parent_hash, epoch_number, epoch_hash, timestamp, transaction_list]), filling [start, end) exactly. */
function parseSingularBatch(buf: Uint8Array, start: number, end: number, rollup: { l2GenesisTime: number; blockTime: number }): BatchBlock {
  const outer = rlpSpan(buf, start, end);
  if (!outer || !outer.isList || outer.end !== end) throw new TypeError("singular batch: not one list filling the batch");
  let pos = outer.start;
  const parent = bytesItem(buf, pos, end, "singular batch.parent_hash");
  if (!parent || parent.bytes.length !== 32) throw new TypeError("singular batch: parent_hash is not 32 bytes");
  pos = parent.end;
  const epochNumber = bytesItem(buf, pos, end, "singular batch.epoch_number");
  if (!epochNumber) throw new TypeError("singular batch: truncated");
  uintOf(epochNumber.bytes, "singular batch.epoch_number");
  pos = epochNumber.end;
  const epochHash = bytesItem(buf, pos, end, "singular batch.epoch_hash");
  if (!epochHash || epochHash.bytes.length !== 32) throw new TypeError("singular batch: epoch_hash is not 32 bytes");
  pos = epochHash.end;
  const ts = bytesItem(buf, pos, end, "singular batch.timestamp");
  if (!ts) throw new TypeError("singular batch: truncated");
  const timestamp = Number(uintOf(ts.bytes, "singular batch.timestamp"));
  pos = ts.end;
  const list = rlpSpan(buf, pos, end);
  if (!list || !list.isList || list.end !== outer.end) throw new TypeError("singular batch: transaction_list is not the last item");
  const txs: BatchTx[] = [];
  let q = list.start;
  while (q < list.end) {
    const item = rlpSpan(buf, q, list.end);
    if (!item || item.isList || item.end > list.end) throw new TypeError("singular batch: a transaction is not a byte string inside the list");
    const raw = buf.subarray(item.start, item.end);
    txs.push({ raw, hash: bytesToHex(keccak256(raw)), end: item.end });
    q = item.end;
  }
  return { number: blockNumberOf(timestamp, rollup), timestamp, parentHash: bytesToHex(parent.bytes), txs, end };
}

function blockNumberOf(timestamp: number, rollup: { l2GenesisTime: number; blockTime: number }): number {
  const n = (timestamp - rollup.l2GenesisTime) / rollup.blockTime;
  if (!Number.isInteger(n) || n < 0) throw new TypeError(`batch timestamp ${timestamp} is not on the rollup's block grid`);
  return n;
}

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
  bits(n: number): (i: number) => number {
    const buf = this.bytes(Math.ceil(n / 8));
    let v = 0n;
    for (const x of buf) v = (v << 8n) | BigInt(x);
    return (i) => Number((v >> BigInt(i)) & 1n);
  }
  get done(): boolean { return this.p === this.b.length; }
}

/** A span batch (type 1), its column-stored transactions rebuilt into raw form so they can be hashed. */
export function decodeSpanBatch(data: Uint8Array, rollup: { l2GenesisTime: number; blockTime: number }, chainId: bigint): Array<Omit<BatchBlock, "end">> {
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
  const protectedBits = r.bits(datas.filter((x) => x.type === 0).length);
  if (!r.done) throw new TypeError(`span batch: ${data.length - r.p} trailing bytes`);
  const ub = (n: bigint): Uint8Array => {
    if (n === 0n) return new Uint8Array(0);
    let h = n.toString(16);
    if (h.length % 2) h = "0" + h;
    return hexToBytes(h);
  };
  let legacyIndex = 0;
  const txs = datas.map((x, i) => {
    const to = tos[i] ?? new Uint8Array(0);
    const yp = BigInt(yParity(i));
    const sig = sigs[i]!;
    const f = x.fields;
    let raw: Uint8Array;
    if (x.type === 0) {
      const [value, gasPrice, input] = f as [Uint8Array, Uint8Array, Uint8Array];
      const v = protectedBits(legacyIndex++) ? chainId * 2n + 35n + yp : 27n + yp;
      raw = rlpEncode([ub(nonces[i]!), gasPrice, ub(gases[i]!), to, value, input, ub(v), sig.r, sig.s]);
    } else {
      let body: RlpItem[];
      if (x.type === 1) { const [value, gasPrice, input, acl] = f as [Uint8Array, Uint8Array, Uint8Array, RlpItem[]]; body = [ub(chainId), ub(nonces[i]!), gasPrice, ub(gases[i]!), to, value, input, acl]; }
      else if (x.type === 2) { const [value, tip, maxFee, input, acl] = f as [Uint8Array, Uint8Array, Uint8Array, Uint8Array, RlpItem[]]; body = [ub(chainId), ub(nonces[i]!), tip, maxFee, ub(gases[i]!), to, value, input, acl]; }
      else if (x.type === 4) { const [value, tip, maxFee, input, acl, auth] = f as [Uint8Array, Uint8Array, Uint8Array, Uint8Array, RlpItem[], RlpItem[]]; body = [ub(chainId), ub(nonces[i]!), tip, maxFee, ub(gases[i]!), to, value, input, acl, auth]; }
      else throw new TypeError(`span batch: unsupported transaction type ${x.type}`);
      const enc = rlpEncode([...body, ub(yp), sig.r, sig.s]);
      raw = new Uint8Array(1 + enc.length);
      raw[0] = x.type;
      raw.set(enc, 1);
    }
    return { raw, hash: bytesToHex(keccak256(raw)), end: 0 };
  });
  const firstTimestamp = rollup.l2GenesisTime + Number(relTimestamp);
  const firstBlock = blockNumberOf(firstTimestamp, rollup);
  const blocks: Array<Omit<BatchBlock, "end">> = [];
  let k = 0;
  for (let b = 0; b < blockCount; b++) {
    blocks.push({ number: firstBlock + b, timestamp: firstTimestamp + b * rollup.blockTime, parentHash: null, txs: txs.slice(k, k + txCounts[b]!) });
    k += txCounts[b]!;
  }
  return blocks;
}

// ── The search ─────────────────────────────────────────────────────────────

interface PlacedFrame extends Frame { l1Block: number; txHash: string; versionedHash: string; blobIndex: number }

function short(h: string): string {
  return `${h.slice(0, 10)}…`;
}

/**
 * Find the L1 data inclusion of a Base block and build its pointer. Returns
 * null when no complete channel holding the block was found in the scanned
 * range (try again later); throws on transport errors and on data that
 * contradicts what the writer saw on Base.
 */
export async function findSettlement(baseBlockNumber: number, baseBlockHash: string, opts: FindSettlementOptions): Promise<SettlementFound | null> {
  const fetchImpl: FetchLike = opts.fetch ?? ((url, init) => fetch(url, init));
  const rpc = rpcClient(opts.l1Rpc, fetchImpl);
  const rollup = opts.rollup ?? BASE_MAINNET_ROLLUP;
  const beacon = opts.beacon ?? ETHEREUM_MAINNET_BEACON;
  const chainId = opts.l2ChainId ?? 8453n;
  const inbox = opts.pins.batchInbox.toLowerCase();
  const batcher = opts.pins.batcher.toLowerCase();
  const cache = opts.cache ?? createSettlementCache();
  const log = opts.log ?? (() => {});
  const l2ts = opts.base?.blockTimestamp ?? rollup.l2GenesisTime + rollup.blockTime * baseBlockNumber;
  if (opts.base?.blockTimestamp !== undefined && opts.base.blockTimestamp !== rollup.l2GenesisTime + rollup.blockTime * baseBlockNumber) {
    throw new Error(`Base block ${baseBlockNumber}'s time ${opts.base.blockTimestamp} is not on the rollup's block grid`);
  }

  // 1. The first L1 block at or after the Base block's time.
  const head = (await rpc("eth_getBlockByNumber", ["latest", false])) as { number: string; timestamp: string } | null;
  if (!head) throw new Error("eth_getBlockByNumber latest: no block");
  const headNumber = parseInt(head.number, 16);
  let lo = Math.max(0, headNumber - Math.ceil((parseInt(head.timestamp, 16) - l2ts) / beacon.secondsPerSlot) - 50);
  let hi = headNumber;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    const b = (await rpc("eth_getBlockByNumber", ["0x" + mid.toString(16), false])) as { timestamp: string } | null;
    if (!b) throw new Error(`eth_getBlockByNumber ${mid}: no block`);
    if (parseInt(b.timestamp, 16) < l2ts) lo = mid + 1;
    else hi = mid;
  }
  const l1Start = lo;

  // 2. Scan: batcher transactions, their blobs, their frames.
  const frames = new Map<string, Map<number, PlacedFrame>>();
  const scanned = new Set<number>();
  const scanBlock = async (num: number): Promise<void> => {
    if (scanned.has(num) || num < 0 || num > headNumber) return;
    scanned.add(num);
    let entry = cache.blocks.get(num);
    if (entry === undefined) {
      const block = (await rpc("eth_getBlockByNumber", ["0x" + num.toString(16), true])) as L1Block | null;
      if (!block) return;
      const candidates = block.transactions.filter((t) => t.to?.toLowerCase() === inbox && t.from.toLowerCase() === batcher);
      const batcherTxs: ScannedTx[] = [];
      if (candidates.length > 0) {
        const ts = parseInt(block.timestamp, 16);
        const slot = (ts - beacon.genesisTime) / beacon.secondsPerSlot;
        if (!Number.isInteger(slot)) throw new Error(`L1 block ${num}'s time ${ts} is not on a slot boundary`);
        const res = (await beaconGet(opts.beaconApi, `/eth/v1/beacon/blob_sidecars/${slot}`, fetchImpl)) as { data?: BeaconSidecar[] };
        const byHash = new Map<string, BeaconSidecar>();
        for (const sc of res.data ?? []) byHash.set(versionedHashOf(hexToBytes(sc.kzg_commitment)), sc);
        for (const t of candidates) {
          if (t.type !== "0x3") { log({ type: "settlement-skip", l1Block: num, txHash: t.hash, reason: `type ${t.type} (calldata) batch` }); continue; }
          const blobs: ScannedBlob[] = [];
          for (const [i, vh] of (t.blobVersionedHashes ?? []).entries()) {
            const sc = byHash.get(vh.toLowerCase());
            if (!sc) throw new Error(`beacon slot ${slot} has no blob for ${vh} of transaction ${t.hash}`);
            const bytes = hexToBytes(sc.blob);
            const commitment = hexToBytes(sc.kzg_commitment);
            if (opts.verifyBlob && !opts.verifyBlob(bytes, commitment)) throw new Error(`blob ${vh}: bytes do not verify against the commitment`);
            let fs: Frame[] = [];
            try {
              fs = parseFrames(decodeOpBlob(bytes));
            } catch (e) {
              log({ type: "settlement-skip", l1Block: num, txHash: t.hash, blob: vh, reason: (e as Error).message });
            }
            blobs.push({ index: i, versionedHash: vh.toLowerCase(), kzgCommitment: sc.kzg_commitment.toLowerCase(), bytes, frames: fs });
          }
          batcherTxs.push({ hash: t.hash.toLowerCase(), txIndex: parseInt(t.transactionIndex, 16), blobs });
        }
        log({ type: "settlement-scan", l1Block: num, batcherTxs: batcherTxs.length, slot });
      }
      entry = batcherTxs.length > 0 ? { number: num, block, batcher: batcherTxs } : null;
      cache.blocks.set(num, entry);
      while (cache.blocks.size > cache.max) cache.blocks.delete(cache.blocks.keys().next().value as number);
    }
    if (!entry) return;
    for (const t of entry.batcher) {
      for (const blob of t.blobs) {
        for (const f of blob.frames) {
          let m = frames.get(f.channelId);
          if (!m) { m = new Map(); frames.set(f.channelId, m); }
          if (!m.has(f.frameNumber)) m.set(f.frameNumber, { ...f, l1Block: num, txHash: t.hash, versionedHash: blob.versionedHash, blobIndex: blob.index });
        }
      }
    }
  };

  interface Found { id: string; ordered: PlacedFrame[]; compression: "brotli" | "zlib"; blocks: BatchBlock[]; target: BatchBlock }
  const tried = new Set<string>();
  const tryChannels = (): Found | null => {
    for (const [id, m] of frames) {
      if (tried.has(id)) continue;
      const last = [...m.values()].find((f) => f.isLast);
      if (!last) continue;
      const ordered: PlacedFrame[] = [];
      for (let i = 0; i <= last.frameNumber; i++) {
        const f = m.get(i);
        if (!f) break;
        ordered.push(f);
      }
      if (ordered.length !== last.frameNumber + 1) continue;
      tried.add(id);
      const joined = new Uint8Array(ordered.reduce((n, f) => n + f.frameData.length, 0));
      let o = 0;
      for (const f of ordered) { joined.set(f.frameData, o); o += f.frameData.length; }
      let blocks: BatchBlock[];
      let dec: { compression: "brotli" | "zlib"; bytes: Uint8Array };
      try {
        dec = decompressChannel(joined, true);
        blocks = decodeBatches(dec.bytes, rollup, chainId);
      } catch (e) {
        log({ type: "settlement-skip", channel: id, reason: (e as Error).message });
        continue;
      }
      log({ type: "settlement-channel", channel: id, frames: ordered.length, compression: dec.compression, bytes: dec.bytes.length, firstBaseBlock: blocks[0]?.number, lastBaseBlock: blocks[blocks.length - 1]?.number });
      const target = blocks.find((b) => b.number === baseBlockNumber);
      if (target) return { id, ordered, compression: dec.compression, blocks, target };
    }
    return null;
  };
  const needsEarlier = (): boolean => {
    for (const m of frames.values()) if (!m.has(0)) return true;
    return false;
  };

  const forward = opts.scanForward ?? 300;
  const back = opts.scanBack ?? 150;
  let found: Found | null = null;
  let nextForward = l1Start;
  let nextBack = l1Start - 1;
  while (!found && (nextForward < l1Start + forward || (needsEarlier() && nextBack >= l1Start - back))) {
    const chunk: number[] = [];
    for (let i = 0; i < 6 && nextForward < l1Start + forward; i++) chunk.push(nextForward++);
    if (needsEarlier()) for (let i = 0; i < 6 && nextBack >= l1Start - back; i++) chunk.push(nextBack--);
    if (chunk.length === 0) break;
    await Promise.all(chunk.map(scanBlock));
    found = tryChannels();
  }
  if (!found) {
    log({ type: "settlement-not-found", baseBlockNumber, l1Start, scannedBlocks: scanned.size, channels: frames.size });
    return null;
  }

  // 3. The batch agrees with what the writer saw on Base.
  const { target, blocks } = found;
  if (target.timestamp !== l2ts) throw new Error(`the batch for Base block ${baseBlockNumber} says time ${target.timestamp}, the block's time is ${l2ts}`);
  const expectParent = opts.base?.parentHash?.toLowerCase();
  if (expectParent && target.parentHash && target.parentHash !== expectParent) {
    throw new Error(`the batch for Base block ${baseBlockNumber} has parent ${short(target.parentHash)}, the block's parent is ${short(expectParent)}`);
  }
  const next = blocks.find((b) => b.number === baseBlockNumber + 1);
  if (next?.parentHash && next.parentHash !== baseBlockHash.toLowerCase()) {
    throw new Error(`the batch after Base block ${baseBlockNumber} names parent ${short(next.parentHash)}, not the block's hash ${short(baseBlockHash)}`);
  }
  let located: { baseTxIndex: number; txHash: string; end: number } | undefined;
  const wantTx = opts.base?.txHash?.toLowerCase();
  if (wantTx) {
    const i = target.txs.findIndex((t) => t.hash === wantTx);
    if (i < 0) throw new Error(`the ceiling transaction ${short(wantTx)} is not among the ${target.txs.length} transactions batched for Base block ${baseBlockNumber}`);
    located = { baseTxIndex: i, txHash: wantTx, end: target.txs[i]!.end };
  }

  // 4. Which transaction the pointer names: frame 0's when its frames reach the bytes, else the frame that completes them.
  const reachEnd = located?.end ?? target.end;
  const { ordered } = found;
  const firstTxHash = ordered[0]!.txHash;
  let k = 0;
  while (k + 1 < ordered.length && ordered[k + 1]!.txHash === firstTxHash) k++;
  let pointerTx = firstTxHash;
  /** Whether frames 0..upTo, decompressed as a prefix, reach the ceiling transaction's last byte. */
  const reaches = (upTo: number): boolean => {
    const joined = new Uint8Array(ordered.slice(0, upTo + 1).reduce((n, f) => n + f.frameData.length, 0));
    let o = 0;
    for (const f of ordered.slice(0, upTo + 1)) { joined.set(f.frameData, o); o += f.frameData.length; }
    try {
      return decompressChannel(joined, false).bytes.length >= reachEnd;
    } catch {
      return false;
    }
  };
  if (k < ordered.length - 1) {
    if (!reaches(k)) {
      let j = k + 1;
      while (j < ordered.length - 1 && !reaches(j)) j++;
      pointerTx = ordered[j]!.txHash;
    }
  }
  const frameOfTx = ordered.find((f) => f.txHash === pointerTx)!;
  const entry = cache.blocks.get(frameOfTx.l1Block);
  if (!entry) throw new Error(`L1 block ${frameOfTx.l1Block} left the cache during the search`);
  const tx = entry.batcher.find((t) => t.hash === pointerTx)!;
  const channelVhs = new Set(ordered.map((f) => f.versionedHash));
  let pointerBlobs = tx.blobs.filter((b) => channelVhs.has(b.versionedHash)).sort((a, b) => a.index - b.index);
  // Keep only what a reader needs (Mike, 2026-09-30: the cheaper setting, as long as it still
  // works): when the pointer's transaction opens the channel, the blobs from its first up to the
  // one whose frames complete the ceiling transaction's bytes. A prefix of the compressed stream
  // decodes to a prefix of the channel, so the audit locates the transaction from these alone;
  // the blobs after it carry later Base blocks and nothing this record needs.
  if (pointerTx === firstTxHash) {
    let upTo = 0;
    while (upTo < ordered.length && ordered[upTo]!.txHash === pointerTx && !reaches(upTo)) upTo++;
    if (upTo < ordered.length && ordered[upTo]!.txHash === pointerTx) {
      const lastIndex = tx.blobs.find((b) => b.versionedHash === ordered[upTo]!.versionedHash)?.index;
      if (lastIndex !== undefined) pointerBlobs = pointerBlobs.filter((b) => b.index <= lastIndex);
    }
  }

  // 5. The L1 evidence: header, every transaction's bytes, the trie.
  const block = entry.block;
  const headerRlp = checkedHeaderRlp(block as unknown as RpcBlock);
  const raws: Uint8Array[] = [];
  for (const t of block.transactions) {
    const want = t.hash.toLowerCase();
    let raw: Uint8Array | null = null;
    try {
      raw = rawTxFromJson(t);
    } catch {
      raw = null;
    }
    if (!raw || bytesToHex(keccak256(raw)) !== want) raw = hexToBytes((await rpc("eth_getRawTransactionByHash", [t.hash])) as string);
    if (bytesToHex(keccak256(raw)) !== want) throw new Error(`L1 transaction ${t.hash} bytes do not hash to its listed hash`);
    raws.push(raw);
  }
  const { root, proof } = txTrieProof(raws, tx.txIndex);
  if (bytesToHex(root) !== block.transactionsRoot.toLowerCase()) throw new Error(`rebuilt L1 transaction trie root ${bytesToHex(root)} is not the header's ${block.transactionsRoot}`);
  const rawTx = raws[tx.txIndex]!;
  if (bytesToHex(keccak256(rawTx)) !== pointerTx) throw new Error("the batcher transaction's bytes do not hash to its hash");

  const pointer: SettlementPointer = {
    version: SETTLEMENT_VERSION,
    baseBlockNumber,
    baseBlockHash: baseBlockHash.toLowerCase(),
    l1: {
      chainId: opts.pins.l1ChainId,
      txHash: pointerTx,
      rawTx: bytesToHex(rawTx),
      blockNumber: parseInt(block.number, 16),
      blockHash: block.hash.toLowerCase(),
      blockTimestamp: parseInt(block.timestamp, 16),
      blockHeader: bytesToHex(headerRlp),
      txIndex: tx.txIndex,
      txInclusionProof: proof.map(bytesToHex),
    },
    blobs: pointerBlobs.map((b) => ({ versionedHash: b.versionedHash, kzgCommitment: b.kzgCommitment, index: b.index, file: `${b.versionedHash}.bin` })),
    channel: { id: found.id, frames: ordered.length, compression: found.compression, firstBaseBlock: blocks[0]!.number, lastBaseBlock: blocks[blocks.length - 1]!.number },
    ...(located ? { located: { baseTxIndex: located.baseTxIndex, txHash: located.txHash } } : {}),
  };
  log({ type: "settlement-found", baseBlockNumber, l1Block: pointer.l1.blockNumber, l1TxHash: pointerTx, blobs: pointerBlobs.length, blobsInChannel: tx.blobs.filter((b) => channelVhs.has(b.versionedHash)).length, channel: found.id, frames: ordered.length, located: located?.baseTxIndex ?? null });
  return { pointer, blobs: pointerBlobs.map((b) => ({ versionedHash: b.versionedHash, kzgCommitment: b.kzgCommitment, index: b.index, bytes: b.bytes })) };
}
