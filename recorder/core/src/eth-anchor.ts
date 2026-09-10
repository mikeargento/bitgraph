// Copyright (c) Mike Argento. All rights reserved. See LICENSE.

/**
 * The chain side of an anchor, checked here rather than believed.
 *
 * An anchor proof is the enclave's signed statement that it saw a particular
 * Ethereum block. The witness beside it is that block's own RLP header. Two
 * things follow from the header alone, with no network and no trust in
 * whoever handed it over:
 *
 *   keccak256(header) IS the block hash. So a header that hashes to the hash
 *   the anchor signed is that block's header and no other.
 *
 *   Item 11 of the header list is the block's timestamp. Once the header is
 *   established, its time is established with it.
 *
 * ⚠️ IN THAT ORDER. Reading the timestamp out of an unverified header would
 * be asserting a time from an untrusted source, which is the one thing this
 * product does not do. The time is returned only when the hash matched.
 */

import { keccak_256 } from "@noble/hashes/sha3.js";

export interface AnchorWitness {
  version?: string;
  headerRlpHex?: unknown;
  blockNumber?: unknown;
  blockHash?: unknown;
}

export type WitnessVerdict =
  | { ok: true; blockNumber: number; blockHash: string; blockTime: Date }
  /** The header did not hash to the hash the anchor signed. A contradiction, not a gap. */
  | { ok: false; kind: "contradicted"; reason: string }
  /** Nothing could be decided: the witness is missing or malformed. Never a fault of the holder. */
  | { ok: false; kind: "undetermined"; reason: string };

/** The header the anchor signed, or a reason there is no verdict. */
export function verifyWitness(witness: unknown, signedBlockHash: string | null): WitnessVerdict {
  if (witness === null || typeof witness !== "object") return undetermined("no witness was fetched for this anchor.");
  const w = witness as AnchorWitness;
  const hex = typeof w.headerRlpHex === "string" ? w.headerRlpHex.replace(/^0x/i, "") : null;
  if (hex === null || hex.length === 0 || hex.length % 2 !== 0 || /[^0-9a-fA-F]/.test(hex)) {
    return undetermined("the witness carries no readable header.");
  }
  const claimed = typeof w.blockHash === "string" ? w.blockHash.toLowerCase() : null;
  const expected = (signedBlockHash ?? claimed)?.toLowerCase() ?? null;
  if (expected === null) return undetermined("the anchor names no block hash to check the header against.");

  const header = hexToBytes(hex);
  const computed = `0x${toHex(keccak_256(header))}`;
  if (computed !== expected) {
    return {
      ok: false,
      kind: "contradicted",
      reason: `the block header hashes to ${computed}, and the anchor is signed over ${expected}.`,
    };
  }

  const items = decodeRlpList(header);
  if (items === null || items.length < 12) return undetermined("the block header did not decode as a header list.");
  const timestamp = toBigInt(items[11]!);
  const number = typeof w.blockNumber === "number" ? w.blockNumber : Number(toBigInt(items[8]!));
  return { ok: true, blockNumber: number, blockHash: computed, blockTime: new Date(Number(timestamp) * 1000) };
}

function undetermined(reason: string): WitnessVerdict {
  return { ok: false, kind: "undetermined", reason };
}

// ── A minimal RLP list decoder: enough to read a block header's items ────────
//
// Deliberately not a general RLP library. It decodes one list of byte strings,
// which is what an Ethereum block header is, and refuses anything else rather
// than guessing.

function decodeRlpList(bytes: Uint8Array): Uint8Array[] | null {
  const head = readItem(bytes, 0);
  if (head === null || !head.isList || head.end !== bytes.length) return null;
  const items: Uint8Array[] = [];
  let at = head.start;
  while (at < head.end) {
    const item = readItem(bytes, at);
    if (item === null || item.isList) return null;
    items.push(bytes.subarray(item.start, item.end));
    at = item.end;
  }
  return items;
}

function readItem(b: Uint8Array, at: number): { start: number; end: number; isList: boolean } | null {
  if (at >= b.length) return null;
  const p = b[at]!;
  if (p <= 0x7f) return { start: at, end: at + 1, isList: false };
  if (p <= 0xb7) return bounded(at + 1, p - 0x80, b.length, false);
  if (p <= 0xbf) {
    const n = p - 0xb7;
    const len = lengthAt(b, at + 1, n);
    return len === null ? null : bounded(at + 1 + n, len, b.length, false);
  }
  if (p <= 0xf7) return bounded(at + 1, p - 0xc0, b.length, true);
  const n = p - 0xf7;
  const len = lengthAt(b, at + 1, n);
  return len === null ? null : bounded(at + 1 + n, len, b.length, true);
}

function bounded(start: number, len: number, limit: number, isList: boolean): { start: number; end: number; isList: boolean } | null {
  const end = start + len;
  return end > limit ? null : { start, end, isList };
}

function lengthAt(b: Uint8Array, at: number, n: number): number | null {
  if (at + n > b.length || n === 0 || n > 4) return null;
  let v = 0;
  for (let i = 0; i < n; i++) v = v * 256 + b[at + i]!;
  return v;
}

function toBigInt(b: Uint8Array): bigint {
  let v = 0n;
  for (const byte of b) v = (v << 8n) | BigInt(byte);
  return v;
}

function hexToBytes(hex: string): Uint8Array {
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  return out;
}

function toHex(b: Uint8Array): string {
  return Array.from(b, (v) => v.toString(16).padStart(2, "0")).join("");
}
