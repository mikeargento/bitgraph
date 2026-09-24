// Copyright (c) 2024-2026 Argento Computing Inc. Licensed under the MIT License. See LICENSE.

/**
 * bitgraph-carrier/1 — the file that carries its own proof.
 *
 * A carrier is the committed bytes followed by one structural block holding
 * the proof and the evidence needed to read its time window offline:
 *
 *   [ committed bytes ............................ ]  ← exactly what was hashed
 *   [ BGPROOF\x01 ][ u32 len ][ payload ][ u32 len ][ BGPROOF\x01 ]
 *
 * The committed digest covers the bytes BEFORE the block, never the block.
 * The block is found from the END of the file only — last 8 bytes must be the
 * magic, then the trailing length, then the leading magic and length must
 * agree — never by scanning, so a carrier fused inside another carrier
 * resolves deterministically to the outermost block, and no ordinary file can
 * be misread as one by accident.
 *
 * THE ENVELOPE RULE. The carrier's own hash is committed nowhere and proves
 * nothing. Anyone can repackage the same committed bytes with the same block
 * and get a different outer hash; that is fine and expected. Never describe
 * the carrier as recorded — the bytes inside it are.
 *
 * THE TIME WINDOW. The payload always carries the floor: the anchor the
 * enclave signed into the slot (`commit.slotAnchor`, present since enclave
 * v7) plus that block's header, so "placed no earlier than this block" checks
 * offline by identity. The ceiling cannot exist when the carrier is written —
 * the anchor that follows the commit has not landed yet — so it is either
 * `present` (stamped in later from public data) or `unfetched`, stated in so
 * many words. There is no third state, and absence of the field is a corrupt
 * block, not a missing bound.
 *
 * ⚠️ TWO BYTE-IDENTICAL COPIES OF THIS FILE EXIST, on purpose:
 *   packages/verify/src/carrier.ts   (canonical, published with the package)
 *   website/src/lib/carrier.ts       (the site cannot import unpublished code)
 * A parity test in the website suite asserts they match. Edit both or the
 * test fails the build. The file is self-contained (only @noble imports) so
 * the copies can be identical.
 */

import { sha256 } from "@noble/hashes/sha256";
import { keccak_256 } from "@noble/hashes/sha3";

/* ── The block ──────────────────────────────────────────────────────────── */

/** "BGPROOF" + 0x01: seven ASCII bytes and a block version. */
export const CARRIER_MAGIC = Uint8Array.from([0x42, 0x47, 0x50, 0x52, 0x4f, 0x4f, 0x46, 0x01]);
/** magic + u32 + u32 + magic around the payload. */
export const CARRIER_OVERHEAD = 24;
/** A payload larger than this is refused as corrupt: a manifest of 100k members fits in a tenth of it. */
export const MAX_CARRIER_PAYLOAD = 8 * 1024 * 1024;

export const CARRIER_VERSION = "bitgraph-carrier/1";

/* ── The payload ────────────────────────────────────────────────────────── */

/** The raw Ethereum block header, so the block's identity and time check offline. */
export interface CarrierWitness {
  headerRlpHex: string;
  blockNumber: number;
  blockHash: string;
}

/** A minimal view of a bitgraph/1 proof; the real shape is the verify package's. */
export type CarrierProof = Record<string, unknown>;

export interface CarrierFloor {
  status: "present";
  /** The anchor proof named by the carried proof's signed `commit.slotAnchor`. */
  anchor: CarrierProof;
  witness: CarrierWitness;
}

export type CarrierCeiling =
  | {
      status: "unfetched";
      /** Set when a completion looked and nothing had landed yet, so "never looked" and "not yet" read apart. */
      searched?: { asOfCounter: string; epochId: string };
    }
  | {
      status: "present";
      /** How the ceiling anchor is ordered after the proof. v1 stamps counter-order only. */
      basis: "counter-order";
      anchor: CarrierProof;
      witness: CarrierWitness;
    };

export interface CarrierPayload {
  carrier: typeof CARRIER_VERSION;
  /** The bitgraph/1 proof exactly as the commit returned it. */
  proof: CarrierProof;
  floor: CarrierFloor;
  ceiling: CarrierCeiling;
}

