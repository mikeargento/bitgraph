// Copyright (c) 2024-2026 Mike Argento. Licensed under the MIT License. See LICENSE.

/**
 * BitGraph Fuse, profile `bitgraph-fuse/1`: construction and parsing.
 *
 * A fused artifact is a file that contains a commitment to a signed slot
 * allocation obtained BEFORE the file was finished. The ordinary bitgraph/1
 * primitive then commits the file's digest exactly as it commits any digest.
 * A valid fused proof therefore bounds the file from below (the slot) and from
 * above (the commit): the exact fused bytes could not feasibly have been
 * finalized before their slot allocation and were committed no later than
 * their commit position.
 *
 * Everything a verifier needs to REBUILD a fused artifact from an original and
 * a proof lives here, which is why it is in the MIT package: the slot record
 * hash (the enclave's own canonical subset), the commitment, and a registry of
 * placements that say byte for byte how the commitment and the origin digest
 * were placed. Nothing here talks to a service.
 *
 * Definitions (spec 3.5):
 *   slotRecordHash = SHA256(canonical slot record body)              32 bytes
 *   slotCommitment = SHA256(UTF8("bitgraph-fuse/1") || 0x00 || slotRecordHash || nonce)
 * with the nonce as its raw 32 bytes. The raw nonce never enters a fused file;
 * only the commitment does, so a partially written file cannot be used to
 * claim the slot.
 */

import { sha256 } from "@noble/hashes/sha256";
import { merkleLeafHash, merkleRootFromPath, MerkleTree } from "./fuse-merkle.js";
import { canonicalize } from "./canonical.js";
import type { Attribution, BitGraphProof, SlotAllocation } from "./types.js";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

export const FUSE_PROFILE = "bitgraph-fuse/1" as const;

/** Domain separation prefix: the 15 profile bytes followed by one zero byte. */
export const FUSE_DOMAIN: Uint8Array = (() => {
  const label = new TextEncoder().encode(FUSE_PROFILE);
  const out = new Uint8Array(label.length + 1);
  out.set(label, 0);
  out[label.length] = 0x00;
  return out;
})();

/**
 * The signed attribution name that marks a fused proof (spec 6.5): the profile
 * id itself, the stable wire identifier of this construction. A product name
 * may change; the v1 wire identifier does not (ruled 2026-09-03).
 */
export const FUSE_ATTRIBUTION_NAME = FUSE_PROFILE;

/** Trailer placement: 8 ASCII magic bytes, 8 reserved zero bytes, 32 commitment bytes. */
export const TRAILER_MAGIC = "BGFUSE01" as const;
export const TRAILER_LENGTH = 48;

/** Fixed paths inside a container/1 archive. */
export const CONTAINER_MANIFEST_PATH = "bitgraph-fuse/manifest.json" as const;
export const CONTAINER_ORIGINAL_PATH = "bitgraph-fuse/original" as const;

// ---------------------------------------------------------------------------
// Byte helpers (pure JS, so the module runs in browsers and Node alike)
// ---------------------------------------------------------------------------

const B64 = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
const B64_LOOKUP: Record<string, number> = {};
for (let i = 0; i < B64.length; i++) B64_LOOKUP[B64[i]!] = i;

export function bytesToBase64(bytes: Uint8Array): string {
  let out = "";
  for (let i = 0; i < bytes.length; i += 3) {
    const a = bytes[i]!;
    const b = i + 1 < bytes.length ? bytes[i + 1]! : 0;
    const c = i + 2 < bytes.length ? bytes[i + 2]! : 0;
    out += B64[a >> 2]! + B64[((a & 3) << 4) | (b >> 4)]!;
    out += i + 1 < bytes.length ? B64[((b & 15) << 2) | (c >> 6)]! : "=";
    out += i + 2 < bytes.length ? B64[c & 63]! : "=";
  }
  return out;
}

/** Strict standard base64 (RFC 4648 section 4): no whitespace, no URL-safe alphabet, correct padding. */
export function base64ToBytes(b64: string): Uint8Array | null {
  if (typeof b64 !== "string" || b64.length % 4 !== 0 || !/^[A-Za-z0-9+/]*={0,2}$/.test(b64)) return null;
  const pad = b64.endsWith("==") ? 2 : b64.endsWith("=") ? 1 : 0;
  const out = new Uint8Array((b64.length / 4) * 3 - pad);
  let o = 0;
  for (let i = 0; i < b64.length; i += 4) {
    const n =
      (B64_LOOKUP[b64[i]!]! << 18) |
      (B64_LOOKUP[b64[i + 1]!]! << 12) |
      ((b64[i + 2] === "=" ? 0 : B64_LOOKUP[b64[i + 2]!]!) << 6) |
      (b64[i + 3] === "=" ? 0 : B64_LOOKUP[b64[i + 3]!]!);
    out[o++] = (n >> 16) & 255;
    if (o < out.length) out[o++] = (n >> 8) & 255;
    if (o < out.length) out[o++] = n & 255;
  }
  // Reject non-canonical padding bits (e.g. "AQ=" style trailing garbage).
  if (bytesToBase64(out) !== b64) return null;
  return out;
}

export function bytesToHex(bytes: Uint8Array): string {
  let s = "";
  for (const b of bytes) s += (b < 16 ? "0" : "") + b.toString(16);
  return s;
}

/** Lowercase hex only; uppercase is rejected so one digest has one spelling. */
export function hexToBytes(hex: string): Uint8Array | null {
  if (typeof hex !== "string" || hex.length % 2 !== 0 || !/^[0-9a-f]*$/.test(hex)) return null;
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  return out;
}

export function bytesEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i]! ^ b[i]!;
  return diff === 0;
}

function concat(...parts: Uint8Array[]): Uint8Array {
  let n = 0;
  for (const p of parts) n += p.length;
  const out = new Uint8Array(n);
  let o = 0;
  for (const p of parts) { out.set(p, o); o += p.length; }
  return out;
}

const utf8 = (s: string) => new TextEncoder().encode(s);

