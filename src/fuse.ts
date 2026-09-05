// Copyright (c) Mike Argento. All rights reserved. See LICENSE.

/**
 * fuse(builder, options): the producer interface of the bitgraph-fuse/1
 * profile (working name; outwardly this is simply BitGraph).
 *
 * The four beats, in order, with nothing else in between:
 *   1. nonce:  allocate a slot; the enclave signs a record that contains no
 *              artifact data and hands back a nonce that is a bearer ticket
 *              until it is consumed.
 *   2. fuse:   hand the COMMITMENT to that record (never the raw nonce) to the
 *              builder, which writes it into the artifact it is producing and
 *              returns the finished bytes.
 *   3. hash:   SHA-256 of the fused bytes.
 *   4. fill:   commit that digest under the same slot, with the placement id
 *              and the origin digest in the signed attribution.
 *
 * fuseSet(members, options): the same four beats for N files under ONE slot.
 * The commitment is computed once and written into every member by that
 * member's own placement; the committed artifact is the canonical set
 * manifest (placement set/1, built by the verify package); the signed title
 * is "set/1" with no origin, because a set has no single origin; the parsed
 * manifest rides along as unsigned metadata. Nothing is committed unless
 * every member's bytes carry the commitment and embed its own origin, and no
 * proof is returned unless the manifest verifies FUSED_DIRECT and every
 * member SET_MEMBER_DIRECT against the explicit manifest bytes.
 *
 * What this module never does: write the nonce anywhere but process memory,
 * put it in a message, or fall back to an ordinary recording when the fused
 * commit fails. A failure is reported as a failure and the slot expires on
 * its own.
 *
 * Transport: the site's proxy routes by default (POST /api/fuse/allocate and
 * /api/fuse/commit, behind the anchor-first gate), configurable so a licensee
 * can point it at a parent directly.
 */

import { sha256 } from "@noble/hashes/sha256";
import {
  buildFrame,
  buildSetManifest,
  bytesEqual,
  bytesToBase64,
  bytesToHex,
  computeSlotCommitment,
  computeSlotRecordHash,
  fuseAttribution,
  getPlacement,
  parseSetManifest,
  readSetMetadata,
  SET_METADATA_KEY,
  TRAILER_LENGTH,
  TRAILER_MAGIC,
  verifyFuse,
  verifyFuseMember,
  base64ToBytes,
} from "@mikeargento/bitgraph-verify";
import type {
  BitGraphProof,
  FuseFrame,
  FuseMemberResult,
  FuseVerifyResult,
  Located,
  Placement,
  PlacementId,
  SetManifest,
  SetMember,
  SlotAllocation,
} from "@mikeargento/bitgraph-verify";

/**
 * SHA-256 over bytes: the platform's native hasher when one is present
 * (WebCrypto, in browsers and in Node), else the JavaScript library. The
 * native path runs about ten times faster over large files and both give
 * the same digest; a test pins that. A platform that refuses the input (a
 * shared or detached buffer) falls back to the library.
 */
export async function digest(bytes: Uint8Array): Promise<Uint8Array> {
  const subtle = (globalThis as { crypto?: { subtle?: { digest?: (alg: string, data: Uint8Array) => Promise<ArrayBuffer> } } }).crypto?.subtle;
  if (subtle !== undefined && typeof subtle.digest === "function") {
    try {
      return new Uint8Array(await subtle.digest("SHA-256", bytes));
    } catch {
      // fall through to the library
    }
  }
  return sha256(bytes);
}

export type { FuseFrame, PlacementId, SlotAllocation, BitGraphProof, SetManifest, FuseMemberResult, FuseVerifyResult } from "@mikeargento/bitgraph-verify";

/** What the builder receives. The raw nonce is deliberately absent. */
export interface BuilderInput {
  /** 32-byte commitment to the signed slot record. Write this into the artifact. */
  commitment: Uint8Array;
  commitmentHex: string;
  /** The origin digest, when the fused artifact names a source. */
  originDigest?: Uint8Array;
  /** The signed slot record, for producers that want to embed its fields. Contains the nonce: do not copy it into the artifact. */
  slot: SlotAllocation;
}

/** Produces the finished (fused) bytes from the commitment. */
export type FuseBuilder = (input: BuilderInput) => Uint8Array | Promise<Uint8Array>;

export interface FuseTransport {
  /** Origin of the commit surface. Default "https://bitgraph.ing". */
  baseUrl?: string;
  /** Default "/api/fuse/allocate". A parent-direct licensee uses "/allocate-slot". */
  allocatePath?: string;
  /** Default "/api/fuse/commit". A parent-direct licensee uses "/commit". */
  commitPath?: string;
  /** Default "/api/proofs/": the by-digest lookup used to recover a lost commit response. */
  lookupPath?: string;
  apiKey?: string;
  fetch?: typeof fetch;
  /** Per-request timeout. Default 30 s. */
  timeoutMs?: number;
  /** Lost-response recovery: how many by-digest reads to attempt, and the wait between them. */
  recoveryAttempts?: number;
  recoveryDelayMs?: number;
}

