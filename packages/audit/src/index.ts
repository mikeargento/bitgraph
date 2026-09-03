// Copyright (c) 2024-2026 Mike Argento. Licensed under the MIT License. See LICENSE.

/**
 * @mikeargento/bitgraph-audit
 *
 * Offline audit of BitGraph proof bundles. The operator's database is not
 * the evidence: proofs are portable objects, and this package lets an
 * independent reader ingest a bundle (directory, .tar, or .tar.gz), verify
 * the available evidence through the canonical verify package, and build
 * the indexes that causal reconstruction and reporting run on.
 *
 * Zero runtime network access, by design. Everything verifiable is
 * verified locally; everything else is reported as exactly what it is.
 */

export type {
  AnomalyCode,
  AuditFinding,
  VerificationTier,
  VerificationStatus,
  EmbeddedProofHashStatus,
  ProofVerification,
  ProofSource,
  ObservedProof,
  UnsupportedVersionRecord,
  ArtifactRecord,
  AnchorWitnessFile,
  BundleManifest,
  ManifestReport,
  ContainerKind,
  IngestCounts,
  IngestLimits,
  IngestResult,
  VerifyObservedOptions,
  VerificationSummary,
  MatchedArtifactBytes,
  PartitionKey,
  ChainComponent,
  ChainPartition,
  EpochLinkFields,
  EpochLineageEdge,
  EpochAnchorBound,
  EpochRecord,
  EpochRelationshipResult,
  ReconstructionResult,
  ChainAnomaly,
  UnexplainedPositionsDetail,
  BoundaryEntryPoint,
  DivergenceKind,
  DivergenceParty,
  DivergenceRecord,
  AnomalyReport,
  AttestedMeasurementEvidence,
  AuthorityGroup,
  SignerEpochSpan,
  AuthorityAnalysis,
  AnchorMetadataCorroboration,
  AnchorRecord,
  AnchorIdentification,
  AnchorWitnessOutcome,
  AnchorWitnessAnalysis,
  BoundEvidence,
  SegmentBound,
  TemporalSegmentStatus,
  TemporalSegment,
  AnchorOrderedPair,
  TemporalAnalysis,
  AttestationCheck,
  NitroValidationOptions,
  NitroValidationResult,
  ProofAttestationRecord,
  AttestationAnalysis,
  AuditOptions,
  AuditRunMetadata,
  AuditResult,
  ExitFlags,
  AnomalyStage,
  ReportAnomaly,
  ReportProofRecord,
  ReportPartition,
  UnorderedEpochPair,
  ReportEpochRelationships,
  ReportInputSummary,
  ReportSummary,
  AuditJsonReport,
} from "./types.js";

export { ingestBundle, ingestEntries, streamMatchedArtifacts, streamArtifactsByHash, DEFAULT_INGEST_LIMITS } from "./ingest.js";
export type { BundleEntrySource } from "./ingest.js";

export { verifyObservedProofs } from "./verify-tiers.js";

export { reconstructChains } from "./reconstruct.js";

export { classifyAnomalies } from "./anomalies.js";

export { analyzeAuthorities } from "./authority.js";

export { identifyAnchors } from "./anchors.js";

export { verifyAnchorWitnesses, verifyAnchorWitness } from "./witness.js";

export { deriveTemporalBounds } from "./temporal.js";

export { validateAttestations, validateNitroAttestationDocument } from "./attestation.js";

export { runAudit, auditIngest, computeExitFlags, auditToolVersion, AUDIT_VERSION } from "./audit.js";
export type { AuditIngestOptions } from "./audit.js";

export { buildJsonReport } from "./report-json.js";

export { buildMarkdownReport } from "./report-md.js";

export { AWS_NITRO_ROOT_CA_PEM } from "./aws-nitro-root-ca.js";

export { computeContentsHashB64, computeEntryDigest } from "./contents-hash.js";
export type { ContentsHashEntry } from "./contents-hash.js";

export { buildBundleArchive } from "./export.js";
export type {
  BundleArchiveInput,
  BundleArchiveProofEntry,
  BundleArchiveWitnessEntry,
  BundleArchiveArtifactFile,
} from "./export.js";
