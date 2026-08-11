// Copyright (c) 2024-2026 Mike Argento. Licensed under the MIT License. See LICENSE.

/**
 * Cast resolution: digest -> recording.
 *
 * A digest identifies bits; a BitGraph recording identifies an OCCURRENCE
 * of those bits at a causal position. The same bits can hold many
 * positions by design (the ledger's by-digest index is one entry per
 * causal position), so a role must resolve to exactly one recording:
 *
 *   exactly 1 verified match          -> resolved
 *   0 matches, optional               -> absent (a definite fact under the closed world)
 *   0 matches, required               -> absent (evaluates to UNDETERMINED)
 *   2+ matches, no pin                -> ambiguous (UNDETERMINED, never a silent pick)
 *   2+ matches, pin selects exactly 1 -> resolved
 *
 * Only proofs whose canonical verification passed (status "verified", at
 * either tier) count as recordings. A file shaped like a proof that fails
 * verification is noise, not evidence — but if matches exist and ALL fail
 * verification, that is surfaced as invalid rather than silently treated
 * as absence, because "the bundle contains only broken recordings of this
 * digest" and "the bundle contains no recordings of this digest" are
 * different situations and only one of them supports a closed-world
 * absence claim.
 */

import type { AuditResult, ObservedProof } from "@mikeargento/bitgraph-audit";
import { decodeDigestBytes, normalizeDigest } from "./rule.js";
import type { CastEntry, Resolution } from "./types.js";

function matchesPin(proof: ObservedProof, pin: NonNullable<CastEntry["at"]>): boolean {
  if ("proofHash" in pin) return proof.proofHash === pin.proofHash;
  return proof.epochId === pin.epochId && proof.counter === pin.counter;
}

/**
 * A recording counts when its canonical verification PASSED at either
 * tier: "verified" is the full-tier pass (artifact bytes present and
 * matching), "artifact-unavailable" is the integrity-tier pass (the proof
 * verifies bytes-free; the digest is inside the signed body either way).
 */
function verificationPassed(proof: ObservedProof): boolean {
  const status = proof.verification?.status;
  return status === "verified" || status === "artifact-unavailable";
}

export function resolveRole(role: string, entry: CastEntry, audit: AuditResult): Resolution {
  const digestB64 = normalizeDigest(entry.digest);
  if (digestB64 === undefined) {
    // parseRule already rejects malformed digests; this guards direct API use.
    return { kind: "invalid", role, reason: "digest is not a well-formed 32-byte SHA-256" };
  }
  const targetBytes = decodeDigestBytes(digestB64) as Buffer;

  const anyMatch: ObservedProof[] = [];
  const verified: ObservedProof[] = [];
  for (const proof of audit.ingest.proofs) {
    // Byte-level match: a hostile file may spell its digest any way it
    // likes, and "only broken recordings exist" must not masquerade as
    // "no recordings exist".
    const proofDigest = decodeDigestBytes(proof.proof.artifact.digestB64);
    if (proofDigest === undefined || !proofDigest.equals(targetBytes)) continue;
    anyMatch.push(proof);
    if (verificationPassed(proof)) verified.push(proof);
  }

  if (verified.length === 0) {
    if (anyMatch.length > 0) {
      return {
        kind: "invalid",
        role,
        reason: `${anyMatch.length} recording(s) of this digest are present but none passed verification`,
      };
    }
    return { kind: "absent", role, optional: entry.optional === true };
  }

  let candidates = verified;
  if (entry.at !== undefined) {
    const pin = entry.at;
    candidates = verified.filter((p) => matchesPin(p, pin));
    if (candidates.length === 0) {
      return {
        kind: "invalid",
        role,
        reason: `"at" pin matches none of the ${verified.length} verified recording(s) of this digest`,
      };
    }
  }

  if (candidates.length > 1) {
    return {
      kind: "ambiguous",
      role,
      matchCount: candidates.length,
      candidates: candidates.map((p) => p.proofHash).sort(),
    };
  }

  const proof = candidates[0] as ObservedProof;
  return {
    kind: "resolved",
    role,
    proof,
    verificationTier: proof.verification?.tier ?? "integrity",
    matchCount: verified.length,
  };
}

/** Resolve every declared role. Deterministic: iterates the cast in declaration order. */
export function resolveCast(
  cast: Record<string, CastEntry>,
  audit: AuditResult
): Map<string, Resolution> {
  const out = new Map<string, Resolution>();
  for (const [role, entry] of Object.entries(cast)) {
    out.set(role, resolveRole(role, entry, audit));
  }
  return out;
}
