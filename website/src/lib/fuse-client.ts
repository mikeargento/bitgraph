/**
 * The public drop's Fuse pipeline, run entirely in the browser (profile
 * bitgraph-fuse/1). The visitor's file is the origin; it is never modified and
 * never uploaded. In memory, on the visitor's machine: hash the origin,
 * allocate an unused slot, derive the slot commitment, build the fused bytes
 * with the registered placement, hash them, and consume that exact slot with
 * the fused digest. The fused bytes are held only until the visitor leaves or
 * downloads them: the durable evidence is the original plus the signed proof,
 * which carries the placement id and the origin digest, and the same
 * registered placement rebuilds the exact fused bytes from those at any time.
 *
 * A multi-file drop makes ONE set (placement set/1): one slot, one commit,
 * every member's fused bytes carrying the shared commitment, and the canonical
 * manifest of member digests as the committed artifact. A member's fused bytes
 * are virtual: nothing here keeps them after the commit, and rebuildSetMember
 * is the one producer of them afterwards, from the original, the proof's slot
 * record and the row's placement.
 */
import { FuseError, MAX_SET_MEMBERS, builderFor, fuse, fuseSet, type FuseSetMember as CoreSetMember, type FuseSetProgress, type FuseTransport } from "@mikeargento/bitgraph";
import { finishState } from "./scan-hash";
export type { FuseSetProgress } from "@mikeargento/bitgraph";
import type { BitGraphProof, FuseFrame, FuseMemberResult, FuseVerifyResult, PlacementId, SetManifest } from "@mikeargento/bitgraph-verify";
import { SET_METADATA_KEY, base64ToBytes, buildFrame, bytesToBase64, computeSlotCommitment, getPlacement, readFuseAttribution, readSetMetadata, verifyFuse, verifyFuseMember } from "@mikeargento/bitgraph-verify";
import { MAX_FUSE_BYTES, fusedNames, placementFor, type SitePlacement } from "./fuse-placement";
import type { BitGraphProof as SiteProof } from "@/lib/bitgraph";

// The site keeps its own looser proof type (version: string); the verify
// package narrows it. Every cast between the two lives in this file.
const asVerify = (proof: SiteProof): BitGraphProof => proof as unknown as BitGraphProof;
const asSite = (proof: BitGraphProof): SiteProof => proof as unknown as SiteProof;

export interface FusedOutcome {
  placement: SitePlacement;
  originDigestB64: string;
  artifactDigestB64: string;
  /** The nested bitgraph/1 proof, exactly as the boundary returned it. */
  proof: SiteProof;
  frame: FuseFrame;
  frameName: string;
  fusedName: string;
  /** The exact fused bytes. Transient: in memory until downloaded or dropped. */
  fusedBytes: Uint8Array;
  recovered: boolean;
  verification: FuseVerifyResult;
}

/** True for the boundary's "come back in a moment" refusals (rotation, first anchor pending). */
export function isTeeRestarting(e: unknown): boolean {
  return typeof e === "object" && e !== null && (e as { code?: unknown }).code === "tee-restarting";
}

export class FuseTooLargeError extends Error {
  readonly code = "too-large";
  constructor(name: string, size: number) {
    super(`${name} is ${(size / (1024 * 1024)).toFixed(0)} MB; files over ${MAX_FUSE_BYTES / (1024 * 1024)} MB are recorded rather than fused in the browser`);
  }
}

/** Fuse one dropped file through this site's own routes. */
export async function fuseFile(file: File, opts: { agency?: unknown } = {}): Promise<FusedOutcome> {
  if (file.size > MAX_FUSE_BYTES) throw new FuseTooLargeError(file.name, file.size);
  const original = new Uint8Array(await file.arrayBuffer());
  const placement = placementFor(original);
  const { fusedName, frameName } = fusedNames(file.name, placement);
  const r = await fuse(builderFor(placement, original), {
    placement,
    original,
    fusedFile: fusedName,
    keepFused: true,
    ...(opts.agency !== undefined ? { agency: opts.agency } : {}),
    transport: { baseUrl: window.location.origin },
  });
  if (r.originDigestB64 === null || r.fusedBytes === undefined) throw new Error("the fuse pipeline returned no origin digest or fused bytes");
  return {
    placement,
    originDigestB64: r.originDigestB64,
    artifactDigestB64: r.artifactDigestB64,
    proof: asSite(r.proof),
    frame: r.frame,
    frameName,
    fusedName,
    fusedBytes: r.fusedBytes,
    recovered: r.recovered,
    verification: r.verification,
  };
}

