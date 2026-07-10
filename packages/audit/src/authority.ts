// Copyright (c) 2024-2026 Mike Argento. Licensed under the MIT License. See LICENSE.

/**
 * bitgraph-audit authority analysis
 *
 * Groups observed proofs by the authority facets of the record: declared
 * measurement, signer key, epochId, chainId, and attestation presence.
 * Flags intra-epoch changes that a single healthy enclave boot cannot
 * produce (one boot means one keypair and one measurement per epoch):
 *
 *   - mid-epoch-signer-change: two or more distinct signer keys within
 *     one epochId.
 *   - mid-epoch-measurement-change: two or more distinct declared
 *     measurements within one epochId.
 *
 * The same signer key appearing across different epochs is NORMAL epoch
 * transition evidence and is surfaced without an anomaly.
 *
 * Measurement honesty: everything here reads DECLARED values, which are
 * self-reported fields inside the signed body (environment.measurement).
 * A declared measurement is never conflated with an attested measurement:
 * attestation validation belongs to a later stage, which populates the
 * typed AuthorityGroup.attested extension point after cryptographically
 * validating attestation documents offline. attestationPresent records
 * only that a document exists; presence alone proves nothing.
 *
 * Dimension discipline: grouping and flags cover all observed proofs
 * regardless of verification outcome. An authority anomaly never changes
 * a proof's verification status; per-proof statuses live on the observed
 * proofs themselves.
 */

import type {
  AuthorityAnalysis,
  AuthorityGroup,
  ChainAnomaly,
  IngestResult,
  ObservedProof,
  SignerEpochSpan,
} from "./types.js";
import { pushMap } from "./validity.js";

/**
 * Analyze authority structure over every observed proof (including
 * chainless proofs, which group with epochId absent). Read-only and
 * deterministic.
 */
export function analyzeAuthorities(ingest: IngestResult): AuthorityAnalysis {
  // -----------------------------------------------------------------------
  // Grouping.
  // -----------------------------------------------------------------------
  const groupsByKey = new Map<string, AuthorityGroup>();
  for (const proof of ingest.proofs) {
    const mapKey = JSON.stringify([
      proof.measurement ?? null,
      proof.publicKeyB64 ?? null,
      proof.epochId ?? null,
      proof.chainId,
      proof.hasAttestation,
    ]);
    const existing = groupsByKey.get(mapKey);
    if (existing !== undefined) {
      existing.proofHashes.push(proof.proofHash);
      continue;
    }
    groupsByKey.set(mapKey, {
      ...(proof.measurement !== undefined ? { measurement: proof.measurement } : {}),
      ...(proof.publicKeyB64 !== undefined ? { publicKeyB64: proof.publicKeyB64 } : {}),
      ...(proof.epochId !== undefined ? { epochId: proof.epochId } : {}),
      chainId: proof.chainId,
      attestationPresent: proof.hasAttestation,
      proofHashes: [proof.proofHash],
      // attested is deliberately left undefined: the attestation
      // validation stage (Phase 4c) fills it. Declared measurement above
      // is self-reported and never treated as attested.
    });
  }
  const groups = [...groupsByKey.values()].sort(compareGroups);

  // -----------------------------------------------------------------------
  // Intra-epoch flags. epochId is boot-scoped: one enclave boot generates
  // one keypair and one measurement, shared across every chain it serves,
  // so the flags aggregate per epochId across chains.
  // -----------------------------------------------------------------------
  const byEpoch = new Map<string, ObservedProof[]>();
  for (const proof of ingest.proofs) {
    if (proof.epochId === undefined) continue;
    pushMap(byEpoch, proof.epochId, proof);
  }

  const anomalies: ChainAnomaly[] = [];
  for (const [epochId, proofs] of [...byEpoch.entries()].sort(([a], [b]) =>
    a < b ? -1 : a > b ? 1 : 0
  )) {
    const keys = new Set<string>();
    const measurements = new Set<string>();
    for (const proof of proofs) {
      if (proof.publicKeyB64 !== undefined) keys.add(proof.publicKeyB64);
      if (proof.measurement !== undefined) measurements.add(proof.measurement);
    }

    if (keys.size >= 2) {
      anomalies.push({
        code: "mid-epoch-signer-change",
        proofHashes: proofs.map((p) => p.proofHash),
        message:
          `${keys.size} distinct signer keys appear within epoch ${epochId}. A single enclave boot ` +
          `generates exactly one keypair per epoch, so multiple keys under one epochId cannot come ` +
          `from one healthy authority lifecycle. All key groups are preserved for adjudication.`,
        details: {
          epochId,
          publicKeysB64: [...keys].sort(),
        },
      });
    }

    if (measurements.size >= 2) {
      anomalies.push({
        code: "mid-epoch-measurement-change",
        proofHashes: proofs.map((p) => p.proofHash),
        message:
          `${measurements.size} distinct declared measurements appear within epoch ${epochId}. A ` +
          `single enclave boot has exactly one measurement, so multiple declared measurements under ` +
          `one epochId cannot come from one healthy authority lifecycle. Declared measurements are ` +
          `self-reported; attestation validation is reported separately.`,
        details: {
          epochId,
          measurements: [...measurements].sort(),
        },
      });
    }
  }

  // -----------------------------------------------------------------------
  // Cross-epoch same-signer spans: normal transition evidence.
  // -----------------------------------------------------------------------
  const epochsByKey = new Map<string, Set<string>>();
  for (const proof of ingest.proofs) {
    if (proof.publicKeyB64 === undefined || proof.epochId === undefined) continue;
    const set = epochsByKey.get(proof.publicKeyB64);
    if (set === undefined) epochsByKey.set(proof.publicKeyB64, new Set([proof.epochId]));
    else set.add(proof.epochId);
  }
  const sharedSignersAcrossEpochs: SignerEpochSpan[] = [...epochsByKey.entries()]
    .filter(([, epochs]) => epochs.size >= 2)
    .map(([publicKeyB64, epochs]) => ({ publicKeyB64, epochIds: [...epochs].sort() }))
    .sort((a, b) => (a.publicKeyB64 < b.publicKeyB64 ? -1 : a.publicKeyB64 > b.publicKeyB64 ? 1 : 0));

  return { groups, anomalies, sharedSignersAcrossEpochs };
}

function compareGroups(a: AuthorityGroup, b: AuthorityGroup): number {
  if (a.chainId !== b.chainId) return a.chainId < b.chainId ? -1 : 1;
  const ea = a.epochId ?? "";
  const eb = b.epochId ?? "";
  if (ea !== eb) return ea < eb ? -1 : 1;
  const ka = a.publicKeyB64 ?? "";
  const kb = b.publicKeyB64 ?? "";
  if (ka !== kb) return ka < kb ? -1 : 1;
  const ma = a.measurement ?? "";
  const mb = b.measurement ?? "";
  if (ma !== mb) return ma < mb ? -1 : 1;
  if (a.attestationPresent !== b.attestationPresent) return a.attestationPresent ? -1 : 1;
  return 0;
}