export type CarrierParse =
  /** No block: the bytes are not a carrier. Not a verdict about anything. */
  | { kind: "none" }
  /** A block is there but cannot be read. A corrupted block, not a forgery. */
  | { kind: "corrupt"; reason: string }
  | {
      kind: "carrier";
      /** The committed bytes: everything before the block. A view, not a copy. */
      inner: Uint8Array;
      payload: CarrierPayload;
      /** Where the block starts, = inner.length. */
      blockOffset: number;
    };

/* ── Small helpers ──────────────────────────────────────────────────────── */

const te = new TextEncoder();

function u32be(n: number): Uint8Array {
  return Uint8Array.from([(n >>> 24) & 0xff, (n >>> 16) & 0xff, (n >>> 8) & 0xff, n & 0xff]);
}
function readU32be(b: Uint8Array, at: number): number {
  return ((b[at]! << 24) | (b[at + 1]! << 16) | (b[at + 2]! << 8) | b[at + 3]!) >>> 0;
}
function magicAt(b: Uint8Array, at: number): boolean {
  if (at < 0 || at + 8 > b.length) return false;
  for (let i = 0; i < 8; i++) if (b[at + i] !== CARRIER_MAGIC[i]!) return false;
  return true;
}
function record(v: unknown): Record<string, unknown> | null {
  return typeof v === "object" && v !== null && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
}
/** base64 (either alphabet, padded or not) → bytes, or null. */
export function b64ToBytes(s: string): Uint8Array | null {
  if (typeof s !== "string" || !/^[A-Za-z0-9+/_-]*={0,2}$/.test(s)) return null;
  const std = s.replace(/-/g, "+").replace(/_/g, "/");
  const pad = std.length % 4 === 0 ? std : std + "=".repeat(4 - (std.length % 4));
  try {
    if (typeof atob === "function") {
      const bin = atob(pad);
      const out = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
      return out;
    }
    return new Uint8Array(Buffer.from(pad, "base64"));
  } catch {
    return null;
  }
}
export function bytesToB64(b: Uint8Array): string {
  if (typeof btoa === "function") {
    let s = "";
    for (let i = 0; i < b.length; i++) s += String.fromCharCode(b[i]!);
    return btoa(s);
  }
  return Buffer.from(b).toString("base64");
}
/** Digest equality across the two base64 alphabets. */
export function sameDigest(a: unknown, b: unknown): boolean {
  if (typeof a !== "string" || typeof b !== "string") return false;
  const na = b64ToBytes(a), nb = b64ToBytes(b);
  if (na === null || nb === null || na.length !== nb.length) return false;
  let diff = 0;
  for (let i = 0; i < na.length; i++) diff |= na[i]! ^ nb[i]!;
  return diff === 0;
}

/* ── Build, parse, complete ─────────────────────────────────────────────── */

export function encodeCarrierBlock(payload: CarrierPayload): Uint8Array {
  const body = te.encode(JSON.stringify(payload));
  if (body.length > MAX_CARRIER_PAYLOAD) throw new Error(`carrier payload too large: ${body.length} bytes`);
  const out = new Uint8Array(body.length + CARRIER_OVERHEAD);
  out.set(CARRIER_MAGIC, 0);
  out.set(u32be(body.length), 8);
  out.set(body, 12);
  out.set(u32be(body.length), 12 + body.length);
  out.set(CARRIER_MAGIC, 16 + body.length);
  return out;
}

/** The committed bytes followed by their block. The inner bytes are copied, never altered. */
export function buildCarrier(inner: Uint8Array, payload: CarrierPayload): Uint8Array {
  const block = encodeCarrierBlock(payload);
  const out = new Uint8Array(inner.length + block.length);
  out.set(inner, 0);
  out.set(block, inner.length);
  return out;
}