export interface FuseOptions {
  /** A registered placement id: "trailer/1", "container/1", or "produced/1". */
  placement: PlacementId;
  /** Forms A and B: the original bytes. Never modified. Absent for Form C. */
  original?: Uint8Array;
  /** Form C only: a source the produced artifact references, if any. */
  originDigest?: Uint8Array;
  /** Filename recorded in the Frame manifest (advisory). */
  fusedFile?: string | null;
  /** Return the fused bytes in the result. Default: true for placements that are not byte-exact, false otherwise. */
  keepFused?: boolean;
  /** Actor-bound commits: an agency envelope passed through untouched. */
  agency?: unknown;
  transport?: FuseTransport;
}

export interface FuseResult {
  frame: FuseFrame;
  proof: BitGraphProof;
  artifactDigestB64: string;
  originDigestB64: string | null;
  /** Present when keepFused is true (or defaulted to true). */
  fusedBytes?: Uint8Array;
  /** True when the commit response was lost and the proof was read back by digest. */
  recovered: boolean;
  /** The local verification of the returned proof against the fused bytes. Always FUSED_DIRECT on success. */
  verification: FuseVerifyResult;
}

export type FuseErrorCode =
  | "bad-placement"
  | "bad-input"
  | "allocate-failed"
  | "builder-failed"
  | "load-failed"
  | "commitment-missing"
  | "commit-refused"
  | "slot-unavailable"
  | "tee-restarting"
  | "network"
  | "slot-mismatch"
  | "verification-failed"
  | "transport";

export class FuseError extends Error {
  readonly code: FuseErrorCode;
  readonly status: number | null;
  /** The caller's 0-based index into a set's members when the failure is one member's; null otherwise. fuse() never sets it. */
  readonly member: number | null;
  constructor(code: FuseErrorCode, message: string, status: number | null = null, member: number | null = null) {
    super(message);
    this.name = "FuseError";
    this.code = code;
    this.status = status;
    this.member = member;
  }
}

/** A builder for a registered placement over an existing original (Forms A and B), or for a bare Form C payload. */
/**
 * Which registered placement a file takes, decided from its bytes, never
 * its name. `trailer/1` appends 48 bytes after the file's own end, which is
 * safe only where decoders stop at an end marker or read by declared sizes:
 * JPEG (EOI), PNG (IEND), GIF (0x3B), TIFF and the TIFF-based raws such as
 * DNG, CR2, NEF, ARW (offset tables), BMP and RIFF containers such as WebP,
 * WAV, AVI (declared sizes). Everything else goes into `container/2`, a tar
 * that carries the original untouched and FIRST, so a scanner can hash it
 * once and finish the fused digest later: PDF, ZIP-based documents, ISO base
 * media video and images, Matroska, MP3, structured and plain text, and any
 * format not recognised here. Artifacts made under `container/1` (the
 * manifest first) stay readable; nothing new is made under it.
 */
export function placementForBytes(bytes: Uint8Array): "trailer/1" | "container/2" {
  const at = (sig: number[], offset = 0): boolean => bytes.length >= offset + sig.length && sig.every((v, i) => bytes[offset + i] === v);
  const trailerSafe =
    at([0xff, 0xd8, 0xff]) || // JPEG
    at([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]) || // PNG
    at([0x47, 0x49, 0x46, 0x38]) || // GIF87a / GIF89a
    at([0x49, 0x49, 0x2a, 0x00]) || at([0x4d, 0x4d, 0x00, 0x2a]) || // TIFF, DNG, CR2, NEF, ARW
    (at([0x42, 0x4d]) && bytes.length >= 14) || // BMP
    (at([0x52, 0x49, 0x46, 0x46]) && bytes.length >= 12); // RIFF: WebP, WAV, AVI
  return trailerSafe ? "trailer/1" : "container/2";
}

/** Names for a fused artifact and its Frame, from the original's name. */
export function fusedNamesFor(originalName: string, placement: PlacementId): { fusedName: string; frameName: string } {
  const dot = originalName.lastIndexOf(".");
  const stem = dot > 0 ? originalName.slice(0, dot) : originalName;
  const ext = dot > 0 ? originalName.slice(dot) : "";
  return {
    fusedName: placement === "trailer/1" ? `${stem}.fused${ext}` : placement.startsWith("container/") ? `${stem}.fused.tar` : `${stem}.produced.json`,
    frameName: `${originalName}.bitgraph-fuse.json`,
  };
}

export function builderFor(placement: PlacementId, original?: Uint8Array): FuseBuilder {
  const p = getPlacement(placement);
  if (p === undefined) throw new FuseError("bad-placement", `placement "${placement}" is not registered`);
  return ({ commitment, originDigest }) => {
    if (original !== undefined) return p.build({ original, originDigest: originDigest ?? sha256(original), commitment });
    return p.build(originDigest !== undefined ? { originDigest, commitment } : { commitment });
  };
}

const DEFAULTS = {
  baseUrl: "https://bitgraph.ing",
  allocatePath: "/api/fuse/allocate",
  commitPath: "/api/fuse/commit",
  lookupPath: "/api/proofs/",
  timeoutMs: 30_000,
  recoveryAttempts: 5,
  recoveryDelayMs: 1_500,
} as const;

/** A transport with every default filled in: what the beats below take. */
type BoundTransport = Required<Pick<FuseTransport, keyof typeof DEFAULTS>> & FuseTransport;

