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
  /** Counter positions inside a partition's observed range that are neither a commit counter nor a referenced slot counter. Each may be a proof absent from the bundle or a slot that was allocated but never committed (routine); the audit cannot distinguish these offline and never asserts authority failure. */
  | "unexplained-counter-positions"
  /** Two or more valid non-identical proofs claim the same commit counter in one partition. */
  | "counter-collision"
  /** Two or more valid non-identical proofs reference the same slot counter in one partition. */
  | "slot-collision"
  /** A commit counter value in one proof equals a different valid proof's slotCounter in the same partition: one causal position double-allocated across kinds. Only possible through enclave malfunction, replay, or compromise. */
  | "cross-kind-position-reuse"
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
  // --- Anchor analysis, witness verification, attestation validation (Phase 4c) ---
  /** Signed attribution identifies an Ethereum anchor, but the unsigned metadata.type is present and disagrees. The signed field governs. */
  | "anchor-metadata-disagreement"
  /** Unsigned metadata claims ethereum-anchor, but the signed attribution does not. Metadata alone never makes a proof an anchor. */
  | "anchor-metadata-only-claim"
  /** An anchor's signed attribution.title does not parse as an Etherscan block URL; the signed block number is treated as absent. */
  | "anchor-title-unparseable"
  /** Anchor witness file fails the field rules of the bundle spec (section 10.2). Confers nothing. */
  | "witness-malformed"
  /** Anchor witness headerRlpHex is not a single well-formed RLP list. Confers nothing. */
  | "witness-rlp-invalid"
  /** Witness header decoded and hashed correctly, but the RLP items at index 8 (number) or 11 (timestamp) are missing or not byte strings. */
  | "witness-header-shape"
  /** Locally recomputed block hash does not equal the anchor's signed attribution.message (spec 10.3 step 3). */
  | "witness-hash-mismatch"
  /** SHA-256 of the exact signed attribution.message string does not equal the anchor's artifact digest (spec 10.3 step 4). */
  | "witness-digest-mismatch"
  /** The header's number field disagrees with the witness's claimed blockNumber or the signed Etherscan URL (spec 10.3 step 5). */
  | "witness-block-number-mismatch"
  /** The witness's claimed blockHash does not equal the locally recomputed block hash (spec 10.3 step 5). */
  | "witness-claimed-hash-mismatch"
  /** The candidate anchor proof is not cryptographically valid; a witness cannot rescue an invalid proof (spec 10.3 preconditions). */
  | "witness-anchor-invalid"
  /** The witness's reconstructed (and claimed) block hash matches no observed anchor's signed attribution.message. */
  | "witness-unmatched"
  /** An attestation document is present but failed offline cryptographic validation (COSE, chain, root, or validity window). */
  | "attestation-invalid"
  /** A validated attestation document's PCR0 does not equal the proof's declared environment.measurement. */
  | "attestation-measurement-mismatch"
  /** A validated attestation document's user_data is not bound to this proof's canonical proof hash. */
  | "attestation-user-data-mismatch"
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
  /** Canonical identity: base64 SHA-256 over the canonical signed body (computeProofHash). Used for dedup and identity, NOT for chain linking. Always computed, never read from the file. */
  proofHash: string;
  /** Chain-link identity: base64 SHA-256 over the canonical WHOLE proof minus the ledger-added proofHash (computeChainHash). This is the value a successor's commit.prevB64 (and epochLink.prevProofHashB64) references. Always computed. */
  chainHash: string;
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
/**
 * "memory" is an ingestEntries() result: entries supplied by the caller
 * with no container on disk. bundlePath is then the caller's label (or "").
 */
export type ContainerKind = "directory" | "tar" | "tar-gz" | "memory";

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
 * Resource caps applied to untrusted .tar / .tar.gz ingest so a crafted
 * archive (a decompression bomb, a header declaring an absurd size, or a
 * flood of tiny entries) aborts with a clear error instead of exhausting
 * memory. Directory bundles are already materialized on disk and are not
 * capped here. All caps are well above legitimate bundle sizes; the
 * defaults are DEFAULT_INGEST_LIMITS.
 */