/** Structural payload check: is this object a readable bitgraph-carrier/1 payload? */
function payloadShapeError(p: unknown): string | null {
  const o = record(p);
  if (o === null) return "payload is not an object";
  if (o["carrier"] !== CARRIER_VERSION) return `unknown carrier version ${JSON.stringify(o["carrier"])}`;
  if (record(o["proof"]) === null) return "payload carries no proof object";
  const floor = record(o["floor"]);
  if (floor === null || floor["status"] !== "present") return "floor must be present: a floorless carrier is not a not-before";
  if (record(floor["anchor"]) === null) return "floor carries no anchor proof";
  const fw = record(floor["witness"]);
  if (fw === null || typeof fw["headerRlpHex"] !== "string" || typeof fw["blockNumber"] !== "number" || typeof fw["blockHash"] !== "string") {
    return "floor carries no readable block-header witness";
  }
  const ceil = record(o["ceiling"]);
  if (ceil === null) return "ceiling is missing: absence must be a stated fact, not a missing key";
  if (ceil["status"] === "unfetched") return null;
  if (ceil["status"] !== "present") return `ceiling status must be "unfetched" or "present", got ${JSON.stringify(ceil["status"])}`;
  if (ceil["basis"] !== "counter-order") return `unknown ceiling basis ${JSON.stringify(ceil["basis"])}`;
  if (record(ceil["anchor"]) === null) return "ceiling carries no anchor proof";
  const cw = record(ceil["witness"]);
  if (cw === null || typeof cw["headerRlpHex"] !== "string" || typeof cw["blockNumber"] !== "number" || typeof cw["blockHash"] !== "string") {
    return "ceiling carries no readable block-header witness";
  }
  return null;
}

export function parseCarrier(bytes: Uint8Array): CarrierParse {
  if (bytes.length < CARRIER_OVERHEAD + 2) return { kind: "none" };
  if (!magicAt(bytes, bytes.length - 8)) return { kind: "none" };
  const len = readU32be(bytes, bytes.length - 12);
  if (len > MAX_CARRIER_PAYLOAD) return { kind: "corrupt", reason: `declared payload length ${len} exceeds the cap` };
  const start = bytes.length - CARRIER_OVERHEAD - len;
  if (start < 0) return { kind: "corrupt", reason: "declared payload length runs past the start of the file" };
  if (!magicAt(bytes, start)) return { kind: "corrupt", reason: "leading magic missing where the trailing length points" };
  if (readU32be(bytes, start + 8) !== len) return { kind: "corrupt", reason: "leading and trailing payload lengths disagree" };
  let payload: unknown;
  try {
    payload = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes.subarray(start + 12, start + 12 + len)));
  } catch {
    return { kind: "corrupt", reason: "payload is not valid UTF-8 JSON" };
  }
  const shape = payloadShapeError(payload);
  if (shape !== null) return { kind: "corrupt", reason: shape };
  return { kind: "carrier", inner: bytes.subarray(0, start), payload: payload as CarrierPayload, blockOffset: start };
}

/**
 * Stamp a verified ceiling into a carrier, or record that a completion looked
 * and found nothing yet. Pure: callers verify the material BEFORE stamping.
 * Never overwrites: a present ceiling that differs from the offered one is
 * reported, since a conflicting embedded ceiling is evidence worth keeping.
 */
export function completeCarrier(
  bytes: Uint8Array,
  ceiling: { anchor: CarrierProof; witness: CarrierWitness } | null,
  searched?: { asOfCounter: string; epochId: string },
): { changed: boolean; bytes: Uint8Array; error?: string } {
  const p = parseCarrier(bytes);
  if (p.kind !== "carrier") return { changed: false, bytes, error: p.kind === "none" ? "not a carrier" : `corrupt block: ${p.reason}` };
  const cur = p.payload.ceiling;
  if (cur.status === "present") {
    if (ceiling === null) return { changed: false, bytes };
    const a = record(record(cur.anchor)?.["commit"]);
    const b = record(record(ceiling.anchor)?.["commit"]);
    const same = a !== null && b !== null && a["counter"] === b["counter"] && cur.witness.blockHash.toLowerCase() === ceiling.witness.blockHash.toLowerCase();
    return same ? { changed: false, bytes } : { changed: false, bytes, error: "carrier already holds a different ceiling; refusing to overwrite it" };
  }
  const payload: CarrierPayload = {
    ...p.payload,
    ceiling: ceiling === null
      ? { status: "unfetched", ...(searched ? { searched } : {}) }
      : { status: "present", basis: "counter-order", anchor: ceiling.anchor, witness: ceiling.witness },
  };
  if (ceiling === null && !searched) return { changed: false, bytes };
  return { changed: true, bytes: buildCarrier(p.inner, payload) };
}