/** The signed fused marker on a proof, or null for an ordinary recording. */
export function fusedMarkerOf(proof: SiteProof): { placement: string | null; originDigestB64: string | null } | null {
  const m = readFuseAttribution(asVerify(proof));
  if (m === null) return null;
  return { placement: m.placement, originDigestB64: m.originDigest ? btoa(String.fromCharCode(...m.originDigest)) : null };
}

export interface Rebuilt {
  verification: FuseVerifyResult;
  /** Present only when the original rebuilt the committed artifact byte for byte. */
  fusedBytes: Uint8Array | null;
  frame: FuseFrame | null;
  placement: string | null;
  fusedName: string | null;
  frameName: string | null;
}

/**
 * Verify a fused proof from the ORIGINAL bytes by reconstruction, and hand
 * back the rebuilt fused bytes and a Frame when the reconstruction matches
 * the signed artifact digest. Nothing here touches the network.
 */
export async function rebuildFromOrigin(siteProof: SiteProof, original: Uint8Array, originalName: string): Promise<Rebuilt> {
  const proof = asVerify(siteProof);
  const verification = await verifyFuse({ proof, bytes: original });
  const none: Rebuilt = { verification, fusedBytes: null, frame: null, placement: verification.placement ?? null, fusedName: null, frameName: null };
  if (verification.category !== "FUSED_FROM_ORIGIN" || !verification.placement) return none;
  const placement = getPlacement(verification.placement);
  const slot = proof.slotAllocation;
  if (placement === undefined || slot === undefined) return none;
  const originDigest = new Uint8Array(await crypto.subtle.digest("SHA-256", original as BufferSource));
  const commitment = computeSlotCommitment(slot);
  const fusedBytes = placement.build({ original, originDigest, commitment });
  const artifactDigest = base64ToBytes(proof.artifact.digestB64);
  if (artifactDigest === null) return none;
  const names = fusedNames(originalName, placement.id as SitePlacement);
  const frame = buildFrame({ proof, placement: placement.id as PlacementId, artifactDigest, originDigest, fusedFile: names.fusedName });
  return { verification, fusedBytes, frame, placement: placement.id, fusedName: names.fusedName, frameName: names.frameName };
}

export interface Unpacked {
  verification: FuseVerifyResult;
  /** The original carried inside the new file, when the placement carries it. */
  originalBytes: Uint8Array | null;
  originalName: string | null;
  frame: FuseFrame | null;
  frameName: string | null;
}

/**
 * The original's name from the new file's: `photo.fused.jpg` was made from
 * `photo.jpg`; a container's original keeps the stem alone, since the
 * container does not record the extension.
 */
export function originalNameOf(fusedFileName: string, placement: string): string {
  const stem = fusedFileName.replace(/\.fused(\.[^.]+)?$/, "");
  return placement === "trailer/1" ? fusedFileName.replace(/\.fused(?=\.[^.]+$)/, "") : stem;
}

/**
 * The package parts when the file in hand IS the new file: verify it directly,
 * then take the original back out of it (both registered placements carry the
 * original whole) and build the Frame. The original's name follows
 * originalNameOf.
 */
export async function unpackNewFile(siteProof: SiteProof, fused: Uint8Array, fusedFileName: string): Promise<Unpacked> {
  const proof = asVerify(siteProof);
  const verification = await verifyFuse({ proof, bytes: fused });
  const none: Unpacked = { verification, originalBytes: null, originalName: null, frame: null, frameName: null };
  if (verification.category !== "FUSED_DIRECT" || !verification.placement) return none;
  const placement = getPlacement(verification.placement);
  const located = placement?.locate(fused);
  const artifactDigest = base64ToBytes(proof.artifact.digestB64);
  if (placement === undefined || !located?.originalBytes || artifactDigest === null) return none;
  const originalBytes = located.originalBytes;
  const originDigest = located.originDigest ?? new Uint8Array(await crypto.subtle.digest("SHA-256", originalBytes as BufferSource));
  const originalName = originalNameOf(fusedFileName, placement.id);
  const frame = buildFrame({ proof, placement: placement.id as PlacementId, artifactDigest, originDigest, fusedFile: fusedFileName });
  return { verification, originalBytes, originalName, frame, frameName: `${originalName}.bitgraph-fuse.json` };
}

