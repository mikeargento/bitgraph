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

import { readFileSync } from "node:fs";
import { ingestBundle } from "./ingest.js";
import { verifyObservedProofs } from "./verify-tiers.js";
import { reconstructChains } from "./reconstruct.js";
import { classifyAnomalies } from "./anomalies.js";
import { analyzeAuthorities } from "./authority.js";
import { identifyAnchors } from "./anchors.js";
import { verifyAnchorWitnesses } from "./witness.js";
import { deriveTemporalBounds } from "./temporal.js";
import { validateAttestations } from "./attestation.js";
import type { AuditOptions, AuditResult, ExitFlags } from "./types.js";

let cachedToolVersion: string | undefined;

/** The audit package's own version, read once from its package.json. */
export function auditToolVersion(): string {
  if (cachedToolVersion === undefined) {
    const raw = readFileSync(new URL("../package.json", import.meta.url), "utf8");
    cachedToolVersion = (JSON.parse(raw) as { version: string }).version;
  }
  return cachedToolVersion;
}

/**
 * Run the complete audit pipeline over a bundle (directory, .tar, .tar.gz,
 * or .tgz) and return everything every stage produced.
 */
export async function runAudit(bundlePath: string, options?: AuditOptions): Promise<AuditResult> {
  // The ONLY wall-clock read in the pipeline. See AuditRunMetadata.
  const startedAt = new Date().toISOString();

  const ingest = await ingestBundle(bundlePath);
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
      bundlePath,
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
 * Derive the CLI exit bit flags from an audit result. Semantics are
 * documented on the ExitFlags type: bit 1 is verification failures
 * (including unsupported-version rejections), bit 2 is chain or authority
 * anomalies or divergences between valid proofs. artifact-unavailable is
 * never a failure by itself; attestation results never set bits on their
 * own; benign ingest findings never set bits.
 */
export function computeExitFlags(result: AuditResult): ExitFlags {
  const verificationFailures =
    result.verification.failed > 0 || result.ingest.counts.unsupportedVersion > 0;
  const chainAnomaliesOrDivergences =
    result.anomalies.anomalies.length > 0 ||
    result.anomalies.divergences.length > 0 ||
    result.authorities.anomalies.length > 0;
  return {
    verificationFailures,
    chainAnomaliesOrDivergences,
    code: (verificationFailures ? 1 : 0) | (chainAnomaliesOrDivergences ? 2 : 0),
  };
}