/* ── Consistency checks (no network, no signatures — bindings only) ─────── */

/** The identity an authenticated anchor proof claims: enclave-signed since v7. */
export function anchorIdentity(anchor: unknown): { counter: string; epochId: string; chainId: string; publicKeyB64: string; blockNumber: number; blockHash: string } | null {
  const p = record(anchor);
  const commit = record(p?.["commit"]);
  const signer = record(p?.["signer"]);
  const a = record(commit?.["anchor"]);
  if (!p || !commit || !signer || !a) return null;
  const counter = commit["counter"], epochId = commit["epochId"], chainId = commit["chainId"];
  const publicKeyB64 = signer["publicKeyB64"], blockNumber = a["blockNumber"], blockHash = a["blockHash"];
  if (typeof counter !== "string" || typeof epochId !== "string" || typeof chainId !== "string") return null;
  if (typeof publicKeyB64 !== "string" || typeof blockNumber !== "number" || typeof blockHash !== "string") return null;
  return { counter, epochId, chainId, publicKeyB64, blockNumber, blockHash };
}

function partitionOf(proof: unknown): { epochId: string; chainId: string; publicKeyB64: string; counter: string; slotAnchor: { counter: string; blockNumber: number; blockHash: string } | null } | null {
  const p = record(proof);
  const commit = record(p?.["commit"]);
  const signer = record(p?.["signer"]);
  if (!p || !commit || !signer) return null;
  const epochId = commit["epochId"], chainId = commit["chainId"], counter = commit["counter"], publicKeyB64 = signer["publicKeyB64"];
  if (typeof epochId !== "string" || typeof chainId !== "string" || typeof counter !== "string" || typeof publicKeyB64 !== "string") return null;
  const sa = record(commit["slotAnchor"]);
  const slotAnchor = sa && typeof sa["counter"] === "string" && typeof sa["blockNumber"] === "number" && typeof sa["blockHash"] === "string"
    ? { counter: sa["counter"], blockNumber: sa["blockNumber"], blockHash: sa["blockHash"] }
    : null;
  return { epochId, chainId, publicKeyB64, counter, slotAnchor };
}

/**
 * The floor must be the anchor the enclave signed into the slot — matched by
 * identity against `commit.slotAnchor`, never merely "some anchor below the
 * slot". An older anchor would read as an earlier not-before than was signed.
 */
export function checkFloorBinding(proof: unknown, floor: CarrierFloor): string[] {
  const errs: string[] = [];
  const part = partitionOf(proof);
  if (part === null) return ["proof is missing commit or signer fields"];
  if (part.slotAnchor === null) return ["proof carries no signed slotAnchor (pre-v7): it cannot travel as a carrier floor"];
  const id = anchorIdentity(floor.anchor);
  if (id === null) return ["floor anchor is not an authenticated anchor (no signed commit.anchor)"];
  if (id.chainId !== part.chainId || id.epochId !== part.epochId || id.publicKeyB64 !== part.publicKeyB64) {
    errs.push("floor anchor is not from the proof's own chain, epoch and key");
  }
  if (id.counter !== part.slotAnchor.counter) errs.push(`floor anchor counter ${id.counter} is not the signed slotAnchor counter ${part.slotAnchor.counter}`);
  if (id.blockNumber !== part.slotAnchor.blockNumber) errs.push(`floor anchor block ${id.blockNumber} is not the signed slotAnchor block ${part.slotAnchor.blockNumber}`);
  if (id.blockHash.toLowerCase() !== part.slotAnchor.blockHash.toLowerCase()) errs.push("floor anchor block hash differs from the signed slotAnchor block hash");
  if (floor.witness.blockNumber !== id.blockNumber) errs.push("floor witness is for a different block number than the floor anchor");
  if (floor.witness.blockHash.toLowerCase() !== id.blockHash.toLowerCase()) errs.push("floor witness is for a different block hash than the floor anchor");
  return errs;
}