export interface IngestLimits {
  /**
   * Ceiling on the total number of decompressed bytes read from a tar or
   * tar.gz container across the whole archive. Exceeding it aborts ingest.
   */
  maxTotalBytes: number;
  /**
   * Ceiling on the number of tar entries (headers) processed. Exceeding it
   * aborts ingest, bounding a flood of zero-length entries.
   */
  maxEntryCount: number;
  /**
   * Ceiling on the size of a single tar metadata entry that is buffered
   * whole (PAX extended headers and GNU long-name entries). A header
   * declaring a larger size aborts ingest before any allocation.
   */
  maxMetadataEntryBytes: number;
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
  /**
   * Which of the epoch's proofs this bound covers. Anchors sit inside
   * epochs, so a bound never covers a whole epoch: a "not-before" bound
   * covers members causally after its anchor, a "not-after" bound covers
   * members causally before its anchor. The uncovered remainder has no
   * bound from this anchor.
   */
  coverage?: "members-before-anchor" | "members-after-anchor";
  /** How many of the epoch's partitioned proofs this bound covers. */
  coveredProofCount?: number;
  /** Total partitioned proofs observed for the epoch. */
  totalProofCount?: number;
  /**
   * What grounds the bound. "block-hash-unpredictability" (not-before):
   * the block hash was unpredictable before the block's timestamp and the
   * covered proofs embed it through the chain. "causal-precedence"
   * (not-after): the covered proofs existed before the anchor commit,
   * which is proven to be no earlier than the block timestamp; reading the
   * timestamp as a wall-clock ceiling additionally assumes the anchor
   * consumed a recently published block.
   */
  basis?: "block-hash-unpredictability" | "causal-precedence";
  /**
   * Evidence class of the representative bound this epoch bound rests on
   * (the minimum-timestamp bound for not-before, the maximum-timestamp
   * bound for not-after): "chain-link" (a verified prevB64 hash-link path)
   * or "counter-order" (commit-counter ordering only, which relies on the
   * authority's counter discipline). Undefined until the temporal stage
   * (Phase 4c) populates it.
   */
  evidence?: BoundEvidence;
  /** True when evidence is "counter-order": the epoch bound rests on weaker evidence. */
  weaker?: boolean;
  /** Plain-language statement of exactly what this bound claims. */
  claim?: string;
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
 * A chain link whose predecessor is absent from the supplied bundle: the
 * earliest proof of a reconstructed run points to history that precedes the
 * exported window.
 *
 * This is the EXPECTED boundary of any bounded excerpt (a single-file proof
 * bundle, a small batch), NOT a chain-integrity defect: a validly signed,
 * attested proof only comes into existence by extending the chain (the
 * fail-closed construction property), so its own existence is evidence it
 * occupied a real position; the predecessor is simply not included in this
 * export. A full-epoch export has NO boundary entry points, its earliest
 * proof is the epoch genesis, which carries no prevB64 at all. An INTERIOR
 * hole never masquerades as a boundary: a missing mid-chain proof both
 * fragments the component (so the successor becomes its own component's
 * boundary) AND surfaces as an `unexplained-counter-positions` anomaly within
 * the observed range, which still trips the exit code.
 *
 * Boundary entry points are informational: they never set the exit code and
 * never mark a partition non-intact. The count is surfaced in the summary so a
 * full-epoch audit (which expects zero) makes a stray boundary visible.
 */
export interface BoundaryEntryPoint {
  /** The partition this boundary is scoped to. */
  partition: PartitionKey;
  /** The proof whose commit.prevB64 references a predecessor absent from the bundle. */
  proofHash: string;
  /** The unresolved predecessor chain hash (standard base64). */
  prevB64: string;
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
  | "cross-kind-position-reuse"
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
  /**
   * Expected excerpt boundaries: a bundle's earliest proofs whose predecessor
   * precedes the exported window. Informational only, never affects the exit
   * code or partition intactness. Zero for a full-epoch export.
   */
  boundaryEntryPoints: BoundaryEntryPoint[];
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
  /** PCR0 measurement extracted from a cryptographically validated attestation document. Present when the group's validated documents attest exactly one value. */
  attestedMeasurement?: string;
  /** Whether the attested measurement equals the declared environment.measurement. */
  matchesDeclared?: boolean;
  /** Member proofs whose attestation documents validated. */
  validatedProofCount?: number;
  /** Member proofs whose attestation documents failed validation. */
  failedProofCount?: number;
  /** All distinct PCR0 values attested by the group's validated documents, when more than one. */
  attestedMeasurements?: string[];
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

// ---------------------------------------------------------------------------
// Anchor analysis (Phase 4c)
// ---------------------------------------------------------------------------

/**
 * How the unsigned metadata relates to the signed anchor identification.
 * The signed attribution.name is the discriminator; metadata.type is
 * corroboration only and is never trusted alone.
 */
export type AnchorMetadataCorroboration = "agrees" | "disagrees" | "absent";

/**
 * One identified Ethereum anchor proof (G5): an ordinary chain member
 * whose SIGNED attribution.name is exactly "Ethereum Anchor".
 *
 * Everything here comes from the signed body or the run verification
 * record. The block timestamp is deliberately absent: it exists only in
 * unsigned metadata (never trusted) and in verified witness headers
 * (see AnchorWitnessOutcome). No wall-clock time is ever derived from a
 * block number.
 */
export interface AnchorRecord {
  /** Canonical proof hash of the anchor proof. */
  proofHash: string;
  epochId?: string;
  chainId: string;
  /** Commit counter (the anchor's causal position in its partition). */
  counter?: string;
  slotCounter?: string;
  /** The Ethereum block hash string from the SIGNED attribution.message, exactly as signed. */
  blockHash?: string;
  /**
   * Block number parsed from the SIGNED Etherscan URL in
   * attribution.title (decimal string). Absent when the title is missing
   * or does not parse; unparseable titles are reported, never guessed.
   */
  blockNumber?: string;
  metadataCorroboration: AnchorMetadataCorroboration;
  /** Run verification record, copied from the observed proof. */
  verificationTier?: VerificationTier;
  verificationStatus?: VerificationStatus;
  verificationReason?: string;
}

/** Output of the anchor identification pass. */
export interface AnchorIdentification {
  /** Identified anchors, in observation order. */
  anchors: AnchorRecord[];
  /**
   * Proofs whose unsigned metadata claims ethereum-anchor while the
   * signed attribution does not. Never treated as anchors.
   */
  metadataOnlyProofHashes: string[];
  /** anchor-metadata-disagreement, anchor-metadata-only-claim, anchor-title-unparseable findings. */
  findings: AuditFinding[];
}

// ---------------------------------------------------------------------------
// Anchor witness verification (Phase 4c, bundle spec section 10)
// ---------------------------------------------------------------------------

/**
 * Outcome of the mandatory witness verification procedure (bundle spec
 * 10.3) for one witness file against one candidate anchor. A witness
 * confers evidence only when verified is true; any failure means it
 * confers nothing and the anchor proof's own standing is unchanged.
 */
export interface AnchorWitnessOutcome {
  /** Bundle-root-relative path of the witness file. */
  witnessPath: string;
  /** Canonical hash of the candidate anchor proof. Absent when the witness matched no anchor or failed before matching. */
  anchorProofHash?: string;
  verified: boolean;
  /** Stable failure code. Present exactly when verified is false. */
  reason?: AnomalyCode;
  /** Plain-language failure detail. Consumers key on reason. */
  detail?: string;
  /** Locally recomputed Keccak-256 block hash (0x + 64 lowercase hex), when the header decoded. */
  computedBlockHash?: string;
  /** Block number from the header's RLP index 8 (decimal string), when read. */
  blockNumber?: string;
  /**
   * Unix seconds from the header's RLP index 11. PRESENT ONLY when every
   * verification step passed: this is the external wall-clock evidence.
   */
  timestamp?: number;
}

/** Output of the witness verification pass. */
export interface AnchorWitnessAnalysis {
  /** One outcome per (witness, candidate anchor) pair, plus one per unusable or unmatched witness. */
  outcomes: AnchorWitnessOutcome[];
  /** witness-* findings for every failure, in detection order. */
  findings: AuditFinding[];
}

// ---------------------------------------------------------------------------
// Temporal bounds (Phase 4c)
// ---------------------------------------------------------------------------

/**
 * What relates a bounded proof to the anchor supplying the bound.
 *
 *   "chain-link"     a verified prevB64 hash-link path connects the proof
 *                    and the anchor within the partition. The relation is
 *                    independently checkable from the objects themselves.
 *   "counter-order"  only the commit counters order them. This relies on
 *                    the authority's per-chain counter discipline rather
 *                    than verifiable hash links, and is marked weaker.
 */
export type BoundEvidence = "chain-link" | "counter-order";

/**
 * One one-sided temporal bound on a segment, derived from a verified
 * anchor witness. Never an interval by itself, and never a statement of
 * any individual proof's exact creation time.
 *
 * Bound semantics, stated precisely:
 *
 *   "not-before": the covered proofs were COMMITTED no earlier than the
 *   block timestamp. Grounded in block-hash unpredictability: the hash
 *   did not exist before the block, the anchor commit consumed it, and
 *   the covered proofs come after the anchor. This additionally assumes
 *   the anchored header is a genuine, publicly published Ethereum block:
 *   the offline audit checks the header's structure and hash binding, not
 *   proof-of-work, consensus, or chain membership, so it cannot confirm
 *   the block is real. Sound along chain-link evidence, subject to that
 *   assumption.
 *
 *   "not-after": the covered proofs existed before the anchor commit
 *   that consumed a block published at the timestamp. The block
 *   timestamp proves the anchor commit came AT OR AFTER it, not how
 *   promptly, so reading the timestamp as a wall-clock ceiling
 *   additionally assumes the anchor consumed a recently published block
 *   (the deployed anchor service commits the latest block on a short
 *   interval, but that is service behavior, not proof). The causal
 *   precedence itself is sound along chain-link evidence.
 */
export interface SegmentBound {
  kind: "not-before" | "not-after";
  anchorProofHash: string;
  /** Block number confirmed by the verified witness header (decimal string). */
  blockNumber?: string;
  /** Locally recomputed block hash (0x + 64 lowercase hex). */
  blockHash: string;
  /** Unix seconds from the verified witness header. */
  timestamp: number;
  evidence: BoundEvidence;
  /** True for counter-order evidence: weaker, as documented on BoundEvidence. */
  weaker: boolean;
  basis: "block-hash-unpredictability" | "causal-precedence";
  /**
   * Whether this bound is EVIDENCE or an ASSUMPTION, stated as a machine field
   * so no consumer has to parse the claim text to find out.
   *
   *   "evidence"   not-before: the block hash could not exist before its block,
   *                so proofs chained after the anchor were committed no earlier
   *                than the block time (assuming a canonical public header).
   *   "assumption" not-after: the covered proofs precede the ANCHOR COMMIT, and
   *                the block time bounds that commit from below, not the proofs
   *                from above. Reading it as a ceiling assumes the anchor consumed
   *                a recently published block. An inbound anchor cannot supply a
   *                proof-carried upper bound.
   */
  boundClass: "evidence" | "assumption";
  /** Plain-language statement of exactly what this bound claims and assumes. */
  claim: string;
}

export type TemporalSegmentStatus =
  /**
   * A verified not-before bound AND a following verified anchor. Deliberately not
   * called "bracketed": the following anchor's block time is an assumption about
   * anchor latency, not a proof-carried upper bound on these proofs.
   */
  | "lower-bounded-with-following-anchor"
  | "lower-bounded"
  | "upper-bounded"
  /** No verified anchor evidence relates to these proofs. Their causal order stands; no wall-clock claim is made. */
  | "ordered-but-unanchored";

/**
 * A group of proofs in one partition sharing the same verified-anchor
 * bound set. Bounds attach to segments, never to individual proofs.
 */
export interface TemporalSegment {
  partition: PartitionKey;
  /** Member canonical hashes, ordered by counter evidence then hash. */
  memberProofHashes: string[];
  /** Min and max over the members' parseable commit and slot counter positions. */
  positionRange?: { min: string; max: string };
  status: TemporalSegmentStatus;
  /**
   * Tightest not-before bounds, tightest first. At most two entries: the
   * tightest overall, plus the tightest chain-link bound when the overall
   * tightest rests only on counter ordering.
   */
  lowerBounds: SegmentBound[];
  /** Tightest not-after bounds, same structure as lowerBounds. */
  upperBounds: SegmentBound[];
}

/**
 * Anchor-derived cross-epoch ordering evidence. Always about the COVERED
 * portions of the two epochs (see EpochAnchorBound.coverage), and always
 * dependent on the not-after freshness assumption documented on
 * SegmentBound. Epoch pairs without such evidence are
 * concurrent-or-unordered, which is never divergence.
 */
export interface AnchorOrderedPair {
  beforeEpochId: string;
  afterEpochId: string;
  /** The before-epoch's covering not-after bound. */
  upperAnchorProofHash: string;
  upperBoundTimestamp: number;
  /** The after-epoch's covering not-before bound. */
  lowerAnchorProofHash: string;
  lowerBoundTimestamp: number;
  basis: "anchor-bounds";
  /** Always true: the upper side of the comparison rests on the anchor-freshness assumption. */
  assumptionDependent: true;
  /** Evidence class of the before-epoch's not-after (upper) bound. */
  upperEvidence: BoundEvidence;
  /** Evidence class of the after-epoch's not-before (lower) bound. */
  lowerEvidence: BoundEvidence;
  /** True when either side rests on "counter-order" evidence: the cross-epoch ordering is weaker. */
  weaker: boolean;
  beforeCoveredProofCount: number;
  beforeTotalProofCount: number;
  afterCoveredProofCount: number;
  afterTotalProofCount: number;
  note: string;
}

/** Output of the temporal bounds pass. */
export interface TemporalAnalysis {
  /** Per-partition segments with their bounds, deterministically ordered. */
  segments: TemporalSegment[];
  /** Anchor-derived cross-epoch ordering evidence (assumption-dependent; see AnchorOrderedPair). */
  anchorOrderedPairs: AnchorOrderedPair[];
  /** Anchors with at least one verified witness, sorted by proof hash. */
  verifiedAnchorProofHashes: string[];
  /** Identified anchors with no verified witness: they still establish causal order, but confer no wall-clock evidence. Sorted. */
  unverifiedAnchorProofHashes: string[];
}

// ---------------------------------------------------------------------------
// Offline attestation validation (Phase 4c)
// ---------------------------------------------------------------------------

/** One named validation check, mirroring the shape of the website validator's check list. */
export interface AttestationCheck {
  name: string;
  pass: boolean;
  detail: string;
}

/** Options for the low-level attestation document validator. */
export interface NitroValidationOptions {
  /** Declared measurement to compare PCR0 against. Compared only after the document validates. */
  expectedPcr0?: string;
  /** Canonical proof hash the attestation's user_data must be bound to. Compared only after the document validates. */
  expectedUserDataB64?: string;
  /**
   * DER bytes of the trust anchor the certificate chain must terminate
   * at. Defaults to the bundled AWS Nitro Enclaves Root CA G1. Supplying
   * other trust material is for tests and non-AWS deployments; the audit
   * pipeline default is always the bundled AWS root.
   */
  trustedRootCaDer?: Uint8Array;
}

/** Result of the low-level offline attestation document validation. */
export interface NitroValidationResult {
  /**
   * True when the DOCUMENT checks all passed: COSE decode, payload parse,
   * leaf presence, ECDSA P-384 signature over the Sig_structure,
   * certificate chain walk, trust-root anchoring, and certificate
   * validity windows evaluated at the document's own timestamp. Says
   * nothing about PCR0 or user_data binding; those are separate facts.
   */
  documentValid: boolean;
  /** Every check performed, in order. Later checks are absent when an earlier one failed. */
  checks: AttestationCheck[];
  /** Detail of the first failed document check. */
  failure?: string;
  /** PCR0 from the attestation payload (lowercase hex). Zero-valued PCRs are treated as absent. */
  pcr0?: string;
  /** All non-zero PCRs (lowercase hex by index). */
  pcrs: Record<number, string>;
  moduleId?: string;
  /** The attestation document's own timestamp, milliseconds since epoch. */
  timestamp?: number;
  certChainLength?: number;
  /** Base64 of the document's user_data bytes, when present. */
  userDataB64?: string;
  /** PCR0 equals expectedPcr0. Present only when expectedPcr0 was given AND the document validated. */
  pcr0Matches?: boolean;
  /** user_data is bound to expectedUserDataB64. Present only when expectedUserDataB64 was given AND the document validated. */
  userDataMatches?: boolean;
}

/**
 * Per-proof attestation facts. The five facts the report must never
 * conflate are tracked separately: declared measurement present,
 * attestation document present, document cryptographically validated,
 * attested PCR0 matches declared measurement, user_data bound to the
 * signed body. pcr0MatchesDeclared and userDataBoundToProof are set only
 * when the document validated; values parsed from an unvalidated
 * document prove nothing and are never compared.
 */
export interface ProofAttestationRecord {
  proofHash: string;
  declaredMeasurementPresent: boolean;
  declaredMeasurement?: string;
  documentPresent: boolean;
  /** environment.attestation.format, when declared. */
  attestationFormat?: string;
  documentValidated: boolean;
  /** Precise failure reason when documentValidated is false and a document was present. */
  validationFailure?: string;
  /** The full check list from the validator. Empty when no document was present. */
  checks: AttestationCheck[];
  attestedPcr0?: string;
  pcrs?: Record<number, string>;
  moduleId?: string;
  timestamp?: number;
  certChainLength?: number;
  userDataB64?: string;
  /** Present only when the document validated and a declared measurement exists. */
  pcr0MatchesDeclared?: boolean;
  /** Present only when the document validated. */
  userDataBoundToProof?: boolean;
}

/** Output of the attestation validation pass. */
export interface AttestationAnalysis {
  /** One record per observed proof, in observation order. */
  records: ProofAttestationRecord[];
  /** attestation-* findings, in detection order. */
  findings: AuditFinding[];
  counts: {
    proofsWithDeclaredMeasurement: number;
    proofsWithDocument: number;
    documentsValidated: number;
    documentsFailed: number;
    pcr0Matches: number;
    pcr0Mismatches: number;
    userDataBound: number;
    userDataUnbound: number;
  };
}

// ---------------------------------------------------------------------------
// Audit orchestration (Phase 4d)
// ---------------------------------------------------------------------------

/** Options for the full audit pipeline (runAudit). */
export interface AuditOptions {
  /**
   * Optional trust policy passed unchanged to the canonical verifier at
   * both verification tiers. Policy rejections surface as verification
   * failures with the verifier's exact reason.
   */
  trustAnchors?: import("@mikeargento/bitgraph-verify").VerificationPolicy;
  /**
   * DER bytes of the attestation trust root. Defaults to the bundled AWS
   * Nitro Enclaves Root CA G1; supplying other material is for tests and
   * explicitly non-AWS deployments.
   */
  trustedRootCaDer?: Uint8Array;
}

/**
 * Run metadata for one audit execution. This is the ONLY nondeterministic
 * data the pipeline produces: startedAt is a wall-clock read, and nothing
 * else in an AuditResult or either report depends on the clock. Two runs
 * over the same bundle differ in this block alone.
 */
export interface AuditRunMetadata {
  /** Tool version, read from the audit package's package.json. */
  toolVersion: string;
  /** ISO 8601 wall-clock start time of the run. */
  startedAt: string;
  /** The bundle path exactly as given to runAudit. */
  bundlePath: string;
  container: ContainerKind;
}

/** Everything one full audit run produced, in pipeline order. */
export interface AuditResult {
  runMetadata: AuditRunMetadata;
  ingest: IngestResult;
  verification: VerificationSummary;
  reconstruction: ReconstructionResult;
  anomalies: AnomalyReport;
  authorities: AuthorityAnalysis;
  anchors: AnchorIdentification;
  witnesses: AnchorWitnessAnalysis;
  temporal: TemporalAnalysis;
  attestations: AttestationAnalysis;
}

/**
 * CLI exit semantics as bit flags.
 *
 *   bit 1 (value 1): verification failures. Set when any proof's canonical
 *   checks failed at either tier, or any proof-shaped input was rejected
 *   as an unsupported version. artifact-unavailable is NOT a failure: a
 *   proof without artifact bytes passes or fails on its bytes-free checks
 *   alone, unless a supplied trust policy makes those checks fail (for
 *   example requireSlot), in which case its status is "failed" and it
 *   counts here. Attestation validation results never set this bit on
 *   their own; they affect it only when a supplied policy made
 *   verification itself fail.
 *
 *   bit 2 (value 2): structural anomalies. Set when chain anomaly
 *   classification or authority analysis produced any anomaly, any
 *   divergence record between valid proofs exists, or any supplied anchor
 *   witness failed its offline verification (a witness-* code: RLP or
 *   header malformation, block-hash mismatch, digest-binding mismatch,
 *   block-number mismatch, an invalid candidate anchor, or an unmatched
 *   witness). Benign findings are reported but never set exit bits: ingest
 *   advisories (duplicate copies, manifest advisories, unsafe paths,
 *   embedded proofHash mismatches) and informational anchor findings
 *   (anchor-metadata-disagreement, anchor-metadata-only-claim,
 *   anchor-title-unparseable, all of which the signed body overrides).
 *   Attestation validation results never set this bit on their own.
 */
export interface ExitFlags {
  verificationFailures: boolean;
  /**
   * Bit 2: chain or authority anomalies, divergences between valid proofs,
   * or anchor witness verification failures. Informational anchor findings
   * and attestation results never set it.
   */
  chainAnomaliesOrDivergences: boolean;
  /** 0 clean, 1 verification failures, 2 structural anomalies (chain/authority/divergence/witness), 3 both. */
  code: number;
}

// ---------------------------------------------------------------------------
// JSON report (Phase 4d)
// ---------------------------------------------------------------------------

/** Which pipeline stage produced a reported anomaly. */
export type AnomalyStage =
  | "ingest"
  | "chain"
  | "authority"
  | "anchor"
  | "witness"
  | "attestation";

/**
 * One entry of the report's unified anomaly list. Every classification is
 * a stable code; message text is supplementary and consumers must never
 * parse it.
 */
export interface ReportAnomaly {
  stage: AnomalyStage;
  code: AnomalyCode;
  message: string;
  /** Bundle-root-relative path, for file-scoped findings. */
  path?: string;
  /** Partition scope, for partition-scoped chain anomalies. */
  partition?: PartitionKey;
  /** Canonical hashes of the observed proofs involved. */
  proofHashes?: string[];
  /** Machine-readable detail specific to the code. */
  details?: Record<string, unknown>;
}

/** Per-proof record in the JSON report. Compact fields only; never the raw proof object. */
export interface ReportProofRecord {
  proofHash: string;
  sources: ProofSource[];
  verificationTier?: VerificationTier;
  verificationStatus?: VerificationStatus;
  verificationReason?: string;
  /** Bundle path of the artifact bytes used. Full tier only. */
  artifactPath?: string;
  embeddedProofHash: EmbeddedProofHashStatus;
  counter?: string;
  slotCounter?: string;
  prevB64?: string;
  epochId?: string;
  chainId: string;
  publicKeyB64?: string;
  measurement?: string;
  enforcement?: string;
  chainless: boolean;
  hasSlotAllocation: boolean;
  hasAttestation: boolean;
  hasAgency: boolean;
  hasEpochLink: boolean;
}

/** One partition in the JSON report, with its reconstructed components and an intactness verdict. */
export interface ReportPartition {
  key: PartitionKey;
  memberProofHashes: string[];
  components: ChainComponent[];
  /**
   * True when the partition's observed record is one connected component
   * and no chain anomaly or divergence is scoped to this partition.
   */
  intact: boolean;
}

/** An epoch pair with no ordering evidence in either direction: concurrent-or-unordered, never divergence. */
export interface UnorderedEpochPair {
  epochIdA: string;
  epochIdB: string;
}

/** Epoch relationship section of the JSON report. */
export interface ReportEpochRelationships {
  /** Observed epochs, sorted by epochId, with anchorBounds populated by the temporal stage where evidence exists. */
  epochs: EpochRecord[];
  /** Every observed epochLink, analyzed. */
  lineageEdges: EpochLineageEdge[];
  /** Transitive ordering from hard lineage edges only. */
  orderedPairs: Array<{ beforeEpochId: string; afterEpochId: string }>;
  /** Anchor-derived, assumption-dependent ordering of covered epoch portions. */
  anchorOrderedPairs: AnchorOrderedPair[];
  /** Distinct epoch pairs with no ordering evidence from either source. */
  unorderedPairs: UnorderedEpochPair[];
}

/** Deterministic input summary of the JSON report. */
export interface ReportInputSummary {
  container: ContainerKind;
  entriesScanned: number;
  strippedRootPrefix?: string;
  computedContentsHashB64: string;
  manifest?: ManifestReport;
  counts: {
    observed: number;
    proofFiles: number;
    exactDuplicates: number;
    semanticDuplicates: number;
    unsupportedVersion: number;
    verified: number;
    failed: number;
    artifactUnavailable: number;
    chainless: number;
    artifacts: number;
    witnesses: number;
    skippedUnsafePaths: number;
  };
}

/** Summary statistics of the JSON report. */
export interface ReportSummary {
  proofsObserved: number;
  fullyVerified: number;
  failed: number;
  artifactUnavailable: number;
  unsupportedVersion: number;
  chainless: number;
  exactDuplicates: number;
  semanticDuplicates: number;
  partitions: number;
  partitionsIntact: number;
  /** True when every partition is intact and no chain or authority anomaly or divergence exists. */
  chainIntact: boolean;
  epochsObserved: number;
  /** Anomaly counts keyed by stable code, keys sorted. */
  anomalyCountsByCode: Record<string, number>;
  divergenceCount: number;
  /**
   * Count of expected excerpt boundaries (earliest proofs whose predecessor
   * precedes the exported window). Informational, never a failure. A
   * full-epoch export has zero; a bounded proof bundle has one per included
   * chain segment.
   */
  boundaryEntryPoints: number;
  authorityGroupCount: number;
  distinctSignerCount: number;
  distinctDeclaredMeasurementCount: number;
  /** The five separately tracked attestation facts (G9), as proof counts. */
  attestation: {
    declaredMeasurementPresent: number;
    documentsPresent: number;
    documentsValidated: number;
    pcr0MatchesDeclared: number;
    userDataBound: number;
  };
  temporal: {
    anchorsIdentified: number;
    anchorsWithVerifiedWitness: number;
    segments: number;
    segmentsWithFollowingAnchor: number;
    segmentsLowerBounded: number;
    segmentsUpperBounded: number;
    segmentsUnanchored: number;
  };
  exit: ExitFlags;
}

/**
 * The audit-report.json object, schema "bitgraph-audit-report/2".
 *
 * Deterministic given the same bundle except for the runMetadata block,
 * which is explicitly identified as the only nondeterministic section.
 * Object keys are built in fixed order; arrays are sorted by stable keys
 * (partition key, counter, canonical hash) or carry the deterministic
 * order of the producing stage. Machine consumers key on stable codes and
 * fields, never on message prose.
 */
export interface AuditJsonReport {
  reportSchemaVersion: "bitgraph-audit-report/2";
  toolVersion: string;
  runMetadata: {
    /** Always true: this block is the only nondeterministic section of the report. */
    nondeterministic: true;
    note: string;
    toolVersion: string;
    startedAt: string;
    bundlePath: string;
    container: ContainerKind;
  };
  input: ReportInputSummary;
  /** Sorted by canonical proof hash. */
  proofs: ReportProofRecord[];
  /** Sorted by path. */
  unsupportedVersions: UnsupportedVersionRecord[];
  /** In the reconstruction pass's deterministic partition order. */
  partitions: ReportPartition[];
  unchainedProofHashes: string[];
  unpartitionedProofHashes: string[];
  epochRelationships: ReportEpochRelationships;
  /** Unified anomaly list: stage order (ingest, chain, authority, anchor, witness, attestation), stage-internal detection order. */
  anomalies: ReportAnomaly[];
  divergences: DivergenceRecord[];
  /** Expected excerpt boundaries (informational; never a failure). Empty for a full-epoch export. */
  boundaryEntryPoints: BoundaryEntryPoint[];
  authorities: {
    groups: AuthorityGroup[];
    sharedSignersAcrossEpochs: SignerEpochSpan[];
  };
  attestations: {
    records: ProofAttestationRecord[];
    counts: AttestationAnalysis["counts"];
  };
  anchors: {
    records: AnchorRecord[];
    metadataOnlyProofHashes: string[];
  };
  witnesses: {
    outcomes: AnchorWitnessOutcome[];
  };
  temporal: {
    segments: TemporalSegment[];
    verifiedAnchorProofHashes: string[];
    unverifiedAnchorProofHashes: string[];
  };
  summary: ReportSummary;
}