// ---------------------------------------------------------------------------
// Slot record hash and slot commitment
// ---------------------------------------------------------------------------

/**
 * The enclave's canonical slot body: the signed subset of the slot record,
 * excluding signatureB64, with `time` and `chainId` present only when the
 * record carries them. Identical to the reconstruction in verifier.ts
 * (verifySlotAllocation) and to the enclave's own slotBody. There is exactly
 * one serialization of a slot record; this is it.
 */
export function canonicalSlotBody(slot: SlotAllocation): Record<string, unknown> {
  return {
    version: slot.version,
    nonceB64: slot.nonceB64,
    counter: slot.counter,
    ...(slot.time !== undefined ? { time: slot.time } : {}),
    epochId: slot.epochId,
    publicKeyB64: slot.publicKeyB64,
    ...(slot.chainId ? { chainId: slot.chainId } : {}),
  };
}

/** SHA-256 of the canonical slot body; equals the proof's commit.slotHashB64. */
export function computeSlotRecordHash(slot: SlotAllocation): Uint8Array {
  return sha256(canonicalize(canonicalSlotBody(slot) as unknown as BitGraphProof));
}

/** The exact preimage of the commitment, for vectors and audits: domain || slotRecordHash || nonce. */
export function slotCommitmentPreimage(slot: SlotAllocation): Uint8Array {
  const nonce = base64ToBytes(slot.nonceB64);
  if (nonce === null || nonce.length !== 32) {
    throw new TypeError("slot.nonceB64 must decode to exactly 32 bytes");
  }
  return concat(FUSE_DOMAIN, computeSlotRecordHash(slot), nonce);
}

/** slotCommitment = SHA256(domain || slotRecordHash || nonce). */
export function computeSlotCommitment(slot: SlotAllocation): Uint8Array {
  return sha256(slotCommitmentPreimage(slot));
}

// ---------------------------------------------------------------------------
// Form C canonical payload
// ---------------------------------------------------------------------------

export interface FusePayload {
  type: typeof FUSE_PROFILE;
  origin?: { algorithm: "sha256"; digest: string };
  slotCommitment: { algorithm: "sha256"; digest: string };
}

/** Build the canonical Form C payload bytes (spec 6.2). Digests are lowercase hex. */
export function buildFusePayload(commitment: Uint8Array, originDigest?: Uint8Array): Uint8Array {
  if (commitment.length !== 32) throw new TypeError("commitment must be 32 bytes");
  if (originDigest !== undefined && originDigest.length !== 32) throw new TypeError("originDigest must be 32 bytes");
  const payload: FusePayload = {
    type: FUSE_PROFILE,
    ...(originDigest !== undefined ? { origin: { algorithm: "sha256", digest: bytesToHex(originDigest) } } : {}),
    slotCommitment: { algorithm: "sha256", digest: bytesToHex(commitment) },
  };
  return canonicalize(payload as unknown as BitGraphProof);
}

function isPlainObject(x: unknown): x is Record<string, unknown> {
  return x !== null && typeof x === "object" && !Array.isArray(x) && Object.getPrototypeOf(x) === Object.prototype;
}

function readDigestField(x: unknown): Uint8Array | null {
  if (!isPlainObject(x)) return null;
  const keys = Object.keys(x);
  if (keys.length !== 2 || x["algorithm"] !== "sha256" || typeof x["digest"] !== "string") return null;
  const bytes = hexToBytes(x["digest"]);
  return bytes !== null && bytes.length === 32 ? bytes : null;
}

/**
 * Strict parse of Form C bytes. The bytes must be valid UTF-8 JSON, a plain
 * object with exactly the allowed keys, the profile type, lowercase-hex
 * 32-byte digests, and must equal their own re-canonicalization byte for byte
 * (which rejects whitespace, key-order games, and duplicate keys, since a
 * duplicate cannot survive a round trip). Returns null on any deviation.
 */
export function parseFusePayload(bytes: Uint8Array): { commitment: Uint8Array; originDigest?: Uint8Array } | null {
  let text: string;
  try {
    text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    return null;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return null;
  }
  if (!isPlainObject(parsed)) return null;
  const keys = Object.keys(parsed).sort();
  const allowed = keys.length === 2 ? ["slotCommitment", "type"] : keys.length === 3 ? ["origin", "slotCommitment", "type"] : null;
  if (allowed === null || keys.join(",") !== allowed.join(",")) return null;
  if (parsed["type"] !== FUSE_PROFILE) return null;
  const commitment = readDigestField(parsed["slotCommitment"]);
  if (commitment === null) return null;
  let originDigest: Uint8Array | undefined;
  if ("origin" in parsed) {
    const o = readDigestField(parsed["origin"]);
    if (o === null) return null;
    originDigest = o;
  }
  if (!bytesEqual(buildFusePayload(commitment, originDigest), bytes)) return null;
  return originDigest !== undefined ? { commitment, originDigest } : { commitment };
}

// ---------------------------------------------------------------------------
// Minimal deterministic ustar (POSIX.1-1988) for container/1 and container/2
// ---------------------------------------------------------------------------

const BLOCK = 512;
const MAX_ENTRY = 0o77777777777; // 8 GiB - 1, the 11-digit octal size field

function octal(n: number, width: number): Uint8Array {
  const s = n.toString(8).padStart(width - 1, "0") + "\0";
  if (s.length !== width) throw new RangeError("field overflow");
  return utf8(s);
}

function ustarHeader(name: string, size: number): Uint8Array {
  if (size > MAX_ENTRY) throw new RangeError("container entries are limited to 8 GiB");
  const h = new Uint8Array(BLOCK);
  const nameBytes = utf8(name);
  if (nameBytes.length > 100) throw new RangeError("ustar name too long");
  h.set(nameBytes, 0);
  h.set(utf8("0000644\0"), 100);        // mode
  h.set(utf8("0000000\0"), 108);        // uid
  h.set(utf8("0000000\0"), 116);        // gid
  h.set(octal(size, 12), 124);          // size
  h.set(utf8("00000000000\0"), 136);    // mtime: 0, the epoch; nothing about a clock enters the bytes
  h.set(utf8("        "), 148);         // checksum placeholder
  h[156] = 0x30;                        // typeflag '0' regular file
  h.set(utf8("ustar\0"), 257);          // magic
  h.set(utf8("00"), 263);               // version
  // uname, gname, devmajor, devminor, prefix: all zero
  let sum = 0;
  for (const b of h) sum += b;
  h.set(utf8(sum.toString(8).padStart(6, "0") + "\0 "), 148);
  return h;
}