/* ── Sets: N files under one slot ── */

/**
 * One row of a set manifest as the site reads it: the ordinal in the
 * CANONICAL manifest (never input order), the member count, both digests in
 * standard base64, and the placement that carries the commitment. The same
 * shape fuse-set.ts exports as SetMemberRow.
 */
export interface SetMemberRow {
  index: number;
  count: number;
  originDigestB64: string;
  fusedDigestB64: string;
  placement: string;
}

/** The row a member verdict names, or null before the manifest is bound. */
function rowOf(v: FuseMemberResult): SetMemberRow | null {
  const m = v.set?.member ?? null;
  if (v.set === null || m === null) return null;
  return { index: m.index, count: v.set.memberCount, originDigestB64: m.originDigestB64, fusedDigestB64: m.fusedDigestB64, placement: m.placement };
}

const isSitePlacement = (id: string): id is SitePlacement => id === "trailer/1" || id === "container/1" || id === "container/2";

async function sha256B64(bytes: Uint8Array): Promise<string> {
  return bytesToBase64(new Uint8Array(await crypto.subtle.digest("SHA-256", bytes as BufferSource)));
}

export interface FusedSetMember {
  /** The first File carrying this (origin, placement). */
  file: File;
  /** Index into the members sent. */
  index: number;
  /** The row's ordinal in the canonical manifest; equals verification.set.member.index. */
  manifestIndex: number;
  /** placementFor(original): the site's policy, never the core default. */
  placement: SitePlacement;
  /** Standard base64; equals the camera's item.digestB64 for this file. */
  originDigestB64: string;
  artifactDigestB64: string;
  fusedName: string;
  /**
   * Present only when the set was made with the core's verifyMembers, which
   * the site never asks for: every member is bound to the proof by its row
   * in the committed manifest, and the export and the drop check read a
   * member with the verifier when they hold its bytes.
   */
  verification?: FuseMemberResult;
}

export interface FusedSet {
  /** The set proof, carrying metadata["bitgraph-fuse/1"] whatever the boundary echoed. */
  proof: SiteProof;
  /** SHA-256 of manifestBytes; the committed artifact. */
  artifactDigestB64: string;
  slotCommitmentB64: string;
  manifestBytes: Uint8Array;
  manifest: SetManifest;
  manifestEchoed: boolean;
  recovered: boolean;
  /** verifyFuse over manifestBytes: FUSED_DIRECT under set/1. */
  verification: FuseVerifyResult;
  /** In the order sent. */
  members: FusedSetMember[];
}

/** A dropped file as the scan left it: hashed once, its placement read from the bytes, and for a trailer/1 file the hasher's saved state. */
export interface ScannedFile {
  file: File;
  /** SHA-256 of the file, standard base64; the member's origin digest. */
  digestB64: string;
  placement: SitePlacement;
  /** The saved hasher state after the placement's prefix and the file's last byte; null when the scan had none (a container/1 file, or a scan without the state-saving hasher). */
  state: Uint8Array | null;
}

export interface SetPlan {
  sets: ScannedFile[][];
  tooLarge: ScannedFile[];
}

/**
 * Bytes a set may need to READ AGAIN while its slot is held: the container/1
 * members, and any trailer/1 member the scan left without a state. A member
 * with a state costs no read at all. The budget keeps the set's fuse phase
 * well inside the slot's 120 s TTL; the camera passes one from the scan's
 * measured speed, and this is the fallback when it has none.
 */
export const DEFAULT_REREAD_BUDGET = 4 * 1024 * 1024 * 1024;

/**
 * Partition a drop: files over MAX_FUSE_BYTES are recorded rather than fused
 * (drop order kept); the rest fill sets greedily in drop order, a new set
 * whenever adding a file would exceed MAX_SET_MEMBERS or the re-read budget.
 * A drop of photos scanned with their states is one set up to the member
 * cap, whatever its size.
 */
