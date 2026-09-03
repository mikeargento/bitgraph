// Copyright (c) 2024-2026 Mike Argento. Licensed under the MIT License. See LICENSE.

/**
 * Audit orchestrator: the full offline pipeline in canonical order.
 *
 *   ingest -> verify tiers -> reconstruct -> classify anomalies ->
 *   analyze authorities -> identify anchors -> verify witnesses ->
 *   derive temporal bounds -> validate attestations
 *
 * Deterministic given the same bundle: the only wall-clock read in the
 * entire pipeline is the runMetadata.startedAt stamp taken here. Every
 * other value in the AuditResult, and in both reports built from it, is a
 * pure function of the bundle contents and the tool version. Certificate
 * validity windows during attestation validation are evaluated at each
 * attestation document's OWN timestamp, never the clock.
 *
 * Zero network access, as everywhere in this package.
 */

import { ingestBundle } from "./ingest.js";
import { verifyObservedProofs } from "./verify-tiers.js";
import { reconstructChains } from "./reconstruct.js";
import { classifyAnomalies } from "./anomalies.js";
import { analyzeAuthorities } from "./authority.js";
import { identifyAnchors } from "./anchors.js";
import { verifyAnchorWitnesses } from "./witness.js";
import { deriveTemporalBounds } from "./temporal.js";
import { validateAttestations } from "./attestation.js";
import type { AuditOptions, AuditResult, ExitFlags, IngestResult } from "./types.js";

/**
 * The audit package's own version, as a source constant rather than a
 * runtime package.json read. The read had two failure modes in bundled
 * embedders (esbuild/webpack output, browsers): a foreign package.json one
 * level up supplies the WRONG version into every report, or there is no
 * package.json at all and the read throws mid-audit. A unit test asserts
 * this equals package.json's version, so the constant cannot drift silently
 * across releases.
 */
export const AUDIT_VERSION = "0.4.1";

/** The audit package's own version. */
export function auditToolVersion(): string {
  return AUDIT_VERSION;
}

/** Options for auditIngest(): the audit options plus the run stamp. */
export interface AuditIngestOptions extends AuditOptions {
  /**
   * The runMetadata.startedAt value. runAudit() stamps the wall clock here;
   * an embedder that needs a fully deterministic result supplies its own
   * (any string, for example ""). Defaults to the wall clock when omitted.
   */
  startedAt?: string;
}

/**
 * The pure tail of the pipeline over an already-ingested bundle: every
 * stage after ingest, in canonical order, with no filesystem access. This
 * is how a browser or an embedder that used ingestEntries() gets the same
 * AuditResult the CLI gets from a path. runAudit() is exactly
 * ingestBundle() followed by this.
 */
export async function auditIngest(
  ingest: IngestResult,
  options?: AuditIngestOptions
): Promise<AuditResult> {
  // The ONLY wall-clock read in the pipeline, and only when the caller did
  // not supply the stamp. See AuditRunMetadata.
  const startedAt = options?.startedAt ?? new Date().toISOString();

  const verification = await verifyObservedProofs(
    ingest,
    options?.trustAnchors !== undefined ? { trustAnchors: options.trustAnchors } : undefined
  );
  const reconstruction = await reconstructChains(ingest);
  const anomalies = await classifyAnomalies(ingest, reconstruction);
  const authorities = analyzeAuthorities(ingest);
  const anchors = identifyAnchors(ingest);
  const witnesses = await verifyAnchorWitnesses(ingest, anchors);
  // Populates EpochRecord.anchorBounds on the reconstruction result.
  const temporal = deriveTemporalBounds(ingest, reconstruction, anchors, witnesses);
  const attestations = await validateAttestations(
    ingest,
    authorities,
    options?.trustedRootCaDer !== undefined
      ? { trustedRootCaDer: options.trustedRootCaDer }
      : undefined
  );

  return {
    runMetadata: {
      toolVersion: auditToolVersion(),
      startedAt,
      bundlePath: ingest.bundlePath,
      container: ingest.container,
    },
    ingest,
    verification,
    reconstruction,
    anomalies,
    authorities,
    anchors,
    witnesses,
    temporal,
    attestations,
  };
}

/**
 * Run the complete audit pipeline over a bundle (directory, .tar, .tar.gz,
 * or .tgz) and return everything every stage produced.
 */
export async function runAudit(bundlePath: string, options?: AuditOptions): Promise<AuditResult> {
  const ingest = await ingestBundle(bundlePath);
  return auditIngest(ingest, options);
}

/**
 * Anchor witness verification-failure codes: every finding the witness
 * stage emits is a failure (verifyAnchorWitnesses records findings only for
 * unverified outcomes), so any witness finding is a genuine problem with
 * supplied evidence and sets bit 2. The three anchor-stage findings
 * (anchor-metadata-disagreement, anchor-metadata-only-claim,
 * anchor-title-unparseable) are informational: the signed body governs and
 * none is a verification failure, so they never set an exit bit.
 */
const WITNESS_VERIFICATION_FAILURE_CODES: ReadonlySet<string> = new Set([
  "witness-malformed",
  "witness-rlp-invalid",
  "witness-header-shape",
  "witness-hash-mismatch",
  "witness-digest-mismatch",
  "witness-block-number-mismatch",
  "witness-claimed-hash-mismatch",
  "witness-anchor-invalid",
  "witness-unmatched",
]);

/**
 * Derive the CLI exit bit flags from an audit result. Semantics are
 * documented on the ExitFlags type: bit 1 is verification failures
 * (including unsupported-version rejections), bit 2 is chain or authority
 * anomalies, divergences between valid proofs, or anchor witness
 * verification failures. artifact-unavailable is never a failure by itself;
 * attestation results and informational anchor findings never set bits;
 * benign ingest findings never set bits.
 */
export function computeExitFlags(result: AuditResult): ExitFlags {
  const verificationFailures =
    result.verification.failed > 0 || result.ingest.counts.unsupportedVersion > 0;
  const witnessVerificationFailures = result.witnesses.findings.some((f) =>
    WITNESS_VERIFICATION_FAILURE_CODES.has(f.code)
  );
  const chainAnomaliesOrDivergences =
    result.anomalies.anomalies.length > 0 ||
    result.anomalies.divergences.length > 0 ||
    result.authorities.anomalies.length > 0 ||
    witnessVerificationFailures;
  return {
    verificationFailures,
    chainAnomaliesOrDivergences,
    code: (verificationFailures ? 1 : 0) | (chainAnomaliesOrDivergences ? 2 : 0),
  };
}