function padTo(n: number): number {
  return (BLOCK - (n % BLOCK)) % BLOCK;
}

/** Build a container/1 archive: manifest entry, then the original, then two zero blocks. */
function buildContainer(original: Uint8Array, manifest: Uint8Array): Uint8Array {
  return concat(
    ustarHeader(CONTAINER_MANIFEST_PATH, manifest.length), manifest, new Uint8Array(padTo(manifest.length)),
    ustarHeader(CONTAINER_ORIGINAL_PATH, original.length), original, new Uint8Array(padTo(original.length)),
    new Uint8Array(BLOCK * 2),
  );
}

interface TarEntry { name: string; data: Uint8Array; headerBytes: Uint8Array }

/** Parse a ustar stream into entries; null when malformed. Does not accept extensions. */
function parseTar(bytes: Uint8Array): TarEntry[] | null {
  const entries: TarEntry[] = [];
  let off = 0;
  while (off + BLOCK <= bytes.length) {
    const h = bytes.subarray(off, off + BLOCK);
    if (h.every((b) => b === 0)) {
      // End marker: two zero blocks, then nothing.
      const rest = bytes.subarray(off);
      if (rest.length !== BLOCK * 2 || !rest.every((b) => b === 0)) return null;
      return entries;
    }
    const nameEnd = h.indexOf(0, 0);
    const name = new TextDecoder().decode(h.subarray(0, nameEnd < 0 || nameEnd > 100 ? 100 : nameEnd));
    const sizeText = new TextDecoder().decode(h.subarray(124, 135));
    if (!/^[0-7]{11}$/.test(sizeText)) return null;
    const size = parseInt(sizeText, 8);
    if (off + BLOCK + size > bytes.length) return null;
    const data = bytes.subarray(off + BLOCK, off + BLOCK + size);
    entries.push({ name, data, headerBytes: h });
    off += BLOCK + size + padTo(size);
  }
  return null;
}

// ---------------------------------------------------------------------------
// Placement registry
// ---------------------------------------------------------------------------

export type PlacementId = "trailer/1" | "container/1" | "container/2" | "produced/1" | "set/1" | "set/2";

export interface Located {
  /** The commitment found in the fused bytes. */
  commitment: Uint8Array;
  /** The origin digest written into the fused bytes, when the placement writes one. */
  originDigest?: Uint8Array;
  /** The original's bytes as carried inside the fused bytes, for placements that carry them. */
  originalBytes?: Uint8Array;
}

/** What a Form A or B placement puts around the original: fused = prefix, original, suffix. */
export interface FusedFrame {
  prefix: Uint8Array;
  suffix: Uint8Array;
}

export interface Placement {
  readonly id: PlacementId;
  /** A: in-file placement of an existing original; B: container; C: produced artifact. */
  readonly form: "A" | "B" | "C";
  /** True when the fused bytes are a deterministic function of (original, proof, placement). */
  readonly byteExact: boolean;
  /** Build the fused bytes. Forms A and B require `original`; Form C forbids it. */
  build(input: { original?: Uint8Array; originDigest?: Uint8Array; commitment: Uint8Array }): Uint8Array;
  /** Find the commitment in fused bytes, or null when the marker is absent or malformed. */
  locate(fused: Uint8Array): Located | null;
  /**
   * Forms A and B: the bytes around the original, such that
   * build({original, originDigest, commitment}) is exactly prefix, original,
   * suffix. A producer that streams the original once can hash the prefix and
   * the original as they pass and finish with the suffix later.
   */
  frame?(input: { originalSize: number; originDigest: Uint8Array; commitment: Uint8Array }): FusedFrame;
  /**
   * The prefix when it depends on the original's size alone, so a scanner can
   * hash it before any slot exists; null when the prefix carries the
   * commitment (container/1) and the fused digest needs the bytes again.
   */
  scanPrefix?(originalSize: number): Uint8Array | null;
}

const trailer1: Placement = {
  id: "trailer/1",
  form: "A",
  byteExact: true,
  build({ original, commitment }) {
    if (original === undefined) throw new TypeError("trailer/1 requires the original bytes");
    if (commitment.length !== 32) throw new TypeError("commitment must be 32 bytes");
    return concat(original, utf8(TRAILER_MAGIC), new Uint8Array(8), commitment);
  },
  locate(fused) {
    if (fused.length < TRAILER_LENGTH) return null;
    const t = fused.subarray(fused.length - TRAILER_LENGTH);
    if (!bytesEqual(t.subarray(0, 8), utf8(TRAILER_MAGIC))) return null;
    if (!t.subarray(8, 16).every((b) => b === 0)) return null;
    return { commitment: new Uint8Array(t.subarray(16, 48)), originalBytes: fused.subarray(0, fused.length - TRAILER_LENGTH) };
  },
  frame({ commitment }) {
    if (commitment.length !== 32) throw new TypeError("commitment must be 32 bytes");
    return { prefix: new Uint8Array(0), suffix: concat(utf8(TRAILER_MAGIC), new Uint8Array(8), commitment) };
  },
  scanPrefix() {
    return new Uint8Array(0);
  },
};

