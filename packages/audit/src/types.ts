// Copyright (c) 2024-2026 Mike Argento. Licensed under the MIT License. See LICENSE.

/**
 * bitgraph-audit types
 *
 * Public data structures for the BitGraph Audit Bundle consumer.
 * This file intentionally contains no logic.
 *
 * Two dimensions are kept deliberately separate throughout:
 *
 *   - Verification status: what the canonical verify package said about a
 *     proof object (and whether artifact bytes were available to say it).
 *   - Chain topology: where the proof sits in the causal record (counters,
 *     predecessor links, epochs, chains). Reconstruction and anomaly
 *     classification build on this in later stages.
 *
 * A verifier failure is never reinterpreted as a chain anomaly, and a chain
 * observation never upgrades a proof's verification status.
 */

// ---------------------------------------------------------------------------
// Anomaly codes
// ---------------------------------------------------------------------------

/**
 * Stable machine-readable codes for audit findings.
 *
 * This is an OPEN union: the listed literals are the codes emitted by the
 * ingest and verification layers, and later stages (chain reconstruction,
 * anchor analysis, attestation validation) extend it with additional codes
 * (for example unexplained counter positions, counter collisions,
 * predecessor reuse, chain breaks, authority divergence, epoch link
 * anomalies). The `(string & {})` arm keeps the type open for those
 * extensions while preserving literal completion for the known codes.
 *
 * Codes are contract: report consumers match on them and must never need
 * to parse English to determine what happened.
 */
export type AnomalyCode =
  /** Proof-shaped file whose version is not exactly "bitgraph/1". Rejected at ingest. */
  | "unsupported-version"
  /** A stored copy carries an embedded proofHash that does not match the computed canonical hash. */
  | "proofhash-mismatch"
  /** Byte-identical proof file observed at more than one path. */
  | "exact-duplicate"
  /** Same canonical proof identity observed in different byte encodings. */
  | "semantic-duplicate"
  /** Container entry whose path is absolute, escapes the bundle root, or contains NUL. Skipped entirely. */
  | "unsafe-path"
  /** Multiple tar entries normalized to the same path; the last entry wins. */
  | "duplicate-path"
  /** Root manifest.json failed to parse as a single JSON object. */
  | "manifest-unparseable"
  /** Root manifest.json parsed but its version field is missing or unrecognized. */
  | "manifest-unrecognized-version"
  /** A manifest field is present but fails the type rules of the bundle spec (section 7.1). */
  | "manifest-field-invalid"
  /** The manifest's contentsHashB64 does not match the computed deterministic contents hash. Advisory; never a proof failure. */
  | "manifest-contents-hash-mismatch"
  // --- Chain reconstruction and anomaly classification (Phase 4b) ---
  /** Counter positions inside a partition's observed range that are neither a commit counter nor a referenced slot counter. The proofs are absent from the bundle; this is never asserted as authority failure. */
  | "unexplained-counter-positions"
  /** Two or more valid non-identical proofs claim the same commit counter in one partition. */
  | "counter-collision"
  /** Two or more valid non-identical proofs reference the same slot counter in one partition. */
  | "slot-collision"
  /** One prevB64 predecessor hash is claimed by two or more valid successors: a detectable fork. All branches are preserved. */
  | "predecessor-reuse"
  /** prevB64 references a predecessor absent from the bundle (no observed proof has that canonical hash). */
  | "chain-break-missing"
  /** prevB64 is not decodable as standard base64 of 32 bytes; it can never match a canonical proof hash. */
  | "chain-break-malformed"
  /** prevB64 resolves to an observed proof in a different partition (different signer, epoch, or chain). prevB64 never bridges partitions. */
  | "chain-break-cross-partition"
  /** More than one proof without prevB64 in a single partition. A single genesis without prevB64 is normal and never an anomaly. */
  | "multiple-genesis"
  /** commit.slotCounter is not strictly less than commit.counter. */
  | "slot-order-violation"
  /** epochLink references a prior epoch that is observed, but the referenced terminal proof is absent from the bundle. */
  | "epochlink-terminal-missing"
  /** epochLink references a prior epoch and terminal proof, neither of which is observed in the bundle. */
  | "epochlink-dangling"
  /** The same predecessor terminal is consumed by genesis proofs of two or more distinct successor epochs. */
  | "epochlink-fork"
  /** epochLink lineage edges form a cycle among epochs: the claimed ordering is self-contradictory. */
  | "epochlink-cycle"
  /** epochLink's prevProofHashB64 matches an observed proof, but the link's declared epoch, key, or counter disagrees with that proof. */
  | "epochlink-mismatch"
  /** Two or more distinct signer keys appear within a single epochId. */
  | "mid-epoch-signer-change"
  /** Two or more distinct declared measurements appear within a single epochId. */
  | "mid-epoch-measurement-change"
  | (string & {});

