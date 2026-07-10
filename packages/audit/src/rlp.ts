// Copyright (c) 2024-2026 Mike Argento. Licensed under the MIT License. See LICENSE.

/**
 * bitgraph-audit minimal RLP decoder (internal)
 *
 * Just enough RLP to decode an Ethereum block header for the anchor
 * witness procedure (bundle spec section 10.3 step 1): a single
 * well-formed list of items, where an item is a byte string or a nested
 * list. No dependency, no encoding support (tests carry their own tiny
 * encoder), no network.
 *
 * Strictness: offsets and lengths are bounds-checked and the top-level
 * decode must consume the input exactly ("a single well-formed RLP
 * list"). Canonical-form minimality (shortest-length encodings) is NOT
 * enforced: the witness procedure recomputes Keccak-256 over the exact
 * raw bytes, so any alternative encoding of the same header changes the
 * hash and fails the hash comparison, which is the actual gate.
 */

export type RlpItem = Uint8Array | RlpItem[];

/**
 * Decode a complete RLP buffer whose top level is a list. Throws Error
 * with a precise message on malformed input or trailing bytes.
 */
export function decodeRlpList(bytes: Uint8Array): RlpItem[] {
  if (bytes.length === 0) throw new Error("RLP: empty input");
  const { item, next } = decodeItem(bytes, 0);
  if (next !== bytes.length) {
    throw new Error(`RLP: ${bytes.length - next} trailing byte(s) after the top-level item`);
  }
  if (!Array.isArray(item)) throw new Error("RLP: top-level item is not a list");
  return item;
}

function decodeItem(bytes: Uint8Array, offset: number): { item: RlpItem; next: number } {
  const prefix = at(bytes, offset);

  // Single byte, self-encoding.
  if (prefix < 0x80) {
    return { item: bytes.subarray(offset, offset + 1), next: offset + 1 };
  }

  // Short byte string (0..55 bytes).
  if (prefix <= 0xb7) {
    const length = prefix - 0x80;
    const end = checkedEnd(bytes, offset + 1, length);
    return { item: bytes.subarray(offset + 1, end), next: end };
  }

  // Long byte string.
  if (prefix <= 0xbf) {
    const lengthOfLength = prefix - 0xb7;
    const length = readLength(bytes, offset + 1, lengthOfLength);
    const start = offset + 1 + lengthOfLength;
    const end = checkedEnd(bytes, start, length);
    return { item: bytes.subarray(start, end), next: end };
  }

  // Short list (payload 0..55 bytes).
  if (prefix <= 0xf7) {
    const payloadLength = prefix - 0xc0;
    const end = checkedEnd(bytes, offset + 1, payloadLength);
    return { item: decodeListPayload(bytes, offset + 1, end), next: end };
  }

  // Long list.
  const lengthOfLength = prefix - 0xf7;
  const payloadLength = readLength(bytes, offset + 1, lengthOfLength);
  const start = offset + 1 + lengthOfLength;
  const end = checkedEnd(bytes, start, payloadLength);
  return { item: decodeListPayload(bytes, start, end), next: end };
}

function decodeListPayload(bytes: Uint8Array, start: number, end: number): RlpItem[] {
  const items: RlpItem[] = [];
  let cursor = start;
  while (cursor < end) {
    const decoded = decodeItem(bytes, cursor);
    if (decoded.next > end) throw new Error("RLP: list item overruns its list payload");
    items.push(decoded.item);
    cursor = decoded.next;
  }
  return items;
}

function readLength(bytes: Uint8Array, offset: number, lengthOfLength: number): number {
  if (lengthOfLength < 1 || lengthOfLength > 8) {
    throw new Error(`RLP: invalid length-of-length ${lengthOfLength}`);
  }
  let value = 0;
  for (let i = 0; i < lengthOfLength; i++) {
    value = value * 256 + at(bytes, offset + i);
  }
  if (value > bytes.length) throw new Error("RLP: declared length exceeds the input size");
  return value;
}

function checkedEnd(bytes: Uint8Array, start: number, length: number): number {
  const end = start + length;
  if (end > bytes.length) throw new Error("RLP: item is truncated");
  return end;
}

function at(bytes: Uint8Array, offset: number): number {
  const value = bytes[offset];
  if (value === undefined) throw new Error("RLP: unexpected end of input");
  return value;
}

/**
 * Interpret an RLP byte string as a big-endian unsigned integer, the
 * encoding Ethereum headers use for the number and timestamp fields. An
 * empty byte string means zero.
 */
export function rlpBytesToBigInt(bytes: Uint8Array): bigint {
  let value = 0n;
  for (const byte of bytes) value = (value << 8n) | BigInt(byte);
  return value;
}

/**
 * Decode a 0x-prefixed, even-length, case-insensitive hex string to
 * bytes. Returns null on any format violation (missing prefix, odd
 * length, non-hex characters).
 */
export function hexToBytes(hex: string): Uint8Array | null {
  if (!hex.startsWith("0x")) return null;
  const body = hex.slice(2);
  if (body.length % 2 !== 0) return null;
  if (!/^[0-9a-fA-F]*$/.test(body)) return null;
  const out = new Uint8Array(body.length / 2);
  for (let i = 0; i < out.length; i++) {
    out[i] = Number.parseInt(body.slice(i * 2, i * 2 + 2), 16);
  }
  return out;
}

/** Lowercase 0x-prefixed hex of bytes. */
export function bytesToHex0x(bytes: Uint8Array): string {
  return `0x${Buffer.from(bytes).toString("hex")}`;
}