const container1: Placement = {
  id: "container/1",
  form: "B",
  byteExact: true,
  build({ original, originDigest, commitment }) {
    if (original === undefined) throw new TypeError("container/1 requires the original bytes");
    const digest = originDigest ?? sha256(original);
    return buildContainer(original, buildFusePayload(commitment, digest));
  },
  locate(fused) {
    const entries = parseTar(fused);
    if (entries === null || entries.length !== 2) return null;
    const [m, o] = entries as [TarEntry, TarEntry];
    if (m.name !== CONTAINER_MANIFEST_PATH || o.name !== CONTAINER_ORIGINAL_PATH) return null;
    const payload = parseFusePayload(m.data);
    if (payload === null || payload.originDigest === undefined) return null;
    // The archive must be the one this module would build: headers included.
    const rebuilt = buildContainer(o.data, m.data);
    if (!bytesEqual(rebuilt, fused)) return null;
    return { commitment: payload.commitment, originDigest: payload.originDigest, originalBytes: o.data };
  },
  frame({ originalSize, originDigest, commitment }) {
    const manifest = buildFusePayload(commitment, originDigest);
    return {
      prefix: concat(ustarHeader(CONTAINER_MANIFEST_PATH, manifest.length), manifest, new Uint8Array(padTo(manifest.length)), ustarHeader(CONTAINER_ORIGINAL_PATH, originalSize)),
      suffix: concat(new Uint8Array(padTo(originalSize)), new Uint8Array(BLOCK * 2)),
    };
  },
  scanPrefix() {
    // The manifest, and so the commitment, comes before the original.
    return null;
  },
};

/**
 * container/2: the same archive with the original FIRST. Everything before
 * the original's bytes is its ustar header, which depends on the size alone,
 * so a scanner that hashes header and original as the file streams by can
 * finish the fused digest later with the manifest for whatever slot the
 * set is made under, without reading the file again. Any bytes fit: the
 * original stays byte-exact inside, and the archive is a plain tar.
 */
function buildContainer2(original: Uint8Array, manifest: Uint8Array): Uint8Array {
  return concat(
    ustarHeader(CONTAINER_ORIGINAL_PATH, original.length), original, new Uint8Array(padTo(original.length)),
    ustarHeader(CONTAINER_MANIFEST_PATH, manifest.length), manifest, new Uint8Array(padTo(manifest.length)),
    new Uint8Array(BLOCK * 2),
  );
}

const container2: Placement = {
  id: "container/2",
  form: "B",
  byteExact: true,
  build({ original, originDigest, commitment }) {
    if (original === undefined) throw new TypeError("container/2 requires the original bytes");
    const digest = originDigest ?? sha256(original);
    return buildContainer2(original, buildFusePayload(commitment, digest));
  },
  locate(fused) {
    const entries = parseTar(fused);
    if (entries === null || entries.length !== 2) return null;
    const [o, m] = entries as [TarEntry, TarEntry];
    if (o.name !== CONTAINER_ORIGINAL_PATH || m.name !== CONTAINER_MANIFEST_PATH) return null;
    const payload = parseFusePayload(m.data);
    if (payload === null || payload.originDigest === undefined) return null;
    // The archive must be the one this module would build: headers included.
    const rebuilt = buildContainer2(o.data, m.data);
    if (!bytesEqual(rebuilt, fused)) return null;
    return { commitment: payload.commitment, originDigest: payload.originDigest, originalBytes: o.data };
  },
  frame({ originalSize, originDigest, commitment }) {
    const manifest = buildFusePayload(commitment, originDigest);
    return {
      prefix: ustarHeader(CONTAINER_ORIGINAL_PATH, originalSize),
      suffix: concat(new Uint8Array(padTo(originalSize)), ustarHeader(CONTAINER_MANIFEST_PATH, manifest.length), manifest, new Uint8Array(padTo(manifest.length)), new Uint8Array(BLOCK * 2)),
    };
  },
  scanPrefix(originalSize) {
    return ustarHeader(CONTAINER_ORIGINAL_PATH, originalSize);
  },
};

const produced1: Placement = {
  id: "produced/1",
  form: "C",
  byteExact: false,
  build({ original, originDigest, commitment }) {
    if (original !== undefined) throw new TypeError("produced/1 takes no original; pass originDigest for a source reference");
    return buildFusePayload(commitment, originDigest);
  },
  locate(fused) {
    const payload = parseFusePayload(fused);
    if (payload === null) return null;
    return payload.originDigest !== undefined
      ? { commitment: payload.commitment, originDigest: payload.originDigest }
      : { commitment: payload.commitment };
  },
};

/** Registered placements in the fixed order a verifier tries them when none is declared. */
export const PLACEMENTS: readonly Placement[] = Object.freeze([trailer1, container1, container2, produced1]);

// ---------------------------------------------------------------------------
// Set manifest (placement set/1): N files fused under ONE slot
// ---------------------------------------------------------------------------
//
// A set is N files fused under one slot. The commitment c is computed once
// from the one slot record; every member's fused bytes carry c via that
// member's own placement (trailer/1 or container/1, chosen per file as
// today); and the COMMITTED ARTIFACT is a canonical manifest listing the
// members' fused digests, origin digests and placement ids, plus c itself.
// The manifest is a Form C artifact under the placement id "set/1".
//
// Its canonical encoding is load-bearing: one committed hash must stand for
// exactly one member list. buildSetManifest is the single source of the byte
// layout (rows strictly ascending by artifact digest, lowercase hex, sorted
// keys, no whitespace) and parseSetManifest accepts nothing that is not byte
// for byte equal to its own rebuild. Anything outside that domain is refused,
// never normalized.

export const SET_PLACEMENT_ID = "set/1" as const;

/**
 * The proof.metadata key under which a set proof carries its manifest as a
 * parsed plain object: the profile id itself, namespaced so it cannot collide
 * with a site's own metadata keys. metadata is UNSIGNED and advisory. The
 * manifest is protected only because its canonical bytes must hash to the
 * signed artifact digest, which verifyFuseMember checks before reading a row.
 */
export const SET_METADATA_KEY = FUSE_PROFILE;

/** A placement id is a lowercase name, a slash, and a positive version: "trailer/1". */
const PLACEMENT_ID_PATTERN = /^[a-z0-9][a-z0-9-]*\/[1-9][0-9]*$/;