/**
 * A single machine-readable audit finding.
 *
 * Findings are advisory observations about the bundle and its files. They
 * never change a proof's verification status; verification results live on
 * the ObservedProof records themselves.
 */
export interface AuditFinding {
  code: AnomalyCode;
  /** Bundle-root-relative path of the entry this finding is about, when applicable. */
  path?: string;
  /** Plain-language description. Consumers must key on `code`, not this text. */
  message: string;
  /** Extra machine-readable detail specific to the code. */
  details?: Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// Verification dimensions
// ---------------------------------------------------------------------------

/**
 * Which verification path ran for a proof.
 *
 *   "full"       verify() from @mikeargento/bitgraph-verify, with the
 *                original artifact bytes (content-addressed match found
 *                in the bundle). The artifact digest comparison ran.
 *   "integrity"  verifyProofIntegrity(): every check verify() performs
 *                except the artifact digest comparison. No artifact bytes
 *                were available. Artifact binding was NOT checked.
 */
export type VerificationTier = "full" | "integrity";

/**
 * Outcome of the verification pass for a proof.
 *
 *   "verified"             Full tier only: verify() passed with the
 *                          original artifact bytes.
 *   "failed"               The canonical checks failed at either tier.
 *                          The exact verifier reason is recorded.
 *   "artifact-unavailable" Integrity tier only: the bytes-free checks
 *                          passed, but no artifact bytes were present in
 *                          the bundle, so digest matching was not
 *                          independently checked. Never reported as
 *                          "verified".
 */
export type VerificationStatus = "verified" | "failed" | "artifact-unavailable";

/** Result of cross-checking an embedded proofHash field against the computed canonical hash. */
export type EmbeddedProofHashStatus = "absent" | "match" | "mismatch";

/**
 * Verification record attached to an ObservedProof by the verification
 * pass (verifyObservedProofs). Absent until that pass has run.
 */
export interface ProofVerification {
  tier: VerificationTier;
  status: VerificationStatus;
  /** Exact failure reason from the canonical verifier. Present only when status is "failed". */
  reason?: string;
  /** Bundle-root-relative path of the artifact bytes used. Full tier only. */
  artifactPath?: string;
}

// ---------------------------------------------------------------------------
// Observed proofs
// ---------------------------------------------------------------------------

/** One source file observed to carry a proof. */
export interface ProofSource {
  /** Bundle-root-relative path. */
  path: string;
  /** Lowercase hex SHA-256 over the file's raw bytes (byte-level identity, distinct from the canonical proof hash). */
  fileSha256Hex: string;
  /** Raw byte length of the file. */
  byteLength: number;
}

/**
 * A unique observed proof, keyed by canonical identity.
 *
 * Identity is the canonical proof hash (base64 SHA-256 over the canonical
 * signed body, computed by computeProofHash from
 * @mikeargento/bitgraph-verify). Byte-identical copies and re-encodings of
 * the same proof collapse into one ObservedProof with multiple sources.
 *
 * Chain metadata fields are extracted best-effort at ingest so that
 * reconstruction never needs to re-walk raw files. Structurally invalid
 * member candidates are still recorded here (the bundle spec requires it);
 * their missing fields stay undefined and their precise failure reason is
 * produced by the verification pass.
 */
export interface ObservedProof {
  /** Canonical identity: base64 SHA-256 over the canonical signed body. Always computed, never read from the file. */
  proofHash: string;
  /**
   * The parsed proof object, retained for the verification pass.
   * Report emitters serialize the compact metadata fields below, not this.
   */
  proof: import("@mikeargento/bitgraph-verify").BitGraphProof;
  /** Every source file observed carrying this canonical identity, in observation order. */
  sources: ProofSource[];

