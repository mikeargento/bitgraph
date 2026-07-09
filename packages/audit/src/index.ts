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
  DivergenceKind,
  DivergenceParty,
  DivergenceRecord,
  AnomalyReport,
  AttestedMeasurementEvidence,
  AuthorityGroup,
  SignerEpochSpan,
  AuthorityAnalysis,
} from "./types.js";

export { ingestBundle, streamMatchedArtifacts } from "./ingest.js";

export { verifyObservedProofs } from "./verify-tiers.js";

export { reconstructChains } from "./reconstruct.js";

export { classifyAnomalies } from "./anomalies.js";

export { analyzeAuthorities } from "./authority.js";

export { computeContentsHashB64, computeEntryDigest } from "./contents-hash.js";
export type { ContentsHashEntry } from "./contents-hash.js";