/** One member of a set, bytes view: the build input and the parse output. */
export interface SetMember {
  /** SHA-256 of the member's FUSED bytes. */
  artifact: Uint8Array;
  /** SHA-256 of the member's ORIGINAL bytes; selects the rebuild path and feeds lookup by original. */
  origin: Uint8Array;
  /** The placement that carries the commitment inside this member's fused bytes. */
  placement: string;
}

/** The manifest as JSON: the type of the value under proof.metadata[SET_METADATA_KEY]. */
export interface SetManifest {
  members: Array<{
    artifact: { algorithm: "sha256"; digest: string };
    origin: { algorithm: "sha256"; digest: string };
    placement: string;
  }>;
  placement: typeof SET_PLACEMENT_ID;
  slotCommitment: { algorithm: "sha256"; digest: string };
  type: typeof FUSE_PROFILE;
}

/**
 * Build the canonical set manifest bytes. Rows are sorted strictly ascending
 * by artifact digest (byte order, which is the lexicographic order of the
 * lowercase hex), so the same members in any input order give the same bytes.
 * Throws on a commitment or digest that is not 32 bytes, an empty list, a
 * malformed placement id, a member placement of "set/1" (no nesting in v1),
 * or a duplicate artifact digest. Duplicate ORIGIN digests are permitted: one
 * original fused two ways is two members with two artifact digests.
 */
export function buildSetManifest(commitment: Uint8Array, members: readonly SetMember[]): Uint8Array {
  if (commitment.length !== 32) throw new TypeError("commitment must be 32 bytes");
  if (members.length === 0) throw new TypeError("a set lists at least one member");
  const rows: SetManifest["members"] = [];
  const seen = new Set<string>();
  for (const m of members) {
    if (m.artifact.length !== 32) throw new TypeError("member artifact digest must be 32 bytes");
    if (m.origin.length !== 32) throw new TypeError("member origin digest must be 32 bytes");
    if (!PLACEMENT_ID_PATTERN.test(m.placement)) throw new TypeError(`member placement "${m.placement}" is not a placement id`);
    if (m.placement === SET_PLACEMENT_ID || m.placement === SET2_PLACEMENT_ID) throw new TypeError("a set cannot list a set as a member");
    const artifact = bytesToHex(m.artifact);
    if (seen.has(artifact)) throw new TypeError(`duplicate member artifact digest ${artifact}`);
    seen.add(artifact);
    rows.push({
      artifact: { algorithm: "sha256", digest: artifact },
      origin: { algorithm: "sha256", digest: bytesToHex(m.origin) },
      placement: m.placement,
    });
  }
  rows.sort((a, b) => (a.artifact.digest < b.artifact.digest ? -1 : 1));
  const manifest: SetManifest = {
    members: rows,
    placement: SET_PLACEMENT_ID,
    slotCommitment: { algorithm: "sha256", digest: bytesToHex(commitment) },
    type: FUSE_PROFILE,
  };
  return canonicalize(manifest);
}

/**
 * Strict parse of set manifest bytes, in the style of parseFusePayload. The
 * bytes must be valid UTF-8 JSON, a plain object with exactly the keys
 * {members, placement, slotCommitment, type}, the profile type, placement
 * "set/1", a lowercase-hex 32-byte commitment, at least one row, every row
 * exactly {artifact, origin, placement} with 32-byte digests and a
 * well-formed placement id other than "set/1", and finally must equal
 * buildSetManifest over what was read byte for byte. That one comparison
 * rejects whitespace, key reordering, duplicate JSON keys (a duplicate cannot
 * survive a round trip), unsorted or duplicated rows, non-canonical escapes
 * and trailing bytes. Registration of a row's placement is NOT checked here:
 * a v2 placement must not poison v1 readers, and it surfaces per row as
 * UNDETERMINED_PLACEMENT at verify time. Returns null on any deviation.
 */
export function parseSetManifest(bytes: Uint8Array): { commitment: Uint8Array; members: SetMember[] } | null {
  let text: string;
  try {
    // ignoreBOM keeps a leading BOM in the text, where JSON.parse refuses it,
    // rather than stripping it as though it were whitespace.
    text = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(bytes);
  } catch {
    return null;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return null;
  }
  if (!isPlainObject(parsed)) return null;
  if (Object.keys(parsed).sort().join(",") !== "members,placement,slotCommitment,type") return null;
  if (parsed["type"] !== FUSE_PROFILE || parsed["placement"] !== SET_PLACEMENT_ID) return null;
  const commitment = readDigestField(parsed["slotCommitment"]);
  if (commitment === null) return null;
  const list = parsed["members"];
  if (!Array.isArray(list) || list.length === 0) return null;
  const members: SetMember[] = [];
  for (const row of list as unknown[]) {
    if (!isPlainObject(row)) return null;
    if (Object.keys(row).sort().join(",") !== "artifact,origin,placement") return null;
    const artifact = readDigestField(row["artifact"]);
    const origin = readDigestField(row["origin"]);
    const placement = row["placement"];
    if (artifact === null || origin === null || typeof placement !== "string") return null;
    if (!PLACEMENT_ID_PATTERN.test(placement) || placement === SET_PLACEMENT_ID || placement === SET2_PLACEMENT_ID) return null;
    members.push({ artifact, origin, placement });
  }
  let rebuilt: Uint8Array;
  try {
    rebuilt = buildSetManifest(commitment, members);
  } catch {
    return null;
  }
  if (!bytesEqual(rebuilt, bytes)) return null;
  return { commitment, members };
}

/**
 * The manifest bytes a proof carries under proof.metadata[SET_METADATA_KEY],
 * re-canonicalized from the parsed object, or null when there is none or it
 * is not a plain object. UNBOUND and UNVALIDATED: metadata is unsigned, so
 * this returns bytes only, never rows. Nothing reads a member from it except
 * through verifyFuseMember, which first requires these bytes to parse
 * strictly and to hash to the signed artifact digest.
 */
export function readSetMetadata(proof: BitGraphProof): Uint8Array | null {
  const value = proof.metadata?.[SET_METADATA_KEY];
  if (!isPlainObject(value)) return null;
  try {
    return canonicalize(value);
  } catch {
    return null;
  }
}