  /** Schema version. Members are always exactly "bitgraph/1" (version policy). */
  version: "bitgraph/1";
  /** commit.counter when present (decimal string, epoch-local and chain-local). */
  counter?: string;
  /** commit.slotCounter when present: the counter position consumed by this proof's slot. */
  slotCounter?: string;
  /** commit.prevB64 when present: canonical hash of the predecessor proof in the same epoch and chain. */
  prevB64?: string;
  /** commit.epochId when present. */
  epochId?: string;
  /**
   * Chain identifier from the signed commit body. The live enclave injects
   * this as an undeclared field for non-default chains; a proof without it
   * belongs to the enclave's default chain, normalized here to the literal
   * string "global".
   */
  chainId: string;
  /** signer.publicKeyB64, when structurally present. */
  publicKeyB64?: string;
  /** environment.measurement (declared, self-reported), when structurally present. */
  measurement?: string;
  /** environment.enforcement (declared, self-reported), when structurally present. */
  enforcement?: string;

  /** Whether a slotAllocation record is embedded. */
  hasSlotAllocation: boolean;
  /** Whether an environment.attestation document is present. Presence alone proves nothing. */
  hasAttestation: boolean;
  /** Whether an agency envelope is present. */
  hasAgency: boolean;
  /** Whether commit.epochLink is present (epoch lineage evidence). */
  hasEpochLink: boolean;

  /** Cross-check of any embedded proofHash field (stored-form proofs) against the computed canonical hash. */
  embeddedProofHash: EmbeddedProofHashStatus;

  /**
   * True when the proof carries neither commit.counter nor commit.epochId:
   * observed-but-unchained. Permitted by the schema, reported separately,
   * not an anomaly.
   */
  chainless: boolean;

