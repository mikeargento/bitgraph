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
 */
import { fuse, builderFor } from "@mikeargento/bitgraph";
import type { BitGraphProof, FuseFrame, FuseVerifyResult, PlacementId } from "@mikeargento/bitgraph-verify";
import { base64ToBytes, buildFrame, computeSlotCommitment, getPlacement, readFuseAttribution, verifyFuse } from "@mikeargento/bitgraph-verify";
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
 * The package parts when the file in hand IS the new file: verify it directly,
 * then take the original back out of it (both registered placements carry the
 * original whole) and build the Frame. The original's name comes from the new
 * file's: `photo.fused.jpg` was made from `photo.jpg`; a container's original
 * keeps the stem alone, since the container does not record the extension.
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
  const stem = fusedFileName.replace(/\.fused(\.[^.]+)?$/, "");
  const originalName = placement.id === "trailer/1" ? fusedFileName.replace(/\.fused(?=\.[^.]+$)/, "") : stem;
  const frame = buildFrame({ proof, placement: placement.id as PlacementId, artifactDigest, originDigest, fusedFile: fusedFileName });
  return { verification, originalBytes, originalName, frame, frameName: `${originalName}.bitgraph-fuse.json` };
}