const set1: Placement = {
  id: SET_PLACEMENT_ID,
  form: "C",
  byteExact: false,
  build() {
    throw new TypeError("set/1 is built with buildSetManifest(commitment, members)");
  },
  locate(fused) {
    const manifest = parseSetManifest(fused);
    return manifest === null ? null : { commitment: manifest.commitment };
  },
};

// ---------------------------------------------------------------------------
// Merkle set (placement set/2): N files under ONE slot, any N
// ---------------------------------------------------------------------------
//
// set/1 commits the whole member list, which is what caps it: the list rides
// in the commit body and in every copy of the proof. set/2 commits the ROOT
// of a Merkle tree over the same rows, so the committed artifact is a few
// hundred bytes whatever N is, and a member proves its place with a path of
// ceil(log2 N) siblings. The floor is unchanged: every member's fused bytes
// still carry the slot's commitment through its own placement. Membership
// and floor stay inseparable in verifyFuseMember; what changes is where the
// list lives (with the producer and the reader that serves it) and what a
// member carries (its row, its index and its path, see SetMemberProof).
//
// Leaves are the canonical row bytes (the same {artifact, origin, placement}
// row set/1 lists), hashed with the RFC 6962 leaf prefix, in the same strict
// order as a set/1 manifest: ascending by artifact digest, no duplicates.
// So one root stands for exactly one member list, and a reader holding the
// list can rebuild the tree; a reader holding one member needs its path.

export const SET2_PLACEMENT_ID = "set/2" as const;

/** The proof.metadata key under which a member's own evidence (row, index, count, path) may ride, UNSIGNED, beside the root document. */
export const SET_MEMBER_METADATA_KEY = `${FUSE_PROFILE}/member` as const;

/** The most members one set/2 tree lists. A limit stated plainly, not a design constant: the tree and the paths are fine far beyond it. */
export const MAX_SET2_MEMBERS = 1_000_000;

/** The root document as JSON: the type of the value under proof.metadata[SET_METADATA_KEY] for a set/2 proof. */
export interface SetRoot {
  count: number;
  placement: typeof SET2_PLACEMENT_ID;
  root: { algorithm: "sha256"; digest: string };
  slotCommitment: { algorithm: "sha256"; digest: string };
  type: typeof FUSE_PROFILE;
}

/** One member's evidence as JSON: its row, its leaf index, the tree size, and the sibling path from the leaf up. */
export interface SetMemberProof {
  count: number;
  index: number;
  member: SetManifest["members"][number];
  path: string[];
  placement: typeof SET2_PLACEMENT_ID;
  type: typeof FUSE_PROFILE;
}

/** The canonical bytes of one row, exactly as a set/1 manifest lists it; the leaf a set/2 tree hashes. */
export function canonicalSetRow(m: SetMember): Uint8Array {
  if (m.artifact.length !== 32) throw new TypeError("member artifact digest must be 32 bytes");
  if (m.origin.length !== 32) throw new TypeError("member origin digest must be 32 bytes");
  if (!PLACEMENT_ID_PATTERN.test(m.placement) || m.placement === SET_PLACEMENT_ID || m.placement === SET2_PLACEMENT_ID) throw new TypeError(`member placement "${m.placement}" is not a member placement id`);
  return canonicalize({
    artifact: { algorithm: "sha256", digest: bytesToHex(m.artifact) },
    origin: { algorithm: "sha256", digest: bytesToHex(m.origin) },
    placement: m.placement,
  } as unknown as BitGraphProof);
}

/** The leaf hash of one row: SHA-256(0x00, canonical row bytes). */
export function setLeaf(m: SetMember): Uint8Array {
  return merkleLeafHash(canonicalSetRow(m));
}

/**
 * Order members as a set/2 tree lists them: strictly ascending by artifact
 * digest, no duplicate artifact. Throws on a duplicate, an empty list, or a
 * malformed row, like buildSetManifest.
 */
export function sortSetMembers(members: readonly SetMember[]): SetMember[] {
  if (members.length === 0) throw new TypeError("a set lists at least one member");
  const sorted = [...members].sort((a, b) => {
    const x = bytesToHex(a.artifact);
    const y = bytesToHex(b.artifact);
    return x < y ? -1 : x > y ? 1 : 0;
  });
  for (let i = 0; i < sorted.length; i++) {
    canonicalSetRow(sorted[i]!);
    if (i > 0 && bytesEqual(sorted[i]!.artifact, sorted[i - 1]!.artifact)) throw new TypeError(`duplicate member artifact digest ${bytesToHex(sorted[i]!.artifact)}`);
  }
  return sorted;
}

/** The tree over a member list, in tree order (sortSetMembers): the sorted rows, their leaf hashes, the root, and every member's path on demand. */
export function buildSetTree(members: readonly SetMember[]): { sorted: SetMember[]; leaves: Uint8Array[]; root: Uint8Array; tree: MerkleTree } {
  const sorted = sortSetMembers(members);
  const leaves = sorted.map(setLeaf);
  const tree = new MerkleTree(leaves);
  return { sorted, leaves, root: tree.root, tree };
}

/** The inclusion path of the member at `index` in tree order. */
export function setMemberPath(tree: MerkleTree, index: number): Uint8Array[] {
  return tree.path(index);
}

/** Build the canonical set/2 root document bytes: the committed artifact. */
export function buildSetRoot(commitment: Uint8Array, count: number, root: Uint8Array): Uint8Array {
  if (commitment.length !== 32) throw new TypeError("commitment must be 32 bytes");
  if (root.length !== 32) throw new TypeError("root must be 32 bytes");
  if (!Number.isInteger(count) || count < 1 || count > MAX_SET2_MEMBERS) throw new TypeError(`count must be an integer from 1 to ${MAX_SET2_MEMBERS}`);
  const doc: SetRoot = {
    count,
    placement: SET2_PLACEMENT_ID,
    root: { algorithm: "sha256", digest: bytesToHex(root) },
    slotCommitment: { algorithm: "sha256", digest: bytesToHex(commitment) },
    type: FUSE_PROFILE,
  };
  return canonicalize(doc as unknown as BitGraphProof);
}