  /** Filled by the verification pass (verifyObservedProofs). */
  verification?: ProofVerification;
}

// ---------------------------------------------------------------------------
// Rejected inputs
// ---------------------------------------------------------------------------

/**
 * A proof-shaped file rejected under the version policy: the audit system
 * supports exactly bitgraph/1. Rejected inputs are counted and listed but
 * are excluded from verification, chain reconstruction, and anomaly
 * analysis. They are not observed objects and not chain members.
 */
export interface UnsupportedVersionRecord {
  code: "unsupported-version";
  /** Bundle-root-relative path. */
  path: string;
  /** The offending version string exactly as it appeared. */
  version: string;
  /** Lowercase hex SHA-256 over the file's raw bytes. */
  fileSha256Hex: string;
}

// ---------------------------------------------------------------------------
// Artifacts and witnesses
// ---------------------------------------------------------------------------

/**
 * A candidate artifact: any entry that is not a member proof, not an anchor
 * witness, and not the root manifest. Indexed by content hash for
 * content-addressed matching against proof digests. Filenames are never
 * load-bearing.
 */
export interface ArtifactRecord {
  /** Lowercase hex SHA-256 over the entry's raw bytes. */
  sha256Hex: string;
  /** The same digest in standard base64, the form proofs carry in artifact.digestB64. */
  sha256B64: string;
  /** Raw byte length. */
  byteLength: number;
  /** Every path holding these exact bytes, in observation order. Byte-identical copies create no ambiguity. */
  paths: string[];
  /** Canonical hashes of every observed proof whose artifact digest equals this content hash. One artifact may satisfy many proofs. */
  matchedProofHashes: string[];
}

/**
 * An anchor witness file discovered by its version discriminator
 * ("bitgraph-anchor-witness/1"). Ingest records it; the anchor analysis
 * stage performs the mandatory verification procedure of the bundle spec
 * (section 10.3). An unverified witness confers nothing.
 */
export interface AnchorWitnessFile {
  /** Bundle-root-relative path. */
  path: string;
  /** Lowercase hex SHA-256 over the file's raw bytes. */
  fileSha256Hex: string;
  /** The parsed witness object, unvalidated beyond the version discriminator. */
  witness: Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// Manifest
// ---------------------------------------------------------------------------

/**
 * The optional root manifest, as declared by the producer. Every field is
 * unsigned and advisory; the consumer cross-checks and reports, it never
 * treats manifest fields as evidence about proofs, ordering, or time.
 */
export interface BundleManifest {
  version: string;
  epochIds?: string[];
  chainIds?: string[];
  proofCount?: number;
  counterRanges?: Array<{ epochId: string; chainId: string; min: string; max: string }>;
  generatedAt?: string;
  contentsHashB64?: string;
  artifactsIncluded?: boolean;
  openEpochs?: Array<{ epochId: string; counterAtSnapshot: string }>;
  /** Unknown fields are tolerated and preserved here untyped. */
  [key: string]: unknown;
}

/** What the consumer found at the reserved root path manifest.json. */
export interface ManifestReport {
  /** Always "manifest.json"; the only load-bearing filename in the format. */
  path: string;
  /** Whether the file parsed as a single JSON object. */
  parsed: boolean;
  /** The raw version value when parsed, whatever it was. */
  version?: string;
  /** Whether version was exactly "bitgraph-bundle/1". When false the manifest is reported but not interpreted. */
  recognized: boolean;
  /** The manifest object, present when parsed and recognized. */
  manifest?: BundleManifest;
  /** Field validation problems per the bundle spec section 7.1. Advisory. */
  problems: string[];
  /** Contents hash comparison, present when the manifest declared contentsHashB64. */
  contentsHash?: {
    declaredB64: string;
    computedB64: string;
    match: boolean;
  };
}

// ---------------------------------------------------------------------------
// Ingest result
// ---------------------------------------------------------------------------

/** Accepted container forms per the bundle spec section 4. */
export type ContainerKind = "directory" | "tar" | "tar-gz";

export interface IngestCounts {
  /** Unique observed proofs by canonical identity. */
  observed: number;
  /** Proof-carrying files, including duplicate copies. */
  proofFiles: number;
  /** Byte-identical duplicate proof files beyond the first copy. */
  exactDuplicates: number;
  /** Re-encoded duplicate proof files (same canonical identity, different bytes) beyond the first copy. */
  semanticDuplicates: number;
  /** Proof-shaped files rejected under the version policy. */
  unsupportedVersion: number;
  /** Candidate artifact files (unique by content hash). */
  artifacts: number;
  /** Anchor witness files. */
  witnesses: number;
  /** Container entries skipped for unsafe paths. */
  skippedUnsafePaths: number;
}

/**
 * Everything the ingest pass learned about a bundle.
 *
 * Memory shape: proofs, witnesses, and per-entry metadata are held in
 * memory (O(number of entries) plus the parsed proof objects themselves);
 * artifact bytes are never retained, only their streaming hashes. The
 * verification pass re-reads matched artifact bytes one artifact at a time.
 */
export interface IngestResult {
  /** The path the bundle was opened from, exactly as given. */
  bundlePath: string;
  container: ContainerKind;
  /**
   * Present when the tar container had a single common top-level directory
   * that was stripped per the bundle spec section 4.1 (the usual result of
   * `tar -czf bundle.tgz mybundle/`). All reported paths are relative to
   * the stripped root.
   */
  strippedRootPrefix?: string;
  /** Total regular-file entries scanned, including skipped and duplicate-path entries. */
  entriesScanned: number;

