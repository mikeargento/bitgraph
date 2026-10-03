// Copyright (c) Argento Computing Inc. All rights reserved. See LICENSE.

/**
 * fuseTree(members, options): the producer of every NEW BitGraph since
 * 2026-10-03 (tree/1). One position, one Merkle tree of 1 to N files; a
 * single file is a tree of one. Each file is a 65-byte leaf (placement code,
 * committed digest, origin digest); the committed artifact is the 84-byte
 * root document; the signed attribution is bitgraph-fuse/2 with title
 * "tree/1" and the spec's hash as its message. tree/1 needs the floor the
 * allocation returns (enclave v9 and later): without it nothing is made.
 * fuse() and fuseSet() below are superseded by it and kept so code that
 * imports them keeps working; what they made stays readable.
 *
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
  buildSetMemberProof,
  buildSetRoot,
  buildSetTree,
  parseSetRoot,
  SET2_PLACEMENT_ID,
  SET_PLACEMENT_ID as SET_PLACEMENT_ID_LOCAL,
  setRootFromMember,
  MAX_SET2_MEMBERS,
  bytesEqual,
  bytesToBase64,
  bytesToHex,
  computeSlotCommitment,
  producerCommitment,
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
  buildTree,
  buildTreeMemberEvidence,
  buildTreeRootDocument,
  currentTreeSpecHash,
  leafCodeOf,
  LEAF_AS_IS,
  MAX_TREE_LEAVES,
  readTreeMetadata,
  TREE_METADATA_KEY,
  treeAttribution,
  treeRootFromMember,
  verifyTreeMember,
} from "@mikeargento/bitgraph-verify";
import type { BitGraphProof, FuseFrame, FuseMemberResult, FuseVerifyResult, Located, MerkleTree, Placement, PlacementId, SetManifest, SetMember, SetMemberProof, SetRoot, SlotAllocation, TreeLeaf, TreeMemberEvidence, TreeVerifyResult } from "@mikeargento/bitgraph-verify";

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

/** The floor anchor an enclave v9 allocation hands back: the one it signs at commit as commit.slotAnchor. */
export interface AnchorMark {
  counter: string;
  blockNumber: number;
  blockHash: string;
}