/** Strict parse of set/2 root document bytes: exactly the five keys, the literals, 32-byte digests, a count in range, byte-equal to its own rebuild. */
export function parseSetRoot(bytes: Uint8Array): { commitment: Uint8Array; count: number; root: Uint8Array } | null {
  let text: string;
  try {
    text = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(bytes);
  } catch {
    return null;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return null;
  }
  if (!isPlainObject(parsed)) return null;
  if (Object.keys(parsed).sort().join(",") !== "count,placement,root,slotCommitment,type") return null;
  if (parsed["type"] !== FUSE_PROFILE || parsed["placement"] !== SET2_PLACEMENT_ID) return null;
  const count = parsed["count"];
  if (typeof count !== "number" || !Number.isInteger(count) || count < 1 || count > MAX_SET2_MEMBERS) return null;
  const commitment = readDigestField(parsed["slotCommitment"]);
  const root = readDigestField(parsed["root"]);
  if (commitment === null || root === null) return null;
  let rebuilt: Uint8Array;
  try {
    rebuilt = buildSetRoot(commitment, count, root);
  } catch {
    return null;
  }
  if (!bytesEqual(rebuilt, bytes)) return null;
  return { commitment, count, root };
}

/** Build a member's evidence object (JSON shape) from tree order. */
export function buildSetMemberProof(member: SetMember, index: number, count: number, path: readonly Uint8Array[]): SetMemberProof {
  if (!Number.isInteger(index) || !Number.isInteger(count) || count < 1 || index < 0 || index >= count) throw new RangeError("member index out of range");
  canonicalSetRow(member);
  return {
    count,
    index,
    member: {
      artifact: { algorithm: "sha256", digest: bytesToHex(member.artifact) },
      origin: { algorithm: "sha256", digest: bytesToHex(member.origin) },
      placement: member.placement,
    },
    path: path.map((p) => {
      if (p.length !== 32) throw new TypeError("a path node is 32 bytes");
      return bytesToHex(p);
    }),
    placement: SET2_PLACEMENT_ID,
    type: FUSE_PROFILE,
  };
}

/** Strict read of a member's evidence from a parsed JSON value: shape, literals, 32-byte hex digests and path nodes, index within count. Null on any deviation. UNBOUND: nothing here touches a root. */
export function parseSetMemberProof(value: unknown): { member: SetMember; index: number; count: number; path: Uint8Array[] } | null {
  if (!isPlainObject(value)) return null;
  if (Object.keys(value).sort().join(",") !== "count,index,member,path,placement,type") return null;
  if (value["type"] !== FUSE_PROFILE || value["placement"] !== SET2_PLACEMENT_ID) return null;
  const count = value["count"];
  const index = value["index"];
  if (typeof count !== "number" || !Number.isInteger(count) || count < 1 || count > MAX_SET2_MEMBERS) return null;
  if (typeof index !== "number" || !Number.isInteger(index) || index < 0 || index >= count) return null;
  const row = value["member"];
  if (!isPlainObject(row) || Object.keys(row).sort().join(",") !== "artifact,origin,placement") return null;
  const artifact = readDigestField(row["artifact"]);
  const origin = readDigestField(row["origin"]);
  const placement = row["placement"];
  if (artifact === null || origin === null || typeof placement !== "string") return null;
  if (!PLACEMENT_ID_PATTERN.test(placement) || placement === SET_PLACEMENT_ID || placement === SET2_PLACEMENT_ID) return null;
  const list = value["path"];
  if (!Array.isArray(list)) return null;
  const path: Uint8Array[] = [];
  for (const node of list as unknown[]) {
    if (typeof node !== "string" || !/^[0-9a-f]{64}$/.test(node)) return null;
    const bytes = hexToBytes(node);
    if (bytes === null) return null;
    path.push(bytes);
  }
  return { member: { artifact, origin, placement }, index, count, path };
}

/** Recompute a root from a member's leaf and path; null when the path does not fit. */
export function setRootFromMember(member: SetMember, index: number, count: number, path: readonly Uint8Array[]): Uint8Array | null {
  return merkleRootFromPath(setLeaf(member), index, count, path);
}

const set2: Placement = {
  id: SET2_PLACEMENT_ID,
  form: "C",
  byteExact: false,
  build() {
    throw new TypeError("set/2 is built with buildSetRoot(commitment, count, root)");
  },
  locate(fused) {
    const doc = parseSetRoot(fused);
    return doc === null ? null : { commitment: doc.commitment };
  },
};

/**
 * Resolve a placement by id. set/1 and set/2 resolve here but are NOT in PLACEMENTS:
 * the undeclared scan is for bytes whose placement was not declared, whereas
 * a set manifest is identified by hashing to the signed artifact digest and
 * by its signed title, so the scan order of every existing fixture is
 * literally unchanged.
 */
export function getPlacement(id: string): Placement | undefined {
  return [...PLACEMENTS, set1, set2].find((p) => p.id === id);
}

// ---------------------------------------------------------------------------
// Attribution (the signed carrier of placement and origin, spec 6.5)
// ---------------------------------------------------------------------------

/**
 * attribution.name = "bitgraph-fuse/1" (the profile id), title = placement id,
 * message = origin digest in standard base64. A set has no single origin, so
 * set/1 refuses an origin digest: a set/1 marker carrying one is out of
 * profile and verifyFuseMember refuses it.
 */
export function fuseAttribution(placement: PlacementId, originDigest?: Uint8Array): Attribution {
  if (originDigest !== undefined && originDigest.length !== 32) throw new TypeError("originDigest must be 32 bytes");
  if ((placement === SET_PLACEMENT_ID || placement === SET2_PLACEMENT_ID) && originDigest !== undefined) throw new TypeError(`${placement} has no single origin; a set marker carries no origin digest`);
  return {
    name: FUSE_ATTRIBUTION_NAME,
    title: placement,
    ...(originDigest !== undefined ? { message: bytesToBase64(originDigest) } : {}),
  };
}