  /** Unique observed proofs in first-observation order. */
  proofs: ObservedProof[];
  /** Proof-shaped files rejected under the version policy. */
  unsupportedVersions: UnsupportedVersionRecord[];
  /** Candidate artifacts, unique by content hash, in first-observation order. */
  artifacts: ArtifactRecord[];
  /** Anchor witness files in observation order. */
  witnesses: AnchorWitnessFile[];
  /** Present when a root manifest.json entry existed. */
  manifest?: ManifestReport;

  /**
   * The deterministic contents hash computed over every final entry except
   * the root manifest.json, per the bundle spec section 8. Computed whether
   * or not a manifest declared one.
   */
  computedContentsHashB64: string;

  /** Machine-readable findings, in detection order. */
  findings: AuditFinding[];
  counts: IngestCounts;
}

// ---------------------------------------------------------------------------
// Verification pass
// ---------------------------------------------------------------------------

/** Options for the verification pass. */
export interface VerifyObservedOptions {
  /**
   * Optional policy constraints passed through unchanged to the canonical
   * verifier (both verify() and verifyProofIntegrity()).
   */
  trustAnchors?: import("@mikeargento/bitgraph-verify").VerificationPolicy;
}

/** Aggregate outcome of the verification pass. */
export interface VerificationSummary {
  /** Unique proofs processed. */
  total: number;
  /** Full tier, canonical verify() passed with artifact bytes. */
  verified: number;
  /** Canonical checks failed at either tier. */
  failed: number;
  /** Integrity checks passed but no artifact bytes were available; binding not independently checked. */
  artifactUnavailable: number;
  /** Proofs with neither counter nor epochId (observed-but-unchained). Informational; orthogonal to status. */
  chainless: number;
}

/** One matched artifact's bytes, yielded by streamMatchedArtifacts. */
export interface MatchedArtifactBytes {
  /** Lowercase hex SHA-256 of the bytes. */
  sha256Hex: string;
  /** Bundle-root-relative path the bytes were read from. */
  path: string;
  bytes: Uint8Array;
}

// ---------------------------------------------------------------------------
// Chain reconstruction (Phase 4b)
// ---------------------------------------------------------------------------

/**
 * A partition of the observed record: one signer lineage on one chain in
 * one epoch, per G6. Multiple signer lineages are never merged. Proofs
 * that carry a counter but no epochId partition with epochId absent.
 */
export interface PartitionKey {
  /** signer.publicKeyB64. */
  publicKeyB64: string;
  /** commit.epochId; absent when the proof carries a counter without an epochId. */
  epochId?: string;
  /** Chain identifier, normalized to "global" when the signed body omits it. */
  chainId: string;
}

/**
 * A connected chain component reconstructed from prevB64 hash links.
 *
 * Hash links are the primary reconstruction evidence: an edge exists from
 * proof P to proof S exactly when S's commit.prevB64 equals P's canonical
 * proof hash and both are members of the same partition. Counters are
 * ordering and anomaly evidence, never the reconstruction mechanism.
 */
export interface ChainComponent {
  /**
   * Member canonical hashes in link order: a deterministic traversal from
   * the component's genesis and broken-link entry points, following
   * successor hash links (branches ordered by counter, then hash).
   */
  memberProofHashes: string[];
  /** Members with no prevB64 field at all: epoch genesis candidates (normal per G1). */
  genesisProofHashes: string[];
  /** Members whose prevB64 did not resolve to any member of this partition (chain-break entry points). */
  brokenLinkProofHashes: string[];
  /** Members with no observed successor in this partition. */
  terminalProofHashes: string[];
  /** Whether any member carries a parseable commit counter or slot counter. */
  hasCounterEvidence: boolean;
  /** Min and max over all parseable commit and slot counter positions of the members. */
  positionRange?: { min: string; max: string };
}

/** One partition's reconstructed chain structure. */
export interface ChainPartition {
  key: PartitionKey;
  /** All member canonical hashes, sorted by counter evidence then hash. */
  memberProofHashes: string[];
  /** Connected components, sorted by lowest counter position then first member hash. */
  components: ChainComponent[];
}

/** The six epochLink fields exactly as declared in the signed commit body. */
export interface EpochLinkFields {
  prevEpochId: string;
  prevPublicKeyB64: string;
  prevCounter: string;
  prevProofHashB64: string;
  toEpochId: string;
  toPublicKeyB64: string;
}

/**
 * Analysis of one observed epochLink: cross-epoch lineage evidence per G1.
 *
 *   "matched"           prevProofHashB64 equals the canonical hash of an
 *                       observed proof.
 *   "terminal-missing"  the prior epoch is observed, but the referenced
 *                       terminal proof is absent from the bundle.
 *   "dangling"          neither the referenced proof nor the prior epoch
 *                       is observed.
 */
export interface EpochLineageEdge {
  /** Predecessor epoch, from the link. */
  fromEpochId: string;
  /** Successor epoch, from the link. */
  toEpochId: string;
  /** Canonical hash of the proof carrying the epochLink. */
  viaProofHash: string;
  /** The declared link fields (part of the signed body of the via proof). */
  link: EpochLinkFields;
  resolution: "matched" | "terminal-missing" | "dangling";
  /** Canonical hash of the observed predecessor proof. Matched only. */
  predecessorProofHash?: string;
  /** Whether the observed predecessor's epochId, signer key, and counter agree with the link's declared fields. Matched only. */
  metadataConsistent?: boolean;
  /** Plain-language descriptions of each disagreement. Matched and inconsistent only. */
  inconsistencies?: string[];
  /** Whether the observed predecessor has no observed successor within its own partition. Matched and partitioned predecessors only. */
  referencedProofIsTerminal?: boolean;
  /**
   * Intrinsic cryptographic validity of the via proof: run verification
   * status when it passed, otherwise an isolated bytes-free recheck that
   * is immune to run-order effects (the epoch link single-successor check
   * depends on verification order) and to supplied trust policy.
   */
  viaProofValid: boolean;
  /** Intrinsic validity of the observed predecessor. Matched only. */
  predecessorValid?: boolean;
  /**
   * True when this edge is hard cross-epoch ordering evidence: matched,
   * metadata-consistent, and both proofs intrinsically valid. Only hard
   * edges derive epoch ordering.
   */
  hardEdge: boolean;
}

/**
 * Typed extension point for anchor-derived one-sided temporal bounds.
 * Reconstruction always leaves EpochRecord.anchorBounds undefined; the
 * anchor analysis stage (Phase 4c) populates it from verified anchor
 * evidence. Overlapping or absent bounds mean concurrent-or-unordered,
 * never divergence.
 */
export interface EpochAnchorBound {
  /**
   * "not-after": proofs of this epoch existed before the referenced
   * anchor evidence. "not-before": they came after it. Always one-sided.
   */
  kind: "not-after" | "not-before";
  /** Canonical hash of the anchor proof providing the bound. */
  anchorProofHash: string;
  /** Ethereum block number parsed from the signed anchor title URL (decimal string). */
  blockNumber?: string;
  /** Ethereum block hash from the signed attribution message. */
  blockHash?: string;
  /**
   * Unix seconds from an offline-verified anchor witness header. Present
   * only when witness material allowed local reconstruction of the block
   * hash. Never sourced from unsigned metadata.
   */
  witnessTimestamp?: number;
}

/** One observed epoch, aggregated across chains and partitions. */
export interface EpochRecord {
  epochId: string;
  /** Chains on which this epoch produced observed proofs, sorted. */
  chainIds: string[];
  /** Distinct signer keys observed under this epochId, sorted. One is normal; more is an authority anomaly. */
  publicKeysB64: string[];
  /** Unique observed proofs carrying this epochId. */
  proofCount: number;
  /**
   * "linked" when the epoch participates in at least one hard epochLink
   * lineage edge. "observed-but-unordered" otherwise: the bundle contains
   * no verified evidence ordering this epoch against any other. Epochs
   * without lineage or anchor evidence are concurrent-or-unordered
   * relative to each other, which is never divergence.
   */
  ordering: "linked" | "observed-but-unordered";
  /** Epochs verified to come directly before this one (hard edges only). */
  linkedPredecessorEpochIds: string[];
  /** Epochs verified to come directly after this one (hard edges only). */
  linkedSuccessorEpochIds: string[];
  /** Anchor-derived one-sided bounds. Undefined until the anchor analysis stage (Phase 4c) populates it. */
  anchorBounds?: EpochAnchorBound[];
}

/** Cross-epoch relationships per G1: independent chains, ordered only by verified evidence. */
export interface EpochRelationshipResult {
  /** Observed epochs, sorted by epochId. */
  epochs: EpochRecord[];
  /** Every observed epochLink, analyzed. Includes non-hard edges with their failure modes. */
  edges: EpochLineageEdge[];
  /**
   * Transitive ordering derived from hard lineage edges only. Pairs whose
   * evidence is contradictory (reachable in both directions, which only a
   * lineage cycle produces) are removed rather than asserted either way.
   * Epoch pairs absent from this list are concurrent-or-unordered.
   */
  orderedPairs: Array<{ beforeEpochId: string; afterEpochId: string }>;
}

/** Everything the reconstruction pass derived from an ingested bundle. */
export interface ReconstructionResult {
  /** Partitions per (signer key, epochId, chainId), deterministically sorted. */
  partitions: ChainPartition[];
  /** Canonical hashes of chainless proofs (neither counter nor epochId): observed-but-unchained, outside all partitions, not an anomaly. */
  unchainedProofHashes: string[];
  /** Canonical hashes of proofs carrying chain fields but no signer key: they cannot join a signer lineage. */
  unpartitionedProofHashes: string[];
  epochRelationships: EpochRelationshipResult;
}

// ---------------------------------------------------------------------------
// Anomaly classification (Phase 4b)
// ---------------------------------------------------------------------------

/**
 * A chain-level anomaly: a structural observation about the reconstructed
 * record. Chain topology and verification status are separate dimensions:
 * an anomaly never changes a proof's verification status, and a verifier
 * failure is never reinterpreted as a chain anomaly.
 */
export interface ChainAnomaly {
  code: AnomalyCode;
  /** The partition this anomaly is scoped to, when partition-scoped. */
  partition?: PartitionKey;
  /** Canonical hashes of the observed proofs involved. Empty when the anomaly is about absent proofs. */
  proofHashes: string[];
  /** Plain language. Consumers key on `code`, never on this text. */
  message: string;
  /** Machine-readable detail specific to the code. All values are JSON-safe strings, arrays, or objects. */
  details?: Record<string, unknown>;
}

/**
 * Detail payload of an "unexplained-counter-positions" anomaly (G2).
 * A position is explained when it is some observed proof's commit counter
 * or is referenced by some observed proof's slotCounter. Every proof
 * consumes two positions; slot positions never produce stored proofs.
 */
export interface UnexplainedPositionsDetail {
  /** Total unexplained positions, decimal string (BigInt-safe). */
  count: string;
  /** Contiguous unexplained ranges, ascending, inclusive. */
  ranges: Array<{ start: string; end: string }>;
  /** Flat position list, ascending, capped; see truncated. */
  positions: string[];
  /** True when count exceeded the flat-list cap and positions is incomplete. Ranges are always complete. */
  truncated: boolean;
}

/** The conflicts that produce divergence records. */
export type DivergenceKind =
  | "counter-collision"
  | "slot-collision"
  | "predecessor-reuse"
  | "multiple-genesis"
  | "epochlink-fork";

/** One competing (or context) proof in a divergence, with everything a reader needs to adjudicate. */
export interface DivergenceParty {
  proofHash: string;
  /** Every bundle path this proof was observed at. */
  sourcePaths: string[];
  verificationTier?: VerificationTier;
  verificationStatus?: VerificationStatus;
  verificationReason?: string;
  counter?: string;
  slotCounter?: string;
  prevB64?: string;
  publicKeyB64?: string;
  epochId?: string;
  chainId: string;
  measurement?: string;
}

/**
 * A conflict between valid proof objects. All parties are preserved; the
 * audit never selects a winner by file order, counter height, verification
 * order, or any other heuristic. The reader adjudicates.
 *
 * Cryptographically invalid proofs related to the same conflict appear in
 * invalidContext, never among the competing parties. Intrinsic validity is
 * assessed independently of run-order effects (the epoch link
 * single-successor check fails whichever consumer verifies second) and of
 * supplied trust policy; the recorded run verification status of every
 * party is shown unmodified.
 */
export interface DivergenceRecord {
  kind: DivergenceKind;
  /** The partition the conflict occurred in, when partition-scoped. */
  partition?: PartitionKey;
  /** The contested resource, e.g. { counter: "18442" } or { prevB64: "..." }. */
  contested: Record<string, string>;
  /** Valid competing branches. Always two or more. */
  parties: DivergenceParty[];
  /** Cryptographically invalid observed proofs involved in the same conflict. Context only, never competing branches. */
  invalidContext: DivergenceParty[];
  /** Plain-language structural explanation of the conflict. */
  explanation: string;
}

/** Output of the anomaly classification pass. */
export interface AnomalyReport {
  /** Chain anomalies in deterministic order (partition order, then detection order within a partition). */
  anomalies: ChainAnomaly[];
  /** Divergence records for every conflict between valid proofs. */
  divergences: DivergenceRecord[];
}

// ---------------------------------------------------------------------------
// Authority analysis (Phase 4b)
// ---------------------------------------------------------------------------

/**
 * Attested-measurement evidence for an authority group.
 *
 * TYPED EXTENSION POINT: authority analysis never populates this. The
 * attestation validation stage (Phase 4c) fills it after cryptographically
 * validating attestation documents offline. Declared measurement
 * (environment.measurement, self-reported) and attested measurement (from
 * a validated attestation document) are never conflated: the fields live
 * apart and the declared value never appears here.
 */
export interface AttestedMeasurementEvidence {
  status: "validated" | "validation-failed" | "unsupported";
  /** PCR0 measurement extracted from a cryptographically validated attestation document. */
  attestedMeasurement?: string;
  /** Whether the attested measurement equals the declared environment.measurement. */
  matchesDeclared?: boolean;
}

/** One authority group: proofs sharing declared measurement, signer key, epoch, chain, and attestation presence. */
export interface AuthorityGroup {
  /** Declared environment.measurement (self-reported; presence proves nothing). */
  measurement?: string;
  publicKeyB64?: string;
  epochId?: string;
  chainId: string;
  /** Whether an attestation document is present on these proofs. Presence alone is not validation. */
  attestationPresent: boolean;
  /** Canonical hashes of member proofs, in observation order. */
  proofHashes: string[];
  /** Filled by the attestation validation stage (Phase 4c). Always undefined here. */
  attested?: AttestedMeasurementEvidence;
}

/** A signer key observed under more than one epochId: normal epoch-transition evidence, never an anomaly. */
export interface SignerEpochSpan {
  publicKeyB64: string;
  /** Sorted epochIds this key signed under. */
  epochIds: string[];
}

/** Output of the authority analysis pass. */
export interface AuthorityAnalysis {
  /** Authority groups, deterministically sorted. */
  groups: AuthorityGroup[];
  /** mid-epoch-signer-change and mid-epoch-measurement-change anomalies. */
  anomalies: ChainAnomaly[];
  /** Same-signer-across-epochs observations (normal transition evidence). */
  sharedSignersAcrossEpochs: SignerEpochSpan[];
}