export function planSets(files: ScannedFile[], rereadBudget = DEFAULT_REREAD_BUDGET): SetPlan {
  const sets: ScannedFile[][] = [];
  const tooLarge: ScannedFile[] = [];
  let current: ScannedFile[] = [];
  let reread = 0;
  for (const f of files) {
    if (f.file.size > MAX_FUSE_BYTES) {
      tooLarge.push(f);
      continue;
    }
    const cost = f.state !== null ? 0 : f.file.size;
    if (current.length > 0 && (current.length >= MAX_SET_MEMBERS || reread + cost > rereadBudget)) {
      sets.push(current);
      current = [];
      reread = 0;
    }
    current.push(f);
    reread += cost;
  }
  if (current.length > 0) sets.push(current);
  return { sets, tooLarge };
}

/**
 * Fuse ONE set of scanned files through this site's own routes: one slot,
 * one commit, and no file read before the slot is held. A file scanned with
 * its state is a hashed member: its fused digest is the saved state finished
 * with its placement's suffix for the slot, so its bytes are never read
 * again. Any other file is a loaded member: read when it is that member's
 * turn, checked against the scan's digest, fused, hashed and released. Every
 * file must be under MAX_FUSE_BYTES and there must be 1 to MAX_SET_MEMBERS
 * of them (callers plan first). The same original under the same placement
 * is sent once, the first File carrying the member. A FuseError from the
 * pipeline passes through untouched. No fused bytes are kept.
 */
export async function fuseFiles(files: ScannedFile[], opts: { agency?: unknown; transport?: FuseTransport; onProgress?: (progress: FuseSetProgress) => void } = {}): Promise<FusedSet> {
  if (files.length === 0) throw new FuseError("bad-input", "a set lists at least one file");
  if (files.length > MAX_SET_MEMBERS) throw new FuseError("bad-input", `a set lists at most ${MAX_SET_MEMBERS} files (got ${files.length})`);
  const sent: ScannedFile[] = [];
  const seen = new Set<string>();
  for (let i = 0; i < files.length; i++) {
    const f = files[i];
    if (f.file.size > MAX_FUSE_BYTES) {
      throw new FuseError("bad-input", `${f.file.name} is ${(f.file.size / (1024 * 1024)).toFixed(0)} MB; files over ${MAX_FUSE_BYTES / (1024 * 1024)} MB are recorded rather than fused in the browser`, null, i);
    }
    const key = `${f.placement}:${f.digestB64}`;
    if (seen.has(key)) continue;
    seen.add(key);
    sent.push(f);
  }
  const members: CoreSetMember[] = sent.map((f) => {
    const originDigest = base64ToBytes(f.digestB64);
    if (originDigest === null || originDigest.length !== 32) throw new FuseError("bad-input", `${f.file.name}: the scan left no 32-byte digest`);
    const placement = getPlacement(f.placement);
    if (f.state !== null && placement?.frame !== undefined) {
      const state = f.state;
      const frame = placement.frame.bind(placement);
      const originalSize = f.file.size;
      return { originDigest, placement: f.placement, name: f.file.name, fusedDigest: ({ commitment }) => finishState(state, frame({ originalSize, originDigest, commitment }).suffix) };
    }
    return { load: async () => new Uint8Array(await f.file.arrayBuffer()), originDigest, placement: f.placement, name: f.file.name };
  });
  const r = await fuseSet(members, {
    keepFused: false,
    ...(opts.agency !== undefined ? { agency: opts.agency } : {}),
    ...(opts.onProgress !== undefined ? { onProgress: opts.onProgress } : {}),
    transport: opts.transport ?? { baseUrl: window.location.origin },
  });
  // A boundary that drops metadata on a held-slot commit returns the proof
  // without its manifest. The site's route attaches it; so does this, so a
  // proof held in the browser always carries what its export needs.
  const proof = r.proof;
  if (readSetMetadata(proof) === null) {
    const manifest = JSON.parse(new TextDecoder().decode(r.manifestBytes)) as SetManifest;
    const prior = proof.metadata;
    const base = typeof prior === "object" && prior !== null && !Array.isArray(prior) ? prior : {};
    proof.metadata = { ...base, [SET_METADATA_KEY]: manifest };
  }
  const out: FusedSetMember[] = r.members.map((m) => {
    const s = sent[m.index];
    return {
      file: s.file,
      index: m.index,
      manifestIndex: m.manifestIndex,
      placement: s.placement,
      originDigestB64: m.originDigestB64,
      artifactDigestB64: m.artifactDigestB64,
      fusedName: m.fusedName ?? fusedNames(s.file.name, s.placement).fusedName,
      ...(m.verification !== undefined ? { verification: m.verification } : {}),
    };
  });
  return {
    proof: asSite(proof),
    artifactDigestB64: r.artifactDigestB64,
    slotCommitmentB64: r.slotCommitmentB64,
    manifestBytes: r.manifestBytes,
    manifest: r.manifest,
    manifestEchoed: r.manifestEchoed,
    recovered: r.recovered,
    verification: r.verification,
    members: out,
  };
}

