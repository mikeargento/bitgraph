// Copyright (c) 2024-2026 Mike Argento. Licensed under the MIT License. See LICENSE.

/**
 * BitGraph Fuse verification (spec 10): two paths, one comparison.
 *
 * Given a proof and a file:
 *   1. Verify the proof as an ordinary bitgraph/1 proof. Fail: stop.
 *   2. Hash the file.
 *   3. Hash equals the artifact digest: RECORDED when nothing marks the proof
 *      fused; otherwise the file IS the fused bytes: recompute the commitment
 *      from the proof's own slot record, locate it in the bytes per the
 *      declared placement, compare.
 *   4. Hash equals the origin digest: rebuild the fused bytes from this file,
 *      the proof's slot record and the placement; hash; compare with the
 *      artifact digest. A false origin cannot yield bytes that hash to the
 *      signed artifact digest, which is what makes an unsigned origin hint
 *      self-proving.
 *   5. Neither: NO_MATCH. The proof proves nothing about this file.
 *
 * A Fuse failure is never reinterpreted as a valid recorded proof, and the
 * categories are reported separately, never collapsed to one verdict. The
 * wall-clock floor (the last anchored block preceding the slot) needs anchor
 * evidence this package does not carry; the Player computes it. This module
 * reports the causal span [N, M] and the bounded statements without it.
 */

import { sha256 } from "@noble/hashes/sha256";
import { verifyProofIntegrity } from "./verifier.js";
import type { BitGraphProof, VerificationPolicy } from "./types.js";
import {
  bytesEqual,
  bytesToBase64,
  computeSlotCommitment,
  getPlacement,
  PLACEMENTS,
  mergeMarkers,
  parseFrame,
  readFrameMarker,
  readFuseAttribution,
  type FuseFrame,
  type FuseMarker,
} from "./fuse.js";

export type FuseCategory =
  | "RECORDED"
  | "FUSED_DIRECT"
  | "FUSED_FROM_ORIGIN"
  | "RECONSTRUCTION_MISMATCH"
  | "INVALID_SLOT_COMMITMENT"
  | "INVALID_ORIGIN_ATTRIBUTION"
  | "INVALID_UNDERLYING_PROOF"
  | "UNDETERMINED_PLACEMENT"
  | "NO_MATCH";

export interface FuseSpan {
  slotCounter: string;
  commitCounter: string;
  epochId: string;
  chainId: string | null;
  /** commitCounter minus slotCounter, as a decimal string (bigint-safe). */
  positions: string;
}

export interface FuseVerifyResult {
  category: FuseCategory;
  /** The underlying bitgraph/1 verification, reported on its own. */
  proof: { valid: boolean; reason?: string };
  /** Present when the proof or a Frame marks it fused. */
  marker: FuseMarker | null;
  /** The placement that was checked or that matched a registry scan. */
  placement: string | null;
  fileDigestB64: string;
  artifactDigestB64: string;
  originDigestB64: string | null;
  /** Recomputed from the proof's slot record; null when the proof carries none. */
  slotCommitmentB64: string | null;
  span: FuseSpan | null;
  /** Optional span policy (spec 12.1); distinct from cryptographic validity. */
  policy: { spanExceeded: boolean; maxPositions: string | null };
  /** The bounded statements of spec 10.7, without the wall-clock floor clause. */
  statements: string[];
  reason: string | null;
}

export interface FuseVerifyOptions {
  proof: BitGraphProof;
  bytes: Uint8Array;
  /** A Frame or its JSON; its manifest is advisory. */
  frame?: FuseFrame | string | object | null;
  trustAnchors?: VerificationPolicy;
  /** Refuse to accept a span wider than this many positions (M - N). Never affects validity categories. */
  maxPositions?: bigint | number;
}

export function spanOf(proof: BitGraphProof): FuseSpan | null {
  const c = proof.commit;
  if (typeof c.counter !== "string" || typeof c.slotCounter !== "string" || typeof c.epochId !== "string") return null;
  let positions: string;
  try {
    positions = (BigInt(c.counter) - BigInt(c.slotCounter)).toString();
  } catch {
    return null;
  }
  return {
    slotCounter: c.slotCounter,
    commitCounter: c.counter,
    epochId: c.epochId,
    chainId: typeof (c as { chainId?: unknown }).chainId === "string" ? ((c as { chainId?: string }).chainId as string) : null,
    positions,
  };
}

/** The floor sentence every fused verdict ends with: bounded below by the slot, above by the commit. */
export function floorStatement(span: FuseSpan): string {
  return `The exact fused bytes could not feasibly have been finalized before their signed slot allocation at position ${span.slotCounter}, and were committed no later than position ${span.commitCounter}.`;
}

