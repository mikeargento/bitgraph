// Copyright (c) 2024-2026 Argento Computing Inc. All rights reserved.

/**
 * The Base floor (enclave v10, 2026-10-06).
 *
 * Until v10 the floor was the chain's latest Ethereum anchor: a separate
 * stream of anchor commits every 12 s, the newest copied into each slot.
 * From v10 the parent hands the enclave the newest Base block header with each
 * allocation, and the enclave fixes that block as the slot's floor. Nothing is
 * written to the ledger for it.
 *
 * The enclave cannot tell a header Base produced from one someone made up:
 * that is the verifier's one lookup, as it always was for an Ethereum floor.
 * What the enclave does check, so the signed floor is at least internally
 * true:
 *   - the header is canonical RLP, and its keccak-256 is the block hash the
 *     proof will carry (number and time are read from the same bytes, never
 *     supplied beside them);
 *   - the block's time is exactly Base mainnet's schedule for its number
 *     (genesis + 2 s per block), which rejects other chains and made-up
 *     numbers;
 *   - block numbers never go down on a chain within an epoch;
 *   - the block's time is not ahead of this enclave's clock by more than
 *     BASE_FLOOR_CLOCK_TOLERANCE_S, so a floor never claims a time after the
 *     position it sits under (beyond that slack).
 * A stale header is accepted: an old floor is still a true floor, only a
 * looser one, and the proof shows its age.
 *
 * Self-contained on purpose (strict RLP, keccak from @noble/hashes): the
 * measured image should not depend on the verifier package's internals.
 */

import { keccak_256 } from "@noble/hashes/sha3";

export const BASE_CHAIN_NAME = "base" as const;
export const BASE_CHAIN_ID = 8453;
/**
 * Base mainnet stamps every block by height: block n is BASE_GENESIS_TIME + 2n
 * (OP Stack: each block is block_time after its parent; checked against the
 * live chain 2026-10-06). A header off that schedule is not a Base mainnet
 * block: another chain, a testnet, or made up. Together with the clock check
 * this also caps the block number, so one absurd header cannot lock a chain's
 * floor for the rest of the epoch. If Base ever changes its block time, this
 * fails closed and the enclave needs a new version.
 */
export const BASE_GENESIS_TIME = 1686789347;
export const BASE_BLOCK_TIME_S = 2;
/** One Base block: covers skew between Base's whole-second stamps and this clock. */
export const BASE_FLOOR_CLOCK_TOLERANCE_S = 2;
/** A real header is a few hundred bytes; refuse anything absurd before parsing. */
const MAX_HEADER_BYTES = 4096;

export interface BaseFloor {
  chain: typeof BASE_CHAIN_NAME;
  /** The EVM chain id (8453), not BitGraph's chain id. */
  evmChainId: typeof BASE_CHAIN_ID;
  blockNumber: number;
  /** 0x-prefixed lowercase hex, 32 bytes: keccak-256 of the header. */
  blockHash: string;
  /** Unix seconds, from the header. */
  blockTimestamp: number;
}

type RlpItem = Uint8Array | RlpItem[];

function readLength(bytes: Uint8Array, pos: number, lenOfLen: number): number {
  if (pos + lenOfLen > bytes.length) throw new Error("rlp: truncated length");
  if (bytes[pos] === 0) throw new Error("rlp: length with a leading zero");
  let n = 0;
  for (let i = 0; i < lenOfLen; i++) n = n * 256 + bytes[pos + i]!;
  if (n < 56) throw new Error("rlp: long form for a short length");
  return n;
}

