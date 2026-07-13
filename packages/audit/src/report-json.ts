// Copyright (c) 2024-2026 Mike Argento. Licensed under the MIT License. See LICENSE.

/**
 * JSON report builder: turns an AuditResult into the audit-report.json
 * object (schema "bitgraph-audit-report/1").
 *
 * Contract for machine consumers: every classification is a stable code
 * or typed field; prose (message, claim, explanation fields) is
 * supplementary and never needs parsing. The report is deterministic
 * given the same bundle except for the runMetadata block, which is
 * explicitly flagged as the only nondeterministic section.
 *
 * Ordering: objects are built in fixed key order; arrays are either
 * sorted here by stable keys (proofs by canonical hash, rejected inputs
 * by path, unordered epoch pairs by epochId) or carry the producing
 * stage's documented deterministic order (partitions, components,
 * anomalies, divergences, witness outcomes, temporal segments).
 *
 * Read-only over the AuditResult. The raw parsed proof objects retained
 * on ObservedProof records are never serialized; per-proof records carry
 * the compact metadata fields only.
 */

import { computeExitFlags } from "./audit.js";
import type {
  AnchorOrderedPair,
  AuditFinding,
  AuditJsonReport,
  AuditResult,
  ChainAnomaly,
  ObservedProof,
  PartitionKey,
  ReportAnomaly,
  ReportPartition,
  ReportProofRecord,
  ReportSummary,
  TemporalSegmentStatus,
  UnorderedEpochPair,
} from "./types.js";

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export function buildJsonReport(result: AuditResult): AuditJsonReport {
  const proofs = buildProofRecords(result);
  const unsupportedVersions = [...result.ingest.unsupportedVersions].sort((a, b) =>
    a.path < b.path ? -1 : a.path > b.path ? 1 : 0
  );
  const partitions = buildPartitions(result);
  const anomalies = buildUnifiedAnomalies(result);
  const unorderedPairs = buildUnorderedEpochPairs(result);
  const summary = buildSummary(result, partitions, anomalies);

  return {
    reportSchemaVersion: "bitgraph-audit-report/1",
    toolVersion: result.runMetadata.toolVersion,
    runMetadata: {
      nondeterministic: true,
      note:
        "This block is the only nondeterministic section of the report. " +
        "startedAt is the wall-clock start time of the audit run; every " +
        "other value in this report is a pure function of the bundle " +
        "contents and the tool version.",
      toolVersion: result.runMetadata.toolVersion,
      startedAt: result.runMetadata.startedAt,
      bundlePath: result.runMetadata.bundlePath,
      container: result.runMetadata.container,
    },
    input: {
      container: result.ingest.container,
      entriesScanned: result.ingest.entriesScanned,
      ...(result.ingest.strippedRootPrefix !== undefined
        ? { strippedRootPrefix: result.ingest.strippedRootPrefix }
        : {}),
      computedContentsHashB64: result.ingest.computedContentsHashB64,
      ...(result.ingest.manifest !== undefined ? { manifest: result.ingest.manifest } : {}),
      counts: {
        observed: result.ingest.counts.observed,
        proofFiles: result.ingest.counts.proofFiles,
        exactDuplicates: result.ingest.counts.exactDuplicates,
        semanticDuplicates: result.ingest.counts.semanticDuplicates,
        unsupportedVersion: result.ingest.counts.unsupportedVersion,
        verified: result.verification.verified,
        failed: result.verification.failed,
        artifactUnavailable: result.verification.artifactUnavailable,
        chainless: result.verification.chainless,
        artifacts: result.ingest.counts.artifacts,
        witnesses: result.ingest.counts.witnesses,
        skippedUnsafePaths: result.ingest.counts.skippedUnsafePaths,
      },
    },
    proofs,
    unsupportedVersions,
    partitions,
    unchainedProofHashes: result.reconstruction.unchainedProofHashes,
    unpartitionedProofHashes: result.reconstruction.unpartitionedProofHashes,
    epochRelationships: {
      epochs: result.reconstruction.epochRelationships.epochs,
      lineageEdges: result.reconstruction.epochRelationships.edges,
      orderedPairs: result.reconstruction.epochRelationships.orderedPairs,
      anchorOrderedPairs: result.temporal.anchorOrderedPairs,
      unorderedPairs,
    },
    anomalies,
    divergences: result.anomalies.divergences,
    boundaryEntryPoints: result.anomalies.boundaryEntryPoints,
    authorities: {
      groups: result.authorities.groups,
      sharedSignersAcrossEpochs: result.authorities.sharedSignersAcrossEpochs,
    },
    attestations: {
      records: result.attestations.records,
      counts: result.attestations.counts,
    },
    anchors: {
      records: result.anchors.anchors,
      metadataOnlyProofHashes: result.anchors.metadataOnlyProofHashes,
    },
    witnesses: {
      outcomes: result.witnesses.outcomes,
    },
    temporal: {
      segments: result.temporal.segments,
      verifiedAnchorProofHashes: result.temporal.verifiedAnchorProofHashes,
      unverifiedAnchorProofHashes: result.temporal.unverifiedAnchorProofHashes,
    },
    summary,
  };
}

