// Copyright (c) 2024-2026 Argento Computing Inc. Licensed under the MIT License. See LICENSE.

/**
 * The EVM pieces a ceiling check needs, written out so the check runs offline
 * with nothing but @noble: RLP, keccak256, a block header's fields, an
 * EIP-1559 transaction and its sender, and a Merkle-Patricia inclusion proof
 * against a header's transactionsRoot.
 *
 * Decoding is STRICT. A non-canonical RLP length, trailing bytes, or a proof
 * node that does not hash to the reference that points at it is a refusal,
 * never a best effort: every value this file returns is bound to a 32-byte
 * hash the caller already holds.
 */

import { keccak_256 } from "@noble/hashes/sha3";
import { secp256k1 } from "@noble/curves/secp256k1.js";

export type RlpItem = Uint8Array | RlpItem[];

export function hexToBytes(hex: string): Uint8Array {
  let h = hex.startsWith("0x") || hex.startsWith("0X") ? hex.slice(2) : hex;
  if (h.length % 2) h = "0" + h;
  if (!/^[0-9a-fA-F]*$/.test(h)) throw new TypeError("not hex");
  const out = new Uint8Array(h.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(h.slice(i * 2, i * 2 + 2), 16);
  return out;
}

export function bytesToHex(bytes: Uint8Array): string {
  let s = "0x";
  for (const b of bytes) s += b.toString(16).padStart(2, "0");
  return s;
}

export function keccak256(bytes: Uint8Array): Uint8Array {
  return keccak_256(bytes);
}

function concat(...parts: Uint8Array[]): Uint8Array {
  let n = 0;
  for (const p of parts) n += p.length;
  const out = new Uint8Array(n);
  let o = 0;
  for (const p of parts) { out.set(p, o); o += p.length; }
  return out;
}

export function bytesEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  let d = 0;
  for (let i = 0; i < a.length; i++) d |= a[i]! ^ b[i]!;
  return d === 0;
}

// ── RLP ────────────────────────────────────────────────────────────────────

function encodeLength(len: number, offset: number): Uint8Array {
  if (len < 56) return Uint8Array.of(offset + len);
  const lenBytes: number[] = [];
  for (let n = len; n > 0; n = Math.floor(n / 256)) lenBytes.unshift(n % 256);
  return Uint8Array.of(offset + 55 + lenBytes.length, ...lenBytes);
}

export function rlpEncode(item: RlpItem): Uint8Array {
  if (item instanceof Uint8Array) {
    if (item.length === 1 && item[0]! < 0x80) return item;
    return concat(encodeLength(item.length, 0x80), item);
  }
  const body = concat(...item.map(rlpEncode));
  return concat(encodeLength(body.length, 0xc0), body);
}

/** Decode exactly one RLP item filling all of `bytes`; throws on anything non-canonical. */
export function rlpDecode(bytes: Uint8Array): RlpItem {
  const [item, end] = decodeAt(bytes, 0);
  if (end !== bytes.length) throw new TypeError("rlp: trailing bytes");
  return item;
}

function readLength(bytes: Uint8Array, pos: number, lenOfLen: number): number {
  if (pos + lenOfLen > bytes.length) throw new TypeError("rlp: truncated length");
  if (bytes[pos] === 0) throw new TypeError("rlp: length with a leading zero");
  let n = 0;
  for (let i = 0; i < lenOfLen; i++) n = n * 256 + bytes[pos + i]!;
  if (n < 56) throw new TypeError("rlp: long form for a short length");
  return n;
}