/** A present ceiling: same partition, strictly after the commit, counter-order. */
export function checkCeilingBinding(proof: unknown, ceiling: Extract<CarrierCeiling, { status: "present" }>): string[] {
  const errs: string[] = [];
  const part = partitionOf(proof);
  if (part === null) return ["proof is missing commit or signer fields"];
  const id = anchorIdentity(ceiling.anchor);
  if (id === null) return ["ceiling anchor is not an authenticated anchor (no signed commit.anchor)"];
  if (id.chainId !== part.chainId || id.epochId !== part.epochId || id.publicKeyB64 !== part.publicKeyB64) {
    errs.push("ceiling anchor is not from the proof's own chain, epoch and key: counter-order says nothing across epochs");
  }
  let after = false;
  try {
    after = BigInt(id.counter) > BigInt(part.counter);
  } catch {
    errs.push("ceiling or commit counter is not a whole number");
  }
  if (!after) errs.push(`ceiling anchor counter ${id.counter} does not follow the commit counter ${part.counter}`);
  if (ceiling.witness.blockNumber !== id.blockNumber) errs.push("ceiling witness is for a different block number than the ceiling anchor");
  if (ceiling.witness.blockHash.toLowerCase() !== id.blockHash.toLowerCase()) errs.push("ceiling witness is for a different block hash than the ceiling anchor");
  return errs;
}

/**
 * An anchor commits SHA-256 of its signed message, the block hash string.
 * This ties the anchor's artifact digest to the block it claims, offline.
 * Also returns the exact bytes the anchor's own digest covers, for verify().
 */
export function anchorMessageBytes(anchor: unknown): { bytes: Uint8Array; error: string | null } {
  const p = record(anchor);
  const attr = record(p?.["attribution"]);
  const id = anchorIdentity(anchor);
  const msg = typeof attr?.["message"] === "string" ? (attr["message"] as string) : id ? id.blockHash.toLowerCase() : null;
  if (msg === null) return { bytes: new Uint8Array(), error: "anchor carries no signed message and no block hash" };
  const bytes = te.encode(msg);
  const artifact = record(p?.["artifact"]);
  const digest = artifact?.["digestB64"];
  if (typeof digest !== "string" || !sameDigest(bytesToB64(sha256(bytes)), digest)) {
    return { bytes, error: "anchor's artifact digest is not the SHA-256 of its signed block-hash message" };
  }
  if (id && msg.toLowerCase() !== id.blockHash.toLowerCase()) return { bytes, error: "anchor's signed message is not its claimed block hash" };
  return { bytes, error: null };
}

/* ── The block-header witness (keccak + minimal RLP) ────────────────────── */
/* The same procedure bitgraph-audit's witness.ts runs (docs/BUNDLE-FORMAT.md
   §10.3), reduced to what a carrier needs: recompute the hash, cross-check
   number, read the timestamp. Ethereum headers RLP-encode as one list whose
   items 8 and 11 are the block number and timestamp. */