// ---------------------------------------------------------------------------
// Per-proof records
// ---------------------------------------------------------------------------

function buildProofRecords(result: AuditResult): ReportProofRecord[] {
  const records = result.ingest.proofs.map((proof) => toProofRecord(proof));
  records.sort((a, b) => (a.proofHash < b.proofHash ? -1 : a.proofHash > b.proofHash ? 1 : 0));
  return records;
}

function toProofRecord(proof: ObservedProof): ReportProofRecord {
  const v = proof.verification;
  return {
    proofHash: proof.proofHash,
    sources: proof.sources,
    ...(v !== undefined ? { verificationTier: v.tier, verificationStatus: v.status } : {}),
    ...(v?.reason !== undefined ? { verificationReason: v.reason } : {}),
    ...(v?.artifactPath !== undefined ? { artifactPath: v.artifactPath } : {}),
    embeddedProofHash: proof.embeddedProofHash,
    ...(proof.counter !== undefined ? { counter: proof.counter } : {}),
    ...(proof.slotCounter !== undefined ? { slotCounter: proof.slotCounter } : {}),
    ...(proof.prevB64 !== undefined ? { prevB64: proof.prevB64 } : {}),
    ...(proof.epochId !== undefined ? { epochId: proof.epochId } : {}),
    chainId: proof.chainId,
    ...(proof.publicKeyB64 !== undefined ? { publicKeyB64: proof.publicKeyB64 } : {}),
    ...(proof.measurement !== undefined ? { measurement: proof.measurement } : {}),
    ...(proof.enforcement !== undefined ? { enforcement: proof.enforcement } : {}),
    chainless: proof.chainless,
    hasSlotAllocation: proof.hasSlotAllocation,
    hasAttestation: proof.hasAttestation,
    hasAgency: proof.hasAgency,
    hasEpochLink: proof.hasEpochLink,
  };
}

// ---------------------------------------------------------------------------
// Partitions with intactness
// ---------------------------------------------------------------------------

function partitionKeyId(key: PartitionKey): string {
  return `${key.publicKeyB64}\u0000${key.epochId ?? ""}\u0000${key.chainId}`;
}

function buildPartitions(result: AuditResult): ReportPartition[] {
  const anomalousPartitions = new Set<string>();
  for (const anomaly of result.anomalies.anomalies) {
    if (anomaly.partition !== undefined) anomalousPartitions.add(partitionKeyId(anomaly.partition));
  }
  for (const divergence of result.anomalies.divergences) {
    if (divergence.partition !== undefined) {
      anomalousPartitions.add(partitionKeyId(divergence.partition));
    }
  }
  return result.reconstruction.partitions.map((partition) => ({
    key: partition.key,
    memberProofHashes: partition.memberProofHashes,
    components: partition.components,
    intact:
      partition.components.length === 1 && !anomalousPartitions.has(partitionKeyId(partition.key)),
  }));
}

// ---------------------------------------------------------------------------
// Unified anomaly list
// ---------------------------------------------------------------------------

function fromFinding(stage: ReportAnomaly["stage"], finding: AuditFinding): ReportAnomaly {
  return {
    stage,
    code: finding.code,
    message: finding.message,
    ...(finding.path !== undefined ? { path: finding.path } : {}),
    ...(finding.details !== undefined ? { details: finding.details } : {}),
  };
}

function fromChainAnomaly(stage: ReportAnomaly["stage"], anomaly: ChainAnomaly): ReportAnomaly {
  return {
    stage,
    code: anomaly.code,
    message: anomaly.message,
    ...(anomaly.partition !== undefined ? { partition: anomaly.partition } : {}),
    proofHashes: anomaly.proofHashes,
    ...(anomaly.details !== undefined ? { details: anomaly.details } : {}),
  };
}