function statements(category: FuseCategory, span: FuseSpan | null, originMatched: boolean): string[] {
  if (span === null) return [];
  const out: string[] = [];
  // The origin sentence names exactly what was checked. On the origin path the
  // supplied file was rebuilt into the committed artifact, so its existence by
  // M is established. On the direct path only the fused bytes were supplied:
  // an embedded origin digest agreeing with the signed marker is consistency,
  // not a check of the original, and a check that did not run is never a verdict.
  if (category === "FUSED_FROM_ORIGIN") {
    out.push(
      `The supplied original rebuilds the committed fused artifact byte for byte, so these exact original bytes existed no later than commit position ${span.commitCounter}.`,
    );
  } else if (category === "FUSED_DIRECT" && originMatched) {
    out.push(
      "The fused bytes carry an origin digest that matches the signed marker; the original itself was not supplied and was not checked.",
    );
  }
  if (category === "FUSED_DIRECT" || category === "FUSED_FROM_ORIGIN") {
    out.push(floorStatement(span));
  }
  if (category === "RECORDED") {
    out.push(`These exact bytes existed no later than commit position ${span.commitCounter}.`);
  }
  return out;
}

export async function verifyFuse(opts: FuseVerifyOptions): Promise<FuseVerifyResult> {
  const { proof, bytes } = opts;
  const frame: FuseFrame | null = opts.frame === undefined || opts.frame === null ? null : (parseFrame(opts.frame) ?? null);
  const fileDigest = sha256(bytes);
  const fileDigestB64 = bytesToBase64(fileDigest);
  const artifactDigestB64 = proof?.artifact?.digestB64 ?? "";

  const base = (category: FuseCategory, extra: Partial<FuseVerifyResult>, reason: string | null): FuseVerifyResult => ({
    category,
    proof: extra.proof ?? { valid: true },
    marker: extra.marker ?? null,
    placement: extra.placement ?? null,
    fileDigestB64,
    artifactDigestB64,
    originDigestB64: extra.originDigestB64 ?? null,
    slotCommitmentB64: extra.slotCommitmentB64 ?? null,
    span: extra.span ?? null,
    policy: extra.policy ?? { spanExceeded: false, maxPositions: null },
    statements: extra.statements ?? [],
    reason,
  });

  // 1. The underlying proof.
  const integrity = await verifyProofIntegrity(
    opts.trustAnchors !== undefined ? { proof, trustAnchors: opts.trustAnchors } : { proof },
  );
  if (!integrity.valid) {
    const reason = integrity.reason ?? "proof failed verification";
    return base("INVALID_UNDERLYING_PROOF", { proof: { valid: false, reason } }, reason);
  }

  // The marker: the signed attribution is authoritative for what it declares;
  // the advisory manifest fills in an undeclared placement or origin hint.
  const marker: FuseMarker | null = mergeMarkers(readFuseAttribution(proof), frame !== null ? readFrameMarker(frame) : null);
  const originDigest = marker?.originDigest;
  const originDigestB64 = originDigest !== undefined ? bytesToBase64(originDigest) : null;
  const span = spanOf(proof);

  // Optional span policy, computed once, reported separately from validity.
  const maxPositions = opts.maxPositions === undefined ? null : BigInt(opts.maxPositions);
  const policy = {
    spanExceeded: maxPositions !== null && span !== null && BigInt(span.positions) > maxPositions,
    maxPositions: maxPositions === null ? null : maxPositions.toString(),
  };

  const common = { proof: { valid: true }, marker, originDigestB64, span, policy };

  // 3. The file is the committed bytes.
  if (fileDigestB64 === artifactDigestB64) {
    if (marker === null) {
      return base("RECORDED", { ...common, statements: statements("RECORDED", span, false) }, null);
    }
    const slot = proof.slotAllocation;
    if (slot === undefined) {
      return base("INVALID_SLOT_COMMITMENT", common, "the proof carries no slot record, so no commitment can be recomputed");
    }
    let expected: Uint8Array;
    try {
      expected = computeSlotCommitment(slot);
    } catch (err) {
      return base("INVALID_SLOT_COMMITMENT", common, `commitment could not be recomputed: ${err instanceof Error ? err.message : String(err)}`);
    }
    const slotCommitmentB64 = bytesToBase64(expected);
    let placement = marker.placement === null ? undefined : getPlacement(marker.placement);
    let located = placement === undefined ? null : placement.locate(bytes);
    if (marker.placement === null) {
      // Undeclared: try the registry in its fixed order and report the one that matched.
      for (const p of PLACEMENTS) {
        const l = p.locate(bytes);
        if (l !== null) { placement = p; located = l; break; }
      }
      if (placement === undefined) {
        return base("INVALID_SLOT_COMMITMENT", { ...common, slotCommitmentB64 }, "no registered placement finds a commitment in the fused bytes");
      }
    } else if (placement === undefined) {
      return base("UNDETERMINED_PLACEMENT", { ...common, slotCommitmentB64 }, `placement "${marker.placement}" is not registered; the commitment cannot be located`);
    }
    if (located === null) {
      return base("INVALID_SLOT_COMMITMENT", { ...common, slotCommitmentB64, placement: placement.id }, `no ${placement.id} commitment found in the fused bytes`);
    }
    if (!bytesEqual(located.commitment, expected)) {
      return base("INVALID_SLOT_COMMITMENT", { ...common, slotCommitmentB64, placement: placement.id }, "the commitment in the fused bytes does not match the proof's slot record");
    }
    // Origin consistency: what the fused bytes say about the origin versus the marker.
    let originMatched = false;
    if (originDigest !== undefined) {
      const embedded = located.originDigest ?? (located.originalBytes !== undefined ? sha256(located.originalBytes) : undefined);
      if (embedded !== undefined) {
        if (!bytesEqual(embedded, originDigest)) {
          return base(
            "INVALID_ORIGIN_ATTRIBUTION",
            { ...common, slotCommitmentB64, placement: placement.id },
            marker.originSource === "attribution"
              ? "the origin digest in the signed attribution does not match the origin inside the fused bytes"
              : "the origin digest in the manifest does not match the origin inside the fused bytes",
          );
        }
        originMatched = true;
      }
    }
    return base("FUSED_DIRECT", { ...common, slotCommitmentB64, placement: placement.id, statements: statements("FUSED_DIRECT", span, originMatched) }, null);
  }

  // 4. The file is the original: rebuild the fused bytes.
  if (originDigest !== undefined && bytesEqual(fileDigest, originDigest)) {
    const slot = proof.slotAllocation;
    if (slot === undefined) {
      return base("INVALID_SLOT_COMMITMENT", common, "the proof carries no slot record, so the fused bytes cannot be rebuilt");
    }
    let commitment: Uint8Array;
    try {
      commitment = computeSlotCommitment(slot);
    } catch (err) {
      return base("INVALID_SLOT_COMMITMENT", common, `commitment could not be recomputed: ${err instanceof Error ? err.message : String(err)}`);
    }
    const slotCommitmentB64 = bytesToBase64(commitment);
    const declared = marker !== null && marker.placement !== null ? getPlacement(marker.placement) : undefined;
    if (marker !== null && marker.placement !== null && declared === undefined) {
      return base("UNDETERMINED_PLACEMENT", { ...common, slotCommitmentB64 }, `placement "${marker.placement}" is not registered; the fused bytes cannot be rebuilt`);
    }
    const candidates = declared !== undefined ? [declared] : PLACEMENTS.filter((p) => p.byteExact);
    const artifactDigest = proof.artifact.digestB64;
    for (const p of candidates) {
      if (!p.byteExact) continue;
      let rebuilt: Uint8Array;
      try {
        rebuilt = p.build({ original: bytes, originDigest, commitment });
      } catch {
        continue;
      }
      if (bytesToBase64(sha256(rebuilt)) === artifactDigest) {
        return base("FUSED_FROM_ORIGIN", { ...common, slotCommitmentB64, placement: p.id, statements: statements("FUSED_FROM_ORIGIN", span, true) }, null);
      }
    }
    return base(
      "RECONSTRUCTION_MISMATCH",
      { ...common, slotCommitmentB64, placement: declared?.id ?? null },
      declared !== undefined
        ? `rebuilding ${declared.id} from this file and the proof's slot record does not reproduce the committed artifact digest`
        : "no registered byte-exact placement rebuilds the committed artifact digest from this file",
    );
  }

  // 5. Neither.
  return base("NO_MATCH", common, "this file matches neither the committed artifact digest nor the origin digest; the proof proves nothing about it");
}

/**
 * Strict ordering between two proofs where counters are comparable (same
 * signer key, epoch, and chain): fused artifact B was assembled after
 * artifact A was committed when commitCounter(A) < slotCounter(B). Returns
 * null when the two are not comparable; an old pooled slot makes this false,
 * never a false positive.
 */
export function assembledAfterCommit(a: BitGraphProof, b: BitGraphProof): boolean | null {
  const chain = (p: BitGraphProof) => (p.commit as { chainId?: string }).chainId ?? null;
  if (a.signer.publicKeyB64 !== b.signer.publicKeyB64) return null;
  if (a.commit.epochId === undefined || a.commit.epochId !== b.commit.epochId) return null;
  if (chain(a) !== chain(b)) return null;
  if (typeof a.commit.counter !== "string" || typeof b.commit.slotCounter !== "string") return null;
  try {
    return BigInt(a.commit.counter) < BigInt(b.commit.slotCounter);
  } catch {
    return null;
  }
}