function decodeAt(bytes: Uint8Array, pos: number): [RlpItem, number] {
  if (pos >= bytes.length) throw new TypeError("rlp: truncated");
  const b = bytes[pos]!;
  if (b < 0x80) return [bytes.slice(pos, pos + 1), pos + 1];
  if (b <= 0xb7) {
    const len = b - 0x80;
    const end = pos + 1 + len;
    if (end > bytes.length) throw new TypeError("rlp: truncated string");
    if (len === 1 && bytes[pos + 1]! < 0x80) throw new TypeError("rlp: single byte should encode as itself");
    return [bytes.slice(pos + 1, end), end];
  }
  if (b <= 0xbf) {
    const lenOfLen = b - 0xb7;
    const len = readLength(bytes, pos + 1, lenOfLen);
    const start = pos + 1 + lenOfLen;
    if (start + len > bytes.length) throw new TypeError("rlp: truncated string");
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
  if (end > bytes.length) throw new TypeError("rlp: truncated list");
  const items: RlpItem[] = [];
  let p = start;
  while (p < end) {
    const [it, next] = decodeAt(bytes, p);
    items.push(it);
    p = next;
  }
  if (p !== end) throw new TypeError("rlp: list overran its length");
  return [items, end];
}

function asBytes(item: RlpItem | undefined, what: string): Uint8Array {
  if (!(item instanceof Uint8Array)) throw new TypeError(`${what}: expected a byte string`);
  return item;
}

function asList(item: RlpItem | undefined, what: string): RlpItem[] {
  if (!Array.isArray(item)) throw new TypeError(`${what}: expected a list`);
  return item;
}

/** An RLP scalar (big-endian, no leading zeros) as a bigint. */
export function rlpUint(item: RlpItem | undefined, what: string): bigint {
  const b = asBytes(item, what);
  if (b.length > 0 && b[0] === 0) throw new TypeError(`${what}: integer with a leading zero`);
  let n = 0n;
  for (const x of b) n = (n << 8n) | BigInt(x);
  return n;
}

// ── Block header ───────────────────────────────────────────────────────────

export interface DecodedHeader {
  /** keccak256 of the header RLP: the block hash. */
  hash: string;
  parentHash: string;
  transactionsRoot: string;
  number: number;
  timestamp: number;
}

/** Decode the fields a ceiling reads from a header RLP, and hash it. */
export function decodeHeader(headerRlp: Uint8Array): DecodedHeader {
  const f = asList(rlpDecode(headerRlp), "header");
  if (f.length < 15) throw new TypeError("header: too few fields");
  const num = rlpUint(f[8], "header.number");
  const ts = rlpUint(f[11], "header.timestamp");
  if (num > BigInt(Number.MAX_SAFE_INTEGER) || ts > BigInt(Number.MAX_SAFE_INTEGER)) throw new TypeError("header: number out of range");
  const txRoot = asBytes(f[4], "header.transactionsRoot");
  const parent = asBytes(f[0], "header.parentHash");
  if (txRoot.length !== 32 || parent.length !== 32) throw new TypeError("header: bad root length");
  return {
    hash: bytesToHex(keccak256(headerRlp)),
    parentHash: bytesToHex(parent),
    transactionsRoot: bytesToHex(txRoot),
    number: Number(num),
    timestamp: Number(ts),
  };
}

// ── EIP-1559 transaction ───────────────────────────────────────────────────

export interface DecodedTx {
  type: 2;
  chainId: bigint;
  nonce: bigint;
  to: string | null;
  value: bigint;
  data: Uint8Array;
  /** Address recovered from the signature, lowercase 0x hex. */
  from: string;
  /** keccak256 of the raw transaction: its hash on chain. */
  hash: string;
}

/**
 * Decode a signed type-2 transaction and recover its sender. Only type 2 is
 * accepted: the writer sends nothing else, and a narrower decoder is a
 * smaller thing to get wrong.
 */
export function decodeEip1559(raw: Uint8Array): DecodedTx {
  if (raw.length < 2 || raw[0] !== 0x02) throw new TypeError("tx: not an EIP-1559 (type 2) transaction");
  const f = asList(rlpDecode(raw.slice(1)), "tx");
  if (f.length !== 12) throw new TypeError("tx: a type-2 transaction has 12 fields");
  const chainId = rlpUint(f[0], "tx.chainId");
  const nonce = rlpUint(f[1], "tx.nonce");
  const toBytes = asBytes(f[5], "tx.to");
  if (toBytes.length !== 0 && toBytes.length !== 20) throw new TypeError("tx: bad recipient length");
  const value = rlpUint(f[6], "tx.value");
  const data = asBytes(f[7], "tx.data");
  asList(f[8], "tx.accessList");
  const yParity = rlpUint(f[9], "tx.yParity");
  const r = rlpUint(f[10], "tx.r");
  const s = rlpUint(f[11], "tx.s");
  if (yParity > 1n) throw new TypeError("tx: yParity must be 0 or 1");
  const signingHash = keccak256(concat(Uint8Array.of(0x02), rlpEncode(f.slice(0, 9))));
  const compact = hexToBytes(r.toString(16).padStart(64, "0") + s.toString(16).padStart(64, "0"));
  const sig = secp256k1.Signature.fromBytes(compact, "compact");
  // Ethereum rejects high-s signatures (EIP-2); so do we.
  if (sig.hasHighS()) throw new TypeError("tx: high-s signature");
  const pub = sig.addRecoveryBit(Number(yParity)).recoverPublicKey(signingHash).toBytes(false);
  const from = bytesToHex(keccak256(pub.slice(1)).slice(12));
  return {
    type: 2,
    chainId,
    nonce,
    to: toBytes.length === 0 ? null : bytesToHex(toBytes),
    value,
    data,
    from,
    hash: bytesToHex(keccak256(raw)),
  };
}

// ── Merkle-Patricia inclusion proof ────────────────────────────────────────

function toNibbles(bytes: Uint8Array): number[] {
  const out: number[] = [];
  for (const b of bytes) out.push(b >> 4, b & 0x0f);
  return out;
}

/** Hex-prefix decode: [nibbles, isLeaf]. */
function hexPrefix(encoded: Uint8Array): [number[], boolean] {
  if (encoded.length === 0) throw new TypeError("mpt: empty path");
  const nib = toNibbles(encoded);
  const flag = nib[0]!;
  if (flag > 3) throw new TypeError("mpt: bad path flag");
  const isLeaf = flag >= 2;
  const odd = flag % 2 === 1;
  if (!odd && nib[1] !== 0) throw new TypeError("mpt: even path must pad with zero");
  return [nib.slice(odd ? 1 : 2), isLeaf];
}

/**
 * Walk an inclusion proof for `key` from `root`. Returns the stored value, or
 * null when the proof shows the key absent or does not hold together (a node
 * that does not hash to the reference pointing at it, a path that diverges).
 * Every node is bound to its parent's reference, so the value is bound to
 * `root` and to nothing the prover could choose.
 */
export function mptVerify(root: Uint8Array, key: Uint8Array, proof: readonly Uint8Array[]): Uint8Array | null {
  const path = toNibbles(key);
  let want: Uint8Array = root; // a 32-byte hash, or an inline node's own RLP
  let depth = 0;
  let i = 0;
  while (true) {
    let nodeRlp: Uint8Array;
    if (want.length === 32) {
      const next = proof[i++];
      if (!next || !bytesEqual(keccak256(next), want)) return null;
      nodeRlp = next;
    } else {
      nodeRlp = want; // inline node (<32 bytes), embedded in its parent
    }
    let node: RlpItem[];
    try {
      node = asList(rlpDecode(nodeRlp), "mpt node");
    } catch {
      return null;
    }
    if (node.length === 17) {
      if (depth === path.length) {
        const v = node[16];
        return v instanceof Uint8Array && v.length > 0 ? v : null;
      }
      const child = node[path[depth]!];
      depth += 1;
      if (child === undefined) return null;
      if (child instanceof Uint8Array) {
        if (child.length === 0) return null;
        want = child;
      } else {
        want = rlpEncode(child);
      }
      continue;
    }
    if (node.length === 2) {
      let seg: number[];
      let isLeaf: boolean;
      try {
        [seg, isLeaf] = hexPrefix(asBytes(node[0], "mpt path"));
      } catch {
        return null;
      }
      for (let k = 0; k < seg.length; k++) if (path[depth + k] !== seg[k]) return null;
      depth += seg.length;
      if (isLeaf) {
        if (depth !== path.length) return null;
        const v = node[1];
        return v instanceof Uint8Array ? v : null;
      }
      const child = node[1]!;
      want = child instanceof Uint8Array ? child : rlpEncode(child);
      continue;
    }
    return null;
  }
}

/** The trie key of transaction `index` in a block: rlp(index). */
export function txTrieKey(index: number): Uint8Array {
  if (!Number.isInteger(index) || index < 0) throw new RangeError("tx index");
  if (index === 0) return rlpEncode(new Uint8Array(0));
  const b: number[] = [];
  for (let n = index; n > 0; n = Math.floor(n / 256)) b.unshift(n % 256);
  return rlpEncode(Uint8Array.from(b));
}
