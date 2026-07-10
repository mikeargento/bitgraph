// Copyright (c) 2024-2026 Mike Argento. Licensed under the MIT License. See LICENSE.

/**
 * bitgraph-audit verification tiers
 *
 * Applies the canonical verification tiers to every unique observed proof
 * in an IngestResult:
 *
 *   - Artifact bytes present (content-addressed match in the bundle):
 *     full verification through verify() from @mikeargento/bitgraph-verify,
 *     with the actual artifact bytes. Status "verified" or "failed" with
 *     the verifier's exact reason.
 *   - Artifact bytes absent: verifyProofIntegrity(), the bytes-free
 *     integrity API. Status "artifact-unavailable" when the checks pass;
 *     never "verified", because digest matching was not independently
 *     checked. Status "failed" with the exact reason otherwise.
 *
 * All verification semantics live in the verify package; this module only
 * routes proofs and records results. Verification status and chain
 * topology are separate dimensions: nothing here reads or writes chain
 * structure, and chainless proofs (tagged at ingest) verify exactly like
 * any other proof.
 *
 * Ordering and epoch link state: verifyEpochLink() in the verify package
 * keeps module-level single-successor state, so resetEpochLinkState() is
 * called exactly once per audit run, before any proof is verified. Within
 * a run, proofs are verified in a deterministic order: first the
 * artifact-matched proofs as their artifact bytes stream by (container
 * order), then the remaining proofs in first-observation order. Re-running
 * the pass over a re-ingested bundle therefore always reproduces the same
 * results.
 */

import {
  resetEpochLinkState,
  verify,
  verifyProofIntegrity,
} from "@mikeargento/bitgraph-verify";
import { streamMatchedArtifacts } from "./ingest.js";
import type {
  IngestResult,
  ObservedProof,
  ProofVerification,
  VerificationSummary,
  VerifyObservedOptions,
} from "./types.js";

/**
 * Verify every unique observed proof in the ingest result, attaching a
 * ProofVerification record to each. Idempotent per proof: records already
 * attached (from a previous call on the same object) are left untouched;
 * for a fresh deterministic run, re-ingest the bundle first.
 *
 * @returns aggregate counts. Per-proof results live on ingest.proofs.
 */
export async function verifyObservedProofs(
  ingest: IngestResult,
  options?: VerifyObservedOptions
): Promise<VerificationSummary> {
  // Fresh single-successor state once per audit run (verify package G7).
  resetEpochLinkState();

  const trustAnchors = options?.trustAnchors;

  // Index proofs by the hex form of their artifact digest, mirroring the
  // strict decoding used for artifact matching at ingest. Resolution goes
  // through a proofHash map so a bundle with many artifacts stays
  // O(proofs + artifacts + matches); ingest built matchedProofHashes in
  // first-observation order, so the per-artifact proof order is unchanged.
  const proofsByHash = new Map<string, ObservedProof>(
    ingest.proofs.map((p) => [p.proofHash, p])
  );
  const byDigestHex = new Map<string, ObservedProof[]>();
  for (const artifact of ingest.artifacts) {
    if (artifact.matchedProofHashes.length === 0) continue;
    const matched = artifact.matchedProofHashes
      .map((hash) => proofsByHash.get(hash))
      .filter((p): p is ObservedProof => p !== undefined);
    byDigestHex.set(artifact.sha256Hex, matched);
  }

  // Tier 1: full verification for proofs whose artifact bytes are present.
  for await (const artifact of streamMatchedArtifacts(ingest)) {
    const proofs = byDigestHex.get(artifact.sha256Hex) ?? [];
    for (const proof of proofs) {
      if (proof.verification !== undefined) continue;
      const result = await verify({
        proof: proof.proof,
        bytes: artifact.bytes,
        ...(trustAnchors !== undefined ? { trustAnchors } : {}),
      });
      const record: ProofVerification = {
        tier: "full",
        status: result.valid ? "verified" : "failed",
        ...(result.reason !== undefined ? { reason: result.reason } : {}),
        artifactPath: artifact.path,
      };
      proof.verification = record;
    }
  }

  // Tier 2: bytes-free integrity for everything else, in observation order.
  for (const proof of ingest.proofs) {
    if (proof.verification !== undefined) continue;
    const result = await verifyProofIntegrity({
      proof: proof.proof,
      ...(trustAnchors !== undefined ? { trustAnchors } : {}),
    });
    const record: ProofVerification = {
      tier: "integrity",
      status: result.valid ? "artifact-unavailable" : "failed",
      ...(result.reason !== undefined ? { reason: result.reason } : {}),
    };
    proof.verification = record;
  }

  // Summary.
  let verified = 0;
  let failed = 0;
  let artifactUnavailable = 0;
  let chainless = 0;
  for (const proof of ingest.proofs) {
    const status = proof.verification?.status;
    if (status === "verified") verified++;
    else if (status === "failed") failed++;
    else if (status === "artifact-unavailable") artifactUnavailable++;
    if (proof.chainless) chainless++;
  }

  return {
    total: ingest.proofs.length,
    verified,
    failed,
    artifactUnavailable,
    chainless,
  };
}