export type MarkerSource = "attribution" | "manifest";

/**
 * What marks a proof as fused, and where each fact came from. The signed
 * attribution is authoritative for what it declares; a Frame's advisory
 * manifest may fill in what the signature leaves undeclared (an origin hint,
 * a placement), and is made self-proving only by reconstruction.
 */
export interface FuseMarker {
  /** The placement id, or null when none is declared (a verifier then tries the registry in order). */
  placement: string | null;
  placementSource: MarkerSource | null;
  originDigest?: Uint8Array;
  originSource?: MarkerSource;
  /** "attribution" when the proof's signed attribution marks it fused, else "manifest". */
  source: MarkerSource;
}

/** Read the fused marker from a proof's signed attribution, or null when the proof is not marked fused. */
export function readFuseAttribution(proof: BitGraphProof): FuseMarker | null {
  const a = proof.attribution;
  if (a === undefined || a.name !== FUSE_ATTRIBUTION_NAME) return null;
  const declared = typeof a.title === "string" && a.title.length > 0;
  const marker: FuseMarker = { placement: declared ? (a.title as string) : null, placementSource: declared ? "attribution" : null, source: "attribution" };
  if (typeof a.message === "string" && a.message.length > 0) {
    const d = base64ToBytes(a.message);
    // A message that is not a digest is still a fused marker; the origin is simply undeclared.
    if (d !== null && d.length === 32) {
      marker.originDigest = d;
      marker.originSource = "attribution";
    }
  }
  return marker;
}

/** Merge the signed marker with a manifest marker: the signature wins wherever it declares. */
export function mergeMarkers(signed: FuseMarker | null, manifest: FuseMarker | null): FuseMarker | null {
  if (signed === null) return manifest;
  if (manifest === null) return signed;
  const out: FuseMarker = { ...signed };
  if (out.placement === null && manifest.placement !== null) {
    out.placement = manifest.placement;
    out.placementSource = "manifest";
  }
  if (out.originDigest === undefined && manifest.originDigest !== undefined) {
    out.originDigest = manifest.originDigest;
    out.originSource = "manifest";
  }
  return out;
}

// ---------------------------------------------------------------------------
// Frame (spec 7.2): the shipped object. Advisory manifest plus the unchanged proof.
// ---------------------------------------------------------------------------

export interface FuseFrame {
  type: typeof FUSE_PROFILE;
  manifest: {
    /** Empty string when the placement is left undeclared. */
    placement: string;
    origin?: { algorithm: "sha256"; digest: string };
    artifact: { algorithm: "sha256"; digest: string };
    fusedFile: string | null;
  };
  fusePayload?: FusePayload;
  proof: BitGraphProof;
}

export function buildFrame(input: {
  proof: BitGraphProof;
  placement: PlacementId;
  artifactDigest: Uint8Array;
  originDigest?: Uint8Array;
  fusedFile: string | null;
  fusePayload?: Uint8Array;
}): FuseFrame {
  const frame: FuseFrame = {
    type: FUSE_PROFILE,
    manifest: {
      placement: input.placement,
      ...(input.originDigest !== undefined ? { origin: { algorithm: "sha256", digest: bytesToHex(input.originDigest) } } : {}),
      artifact: { algorithm: "sha256", digest: bytesToHex(input.artifactDigest) },
      fusedFile: input.fusedFile,
    },
    proof: input.proof,
  };
  if (input.fusePayload !== undefined) {
    const parsed = parseFusePayload(input.fusePayload);
    if (parsed === null) throw new TypeError("fusePayload is not a canonical bitgraph-fuse/1 payload");
    frame.fusePayload = JSON.parse(new TextDecoder().decode(input.fusePayload)) as FusePayload;
  }
  return frame;
}

/**
 * Structural read of a Frame. The manifest is advisory: nothing here is
 * trusted beyond its shape, and the nested proof is returned exactly as
 * found for the ordinary verifier. Null when this is not a Frame.
 */
export function parseFrame(input: unknown): FuseFrame | null {
  const obj = typeof input === "string" ? (() => { try { return JSON.parse(input) as unknown; } catch { return null; } })() : input;
  if (!isPlainObject(obj) || obj["type"] !== FUSE_PROFILE) return null;
  const m = obj["manifest"];
  if (!isPlainObject(m)) return null;
  if (m["placement"] !== undefined && typeof m["placement"] !== "string") return null;
  const artifact = readDigestField(m["artifact"]);
  if (artifact === null) return null;
  if (m["origin"] !== undefined && readDigestField(m["origin"]) === null) return null;
  if (m["fusedFile"] !== null && typeof m["fusedFile"] !== "string") return null;
  const proof = obj["proof"];
  if (!isPlainObject(proof) || proof["version"] !== "bitgraph/1") return null;
  const frame: FuseFrame = {
    type: FUSE_PROFILE,
    manifest: {
      placement: typeof m["placement"] === "string" ? m["placement"] : "",
      ...(m["origin"] !== undefined ? { origin: m["origin"] as { algorithm: "sha256"; digest: string } } : {}),
      artifact: m["artifact"] as { algorithm: "sha256"; digest: string },
      fusedFile: m["fusedFile"] as string | null,
    },
    proof: proof as unknown as BitGraphProof,
  };
  if (obj["fusePayload"] !== undefined) {
    if (!isPlainObject(obj["fusePayload"])) return null;
    frame.fusePayload = obj["fusePayload"] as unknown as FusePayload;
  }
  return frame;
}

/** Marker from a Frame's advisory manifest (unsigned; made self-proving only by reconstruction). */
export function readFrameMarker(frame: FuseFrame): FuseMarker {
  const declared = frame.manifest.placement.length > 0;
  const marker: FuseMarker = { placement: declared ? frame.manifest.placement : null, placementSource: declared ? "manifest" : null, source: "manifest" };
  if (frame.manifest.origin !== undefined) {
    const d = hexToBytes(frame.manifest.origin.digest);
    if (d !== null && d.length === 32) {
      marker.originDigest = d;
      marker.originSource = "manifest";
    }
  }
  return marker;
}