/** What the builder receives. The raw nonce is deliberately absent. */
export interface BuilderInput {
  /** 32-byte commitment to the signed slot record (bitgraph-fuse/2 also binds the floor block). Write this into the artifact. */
  commitment: Uint8Array;
  commitmentHex: string;
  /** Which commitment this is: 2 when the boundary returned its floor anchor (enclave v9 and later), else 1. */
  fuseVersion: 1 | 2;
  /** The floor bound into a fuse/2 commitment, when there is one. */
  floor?: AnchorMark;
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
  | "transport"
  /** tree/1 only: the allocation returned no floor anchor (a boundary before enclave v9), so no tree/1 commitment can be made. */
  | "floor-missing";

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

function isAnchorMark(x: unknown): x is AnchorMark {
  if (x === null || typeof x !== "object" || Array.isArray(x)) return false;
  const a = x as Record<string, unknown>;
  return typeof a.counter === "string" && /^(0|[1-9][0-9]*)$/.test(a.counter)
    && typeof a.blockNumber === "number" && Number.isSafeInteger(a.blockNumber) && a.blockNumber >= 0
    && typeof a.blockHash === "string" && /^0x[0-9a-f]{64}$/.test(a.blockHash);
}

/**
 * 1. nonce. The signed slot record from the boundary; it must sit on the
 * anchored chain. Since enclave v9 the response also carries the floor anchor
 * the boundary will sign at commit; with it the producer makes a
 * bitgraph-fuse/2 commitment, without it a fuse/1 one.
 */
async function allocateSlot(t: BoundTransport): Promise<{ slot: SlotAllocation; anchor: AnchorMark | null }> {
  const alloc = await request(t, t.allocatePath, { method: "POST", body: {} });
  if (alloc.status === 503 && codeOf(alloc.json) === "tee-restarting") throw new FuseError("tee-restarting", messageOf(alloc.json, "the boundary is restarting"), 503);
  if (alloc.status !== 200) throw new FuseError("allocate-failed", messageOf(alloc.json, `allocation failed (${alloc.status})`), alloc.status);
  const slotId = (alloc.json as { slotId?: unknown } | null)?.slotId;
  const slot = (alloc.json as { slot?: unknown } | null)?.slot;
  if (!isSlotRecord(slot) || slotId !== slot.nonceB64) throw new FuseError("allocate-failed", "the allocation response is not a slot record", alloc.status);
  if (slot.chainId !== "bitgraph:main") throw new FuseError("allocate-failed", "the slot is not on the anchored chain; a fused floor needs bitgraph:main");
  const anchorRaw = (alloc.json as { anchor?: unknown } | null)?.anchor;
  return { slot, anchor: isAnchorMark(anchorRaw) ? anchorRaw : null };
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
    // A container is located only when its archive, the original inside it
    // (hashed against the origin it declares) and the commitment all hold.
    const what = placement.form === "B"
      ? `are not a valid ${placement.id} carrying this position's commitment: the archive, the original inside it or the commitment does not hold`
      : `do not carry the ${placement.id} commitment`;
    throw new FuseError("commitment-missing", `${label}the fused bytes ${what}; nothing was committed and the slot will expire`, null, member);
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
 *
 * Superseded by fuseTree (tree/1, 2026-10-03): a new BitGraph of one file is
 * a tree of one. Kept so code that imports it keeps working.
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
  const { slot, anchor } = await allocateSlot(t);

  // 2. fuse
  const { commitment, version } = producerCommitment(slot, anchor);
  let fused: Uint8Array;
  try {
    fused = await builder({ commitment, commitmentHex: bytesToHex(commitment), fuseVersion: version, ...(anchor !== null ? { floor: anchor } : {}), ...(originDigest !== undefined ? { originDigest } : {}), slot });
  } catch (err) {
    throw new FuseError("builder-failed", `the builder threw: ${err instanceof Error ? err.message : String(err)}`);
  }
  if (!(fused instanceof Uint8Array)) throw new FuseError("builder-failed", "the builder must return a Uint8Array");
  requireCommitment(placement, fused, commitment);

  // 3. hash
  const artifactDigest = await digest(fused);
  const artifactDigestB64 = bytesToBase64(artifactDigest);

  // 4. fill
  const attribution = fuseAttribution(placement.id, originDigest, version);
  const body: Record<string, unknown> = {
    digests: [{ digestB64: artifactDigestB64, hashAlg: "sha256" }],
    slotId: slot.nonceB64,
    slot,
    chainId: "bitgraph:main",
    attribution,
    // fuse/2: the boundary checks the bound floor against its ledger before spending the slot.
    ...(version === 2 ? { anchor } : {}),
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
  /** Which commitment this is: 2 when the boundary returned its floor anchor, else 1. */
  fuseVersion: 1 | 2;
  /** The floor bound into a fuse/2 commitment, when there is one. */
  floor?: AnchorMark;
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
   * "tree": set/2 only, 0 of 1 before the tree is built, 1 of 1 after.
   * "commit": 0 of 1 before the request, 1 of 1 when the proof is back.
   * "verify": only with verifyMembers, one per member.
   */
  phase: "hash" | "fuse" | "tree" | "commit" | "verify";
  done: number;
  total: number;
}

export interface FuseSetOptions {
  /**
   * "set/1" (default): the committed artifact is the canonical manifest of
   * every member, which rides in the commit and in the proof; at most
   * MAX_SET_MEMBERS. "set/2": the committed artifact is the root of a Merkle
   * tree over the same rows, a few hundred bytes whatever N is; each member
   * gets its leaf index and path (see FuseSetMemberResult.path), which a
   * reader needs beside the proof; at most MAX_SET2_MEMBERS.
   */
  set?: "set/1" | "set/2";
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
  /** set/2 only: the member's inclusion path, siblings from the leaf up; with manifestIndex and the set's count it is the member's evidence (memberProof). */
  path?: Uint8Array[];
  /** set/2 only: the member's evidence as its JSON object, ready to ride beside the proof or under proof.metadata[SET_MEMBER_METADATA_KEY]. */
  memberProof?: SetMemberProof;
}

export interface FuseSetResult {
  /** Which set kind was made. */
  set: "set/1" | "set/2";
  proof: BitGraphProof;
  /** The committed artifact: the set/1 manifest, or the set/2 root document. Keep it beside the proof. */
  manifestBytes: Uint8Array;
  /** JSON.parse of manifestBytes; the exact object sent under metadata. For set/2 a SetRoot. */
  manifest: SetManifest | SetRoot;
  /** set/2 only: the tree root, standard base64. */
  treeRootB64?: string;
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
 *
 * Superseded by fuseTree (tree/1, 2026-10-03): N files are one tree under one
 * position. Kept so code that imports it keeps working.
 */
export async function fuseSet(members: readonly FuseSetMember[], options: FuseSetOptions = {}): Promise<FuseSetResult> {
  // 0. validate, before any request. A refusal here burns nothing.
  if (!Array.isArray(members) || members.length === 0) throw new FuseError("bad-input", "a set lists at least one member");
  const setKind = options.set ?? "set/1";
  if (setKind !== "set/1" && setKind !== "set/2") throw new FuseError("bad-input", `set must be "set/1" or "set/2" (got ${String(setKind)})`);
  const cap = setKind === "set/1" ? MAX_SET_MEMBERS : MAX_SET2_MEMBERS;
  if (members.length > cap) throw new FuseError("bad-input", `a ${setKind} set lists at most ${cap} members (got ${members.length})`);
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
  const { slot, anchor } = await allocateSlot(t);

  // 2. fuse: the commitment once, every member's digest under it. The slot
  //    is held and its TTL is running; a throw here burns it but commits
  //    nothing. A member's fused bytes are virtual: each is built, hashed
  //    and released in turn, so memory holds one member's bytes at a time.
  //    They are held only for a caller who keeps them or asks the full
  //    verifier to read them.
  const { commitment, version } = producerCommitment(slot, anchor);
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
        d = await c.fusedDigest!({ commitment, commitmentHex, fuseVersion: version, ...(anchor !== null ? { floor: anchor } : {}), slot });
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
        fused = await builder({ commitment, commitmentHex, fuseVersion: version, ...(anchor !== null ? { floor: anchor } : {}), originDigest: c.originDigest, slot });
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

  // 3. hash: the committed artifact. set/1: the canonical manifest of every
  //    row. set/2: the root document over the Merkle tree of the same rows.
  let manifestBytes: Uint8Array;
  let tree: ReturnType<typeof buildSetTree> | null = null;
  try {
    if (setKind === "set/1") {
      manifestBytes = buildSetManifest(commitment, rows);
    } else {
      report("tree", 0, 1);
      tree = buildSetTree(rows);
      manifestBytes = buildSetRoot(commitment, tree.sorted.length, tree.root);
      report("tree", 1, 1);
    }
  } catch (err) {
    throw new FuseError("bad-input", `the set ${setKind === "set/1" ? "manifest" : "root document"} could not be built: ${err instanceof Error ? err.message : String(err)}; ${expiring}`);
  }
  const artifactDigestB64 = bytesToBase64(await digest(manifestBytes));
  const manifest = JSON.parse(new TextDecoder().decode(manifestBytes)) as SetManifest | SetRoot;

  // 4. fill: one commit, the parsed artifact riding along as unsigned metadata
  const body: Record<string, unknown> = {
    digests: [{ digestB64: artifactDigestB64, hashAlg: "sha256" }],
    slotId: slot.nonceB64,
    slot,
    chainId: "bitgraph:main",
    attribution: fuseAttribution(setKind === "set/1" ? SET_PLACEMENT_ID_LOCAL : SET2_PLACEMENT_ID, undefined, version),
    metadata: { [SET_METADATA_KEY]: manifest },
    ...(version === 2 ? { anchor } : {}),
  };
  if (options.agency !== undefined) body.agency = options.agency;
  report("commit", 0, 1);
  const { proof, recovered } = await commitUnderSlot(t, body, artifactDigestB64, slot);
  report("commit", 1, 1);

  // The committed artifact is verified by a reader before the proof is called a set proof.
  const verification = await verifyFuse({ proof, bytes: manifestBytes });
  if (verification.category !== "FUSED_DIRECT" || verification.placement !== setKind) {
    throw new FuseError("verification-failed", `the returned proof does not verify as a ${setKind} set: ${verification.category}${verification.reason ? ` (${verification.reason})` : ""}`);
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
  // set/1: the strictly parsed manifest lists each computed row. set/2: the
  // strictly parsed root document states the count and the root the tree
  // over these rows computed, and each member's path recomputes that root
  // (the verifier's own check, run here once per member).
  let listedRows: readonly SetMember[];
  if (setKind === "set/1") {
    const parsed = parseSetManifest(manifestBytes);
    if (parsed === null) throw new FuseError("verification-failed", "the committed manifest does not parse as a set manifest");
    listedRows = parsed.members;
  } else {
    const doc = parseSetRoot(manifestBytes);
    if (doc === null || tree === null) throw new FuseError("verification-failed", "the committed root document does not parse as a set root");
    if (doc.count !== tree.sorted.length || !bytesEqual(doc.root, tree.root)) throw new FuseError("verification-failed", "the committed root document does not state this tree's count and root");
    listedRows = tree.sorted;
  }
  const rowIndex = new Map<string, number>();
  listedRows.forEach((row, k) => rowIndex.set(bytesToHex(row.artifact), k));
  const results: FuseSetMemberResult[] = [];
  for (let i = 0; i < checked.length; i++) {
    const c = checked[i]!;
    const row = rows[i]!;
    const k = rowIndex.get(bytesToHex(row.artifact));
    const listed = k !== undefined ? listedRows[k] : undefined;
    if (k === undefined || listed === undefined || !bytesEqual(listed.origin, row.origin) || listed.placement !== row.placement) {
      throw new FuseError("verification-failed", `member ${i}: the committed ${setKind === "set/1" ? "manifest" : "tree"} does not list this member's fused digest with its origin and placement`, null, i);
    }
    let path: Uint8Array[] | undefined;
    let memberProof: SetMemberProof | undefined;
    if (tree !== null) {
      path = tree.tree.path(k);
      const reached = setRootFromMember(row, k, tree.sorted.length, path);
      if (reached === null || !bytesEqual(reached, tree.root)) throw new FuseError("verification-failed", `member ${i}: its path does not recompute the committed root`, null, i);
      memberProof = buildSetMemberProof(row, k, tree.sorted.length, path);
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
      ...(path !== undefined ? { path } : {}),
      ...(memberProof !== undefined ? { memberProof } : {}),
    });
  }
  return {
    set: setKind,
    proof,
    manifestBytes,
    manifest,
    ...(tree !== null ? { treeRootB64: bytesToBase64(tree.root) } : {}),
    artifactDigestB64,
    slotCommitmentB64: bytesToBase64(commitment),
    members: results,
    recovered,
    manifestEchoed,
    verification,
  };
}

// ---------------------------------------------------------------------------
// tree/1: every BitGraph is a Merkle tree under one position (2026-10-03)
// ---------------------------------------------------------------------------

/**
 * Files above this many bytes go into a tree as is (leaf code 0x00): the
 * file's own digest is its leaf, nothing is placed in it, and nothing bounds
 * it from below. At or below it, any verifier can rebuild a placed member's
 * committed bytes in memory from the original. The same 256 MiB at which the
 * site's drop box records rather than fuses (website/src/lib/fuse-placement.ts).
 */
export const MAX_FUSE_BYTES = 256 * 1024 * 1024;

/** How a file goes into a tree: as is (0x00), or placed into committed bytes that carry the commitment. */
export type TreeMemberPlacement = "as-is" | SetMemberPlacement;

/**
 * The placement a file takes in a tree, from its size and its first bytes
 * (every magic number placementForBytes reads sits in the first 16): as is
 * above maxFuseBytes, otherwise placementForBytes.
 */
export function treePlacementFor(size: number, head: Uint8Array, maxFuseBytes: number = MAX_FUSE_BYTES): TreeMemberPlacement {
  return size > maxFuseBytes ? "as-is" : placementForBytes(head);
}

/** A tree member given as bytes: hashed, placed (unless as is), checked and hashed again by the core. */
export interface FuseTreeBytesMember {
  original: Uint8Array;
  /** Default: treePlacementFor(original.length, original, options.maxFuseBytes). */
  placement?: TreeMemberPlacement;
  /** Unsigned and informational: the owner's export lists it beside the leaf. */
  name?: string;
  /** Placed members only. Default: the placement's own build. The locate and origin guards run regardless. */
  builder?: FuseBuilder;
}

/** A placed member read only when it is its turn, after the slot is held, and checked against its named digest. */
export interface FuseTreeLoadedMember {
  load: () => Promise<Uint8Array> | Uint8Array;
  originDigest: Uint8Array;
  placement: SetMemberPlacement;
  name?: string;
  builder?: FuseBuilder;
}

/**
 * A placed member whose committed digest the caller finishes itself for the
 * held commitment (a scanner's saved hash state finished with the placement's
 * suffix). The core never sees its bytes.
 */
export interface FuseTreeHashedMember {
  originDigest: Uint8Array;
  placement: SetMemberPlacement;
  fusedDigest: (input: FusedDigestInput) => Promise<Uint8Array> | Uint8Array;
  name?: string;
}

/** A file that goes in as is, given by its digest alone: nothing is read, placed or loaded. */
export interface FuseTreeAsIsMember {
  originDigest: Uint8Array;
  placement: "as-is";
  name?: string;
}

export type FuseTreeMember = FuseTreeBytesMember | FuseTreeLoadedMember | FuseTreeHashedMember | FuseTreeAsIsMember;

/** Progress, in fuseSet's phases: hash (before any request), fuse (each leaf, after the slot is held), tree, commit, verify (only with verifyMembers). */
export type FuseTreeProgress = FuseSetProgress;

export interface FuseTreeOptions {
  /** Above this many bytes a bytes member that names no placement goes in as is. Default MAX_FUSE_BYTES. */
  maxFuseBytes?: number;
  /** Return each member's committed bytes (for as is, the original itself) when they passed through the core. Default false: they are virtual, rebuilt from the original and the proof. */
  keepCommitted?: boolean;
  /**
   * Run verifyTreeMember over every member's committed bytes after the
   * commit and return each verdict. Default false: every member's leaf is
   * bound to the returned proof by its path to the verified root, which
   * reads no bytes. A hashed member, or an as-is member given by its digest,
   * has no bytes here and is refused before any request.
   */
  verifyMembers?: boolean;
  /** Called as the tree advances. A throw inside it is ignored: a progress hook never changes the outcome. */
  onProgress?: (progress: FuseTreeProgress) => void;
  /** Actor-bound commits: an agency envelope passed through untouched. */
  agency?: unknown;
  transport?: FuseTransport;
}

export interface FuseTreeMemberResult {
  /** The caller's index into members. */
  index: number;
  /** The member's leaf in the sorted tree: its evidence's index. */
  leafIndex: number;
  placement: TreeMemberPlacement;
  /** The leaf's placement code: 0x00 as is, 0x01 trailer/1, 0x02 container/1, 0x03 container/2. */
  code: number;
  originDigestB64: string;
  /** SHA-256 of the committed bytes: the leaf's artifact. For as is, the file's own digest. */
  artifactDigestB64: string;
  name: string | null;
  /** Present only with keepCommitted, for a member whose bytes passed through the core (never a hashed member, nor an as-is member given by its digest). */
  committedBytes?: Uint8Array;
  /** Present only with verifyMembers: the verifier's verdict on the committed bytes, TREE_MEMBER_DIRECT (TREE_MEMBER_AS_IS for as is) on success. */
  verification?: TreeVerifyResult;
}

export interface FuseTreeResult {
  proof: BitGraphProof;
  /** The committed artifact: the 84-byte root document. Its SHA-256 is the signed digest; every export carries it. */
  rootDocument: Uint8Array;
  /** SHA-256 of rootDocument, standard base64; equals proof.artifact.digestB64. */
  artifactDigestB64: string;
  count: number;
  /** The tree's root, lowercase hex. */
  rootHex: string;
  /** commitment/2, which every placed member's committed bytes carry. committedBytesFor(member.code, original, commitment) rebuilds them. */
  commitment: Uint8Array;
  /** The floor block the commitment binds, as the proof signs it (commit.slotAnchor). */
  floor: AnchorMark;
  /** The spec hash the signed attribution pins, standard base64. */
  specHashB64: string;
  /** Every leaf, in tree order (strictly ascending artifact digest). */
  leaves: TreeLeaf[];
  /** The tree over those leaves: tree.path(k) is leaf k's path. */
  tree: MerkleTree;
  /** In the caller's order. */
  members: FuseTreeMemberResult[];
  /** A member's evidence (TreeMemberEvidence JSON) by the caller's index, built on demand so a large tree holds no path it is not asked for. */
  memberEvidence: (index: number) => TreeMemberEvidence;
  /** True when the commit response was lost and the proof was read back by the root document's digest. */
  recovered: boolean;
  /** True only when the proof's metadata carries this root document. Absent is normal for a boundary that drops metadata; exports carry the document either way. */
  rootDocumentEchoed: boolean;
  /** verifyTreeMember over the proof and the root document: TREE_ROOT_VALID on success. */
  verification: TreeVerifyResult;
}

function compareDigests(a: Uint8Array, b: Uint8Array): number {
  for (let i = 0; i < a.length && i < b.length; i++) if (a[i] !== b[i]) return a[i]! - b[i]!;
  return a.length - b.length;
}

/** The index of the leaf with this artifact digest in a sorted list, or -1. */
function leafIndexOf(sorted: readonly TreeLeaf[], artifact: Uint8Array): number {
  let lo = 0;
  let hi = sorted.length - 1;
  while (lo <= hi) {
    const mid = (lo + hi) >>> 1;
    const c = compareDigests(sorted[mid]!.artifact, artifact);
    if (c === 0) return mid;
    if (c < 0) lo = mid + 1;
    else hi = mid - 1;
  }
  return -1;
}

/**
 * Make ONE tree/1 BitGraph of 1 to N files: allocate one slot, take its floor,
 * make every member's leaf under commitment/2, build the tree and its root
 * document, commit the document's digest under the same slot with the spec
 * pinned in the signed attribution, and verify what comes back before
 * returning it. Throws a FuseError otherwise; it never commits a partial
 * tree, never allocates a second slot, and never makes a tree without the
 * floor. Members may be bytes, a loader read after the slot is held, a digest
 * the caller finishes from a saved hash state, or (for as is) a digest alone;
 * one tree may mix them.
 */
export async function fuseTree(members: readonly FuseTreeMember[], options: FuseTreeOptions = {}): Promise<FuseTreeResult> {
  // 0. validate, before any request. A refusal here burns nothing.
  if (!Array.isArray(members) || members.length === 0) throw new FuseError("bad-input", "a tree lists at least one member");
  if (members.length > MAX_TREE_LEAVES) throw new FuseError("bad-input", `a tree lists at most ${MAX_TREE_LEAVES} members (got ${members.length})`);
  const maxFuseBytes = options.maxFuseBytes ?? MAX_FUSE_BYTES;
  if (typeof maxFuseBytes !== "number" || !Number.isFinite(maxFuseBytes) || maxFuseBytes < 0) throw new FuseError("bad-input", "maxFuseBytes must be a non-negative number");
  const keep = options.keepCommitted === true;
  const verifyMembers = options.verifyMembers === true;
  let specHash: Uint8Array;
  try {
    specHash = currentTreeSpecHash();
  } catch (err) {
    throw new FuseError("bad-input", `no tree/1 spec hash to pin: ${err instanceof Error ? err.message : String(err)}`);
  }
  type Kind = "bytes" | "loaded" | "hashed" | "as-is";
  interface Checked {
    kind: Kind;
    id: TreeMemberPlacement;
    code: number;
    /** The registered placement; null for as is. */
    placement: Placement | null;
    originDigest: Uint8Array;
    name: string | null;
    original: Uint8Array | null;
    load: (() => Promise<Uint8Array> | Uint8Array) | null;
    builder: FuseBuilder | null;
    fusedDigest: ((input: FusedDigestInput) => Promise<Uint8Array> | Uint8Array) | null;
  }
  const checked: Checked[] = [];
  const seen = new Map<string, number>();
  const report = (phase: FuseTreeProgress["phase"], done: number, total: number) => {
    if (options.onProgress === undefined) return;
    try {
      options.onProgress({ phase, done, total });
    } catch {
      // a progress hook never changes the outcome
    }
  };
  const bad = (i: number, message: string) => new FuseError("bad-input", `member ${i}: ${message}`, null, i);
  const shapes = 'original must be a Uint8Array, or load or fusedDigest a function, or placement "as-is" with an originDigest';
  interface Loose { original?: unknown; load?: unknown; fusedDigest?: unknown; placement?: unknown; originDigest?: unknown; name?: unknown; builder?: unknown }
  for (let i = 0; i < members.length; i++) {
    // A null, undefined or missing element is refused like any other member without bytes, a loader or a digest.
    const m = members[i] as Loose | null | undefined;
    if (m === null || m === undefined || typeof m !== "object") throw bad(i, shapes);
    const kind: Kind | null = m.original instanceof Uint8Array ? "bytes" : typeof m.load === "function" ? "loaded" : typeof m.fusedDigest === "function" ? "hashed" : m.placement === "as-is" ? "as-is" : null;
    if (kind === null) throw bad(i, shapes);
    if (kind !== "bytes" && m.placement === undefined) throw bad(i, `a ${kind} member names its placement`);
    if (m.placement !== undefined && typeof m.placement !== "string") throw bad(i, "placement must be a string");
    const original = kind === "bytes" ? (m.original as Uint8Array) : null;
    const id = m.placement !== undefined ? (m.placement as string) : treePlacementFor(original!.length, original!, maxFuseBytes);
    const code = leafCodeOf(id);
    if (code === null) {
      if (getPlacement(id) === undefined) throw new FuseError("bad-placement", `member ${i}: placement "${id}" is not registered`, null, i);
      throw bad(i, `${id} is not a tree placement; a tree holds as-is, trailer/1, container/1 and container/2 members`);
    }
    if ((kind === "loaded" || kind === "hashed") && code === LEAF_AS_IS) throw bad(i, `an as-is member is given by its bytes or its originDigest alone; a ${kind} member is placed`);
    if (m.name !== undefined && typeof m.name !== "string") throw bad(i, "name must be a string");
    if (m.builder !== undefined && typeof m.builder !== "function") throw bad(i, "builder must be a function");
    if (code === LEAF_AS_IS && m.builder !== undefined) throw bad(i, "an as-is member takes no builder: nothing is placed in it");
    if (kind !== "bytes" && !(m.originDigest instanceof Uint8Array && m.originDigest.length === 32)) throw bad(i, `${kind === "as-is" ? "an as-is" : `a ${kind}`} member names its originDigest, 32 bytes`);
    if (verifyMembers && (kind === "hashed" || kind === "as-is")) throw bad(i, `${kind === "as-is" ? "an as-is member given by its digest" : "a hashed member"} cannot be verified in full; pass its bytes or drop verifyMembers`);
    const originDigest = original !== null ? await digest(original) : (m.originDigest as Uint8Array);
    // The same original under the same placement makes the same leaf, which a tree lists once.
    const key = `${code}:${bytesToHex(originDigest)}`;
    const j = seen.get(key);
    if (j !== undefined) {
      throw new FuseError("bad-input", `members ${j} and ${i} are the same original under the same placement (${id}) and would make the same leaf; a tree lists each leaf once`, null, i);
    }
    seen.set(key, i);
    checked.push({
      kind,
      id: id as TreeMemberPlacement,
      code,
      placement: code === LEAF_AS_IS ? null : getPlacement(id)!,
      originDigest,
      name: typeof m.name === "string" ? m.name : null,
      original,
      load: kind === "loaded" ? (m.load as Checked["load"]) : null,
      builder: (kind === "bytes" || kind === "loaded") && m.builder !== undefined ? (m.builder as FuseBuilder) : null,
      fusedDigest: kind === "hashed" ? (m.fusedDigest as Checked["fusedDigest"]) : null,
    });
    report("hash", i + 1, members.length);
  }
  const t: BoundTransport = { ...DEFAULTS, ...(options.transport ?? {}) };

  // 1. nonce: one slot for the whole tree, and the floor it binds.
  const { slot, anchor } = await allocateSlot(t);
  if (anchor === null) {
    throw new FuseError("floor-missing", "the allocation returned no floor anchor, so no tree/1 commitment can be made (tree/1 binds the floor block: bitgraph-fuse/2, enclave v9 and later); nothing was committed and the position will expire");
  }
  const { commitment, version } = producerCommitment(slot, anchor);
  if (version !== 2) throw new FuseError("floor-missing", "the floor anchor could not be bound into the commitment; nothing was committed and the position will expire");
  const commitmentHex = bytesToHex(commitment);
  const expiring = "nothing was committed and the slot will expire";

  // 2. leaves: every member's under the one commitment. Committed bytes are
  //    virtual: each is built, checked, hashed and released in turn, held only
  //    for a caller who keeps them or asks the full verifier to read them.
  const leaves: TreeLeaf[] = [];
  const held: (Uint8Array | null)[] = [];
  for (let i = 0; i < checked.length; i++) {
    const c = checked[i]!;
    let artifact: Uint8Array;
    let bytes: Uint8Array | null = null;
    if (c.code === LEAF_AS_IS) {
      // As is: the file is its own committed bytes and its digest its artifact.
      artifact = c.originDigest;
      if (c.original !== null && (keep || verifyMembers)) bytes = c.original;
    } else if (c.kind === "hashed") {
      let d: unknown;
      try {
        d = await c.fusedDigest!({ commitment, commitmentHex, fuseVersion: version, floor: anchor, slot });
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
        if (!bytesEqual(await digest(original), c.originDigest)) throw new FuseError("bad-input", `member ${i}: originDigest is not the SHA-256 of the loaded bytes; ${expiring}`, null, i);
      } else {
        original = c.original!;
      }
      const builder = c.builder ?? builderFor(c.id as PlacementId, original);
      let committed: Uint8Array;
      try {
        committed = await builder({ commitment, commitmentHex, fuseVersion: version, floor: anchor, originDigest: c.originDigest, slot });
      } catch (err) {
        throw new FuseError("builder-failed", `member ${i}: the builder threw: ${err instanceof Error ? err.message : String(err)}; ${expiring}`, null, i);
      }
      if (!(committed instanceof Uint8Array)) throw new FuseError("builder-failed", `member ${i}: the builder must return a Uint8Array; ${expiring}`, null, i);
      const located = requireCommitment(c.placement!, committed, commitment, i);
      // The leaf's origin must be the origin the bytes embed (declared, and
      // carried byte for byte), else the member would verify INVALID_ORIGIN
      // after the slot is spent; the same two checks fuseSet runs.
      const declared = located.originDigest;
      const carried = located.originalBytes;
      if ((declared !== undefined && !bytesEqual(declared, c.originDigest)) || (carried !== undefined && !bytesEqual(carried, original))) {
        throw new FuseError("builder-failed", `member ${i}: the committed bytes embed an origin that is not the member's original; ${expiring}`, null, i);
      }
      artifact = await digest(committed);
      if (keep || verifyMembers) bytes = committed;
    }
    leaves.push({ placement: c.code, artifact, origin: c.originDigest });
    held.push(bytes);
    report("fuse", i + 1, checked.length);
  }

  // 3. hash: the tree, and the root document that is the committed artifact.
  report("tree", 0, 1);
  let built: ReturnType<typeof buildTree>;
  try {
    built = buildTree(leaves);
  } catch (err) {
    throw new FuseError("bad-input", `the tree could not be built: ${err instanceof Error ? err.message : String(err)}; ${expiring}`);
  }
  const count = built.sorted.length;
  const rootDocument = buildTreeRootDocument(commitment, count, built.root);
  report("tree", 1, 1);
  const artifactDigestB64 = bytesToBase64(await digest(rootDocument));
  const specHashB64 = bytesToBase64(specHash);

  // 4. fill: one commit; the root document rides as unsigned metadata, bound by its hash.
  const body: Record<string, unknown> = {
    digests: [{ digestB64: artifactDigestB64, hashAlg: "sha256" }],
    slotId: slot.nonceB64,
    slot,
    chainId: "bitgraph:main",
    attribution: treeAttribution(specHash),
    metadata: { [TREE_METADATA_KEY]: bytesToHex(rootDocument) },
    // fuse/2: the boundary checks the bound floor against its ledger before spending the slot.
    anchor,
  };
  if (options.agency !== undefined) body.agency = options.agency;
  report("commit", 0, 1);
  const { proof, recovered } = await commitUnderSlot(t, body, artifactDigestB64, slot);
  report("commit", 1, 1);

  // A reader verifies the proof before it is called a tree: the signature,
  // fuse/2 and a known spec, the commitment recomputed from the proof's own
  // slot record and signed floor, and this root document under the signed
  // digest. The explicit document is used, so no verdict rests on the echo.
  const verification = await verifyTreeMember({ proof, rootDocument });
  if (verification.category !== "TREE_ROOT_VALID") {
    throw new FuseError("verification-failed", `the returned proof does not verify as this tree: ${verification.category} (${verification.reason})`);
  }
  if (proof.attribution?.message !== specHashB64) {
    throw new FuseError("verification-failed", "the returned proof pins a different spec than the one sent");
  }
  // The echo is unsigned and advisory: absent is normal, different is a rewrite.
  let rootDocumentEchoed = false;
  if (proof.metadata?.[TREE_METADATA_KEY] !== undefined) {
    const echoed = readTreeMetadata(proof);
    if (echoed === null || !bytesEqual(echoed, rootDocument)) {
      throw new FuseError("verification-failed", `the returned proof echoes a root document under metadata["${TREE_METADATA_KEY}"] that differs from the committed one`);
    }
    rootDocumentEchoed = true;
  }
  const floor = proof.commit.slotAnchor!;

  // Every member is bound to the verified root by its own path (the
  // verifier's check, run here once per member); no member's bytes are read
  // again. With verifyMembers the full verifier reads the committed bytes too.
  const results: FuseTreeMemberResult[] = [];
  for (let i = 0; i < checked.length; i++) {
    const c = checked[i]!;
    const leaf = leaves[i]!;
    const k = leafIndexOf(built.sorted, leaf.artifact);
    const listed = k >= 0 ? built.sorted[k] : undefined;
    if (listed === undefined || listed.placement !== leaf.placement || !bytesEqual(listed.origin, leaf.origin)) {
      throw new FuseError("verification-failed", `member ${i}: the committed tree does not list this member's leaf`, null, i);
    }
    const path = built.tree.path(k);
    const reached = treeRootFromMember(listed, k, count, path);
    if (reached === null || !bytesEqual(reached, built.root)) throw new FuseError("verification-failed", `member ${i}: its path does not recompute the committed root`, null, i);
    let memberVerification: TreeVerifyResult | undefined;
    if (verifyMembers) {
      const want = c.code === LEAF_AS_IS ? "TREE_MEMBER_AS_IS" : "TREE_MEMBER_DIRECT";
      const v = await verifyTreeMember({ proof, rootDocument, member: buildTreeMemberEvidence(listed, k, count, path), bytes: held[i]!, proofAlreadyVerified: true });
      if (v.category !== want || v.member?.index !== k) {
        throw new FuseError("verification-failed", `member ${i}: the returned proof does not verify this member: ${v.category} (${v.reason})`, null, i);
      }
      memberVerification = v;
      report("verify", i + 1, checked.length);
    }
    const kept = held[i];
    results.push({
      index: i,
      leafIndex: k,
      placement: c.id,
      code: c.code,
      originDigestB64: bytesToBase64(c.originDigest),
      artifactDigestB64: bytesToBase64(leaf.artifact),
      name: c.name,
      ...(keep && kept !== null && kept !== undefined ? { committedBytes: kept } : {}),
      ...(memberVerification !== undefined ? { verification: memberVerification } : {}),
    });
  }
  const memberEvidence = (index: number): TreeMemberEvidence => {
    const r = results[index];
    if (r === undefined) throw new RangeError(`no member ${index}`);
    return buildTreeMemberEvidence(built.sorted[r.leafIndex]!, r.leafIndex, count, built.tree.path(r.leafIndex));
  };
  return {
    proof,
    rootDocument,
    artifactDigestB64,
    count,
    rootHex: bytesToHex(built.root),
    commitment,
    floor: { counter: floor.counter, blockNumber: floor.blockNumber, blockHash: floor.blockHash },
    specHashB64,
    leaves: built.sorted,
    tree: built.tree,
    members: results,
    memberEvidence,
    recovered,
    rootDocumentEchoed,
    verification,
  };
}

/** Decode a standard-base64 digest, for callers holding one as text. */
export function digestFromBase64(b64: string): Uint8Array {
  const d = base64ToBytes(b64);
  if (d === null || d.length !== 32) throw new FuseError("bad-input", "not a 32-byte base64 digest");
  return d;
}