function decodeAt(bytes: Uint8Array, pos: number): [RlpItem, number] {
  if (pos >= bytes.length) throw new Error("rlp: truncated");
  const b = bytes[pos]!;
  if (b < 0x80) return [bytes.slice(pos, pos + 1), pos + 1];
  if (b <= 0xb7) {
    const len = b - 0x80;
    const end = pos + 1 + len;
    if (end > bytes.length) throw new Error("rlp: truncated string");
    if (len === 1 && bytes[pos + 1]! < 0x80) throw new Error("rlp: single byte should encode as itself");
    return [bytes.slice(pos + 1, end), end];
  }
  if (b <= 0xbf) {
    const lenOfLen = b - 0xb7;
    const len = readLength(bytes, pos + 1, lenOfLen);
    const start = pos + 1 + lenOfLen;
    if (start + len > bytes.length) throw new Error("rlp: truncated string");
    return [bytes.slice(start, start + len), start + len];
  }
  let start: number;
  let len: number;
  if (b <= 0xf7) {
    len = b - 0xc0;
    start = pos + 1;
  } else {
    const lenOfLen = b - 0xf7;
    len = readLength(bytes, pos + 1, lenOfLen);
    start = pos + 1 + lenOfLen;
  }
  const end = start + len;
  if (end > bytes.length) throw new Error("rlp: truncated list");
  const items: RlpItem[] = [];
  let p = start;
  while (p < end) {
    const [it, next] = decodeAt(bytes, p);
    items.push(it);
    p = next;
  }
  if (p !== end) throw new Error("rlp: list overran its length");
  return [items, end];
}

function rlpUint(item: RlpItem | undefined, what: string): number {
  if (!(item instanceof Uint8Array)) throw new Error(`${what}: expected a byte string`);
  if (item.length > 0 && item[0] === 0) throw new Error(`${what}: integer with a leading zero`);
  if (item.length > 6) throw new Error(`${what}: out of range`);
  let n = 0;
  for (const x of item) n = n * 256 + x;
  return n;
}

function toHex(bytes: Uint8Array): string {
  let s = "0x";
  for (const b of bytes) s += b.toString(16).padStart(2, "0");
  return s;
}

/**
 * Check a Base header handed over with an allocation and return the floor it
 * fixes. Throws on anything short of a header that passes every check.
 */
export function checkBaseFloorHeader(
  headerB64: unknown,
  prev: BaseFloor | undefined,
  nowMs: number,
): BaseFloor {
  if (typeof headerB64 !== "string" || headerB64.length === 0) throw new Error("baseFloor.headerB64 is required");
  const raw = new Uint8Array(Buffer.from(headerB64, "base64"));
  if (raw.length === 0 || raw.length > MAX_HEADER_BYTES) throw new Error("baseFloor header: bad length");
  if (Buffer.from(raw).toString("base64") !== headerB64) throw new Error("baseFloor.headerB64 must be canonical base64");

  const [item, end] = decodeAt(raw, 0);
  if (end !== raw.length) throw new Error("rlp: trailing bytes");
  if (!Array.isArray(item) || item.length < 15) throw new Error("baseFloor header: not a block header");
  const parent = item[0];
  if (!(parent instanceof Uint8Array) || parent.length !== 32) throw new Error("baseFloor header: bad parent hash");
  const blockNumber = rlpUint(item[8], "baseFloor header number");
  const blockTimestamp = rlpUint(item[11], "baseFloor header timestamp");
  if (blockNumber <= 0) throw new Error("baseFloor header: block number must be positive");

  if (blockTimestamp !== BASE_GENESIS_TIME + BASE_BLOCK_TIME_S * blockNumber) {
    throw new Error(`base floor block ${blockNumber} is stamped ${blockTimestamp}, off Base mainnet's schedule (${BASE_GENESIS_TIME + BASE_BLOCK_TIME_S * blockNumber})`);
  }
  if (prev && blockNumber < prev.blockNumber) {
    throw new Error(`base floor block ${blockNumber} is older than this chain's last floor, block ${prev.blockNumber}`);
  }
  if (blockTimestamp > Math.floor(nowMs / 1000) + BASE_FLOOR_CLOCK_TOLERANCE_S) {
    throw new Error(`base floor block ${blockNumber} is stamped ${blockTimestamp}, ahead of the enclave clock (${Math.floor(nowMs / 1000)})`);
  }

  return {
    chain: BASE_CHAIN_NAME,
    evmChainId: BASE_CHAIN_ID,
    blockNumber,
    blockHash: toHex(keccak_256(raw)),
    blockTimestamp,
  };
}