export interface RebuiltMember {
  verification: FuseMemberResult;
  /** Present only when the original rebuilt this member's listed fused digest byte for byte. */
  fusedBytes: Uint8Array | null;
  placement: string | null;
  fusedName: string | null;
  member: SetMemberRow | null;
  memberCount: number | null;
}

/**
 * Verify a set proof from ONE member's ORIGINAL bytes by reconstruction, and
 * hand back the rebuilt fused bytes when they hash to the row's listed
 * digest. Explicit manifest bytes win over proof.metadata. The only producer
 * of a member's fused bytes on the site; nothing here touches the network.
 */
export async function rebuildSetMember(siteProof: SiteProof, original: Uint8Array, originalName: string, manifest?: Uint8Array | null): Promise<RebuiltMember> {
  const proof = asVerify(siteProof);
  const verification = await verifyFuseMember({ proof, bytes: original, manifest: manifest ?? null });
  const member = rowOf(verification);
  const none: RebuiltMember = { verification, fusedBytes: null, placement: verification.placement ?? null, fusedName: null, member, memberCount: verification.set?.memberCount ?? null };
  if (verification.category !== "SET_MEMBER_FROM_ORIGIN" || member === null) return none;
  const placement = getPlacement(member.placement);
  const slot = proof.slotAllocation;
  if (placement === undefined || slot === undefined) return none;
  const id = placement.id;
  if (!isSitePlacement(id)) return none;
  const originDigest = new Uint8Array(await crypto.subtle.digest("SHA-256", original as BufferSource));
  const commitment = computeSlotCommitment(slot);
  let fusedBytes: Uint8Array;
  try {
    fusedBytes = placement.build({ original, originDigest, commitment });
  } catch {
    return none;
  }
  if ((await sha256B64(fusedBytes)) !== member.fusedDigestB64) return none;
  return { ...none, fusedBytes, placement: id, fusedName: fusedNames(originalName, id).fusedName };
}

export interface UnpackedMember {
  verification: FuseMemberResult;
  /** The original carried inside the member's new file. */
  originalBytes: Uint8Array | null;
  originalName: string | null;
  member: SetMemberRow | null;
}

/**
 * The package parts when the file in hand IS a member's new file: verify it
 * directly, then take the original back out of it (both registered
 * placements carry the original whole). The original's name follows
 * originalNameOf.
 */
export async function unpackSetMember(siteProof: SiteProof, fused: Uint8Array, fusedFileName: string, manifest?: Uint8Array | null): Promise<UnpackedMember> {
  const proof = asVerify(siteProof);
  const verification = await verifyFuseMember({ proof, bytes: fused, manifest: manifest ?? null });
  const member = rowOf(verification);
  const none: UnpackedMember = { verification, originalBytes: null, originalName: null, member };
  if (verification.category !== "SET_MEMBER_DIRECT" || member === null) return none;
  const placement = getPlacement(member.placement);
  const located = placement?.locate(fused);
  if (placement === undefined || !located?.originalBytes) return none;
  return { verification, originalBytes: located.originalBytes, originalName: originalNameOf(fusedFileName, placement.id), member };
}