const B64_32 = /^[A-Za-z0-9+/]{43}=$/;
const B64_64 = /^[A-Za-z0-9+/]{86}==$/;

function isSlotRecord(x: unknown): x is SlotAllocation {
  if (x === null || typeof x !== "object" || Array.isArray(x)) return false;
  const s = x as Record<string, unknown>;
  return (
    s.version === "bitgraph/slot/1" &&
    typeof s.nonceB64 === "string" && B64_32.test(s.nonceB64) &&
    typeof s.counter === "string" && /^(0|[1-9][0-9]*)$/.test(s.counter) &&
    typeof s.epochId === "string" && typeof s.publicKeyB64 === "string" &&
    typeof s.signatureB64 === "string" && B64_64.test(s.signatureB64)
  );
}

function toUrlSafe(b64: string): string {
  return b64.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function request(
  t: Required<Pick<FuseTransport, "baseUrl" | "timeoutMs">> & FuseTransport,
  path: string,
  init: { method: "GET" | "POST"; body?: unknown },
): Promise<{ status: number; json: unknown; headers: Headers }> {
  const f = t.fetch ?? fetch;
  const headers: Record<string, string> = {};
  if (init.body !== undefined) headers["Content-Type"] = "application/json";
  if (t.apiKey) headers["Authorization"] = `Bearer ${t.apiKey}`;
  let res: Response;
  try {
    res = await f(`${t.baseUrl}${path}`, {
      method: init.method,
      headers,
      ...(init.body !== undefined ? { body: JSON.stringify(init.body) } : {}),
      signal: AbortSignal.timeout(t.timeoutMs),
    });
  } catch (err) {
    throw new FuseError("network", `request failed: ${err instanceof Error ? err.message : String(err)}`);
  }
  const text = await res.text();
  let json: unknown = null;
  try { json = text.length > 0 ? JSON.parse(text) : null; } catch { json = text; }
  return { status: res.status, json, headers: res.headers };
}

function messageOf(json: unknown, fallback: string): string {
  return json !== null && typeof json === "object" && typeof (json as { error?: unknown }).error === "string" ? (json as { error: string }).error : fallback;
}

function codeOf(json: unknown): string | null {
  return json !== null && typeof json === "object" && typeof (json as { code?: unknown }).code === "string" ? (json as { code: string }).code : null;
}

/**
 * Read the proof back by digest after a lost or refused commit: the ONE proof
 * whose commit.slotHashB64 is the hash of the slot record we hold. Any other
 * proof of the same digest is a different recording under a different slot.
 * Never allocates.
 */
async function recover(
  t: Required<Pick<FuseTransport, "baseUrl" | "timeoutMs" | "recoveryAttempts" | "recoveryDelayMs" | "lookupPath">> & FuseTransport,
  artifactDigestB64: string,
  slot: SlotAllocation,
): Promise<BitGraphProof | null> {
  const expectedSlotHash = bytesToBase64(computeSlotRecordHash(slot));
  for (let attempt = 0; attempt < t.recoveryAttempts; attempt++) {
    if (attempt > 0) await sleep(t.recoveryDelayMs);
    let r: { status: number; json: unknown };
    try {
      r = await request(t, `${t.lookupPath}${encodeURIComponent(toUrlSafe(artifactDigestB64))}`, { method: "GET" });
    } catch {
      continue;
    }
    if (r.status !== 200) continue;
    const proofs = (r.json as { proofs?: Array<{ proof?: BitGraphProof }> } | null)?.proofs;
    if (!Array.isArray(proofs)) continue;
    for (const entry of proofs) {
      const p = entry?.proof;
      if (p && p.commit?.slotHashB64 === expectedSlotHash && p.commit?.nonceB64 === slot.nonceB64) return p;
    }
  }
  return null;
}

/** 1. nonce. The signed slot record from the boundary; it must sit on the anchored chain. */
async function allocateSlot(t: BoundTransport): Promise<SlotAllocation> {
  const alloc = await request(t, t.allocatePath, { method: "POST", body: {} });
  if (alloc.status === 503 && codeOf(alloc.json) === "tee-restarting") throw new FuseError("tee-restarting", messageOf(alloc.json, "the boundary is restarting"), 503);
  if (alloc.status !== 200) throw new FuseError("allocate-failed", messageOf(alloc.json, `allocation failed (${alloc.status})`), alloc.status);
  const slotId = (alloc.json as { slotId?: unknown } | null)?.slotId;
  const slot = (alloc.json as { slot?: unknown } | null)?.slot;
  if (!isSlotRecord(slot) || slotId !== slot.nonceB64) throw new FuseError("allocate-failed", "the allocation response is not a slot record", alloc.status);
  if (slot.chainId !== "bitgraph:main") throw new FuseError("allocate-failed", "the slot is not on the anchored chain; a fused floor needs bitgraph:main");
  return slot;
}

/**
 * Fail closed: never commit bytes that do not carry the commitment. Returns
 * what the placement located, for any further check. `member` names the
 * set member the bytes belong to; null for a single fused artifact.
 */
function requireCommitment(placement: Placement, fused: Uint8Array, commitment: Uint8Array, member: number | null = null): Located {
  const located = placement.locate(fused);
  if (located === null || bytesToHex(located.commitment) !== bytesToHex(commitment)) {
    const label = member !== null ? `member ${member}: ` : "";
    throw new FuseError("commitment-missing", `${label}the fused bytes do not carry the ${placement.id} commitment; nothing was committed and the slot will expire`, null, member);
  }
  return located;
}

/**
 * 4. fill. Commit under the held slot; on a lost or refused response read
 * back by digest and match the slot record; never allocate again; refuse a
 * proof under any other slot.
 */
async function commitUnderSlot(t: BoundTransport, body: Record<string, unknown>, artifactDigestB64: string, slot: SlotAllocation): Promise<{ proof: BitGraphProof; recovered: boolean }> {
  let proof: BitGraphProof | null = null;
  let recovered = false;
  let commit: { status: number; json: unknown } | null = null;
  try {
    commit = await request(t, t.commitPath, { method: "POST", body });
  } catch (err) {
    // The request may have reached the boundary. Read back before giving up; never allocate again.
    proof = await recover(t, artifactDigestB64, slot);
    if (proof === null) throw err;
    recovered = true;
  }
  if (proof === null && commit !== null) {
    if (commit.status === 200) {
      const j = commit.json as { proof?: BitGraphProof } | BitGraphProof[] | null;
      proof = Array.isArray(j) ? (j[0] ?? null) : (j?.proof ?? null);
      if (proof === null) throw new FuseError("commit-refused", "the commit response carried no proof", 200);
    } else if (commit.status === 409 && codeOf(commit.json) === "slot-unavailable") {
      proof = await recover(t, artifactDigestB64, slot);
      if (proof === null) throw new FuseError("slot-unavailable", messageOf(commit.json, "the slot is no longer available"), 409);
      recovered = true;
    } else if (commit.status === 503 && codeOf(commit.json) === "tee-restarting") {
      proof = await recover(t, artifactDigestB64, slot);
      if (proof === null) throw new FuseError("tee-restarting", messageOf(commit.json, "the boundary is restarting"), 503);
      recovered = true;
    } else {
      throw new FuseError("commit-refused", messageOf(commit.json, `commit refused (${commit.status})`), commit.status);
    }
  }
  if (proof === null) throw new FuseError("transport", "no proof");

  // Never label as fused a proof under any other slot.
  if (proof.slotAllocation?.nonceB64 !== slot.nonceB64 || proof.commit?.nonceB64 !== slot.nonceB64) {
    throw new FuseError("slot-mismatch", "the boundary returned a proof under a different slot; nothing is labelled fused");
  }
  return { proof, recovered };
}

/**
 * Allocate, fuse, hash, fill. Returns the Frame with the unchanged proof, or
 * throws a FuseError; it never returns an ordinary recording in place of a
 * fused one.
 */
export async function fuse(builder: FuseBuilder, options: FuseOptions): Promise<FuseResult> {
  const placement = getPlacement(options.placement);
  if (placement === undefined) throw new FuseError("bad-placement", `placement "${options.placement}" is not registered`);
  if (placement.form !== "C" && options.original === undefined) throw new FuseError("bad-input", `${placement.id} needs the original bytes`);
  if (placement.form === "C" && options.original !== undefined) throw new FuseError("bad-input", "produced/1 takes no original; pass originDigest to name a source");
  if (options.originDigest !== undefined && options.originDigest.length !== 32) throw new FuseError("bad-input", "originDigest must be 32 bytes");

  const t: BoundTransport = { ...DEFAULTS, ...(options.transport ?? {}) };
  const originDigest = options.original !== undefined ? await digest(options.original) : options.originDigest;
  const originDigestB64 = originDigest !== undefined ? bytesToBase64(originDigest) : null;

  // 1. nonce
  const slot = await allocateSlot(t);

  // 2. fuse
  const commitment = computeSlotCommitment(slot);
  let fused: Uint8Array;
  try {
    fused = await builder({ commitment, commitmentHex: bytesToHex(commitment), ...(originDigest !== undefined ? { originDigest } : {}), slot });
  } catch (err) {
    throw new FuseError("builder-failed", `the builder threw: ${err instanceof Error ? err.message : String(err)}`);
  }
  if (!(fused instanceof Uint8Array)) throw new FuseError("builder-failed", "the builder must return a Uint8Array");
  requireCommitment(placement, fused, commitment);

  // 3. hash
  const artifactDigest = await digest(fused);
  const artifactDigestB64 = bytesToBase64(artifactDigest);

  // 4. fill
  const attribution = fuseAttribution(placement.id, originDigest);
  const body: Record<string, unknown> = {
    digests: [{ digestB64: artifactDigestB64, hashAlg: "sha256" }],
    slotId: slot.nonceB64,
    slot,
    chainId: "bitgraph:main",
    attribution,
  };
  if (options.agency !== undefined) body.agency = options.agency;
  const { proof, recovered } = await commitUnderSlot(t, body, artifactDigestB64, slot);

  // A minted proof is verified by a reader before it is called a proof.
  const verification = await verifyFuse({ proof, bytes: fused });
  if (verification.category !== "FUSED_DIRECT") {
    throw new FuseError("verification-failed", `the returned proof does not verify as fused: ${verification.category}${verification.reason ? ` (${verification.reason})` : ""}`);
  }

  const frame = buildFrame({
    proof,
    placement: placement.id,
    artifactDigest,
    ...(originDigest !== undefined ? { originDigest } : {}),
    fusedFile: options.fusedFile ?? null,
    ...(placement.form === "C" ? { fusePayload: fused } : {}),
  });
  const keep = options.keepFused ?? !placement.byteExact;
  return {
    frame,
    proof,
    artifactDigestB64,
    originDigestB64,
    ...(keep ? { fusedBytes: fused } : {}),
    recovered,
    verification,
  };
}

// ---------------------------------------------------------------------------
// Sets: N files fused under ONE slot
// ---------------------------------------------------------------------------

/**
 * The most members one set takes. Measured: one canonical row is 246 bytes
 * (container/1, the longest id this phase), so 2000 rows is 492,174 bytes.
 * The parent refuses raw bodies over 1 MB (server.ts:249), which would land
 * AFTER allocation and burn the slot. Half the cap is left for the slot
 * record, an agency envelope, and future longer placement ids. 4000 rows
 * (984 KB) leaves 63 KB and is refused; 10000 rows (2.4 MB) cannot pass at
 * all. A test pins the budget.
 */
export const MAX_SET_MEMBERS = 2000;

/** The placements a set member takes: Forms A and B, one original per member. */
export type SetMemberPlacement = "trailer/1" | "container/1" | "container/2";

/** What a hashed member's fused digest is computed for: the held slot and its commitment. */
export interface FusedDigestInput {
  commitment: Uint8Array;
  commitmentHex: string;
  slot: SlotAllocation;
}

/**
 * A member given as bytes. The core hashes the original, builds the fused
 * bytes under the slot's commitment, checks them, and hashes them.
 */
export interface FuseSetBytesMember {
  /** The original bytes. Never modified. */
  original: Uint8Array;
  /** Default: placementForBytes(original). */
  placement?: SetMemberPlacement;
  /** Advisory; feeds fusedNamesFor. */
  name?: string;
  /** Default: builderFor(placement, original). The locate and origin guards run regardless. */
  builder?: FuseBuilder;
}

/**
 * A member whose bytes are read only when it is that member's turn, after
 * the slot is held, and released once hashed: one member's bytes in memory
 * at a time, however large the set. Nothing can be read before allocation
 * without reading twice, so the caller names the placement and the origin
 * digest up front; the digest is checked against the loaded bytes, and the
 * byte guards run as for a bytes member.
 */
export interface FuseSetLoadedMember {
  load: () => Promise<Uint8Array> | Uint8Array;
  originDigest: Uint8Array;
  placement: SetMemberPlacement;
  /** Advisory; feeds fusedNamesFor. */
  name?: string;
  /** Default: builderFor(placement, bytes). The locate and origin guards run regardless. */
  builder?: FuseBuilder;
}

/**
 * A member the caller hashes itself: it answers the fused digest for the
 * held slot's commitment. For trailer/1 that is a hash state saved after
 * the original and finished with trailerBytesFor(commitment), so the bytes
 * are read once, when they are scanned, and never again. The core never
 * sees this member's bytes: no byte guard runs, keepFused returns nothing
 * for it, and verifyMembers refuses it before any request. Its row is bound
 * to the committed manifest by digest like every other.
 */
export interface FuseSetHashedMember {
  originDigest: Uint8Array;
  placement: SetMemberPlacement;
  fusedDigest: (input: FusedDigestInput) => Promise<Uint8Array> | Uint8Array;
  /** Advisory; feeds fusedNamesFor. */
  name?: string;
}

export type FuseSetMember = FuseSetBytesMember | FuseSetLoadedMember | FuseSetHashedMember;

/**
 * The 48 bytes trailer/1 appends after the original: the magic, eight
 * reserved zero bytes, the commitment. A hasher whose state was saved after
 * the original finishes with these and holds the member's fused digest
 * without reading the original again. A test pins them against the
 * placement's own build.
 */
export function trailerBytesFor(commitment: Uint8Array): Uint8Array {
  if (!(commitment instanceof Uint8Array) || commitment.length !== 32) throw new FuseError("bad-input", "a slot commitment is 32 bytes");
  const out = new Uint8Array(TRAILER_LENGTH);
  out.set(new TextEncoder().encode(TRAILER_MAGIC), 0);
  out.set(commitment, TRAILER_LENGTH - 32);
  return out;
}

export interface FuseSetProgress {
  /**
   * "hash": each member checked before any request (a bytes member's origin digest is taken here).
   * "fuse": each member's fused digest taken, after the slot is held.
   * "commit": 0 of 1 before the request, 1 of 1 when the proof is back.
   * "verify": only with verifyMembers, one per member.
   */
  phase: "hash" | "fuse" | "commit" | "verify";
  done: number;
  total: number;
}

export interface FuseSetOptions {
  /** Return each member's fused bytes. Default false: they are virtual, rebuilt from the original and the proof. A hashed member has none to return. */
  keepFused?: boolean;
  /**
   * Run the full verifier (verifyFuseMember) over every member's fused bytes
   * after the commit and return each verdict under `verification`. Default
   * false: every member is bound to the returned proof by digest, its row in
   * the committed manifest, which is itself verified FUSED_DIRECT; that is
   * linear and reads no bytes. The full pass re-hashes every member with the
   * verifier's own hasher and grows with the square of the member count. A
   * set with a hashed member refuses it before any request.
   */
  verifyMembers?: boolean;
  /** Called as the set advances. A throw inside it is ignored: a progress hook never changes the outcome. */
  onProgress?: (progress: FuseSetProgress) => void;
  /** Actor-bound commits: an agency envelope passed through untouched. */
  agency?: unknown;
  transport?: FuseTransport;
}

export interface FuseSetMemberResult {
  /** The caller's index into members. */
  index: number;
  /** The row's position in the sorted manifest; equals verification.set.member.index. */
  manifestIndex: number;
  placement: SetMemberPlacement;
  originDigestB64: string;
  /** SHA-256 of the member's fused bytes; the row's artifact. */
  artifactDigestB64: string;
  /** fusedNamesFor(name, placement); null when the member has no name. */
  fusedName: string | null;
  /** Advisory; no Frame is written for a set member this phase. */
  frameName: string | null;
  /** Present only when keepFused is true and the member's bytes passed through the core (never for a hashed member). */
  fusedBytes?: Uint8Array;
  /** Present only with verifyMembers: the verifier's own verdict against this member's fused bytes. Always SET_MEMBER_DIRECT on success, with set.manifestSource "argument". */
  verification?: FuseMemberResult;
}

export interface FuseSetResult {
  proof: BitGraphProof;
  /** The committed artifact. Keep it beside the proof. */
  manifestBytes: Uint8Array;
  /** JSON.parse of manifestBytes; the exact object sent under metadata. */
  manifest: SetManifest;
  /** SHA-256 of manifestBytes; equals proof.artifact.digestB64. */
  artifactDigestB64: string;
  slotCommitmentB64: string;
  /** In the caller's order. */
  members: FuseSetMemberResult[];
  /** True when the commit response was lost and the proof was read back by the manifest digest. */
  recovered: boolean;
  /** True only when readSetMetadata(proof) is byte-equal to manifestBytes. */
  manifestEchoed: boolean;
  /** verifyFuse over manifestBytes. Always FUSED_DIRECT under "set/1" on success. */
  verification: FuseVerifyResult;
}

/**
 * Allocate once, fuse every member with the one commitment, hash the set
 * manifest, fill the slot with it. Returns the proof with the manifest bytes
 * beside it, or throws a FuseError; it never commits a partial set and never
 * allocates a second slot. Members may be given as bytes, as a loader read
 * one at a time after the slot is held, or as a digest the caller finishes
 * itself; one set may mix them.
 */
export async function fuseSet(members: readonly FuseSetMember[], options: FuseSetOptions = {}): Promise<FuseSetResult> {
  // 0. validate, before any request. A refusal here burns nothing.
  if (!Array.isArray(members) || members.length === 0) throw new FuseError("bad-input", "a set lists at least one member");
  if (members.length > MAX_SET_MEMBERS) throw new FuseError("bad-input", `a set lists at most ${MAX_SET_MEMBERS} members (got ${members.length})`);
  const keep = options.keepFused === true;
  const verifyMembers = options.verifyMembers === true;
  type Kind = "bytes" | "loaded" | "hashed";
  interface Checked {
    kind: Kind;
    placement: Placement;
    id: SetMemberPlacement;
    originDigest: Uint8Array;
    name: string | null;
    original: Uint8Array | null;
    load: (() => Promise<Uint8Array> | Uint8Array) | null;
    builder: FuseBuilder | null;
    fusedDigest: ((input: FusedDigestInput) => Promise<Uint8Array> | Uint8Array) | null;
  }
  const checked: Checked[] = [];
  const seen = new Map<string, number>();
  const report = (phase: FuseSetProgress["phase"], done: number, total: number) => {
    if (options.onProgress === undefined) return;
    try {
      options.onProgress({ phase, done, total });
    } catch {
      // a progress hook never changes the outcome
    }
  };
  const bad = (i: number, message: string) => new FuseError("bad-input", `member ${i}: ${message}`, null, i);
  for (let i = 0; i < members.length; i++) {
    const m = members[i] as Partial<FuseSetBytesMember & FuseSetLoadedMember & FuseSetHashedMember> | null | undefined;
    // A null, undefined or missing element is refused like any other member without bytes, a loader or a digest.
    if (m === null || typeof m !== "object") throw bad(i, "original must be a Uint8Array, or load or fusedDigest a function");
    const kind: Kind | null = m.original instanceof Uint8Array ? "bytes" : typeof m.load === "function" ? "loaded" : typeof m.fusedDigest === "function" ? "hashed" : null;
    if (kind === null) throw bad(i, "original must be a Uint8Array, or load or fusedDigest a function");
    if (kind !== "bytes" && m.placement === undefined) throw bad(i, `a ${kind} member names its placement`);
    const id = m.placement ?? placementForBytes(m.original as Uint8Array);
    const placement = getPlacement(id);
    if (placement === undefined) throw new FuseError("bad-placement", `member ${i}: placement "${id}" is not registered`, null, i);
    if (placement.form === "C") throw bad(i, `${id} takes no original; a set holds trailer/1, container/1 and container/2 members only`);
    if (m.name !== undefined && typeof m.name !== "string") throw bad(i, "name must be a string");
    if (m.builder !== undefined && typeof m.builder !== "function") throw bad(i, "builder must be a function");
    if (kind !== "bytes" && !(m.originDigest instanceof Uint8Array && m.originDigest.length === 32)) throw bad(i, `a ${kind} member names its originDigest, 32 bytes`);
    if (kind === "hashed" && verifyMembers) throw bad(i, "a hashed member cannot be verified in full; pass its bytes or drop verifyMembers");
    const originDigest = kind === "bytes" ? await digest(m.original as Uint8Array) : (m.originDigest as Uint8Array);
    // The same original under the same placement fuses to the same bytes, which one manifest lists once.
    const key = `${id}:${bytesToHex(originDigest)}`;
    const j = seen.get(key);
    if (j !== undefined) {
      throw new FuseError("bad-input", `members ${j} and ${i} are the same original under the same placement (${id}) and would fuse to the same bytes; a set lists each fused artifact once`, null, i);
    }
    seen.set(key, i);
    checked.push({
      kind,
      placement,
      id,
      originDigest,
      name: m.name ?? null,
      original: kind === "bytes" ? (m.original as Uint8Array) : null,
      load: kind === "loaded" ? (m.load as Checked["load"]) : null,
      builder: kind !== "hashed" && m.builder !== undefined ? (m.builder as FuseBuilder) : null,
      fusedDigest: kind === "hashed" ? (m.fusedDigest as Checked["fusedDigest"]) : null,
    });
    report("hash", i + 1, members.length);
  }
  const t: BoundTransport = { ...DEFAULTS, ...(options.transport ?? {}) };

  // 1. nonce: one slot for the whole set
  const slot = await allocateSlot(t);

  // 2. fuse: the commitment once, every member's digest under it. The slot
  //    is held and its TTL is running; a throw here burns it but commits
  //    nothing. A member's fused bytes are virtual: each is built, hashed
  //    and released in turn, so memory holds one member's bytes at a time.
  //    They are held only for a caller who keeps them or asks the full
  //    verifier to read them.
  const commitment = computeSlotCommitment(slot);
  const commitmentHex = bytesToHex(commitment);
  const fusedBytes: (Uint8Array | null)[] = [];
  const rows: SetMember[] = [];
  const expiring = "nothing was committed and the slot will expire";
  for (let i = 0; i < checked.length; i++) {
    const c = checked[i]!;
    let artifact: Uint8Array;
    let held: Uint8Array | null = null;
    if (c.kind === "hashed") {
      let d: unknown;
      try {
        d = await c.fusedDigest!({ commitment, commitmentHex, slot });
      } catch (err) {
        throw new FuseError("builder-failed", `member ${i}: fusedDigest threw: ${err instanceof Error ? err.message : String(err)}; ${expiring}`, null, i);
      }
      if (!(d instanceof Uint8Array) || d.length !== 32) throw new FuseError("builder-failed", `member ${i}: fusedDigest must return a 32-byte digest; ${expiring}`, null, i);
      artifact = d;
    } else {
      let original: Uint8Array;
      if (c.kind === "loaded") {
        let loaded: unknown;
        try {
          loaded = await c.load!();
        } catch (err) {
          throw new FuseError("load-failed", `member ${i}: load threw: ${err instanceof Error ? err.message : String(err)}; ${expiring}`, null, i);
        }
        if (!(loaded instanceof Uint8Array)) throw new FuseError("load-failed", `member ${i}: load must return a Uint8Array; ${expiring}`, null, i);
        original = loaded;
        // The digest the caller named is the row's origin; it must be these bytes' own.
        if (!bytesEqual(await digest(original), c.originDigest)) throw new FuseError("bad-input", `member ${i}: originDigest is not the SHA-256 of the loaded bytes; ${expiring}`, null, i);
      } else {
        original = c.original!;
      }
      const builder = c.builder ?? builderFor(c.id, original);
      let fused: Uint8Array;
      try {
        fused = await builder({ commitment, commitmentHex, originDigest: c.originDigest, slot });
      } catch (err) {
        throw new FuseError("builder-failed", `member ${i}: the builder threw: ${err instanceof Error ? err.message : String(err)}`, null, i);
      }
      if (!(fused instanceof Uint8Array)) throw new FuseError("builder-failed", `member ${i}: the builder must return a Uint8Array`, null, i);
      const located = requireCommitment(c.placement, fused, commitment, i);
      // The row's origin must be the origin the bytes embed, else the member
      // would verify INVALID_ORIGIN_ATTRIBUTION after the slot is spent. Both
      // facts are checked when both are present: the digest the bytes declare
      // (container/1's payload) and the bytes they carry, compared byte for
      // byte with the member's original rather than hashed again, so a builder
      // cannot pack other bytes under the member's digest and leave a member no
      // original rebuilds.
      const declared = located.originDigest;
      const carried = located.originalBytes;
      if ((declared !== undefined && !bytesEqual(declared, c.originDigest)) || (carried !== undefined && !bytesEqual(carried, original))) {
        throw new FuseError("builder-failed", `member ${i}: the fused bytes embed an origin that is not the member's original; ${expiring}`, null, i);
      }
      artifact = await digest(fused);
      if (keep || verifyMembers) held = fused;
    }
    rows.push({ artifact, origin: c.originDigest, placement: c.id });
    fusedBytes.push(held);
    report("fuse", i + 1, checked.length);
  }

  // 3. hash: the canonical manifest is the artifact
  let manifestBytes: Uint8Array;
  try {
    manifestBytes = buildSetManifest(commitment, rows);
  } catch (err) {
    throw new FuseError("bad-input", `the set manifest could not be built: ${err instanceof Error ? err.message : String(err)}; ${expiring}`);
  }
  const artifactDigestB64 = bytesToBase64(await digest(manifestBytes));
  const manifest = JSON.parse(new TextDecoder().decode(manifestBytes)) as SetManifest;

  // 4. fill: one commit, the parsed manifest riding along as unsigned metadata
  const body: Record<string, unknown> = {
    digests: [{ digestB64: artifactDigestB64, hashAlg: "sha256" }],
    slotId: slot.nonceB64,
    slot,
    chainId: "bitgraph:main",
    attribution: fuseAttribution("set/1"),
    metadata: { [SET_METADATA_KEY]: manifest },
  };
  if (options.agency !== undefined) body.agency = options.agency;
  report("commit", 0, 1);
  const { proof, recovered } = await commitUnderSlot(t, body, artifactDigestB64, slot);
  report("commit", 1, 1);

  // The manifest is verified by a reader before the proof is called a set proof.
  const verification = await verifyFuse({ proof, bytes: manifestBytes });
  if (verification.category !== "FUSED_DIRECT" || verification.placement !== "set/1") {
    throw new FuseError("verification-failed", `the returned proof does not verify as a set: ${verification.category}${verification.reason ? ` (${verification.reason})` : ""}`);
  }
  // The echo is unsigned and advisory. Absent is normal for a boundary that
  // drops metadata on a held-slot commit (enclaves before v6, and a proxy
  // that does not forward it); differing means a boundary rewrote the
  // response.
  const echoed = readSetMetadata(proof);
  if (echoed !== null && !bytesEqual(echoed, manifestBytes)) {
    throw new FuseError("verification-failed", `the returned proof echoes a set manifest under metadata["${SET_METADATA_KEY}"] that differs from the committed one`);
  }
  const manifestEchoed = echoed !== null;
  // Every member is bound to the returned proof by its row: the manifest the
  // proof commits (verified FUSED_DIRECT above) is parsed strictly, and each
  // member's computed fused digest, origin and placement must sit in it. No
  // member's bytes are read again. With verifyMembers the full verifier runs
  // over each member's fused bytes as well, against the explicit manifest
  // bytes so no verdict depends on the echo, and its verdict is returned.
  const parsed = parseSetManifest(manifestBytes);
  if (parsed === null) throw new FuseError("verification-failed", "the committed manifest does not parse as a set manifest");
  const rowIndex = new Map<string, number>();
  parsed.members.forEach((row, k) => rowIndex.set(bytesToHex(row.artifact), k));
  const results: FuseSetMemberResult[] = [];
  for (let i = 0; i < checked.length; i++) {
    const c = checked[i]!;
    const row = rows[i]!;
    const k = rowIndex.get(bytesToHex(row.artifact));
    const listed = k !== undefined ? parsed.members[k] : undefined;
    if (k === undefined || listed === undefined || !bytesEqual(listed.origin, row.origin) || listed.placement !== row.placement) {
      throw new FuseError("verification-failed", `member ${i}: the committed manifest does not list this member's fused digest with its origin and placement`, null, i);
    }
    const memberArtifactB64 = bytesToBase64(row.artifact);
    let verification: FuseMemberResult | undefined;
    if (verifyMembers) {
      const v = await verifyFuseMember({ proof, bytes: fusedBytes[i]!, manifest: manifestBytes });
      const member = v.set?.member ?? null;
      if (v.category !== "SET_MEMBER_DIRECT" || member === null || member.fusedDigestB64 !== memberArtifactB64 || member.index !== k) {
        throw new FuseError("verification-failed", `member ${i}: the returned proof does not verify this member: ${v.category}${v.reason ? ` (${v.reason})` : ""}`, null, i);
      }
      verification = v;
      report("verify", i + 1, checked.length);
    }
    const names = c.name !== null ? fusedNamesFor(c.name, c.id) : null;
    const held = fusedBytes[i];
    results.push({
      index: i,
      manifestIndex: k,
      placement: c.id,
      originDigestB64: bytesToBase64(c.originDigest),
      artifactDigestB64: memberArtifactB64,
      fusedName: names?.fusedName ?? null,
      frameName: names?.frameName ?? null,
      ...(keep && held !== null ? { fusedBytes: held } : {}),
      ...(verification !== undefined ? { verification } : {}),
    });
  }
  return {
    proof,
    manifestBytes,
    manifest,
    artifactDigestB64,
    slotCommitmentB64: bytesToBase64(commitment),
    members: results,
    recovered,
    manifestEchoed,
    verification,
  };
}

/** Decode a standard-base64 digest, for callers holding one as text. */
export function digestFromBase64(b64: string): Uint8Array {
  const d = base64ToBytes(b64);
  if (d === null || d.length !== 32) throw new FuseError("bad-input", "not a 32-byte base64 digest");
  return d;
}
