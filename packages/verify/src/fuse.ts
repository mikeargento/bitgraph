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

/** The signed attribution name that marks a fused proof (spec 6.5). */
export const FUSE_ATTRIBUTION_NAME = "BitGraph Fuse" as const;

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
// Minimal deterministic ustar (POSIX.1-1988) for container/1
// ---------------------------------------------------------------------------

const BLOCK = 512;
const MAX_ENTRY = 0o77777777777; // 8 GiB - 1, the 11-digit octal size field

function octal(n: number, width: number): Uint8Array {
  const s = n.toString(8).padStart(width - 1, "0") + "\0";
  if (s.length !== width) throw new RangeError("field overflow");
  return utf8(s);
}

function ustarHeader(name: string, size: number): Uint8Array {
  if (size > MAX_ENTRY) throw new RangeError("container/1 entries are limited to 8 GiB");
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

export type PlacementId = "trailer/1" | "container/1" | "produced/1";

export interface Located {
  /** The commitment found in the fused bytes. */
  commitment: Uint8Array;
  /** The origin digest written into the fused bytes, when the placement writes one. */
  originDigest?: Uint8Array;
  /** The original's bytes as carried inside the fused bytes, for placements that carry them. */
  originalBytes?: Uint8Array;
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
export const PLACEMENTS: readonly Placement[] = Object.freeze([trailer1, container1, produced1]);

export function getPlacement(id: string): Placement | undefined {
  return PLACEMENTS.find((p) => p.id === id);
}

// ---------------------------------------------------------------------------
// Attribution (the signed carrier of placement and origin, spec 6.5)
// ---------------------------------------------------------------------------

/** attribution.name = "BitGraph Fuse", title = placement id, message = origin digest in standard base64. */
export function fuseAttribution(placement: PlacementId, originDigest?: Uint8Array): Attribution {
  if (originDigest !== undefined && originDigest.length !== 32) throw new TypeError("originDigest must be 32 bytes");
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