function buildUnifiedAnomalies(result: AuditResult): ReportAnomaly[] {
  const out: ReportAnomaly[] = [];
  for (const finding of result.ingest.findings) out.push(fromFinding("ingest", finding));
  for (const anomaly of result.anomalies.anomalies) out.push(fromChainAnomaly("chain", anomaly));
  for (const anomaly of result.authorities.anomalies) {
    out.push(fromChainAnomaly("authority", anomaly));
  }
  for (const finding of result.anchors.findings) out.push(fromFinding("anchor", finding));
  for (const finding of result.witnesses.findings) out.push(fromFinding("witness", finding));
  for (const finding of result.attestations.findings) {
    out.push(fromFinding("attestation", finding));
  }
  return out;
}

// ---------------------------------------------------------------------------
// Epoch pairs without ordering evidence
// ---------------------------------------------------------------------------

function buildUnorderedEpochPairs(result: AuditResult): UnorderedEpochPair[] {
  const epochIds = result.reconstruction.epochRelationships.epochs.map((e) => e.epochId);
  const ordered = new Set<string>();
  const mark = (a: string, b: string): void => {
    ordered.add(`${a}\u0000${b}`);
    ordered.add(`${b}\u0000${a}`);
  };
  for (const pair of result.reconstruction.epochRelationships.orderedPairs) {
    mark(pair.beforeEpochId, pair.afterEpochId);
  }
  for (const pair of result.temporal.anchorOrderedPairs as AnchorOrderedPair[]) {
    mark(pair.beforeEpochId, pair.afterEpochId);
  }
  const out: UnorderedEpochPair[] = [];
  for (let i = 0; i < epochIds.length; i++) {
    for (let j = i + 1; j < epochIds.length; j++) {
      const a = epochIds[i] as string;
      const b = epochIds[j] as string;
      if (!ordered.has(`${a}\u0000${b}`)) out.push({ epochIdA: a, epochIdB: b });
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// Summary statistics
// ---------------------------------------------------------------------------

function buildSummary(
  result: AuditResult,
  partitions: ReportPartition[],
  anomalies: ReportAnomaly[]
): ReportSummary {
  const countsByCode = new Map<string, number>();
  for (const anomaly of anomalies) {
    countsByCode.set(anomaly.code, (countsByCode.get(anomaly.code) ?? 0) + 1);
  }
  const anomalyCountsByCode = Object.fromEntries(
    [...countsByCode.entries()].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
  );

  const signers = new Set<string>();
  const measurements = new Set<string>();
  for (const proof of result.ingest.proofs) {
    if (proof.publicKeyB64 !== undefined) signers.add(proof.publicKeyB64);
    if (proof.measurement !== undefined) measurements.add(proof.measurement);
  }

  const segmentCount = (status: TemporalSegmentStatus): number =>
    result.temporal.segments.filter((s) => s.status === status).length;

  const partitionsIntact = partitions.filter((p) => p.intact).length;
  const exit = computeExitFlags(result);

  return {
    proofsObserved: result.ingest.counts.observed,
    fullyVerified: result.verification.verified,
    failed: result.verification.failed,
    artifactUnavailable: result.verification.artifactUnavailable,
    unsupportedVersion: result.ingest.counts.unsupportedVersion,
    chainless: result.verification.chainless,
    exactDuplicates: result.ingest.counts.exactDuplicates,
    semanticDuplicates: result.ingest.counts.semanticDuplicates,
    partitions: partitions.length,
    partitionsIntact,
    chainIntact:
      partitionsIntact === partitions.length &&
      result.anomalies.anomalies.length === 0 &&
      result.authorities.anomalies.length === 0 &&
      result.anomalies.divergences.length === 0,
    epochsObserved: result.reconstruction.epochRelationships.epochs.length,
    anomalyCountsByCode,
    divergenceCount: result.anomalies.divergences.length,
    boundaryEntryPoints: result.anomalies.boundaryEntryPoints.length,
    authorityGroupCount: result.authorities.groups.length,
    distinctSignerCount: signers.size,
    distinctDeclaredMeasurementCount: measurements.size,
    attestation: {
      declaredMeasurementPresent: result.attestations.counts.proofsWithDeclaredMeasurement,
      documentsPresent: result.attestations.counts.proofsWithDocument,
      documentsValidated: result.attestations.counts.documentsValidated,
      pcr0MatchesDeclared: result.attestations.counts.pcr0Matches,
      userDataBound: result.attestations.counts.userDataBound,
    },
    temporal: {
      anchorsIdentified: result.anchors.anchors.length,
      anchorsWithVerifiedWitness: result.temporal.verifiedAnchorProofHashes.length,
      segments: result.temporal.segments.length,
      segmentsBracketed: segmentCount("bracketed"),
      segmentsLowerBounded: segmentCount("lower-bounded"),
      segmentsUpperBounded: segmentCount("upper-bounded"),
      segmentsUnanchored: segmentCount("ordered-but-unanchored"),
    },
    exit,
  };
}