function hexToBytes(hex: string): Uint8Array | null {
  const clean = hex.startsWith("0x") || hex.startsWith("0X") ? hex.slice(2) : hex;
  if (clean.length % 2 !== 0 || !/^[0-9a-fA-F]*$/.test(clean)) return null;
  const out = new Uint8Array(clean.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(clean.slice(i * 2, i * 2 + 2), 16);
  return out;
}

/** Top-level items of one RLP list, as raw byte payloads. Null when malformed. */
export function decodeRlpTop(bytes: Uint8Array): Uint8Array[] | null {
  if (bytes.length === 0) return null;
  const b0 = bytes[0]!;
  let at: number, end: number;
  if (b0 >= 0xf8) {
    const ll = b0 - 0xf7;
    if (1 + ll > bytes.length) return null;
    let len = 0;
    for (let i = 0; i < ll; i++) len = len * 256 + bytes[1 + i]!;
    at = 1 + ll;
    end = at + len;
  } else if (b0 >= 0xc0) {
    at = 1;
    end = at + (b0 - 0xc0);
  } else return null;
  if (end !== bytes.length) return null;
  const items: Uint8Array[] = [];
  while (at < end) {
    const h = bytes[at]!;
    if (h < 0x80) {
      items.push(bytes.subarray(at, at + 1));
      at += 1;
    } else if (h <= 0xb7) {
      const len = h - 0x80;
      if (at + 1 + len > end) return null;
      items.push(bytes.subarray(at + 1, at + 1 + len));
      at += 1 + len;
    } else if (h <= 0xbf) {
      const ll = h - 0xb7;
      if (at + 1 + ll > end) return null;
      let len = 0;
      for (let i = 0; i < ll; i++) len = len * 256 + bytes[at + 1 + i]!;
      if (at + 1 + ll + len > end) return null;
      items.push(bytes.subarray(at + 1 + ll, at + 1 + ll + len));
      at += 1 + ll + len;
    } else {
      // A nested list inside a header's top level (withdrawals etc. stay hashed): skip it whole.
      let len: number, hl: number;
      if (h <= 0xf7) {
        len = h - 0xc0;
        hl = 1;
      } else {
        const ll = h - 0xf7;
        len = 0;
        for (let i = 0; i < ll; i++) len = len * 256 + bytes[at + 1 + i]!;
        hl = 1 + ll;
      }
      if (at + hl + len > end) return null;
      items.push(bytes.subarray(at + hl, at + hl + len));
      at += hl + len;
    }
  }
  return items;
}

function rlpNumber(item: Uint8Array): number | null {
  if (item.length > 6) return null;
  let n = 0;
  for (const b of item) n = n * 256 + b;
  return n;
}

export interface WitnessCheck {
  ok: boolean;
  error: string | null;
  /** The block's own timestamp, seconds since the epoch, read from the verified header. */
  timestamp: number | null;
}

/** keccak256(header) must reproduce the block hash; the header's number must match. Offline. */
export function verifyWitnessHeader(w: CarrierWitness): WitnessCheck {
  const raw = hexToBytes(w.headerRlpHex);
  if (raw === null) return { ok: false, error: "witness header is not hex", timestamp: null };
  const hash = "0x" + Array.from(keccak_256(raw), (b) => b.toString(16).padStart(2, "0")).join("");
  if (hash !== w.blockHash.toLowerCase()) return { ok: false, error: "keccak-256 of the witness header does not reproduce the block hash", timestamp: null };
  const items = decodeRlpTop(raw);
  if (items === null || items.length < 12) return { ok: false, error: "witness header is not a well-formed block-header list", timestamp: null };
  const num = rlpNumber(items[8]!);
  if (num !== w.blockNumber) return { ok: false, error: `witness header is block ${num ?? "?"}, not ${w.blockNumber}`, timestamp: null };
  return { ok: true, error: null, timestamp: rlpNumber(items[11]!) };
}

/* ── The window a reader states ─────────────────────────────────────────── */

export interface CarrierBounds {
  notBefore: { blockNumber: number; blockHash: string; timestamp: number | null };
  /** null means NOT FETCHED — say so in those words — never "none exists". */
  notAfter: { blockNumber: number; blockHash: string; timestamp: number | null } | null;
}

export function carrierBounds(payload: CarrierPayload): CarrierBounds {
  const f = payload.floor.witness;
  const floorTs = verifyWitnessHeader(f);
  const notBefore = { blockNumber: f.blockNumber, blockHash: f.blockHash.toLowerCase(), timestamp: floorTs.ok ? floorTs.timestamp : null };
  if (payload.ceiling.status !== "present") return { notBefore, notAfter: null };
  const c = payload.ceiling.witness;
  const ceilTs = verifyWitnessHeader(c);
  return { notBefore, notAfter: { blockNumber: c.blockNumber, blockHash: c.blockHash.toLowerCase(), timestamp: ceilTs.ok ? ceilTs.timestamp : null } };
}

/** SHA-256 of the committed bytes, compared to the carried proof's artifact digest. */
export function innerDigestMatches(inner: Uint8Array, payload: CarrierPayload): boolean {
  const artifact = record(payload.proof["artifact"]);
  return sameDigest(bytesToB64(sha256(inner)), artifact?.["digestB64"] as string);
}
