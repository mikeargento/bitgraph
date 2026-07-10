# BitGraph Audit Bundle: Project Report

Date: 2026-07-10
Branch: `audit-bundle` (nine phase commits, `ba1c4a0f` through `c32729ed`, plus uncommitted Phase 6 documentation changes)

This is the final report required by the build brief. It is compiled from `DECISIONS.md` (the dated, per-phase log of every confirmation, correction, and judgment call), the phase commits, and a fresh verification run on 2026-07-10. Sources of record: `DECISIONS.md` for reasoning, `docs/BUNDLE-FORMAT.md` for the interchange format, `packages/audit/src/` and `packages/verify/src/` for behavior.

## 1. What was delivered

1. `@mikeargento/bitgraph-audit` 0.1.0 (`packages/audit`, MIT): offline audit library plus `bitgraph-audit` CLI. Ingests a bundle (directory, `.tar`, `.tar.gz`), verifies all available evidence through the canonical verify package, reconstructs causal order, classifies anomalies with stable codes, preserves divergence, analyzes authorities, identifies Ethereum anchors, verifies anchor witnesses offline, derives honest temporal bounds, and validates Nitro attestation documents offline. Zero runtime network access.
2. `@mikeargento/bitgraph-verify` 1.1.0 (minor bump): new bytes-free integrity API `verifyProofIntegrity()`, sharing one internal check pipeline with `verify()` so no check is duplicated. Existing `verify()` semantics byte-for-byte unchanged.
3. `docs/BUNDLE-FORMAT.md`: normative `bitgraph-bundle/1` interchange specification, self-contained enough for a third-party reimplementation, including the `bitgraph-anchor-witness/1` format and a deterministic contents hash.
4. Epoch export in the website (`website/src/lib/export-epoch.ts` plus `GET /api/export/epoch/[epochId]`): server-side, read-only, spec-conforming `.tar.gz` export of one epoch; closed epochs export completely, open epochs as labeled snapshots. Self-notarization exists only as a documented, disabled hook (`docs/EXPORT-INTEGRATION.md`).
5. Documentation: `docs/HOW-TO-AUDIT.md` (recipient walkthrough), root `README.md` package section, `packages/audit/README.md`, the `BITGRAPH-DOCS.md` epoch-transition contradiction fix, and two stale comment fixes.

Version policy honored throughout, per owner directive: `bitgraph/1` only. `occ/1` and any other version are rejected at ingest as `unsupported-version`, with no compatibility mode of any kind.

Nothing was published to npm and nothing was committed through live infrastructure. `server/commit-service/` was never modified.

## 2. Files created or modified

Committed on `audit-bundle` (git diff main...HEAD: 59 files, +17,839 / -99):

Repo root and shared:

* `DECISIONS.md` (new): the full per-phase decision log.
* `package.json`: workspaces gained `packages/audit`; build/typecheck chain audit after verify; `test:core` runs `npm run build` first and lists the 15 new audit suites plus `proof-integrity`.
* `package-lock.json`: workspace wiring, `@noble/ed25519` devDependency for the benchmark generator.

`packages/verify` (1.0.0 to 1.1.0):

* `src/verifier.ts`: internal `runChecks()` refactor; `verifyProofIntegrity()` added.
* `src/index.ts`: exports `verifyProofIntegrity`, `ProofIntegrityResult`.
* `package.json` (version 1.1.0), `CHANGELOG.md` (new).

`packages/audit` (new package, 0.1.0): `package.json`, `tsconfig.json`, `LICENSE` (MIT), `README.md`, `scripts/bench-audit.mjs`, and `src/`: `index.ts`, `types.ts`, `ingest.ts`, `tar.ts`, `contents-hash.ts`, `verify-tiers.ts`, `validity.ts`, `reconstruct.ts`, `anomalies.ts`, `authority.ts`, `anchors.ts`, `rlp.ts`, `witness.ts`, `temporal.ts`, `attestation.ts`, `aws-nitro-root-ca.ts`, `audit.ts`, `report-json.ts`, `report-md.ts`, `cli.ts`, `export.ts`.

Docs: `docs/BUNDLE-FORMAT.md` (new), `docs/EXPORT-INTEGRATION.md` (new, disabled self-notarization hook).

Tests (root `src/__tests__/`, node:test convention): new suites `proof-integrity.test.ts`, `audit-ingest.test.ts`, `audit-tiers.test.ts`, `audit-reconstruct.test.ts`, `audit-anomalies.test.ts`, `audit-anchors.test.ts`, `audit-witness.test.ts`, `audit-temporal.test.ts`, `audit-attestation.test.ts`, `audit-report.test.ts`, `audit-cli.test.ts`, `audit-property.test.ts`, `audit-real-fixtures.test.ts`, `audit-dependencies.test.ts`, `audit-bench-smoke.test.ts`, `audit-roundtrip.test.ts`; shared non-test helpers `audit-fixtures.ts`, `realistic-proof-fixture.ts`, `mock-proof-fixture.ts`; `proof-hash.test.ts` and `proof-hash-regression.test.ts` modified only to import the fixtures from the shared modules (fixture values byte-for-byte unchanged).

Website (Phase 5): `src/lib/export-epoch.ts` (new), `src/app/api/export/epoch/[epochId]/route.ts` (new), `src/lib/s3.ts` (added `listKeysUnderPrefix`, `getObjectText`, `getCurrentEpoch` helpers).

Phase 6 (uncommitted, this working tree):

* `docs/HOW-TO-AUDIT.md` (new): recipient walkthrough.
* `BITGRAPH-DOCS.md`: epoch-transition contradiction fixed (see section 10).
* `README.md`: "Verification and audit packages" section added.
* `packages/audit/README.md`: stale "current library surface" sentence replaced with the finished pipeline and CLI.
* `packages/verify/src/types.ts`: `requireEpochId` doc comment no longer names DynamoDB ("an external monotonic anchor").
* `packages/adapter-nitro/src/kms-counter.ts`: header comment likewise ("An external monotonic anchor closes the blob rollback gap").
* `DECISIONS.md`: Phase 6 entry appended.
* `PROJECT-REPORT.md` (this file).

## 3. Public API surfaces

### @mikeargento/bitgraph-verify 1.1.0 (additions to 1.0.0)

* `verifyProofIntegrity(opts: { proof: BitGraphProof; trustAnchors?: VerificationPolicy }): Promise<ProofIntegrityResult>`: every check `verify()` performs except the artifact digest comparison (structure, canonical Ed25519 signature, agency envelope, slot binding, epochLink, policy).
* `ProofIntegrityResult = { valid: boolean; artifactBinding: "not-checked"; reason?: string }`: the literal `artifactBinding: "not-checked"` rides on every result so a passing integrity check can never be mistaken for full verification.
* Unchanged: `verify`, `resetEpochLinkState`, `computeProofHash`, `canonicalize`, `canonicalizeToString`, `constantTimeEqual`, and all exported types. `verify()` results are byte-for-byte identical to 1.0.0 (pinned by exact-string regression tests).

### @mikeargento/bitgraph-audit 0.1.0 (complete public API)

Pipeline functions, in canonical order: `ingestBundle`, `verifyObservedProofs`, `reconstructChains`, `classifyAnomalies`, `analyzeAuthorities`, `identifyAnchors`, `verifyAnchorWitnesses` (and single-pair `verifyAnchorWitness`), `deriveTemporalBounds`, `validateAttestations` (and low-level `validateNitroAttestationDocument`).

Orchestration and reports: `runAudit(bundlePath, options)`, `computeExitFlags(result)`, `auditToolVersion()`, `buildJsonReport(result)` (schema `bitgraph-audit-report/1`), `buildMarkdownReport(result)`.

Producer side and utilities: `buildBundleArchive` (deterministic spec-conforming `.tar.gz` builder, shared by the round-trip reference and consumed by the website exporter), `computeContentsHashB64`, `computeEntryDigest`, `streamMatchedArtifacts`, `AWS_NITRO_ROOT_CA_PEM` (the bundled trust root, exported for transparency).

CLI binary: `bitgraph-audit <path-to-bundle> [--out <dir>] [--format json,md] [--trust-policy <path>]`. Exit codes as bit flags: 0 clean; 1 verification failures (including `unsupported-version`); 2 chain anomalies or divergences between valid proofs; 3 both; 64 usage or input error. `--trust-policy` maps onto the canonical 14-field `VerificationPolicy`.

Exported types (all from `types.ts` or the module that owns them): `AnomalyCode`, `AuditFinding`, `VerificationTier`, `VerificationStatus`, `EmbeddedProofHashStatus`, `ProofVerification`, `ProofSource`, `ObservedProof`, `UnsupportedVersionRecord`, `ArtifactRecord`, `AnchorWitnessFile`, `BundleManifest`, `ManifestReport`, `ContainerKind`, `IngestCounts`, `IngestResult`, `VerifyObservedOptions`, `VerificationSummary`, `MatchedArtifactBytes`, `PartitionKey`, `ChainComponent`, `ChainPartition`, `EpochLinkFields`, `EpochLineageEdge`, `EpochAnchorBound`, `EpochRecord`, `EpochRelationshipResult`, `ReconstructionResult`, `ChainAnomaly`, `UnexplainedPositionsDetail`, `DivergenceKind`, `DivergenceParty`, `DivergenceRecord`, `AnomalyReport`, `AttestedMeasurementEvidence`, `AuthorityGroup`, `SignerEpochSpan`, `AuthorityAnalysis`, `AnchorMetadataCorroboration`, `AnchorRecord`, `AnchorIdentification`, `AnchorWitnessOutcome`, `AnchorWitnessAnalysis`, `BoundEvidence`, `SegmentBound`, `TemporalSegmentStatus`, `TemporalSegment`, `AnchorOrderedPair`, `TemporalAnalysis`, `AttestationCheck`, `NitroValidationOptions`, `NitroValidationResult`, `ProofAttestationRecord`, `AttestationAnalysis`, `AuditOptions`, `AuditRunMetadata`, `AuditResult`, `ExitFlags`, `AnomalyStage`, `ReportAnomaly`, `ReportProofRecord`, `ReportPartition`, `UnorderedEpochPair`, `ReportEpochRelationships`, `ReportInputSummary`, `ReportSummary`, `AuditJsonReport`, `ContentsHashEntry`, `BundleArchiveInput`, `BundleArchiveProofEntry`, `BundleArchiveWitnessEntry`, `BundleArchiveArtifactFile`.

Runtime dependencies: `@mikeargento/bitgraph-verify` `^1.1.0` and `@noble/hashes` `^1.4.0`. Nothing else; tar and gzip handling use in-package code plus `node:zlib`.

### Website export surface (proprietary, write-side operator functionality)

* `website/src/lib/export-epoch.ts`: `exportEpoch(safeEpochId, source)`, `EpochDataSource` (the S3-or-mock seam), `EpochExportResult`, `MAX_EXPORT_OBJECTS` (20,000), `EpochTooLargeError`, `notarizeArchiveHook(archiveSha256B64)` (throws; deliberately disabled, wiring documented in `docs/EXPORT-INTEGRATION.md`).
* `GET /api/export/epoch/[epochId]`: streams a `bitgraph-bundle/1` `.tar.gz` of one epoch's proofs and anchors. Read-only against the ledger; never writes to S3, never commits. Epoch ids validated against `^[A-Za-z0-9_-]{1,128}$` before any S3 call. Artifact bytes are never included (the ledger stores none; proofs are capability-gated by the file itself).

## 4. Stable anomaly and finding codes (complete list, 41)

Ingest (10): `unsupported-version`, `proofhash-mismatch`, `exact-duplicate`, `semantic-duplicate`, `unsafe-path`, `duplicate-path`, `manifest-unparseable`, `manifest-unrecognized-version`, `manifest-field-invalid`, `manifest-contents-hash-mismatch`.

Chain reconstruction and classification (16): `unexplained-counter-positions` (G2 gap logic: a position is explained if it is some proof's `commit.counter` or referenced by some proof's `commit.slotCounter`), `counter-collision`, `slot-collision`, `predecessor-reuse`, `chain-break-missing`, `chain-break-malformed`, `chain-break-cross-partition`, `multiple-genesis`, `slot-order-violation`, `epochlink-terminal-missing`, `epochlink-dangling`, `epochlink-fork`, `epochlink-cycle`, `epochlink-mismatch`, `mid-epoch-signer-change`, `mid-epoch-measurement-change`.

Anchor analysis (3): `anchor-metadata-disagreement`, `anchor-metadata-only-claim`, `anchor-title-unparseable`.

Witness verification (9): `witness-malformed`, `witness-rlp-invalid`, `witness-header-shape`, `witness-hash-mismatch`, `witness-digest-mismatch`, `witness-block-number-mismatch`, `witness-claimed-hash-mismatch`, `witness-anchor-invalid`, `witness-unmatched`.

Attestation validation (3): `attestation-invalid`, `attestation-measurement-mismatch`, `attestation-user-data-mismatch`.

Every code has a plain-language consequence sentence in the markdown report. `attestation-validation-unsupported` was reserved in the design but is never emitted: the full offline Nitro validator (COSE, certificate chain to the bundled AWS root, PCR0, user_data binding, validity window at the document's own timestamp) proved implementable, so honesty never required the fallback.

## 5. Test results

Verified 2026-07-10 on this working tree (Phase 6 changes applied): `npm run build` green; `npm test` (root `test:core`, node:test) green.

* **308 tests, 72 suites, 0 failures, 0 skipped.**
* Suites wired into `test:core` (19 files): `canonical`, `constructor`, `verifier`, `proof-integrity`, `audit-ingest`, `audit-tiers`, `audit-reconstruct`, `audit-anomalies`, `audit-anchors`, `audit-witness`, `audit-temporal`, `audit-attestation`, `audit-report`, `audit-cli`, `audit-property`, `audit-real-fixtures`, `audit-dependencies`, `audit-bench-smoke`, `audit-roundtrip`.
* The two proof-hash suites (`proof-hash`, `proof-hash-regression`) are compiled but not part of `test:core`, exactly as on `main`; run manually they pass (18 tests, 0 failures) after the fixture-module moves.
* Count progression by phase: 114 baseline before Phase 2, 144 after Phase 2, 178 after 4a, 210 after 4b, 247 after 4c, 261 after 4d, 302 after 4e, 308 after the Phase 5 round-trip suite.
* Property-based coverage (Phase 4e): 12 fixed seeds, 16 injectable scenario classes composed by random subset, asserting the exact anomaly-code multiset (no missing detections, no spurious extras) plus determinism (same seed regenerates a byte-identical report modulo run metadata).
* Dependency audit pinned by test: the runtime closure is exactly verify + `@noble/hashes` (+ `@noble/ed25519` transitively), and an fs walk of the compiled first-party module graph asserts no network API references.

## 6. The 50,000-proof benchmark (Phase 4e, `npm run bench` in packages/audit)

Corpus: deterministic seed, 5 epochs x 10,000 proofs, one chain (`bitgraph:main`), G2 slot/commit interleaving, 100 Ethereum anchors as ordinary chain members each with an offline-verifiable RLP header witness, real Ed25519 signatures throughout. Measured 2026-07-10, Apple Silicon (arm64 darwin, node v24.13.1):

* Generation (50k real signatures): 14.62 s; write directory bundle 2.28 s; write `.tar.gz` 1.40 s.
* Staged pipeline over the directory bundle: **69.00 s total (725 proofs/sec)**: ingest 6.96 s; verify tiers 61.23 s (Ed25519 verification is about 89% of the pipeline); reconstruct 0.10 s; classify 0.12 s; authorities 0.05 s; anchors 0.01 s; witnesses 0.01 s; temporal 0.50 s; attestations 0.02 s; JSON report build 0.05 s; JSON serialize 0.14 s; markdown 0.07 s.
* Full `runAudit` over the `.tar.gz`: **63.67 s (785 proofs/sec)**.
* Peak RSS 747.4 MiB for the whole process including corpus generation; final RSS 394.2 MiB. Report sizes: JSON 74.1 MiB (complete), markdown 0.3 MiB (200-row table caps hold).
* Sanity gate: both containers audit completely clean (50,000 observed, zero failures, zero anomalies, all 100 witnesses verified, exit 0).

One O(N^2) hot path was found and fixed during this phase (full-tier index in `verify-tiers.ts`, now a Map lookup); no verification semantics were weakened for performance.

## 7. Sample audit report (real CLI run, 2026-07-10)

Generated for this report by building the standard synthetic bundle with the compiled fixture helpers (`dist/__tests__/audit-fixtures.js`, `makeStandardAuditBundle()`: a healthy signed chain of four slot/commit proofs with one proof deliberately removed, a predecessor-reuse fork, an Ethereum anchor with a valid RLP witness, one occ/1 reject, duplicate copies, and one artifact file) and running `node packages/audit/dist/cli.js <bundle> --out <dir>`. The CLI exited 3 (verification failures from the occ/1 reject; chain anomalies and one divergence) and wrote both reports. From the executive summary of `audit-report.md` (quoted passages verbatim; its count tables condensed to prose here):

> This report examines a bundle of BitGraph proofs offline. A BitGraph proof is a small signed record stating that a specific file, identified by its digital fingerprint, was committed at a specific position in a sequence kept by an authority. Because each proof names the fingerprint of the proof before it, the sequence forms a chain whose order can be checked from the objects themselves: this is what is meant by causal order. The audit verifies what can be verified, reconstructs that order, and reports anything missing or conflicting. Where evidence is incomplete, it says so rather than guessing, and where valid records conflict, it presents all of them and chooses none.
>
> Proofs: 6 observed; 1 fully verified (artifact bytes present and matched); 0 failed; 5 observed without artifact bytes; 1 rejected as an unsupported legacy version; 1 byte-identical duplicate copy and 1 re-encoded duplicate copy.
>
> "5 proofs arrived without the original file bytes. Their internal cryptography was checked and passed, but the link between proof and file could not be independently confirmed because there was no file to compare against. They are reported as observed, never as fully verified."
>
> Causal chain, partition signer `hWzf3SRwH5FF...`, epoch `epoch-standard-main`, chain `bitgraph:main`, chain intact: no. "The 5 observed proofs form 2 disconnected sequences. The record between them cannot be reconstructed from the supplied evidence. 2 counter positions are neither commit positions nor referenced slot positions in the supplied bundle. This means the auditor cannot reconstruct those positions from the supplied evidence. It does not, by itself, prove that the BitGraph authority failed to create them."
>
> Anomalies: `chain-break-missing` 1, `exact-duplicate` 1, `predecessor-reuse` 1, `semantic-duplicate` 1, `unexplained-counter-positions` 1, `unsupported-version` 1, each with a plain-language consequence sentence.
>
> Divergences: 1. "Two independently valid proof objects name the same predecessor proof: the chain forks at that point. The audit tool does not choose between them. Both objects and their predecessor relationships are shown in the divergence details for adjudication."
>
> External time evidence: 1 Ethereum anchor identified, 1 verified offline against its witness block header. "A verified anchor bounds time in one direction at a time. Proofs that come after an anchor in the chain were committed no earlier than that block's timestamp, because the block's fingerprint could not have been known before the block existed. Proofs that come before an anchor existed before the commit that consumed the block; reading that as a wall-clock ceiling additionally assumes the anchor consumed a recently published block, and every such bound in this report states that assumption. No individual proof's exact creation time is ever stated."

Fixture ingest results (Phase 4e, `audit-real-fixtures.test.ts`, over the repo's two embedded static fixtures): both observed, zero `unsupported-version`; `REALISTIC_PROOF` fails at the integrity tier with the verifier's exact reason "signature verification failed: signature does not match" (placeholder signature, a non-version reason, as G8 predicted); `MOCK_PROOF` fails with "artifact.digestB64 is not valid base64"; `REALISTIC_PROOF` is identified as an Ethereum anchor by its signed attribution (block 24800448) and its truncated attestation blob reports document-present-but-invalid with a precise reason. Exact anomaly multiset pinned: `attestation-invalid` x2, `chain-break-malformed`, `chain-break-missing`. Exit code 3.

## 8. Export round-trip result

`src/__tests__/audit-roundtrip.test.ts` (mandatory per the brief; synthetic data only, never live S3), all passing:

* Closed-epoch archive from the reference builder, with artifacts, audits completely clean (5 verified, 0 artifact-unavailable, exit flags 0).
* Open-epoch snapshot round-trips `openEpochs` through the manifest and audits clean.
* The builder is deterministic: the same input produces a byte-identical archive.
* Producer-conformance violations are rejected deterministically.
* The website's closed-epoch export (mocked `EpochDataSource`) is byte-identical to the reference builder's archive and audits clean: 0 verified, 5 artifact-unavailable, 0 verified witnesses, which is the honest result because the live ledger stores neither artifact bytes nor witness files.
* The website's open-epoch export carries the `openEpochs` snapshot and audits clean.

## 9. Ground truth G1 through G10: resolution

All ten items were re-verified against source in Phase 1 (DECISIONS.md, HEAD `e324da47` at the time) and **all ten were CONFIRMED**. Summary of each resolution:

* **G1 (epoch genesis and lineage): confirmed.** First proof of an epoch omits `prevB64` entirely; chain state is in-memory only; `verifyAndLinkChain()` builds the six-field `epochLink` and never seeds `lastProofHashB64`; the deployed parent always sends fresh genesis. Audit treats epochs as independent chains, supports `epochLink` as lineage evidence, never bridges epochs via `prevB64`. Only drift: `initEnclave()` moved from server.ts:159-175 to 164-176, behavior identical.
* **G2 (two-position counters): confirmed.** Slot takes counter N, commit takes a later counter (first proof: slot 1, commit 2). Gap logic implemented exactly as specified: a position is explained if it is a commit counter or a referenced slotCounter; only unexplained positions are candidates.
* **G3 (commit schema): confirmed.** Schema in `packages/verify/src/types.ts` (no root `src/types.ts`; the repo CLAUDE.md diagram is stale on this point). `nonceB64` the only required commit field; live enclave injects undeclared `chainId` via type cast; the audit validator tolerates unknown fields at every level.
* **G4 (proofHash not on the wire): confirmed.** Computed by `computeProofHash()`, appended at storage/serving time. The audit tool computes canonical identity itself and cross-checks any embedded field (`proofhash-mismatch`).
* **G5 (anchor proofs): confirmed.** `digestB64` = SHA-256 of the block-hash string; raw hash in signed `attribution.message`; block number only inside the signed Etherscan URL; timestamp only in unsigned metadata (never trusted). Identification by signed `attribution.name === "Ethereum Anchor"`.
* **G6 (per-chainId chains): confirmed.** Per-chain counter and prevB64 state; `"global"` default chain; `bitgraph:main` by caller convention. Partitioning by (signer key, epochId, chainId).
* **G7 (verifier boundary): confirmed.** `verify()` requires bytes; 14-field all-optional `VerificationPolicy`; `verifyEpochLink` module state with `resetEpochLinkState()`, reset once per audit run.
* **G8 (fixtures reality): confirmed.** Zero standalone JSON fixtures; `MOCK_PROOF` and `REALISTIC_PROOF` embedded, fail full verification for non-version reasons by design; treated as canonical-hash and ingest fixtures, with the exact failure reasons pinned in tests.
* **G9 (attestation validator): confirmed.** `website/src/lib/nitro-verify.ts` ported faithfully into `packages/audit/src/attestation.ts` with the AWS Nitro Root CA G1 bundled locally (DER SHA-256 fingerprint verified against the AWS-published value). One documented discrepancy against the brief's assumption: see section 10.
* **G10 (repo mechanics): confirmed.** Root workspaces was exactly `["packages/verify"]`; `packages/audit` added and chained into build/typecheck the same way; node:test from the repo root; no naming collisions with "audit" or "bundle".

## 10. Corrections of the brief against the code (authority rule applied)

Every entry below is recorded in dated detail in `DECISIONS.md`; the code won each time.

1. **Temporal not-after honesty correction (Phase 4c, the most significant).** The 4c brief asked for "existed by block time T" upper bounds. Verified against source, the anchor mechanism is inbound-only: the Railway service reads the latest block and commits its hash into the chain; nothing is ever sent to Ethereum. An inbound commitment cannot cryptographically upper-bound prior events without assuming the anchor consumed a recently published block. Implemented per halt rule 6 (correct toward honesty): `not-before` bounds are cryptographically grounded in block-hash unpredictability; `not-after` bounds carry the explicitly stated freshness assumption on every bound record and claim string; assumption-dependent cross-epoch pairs are marked `assumptionDependent: true`. `docs/BUNDLE-FORMAT.md` sections 10.1 and 10.3 were updated to state both directions with their exact strength. Noted for the maintainer: the website's two-sided "Recorded between" display rests on the same assumption (website copy out of scope this run).
2. **Website validity-window discrepancy (Phase 4c).** The brief assumed the website's nitro-verify checks certificate validity windows; the source shows it does not (no notBefore/notAfter logic; the May 2026 session note described intent that never landed). The audit port adds the check, evaluated at the attestation document's own timestamp, because audits run long after short-lived leaf certificates expire.
3. **Contents-hash scheme upgrade (Phase 3).** The brief sketched hashing a path/NUL/content concatenation; that construction is boundary-ambiguous (content can contain NULs and nothing terminates it). The spec uses fixed 32-byte per-entry digests, sorted by raw UTF-8 path bytes, hashed together. Test vectors embedded in the spec.
4. **Manifest counter range widened (Phase 3).** The brief's singular "counter range" is meaningless across epochs and chains (counters are epoch-local and chain-local per G6); the manifest carries `counterRanges` partitioned by (epochId, chainId).
5. **Anchor filename divergence documented, not fixed (Phase 3).** The ledger's `anchorKey()` and the live anchor service disagree on the anchor filename shape; the spec lists both as advisory since discovery is shape-based. Product code untouched.
6. **`epochlink-mismatch` added beyond the brief's four epochLink codes (Phase 4b).** A link whose hash matches an observed proof but whose declared epoch, key, or counter disagrees is detectable only by the audit tool (the canonical verifier never sees the predecessor); hiding it under another code would misreport.
7. **CLAUDE.md structure diagram stale (Phase 1).** It lists `src/types.ts` and `src/proof-hash.ts` at the repo root; both live in `packages/verify/src/`. G3's statement is the correct one; the diagram was left for the maintainer.
8. **Property-generator bugs fixed in the generator, not the auditor (Phase 4e).** Twice the property loop flagged "spurious" anomalies that were in fact honest detections of generator mistakes (a collider violating G2 nonce-first ordering; an epochLink scenario mixing two measurements inside one boot-scoped epoch). The generator was fixed both times. Same pattern in the benchmark script: witness `blockNumber` must be a JSON number per spec 10.2; the script was fixed, not the auditor.
9. **Stored-form ingest semantics honored (Phase 4d).** A stored copy whose embedded proofHash matches does not upgrade the record's `embeddedProofHash` from "absent" (first-observed copy governs; only a mismatch escalates). The report test was corrected to match the tested behavior rather than changing ingest.
10. **Phase 5 completion notes (orchestrator).** The Phase 5 agent hit a session limit during final verification; the orchestrator fixed TypeScript strictness in the round-trip suite, parametrized expected verified-witness counts (website exports honestly contain no witnesses or artifacts), and replaced one BigInt literal with `BigInt(0)` for the website's ES2017 target.
11. **BITGRAPH-DOCS.md contradiction fixed (Phase 6, this run).** The unpublished repo-root draft's Self-Host section claimed the chain continues across epochs via `prevB64` while its own FAQ said the opposite and cited a stale DynamoDB anchor. Both now match the code: no `prevB64` at epoch genesis; the counter resets (first slot = counter 1, first commit = counter 2); cross-epoch lineage rides in the optional `commit.epochLink` field (verified when present, not currently exercised by the deployed parent); cross-epoch ordering comes from Ethereum anchors; no DynamoDB. The two stale DynamoDB code comments (`packages/verify/src/types.ts` `requireEpochId` doc, `packages/adapter-nitro/src/kms-counter.ts` header) now say "an external monotonic anchor" without naming a store.

## 11. Known open items for the maintainer

* Publishing decisions: `@mikeargento/bitgraph-verify` 1.1.0 and `@mikeargento/bitgraph-audit` 0.1.0 are prepared but deliberately unpublished. `docs/HOW-TO-AUDIT.md` documents the from-source path until the npx one-liner is real.
* Self-notarization stays a disabled hook (`notarizeArchiveHook`, `docs/EXPORT-INTEGRATION.md`); wiring it commits a permanent proof and is the maintainer's manual decision.
* The partial signature-only helpers (`website/src/lib/bitgraph.ts` `verifyProofSignature`, `server/commit-service/src/parent/verify-helper.ts` `verifySignatureOnly`) are future consumers of `verifyProofIntegrity`; consolidating them would strengthen both call sites (recorded in Phase 2, out of scope this run).
* The website's two-sided time-window copy shares the not-after freshness assumption documented in section 10; website copy was out of scope for this run.
* The root CLAUDE.md structure diagram still shows `src/types.ts` and `src/proof-hash.ts` at the repo root; they live in `packages/verify/src/`.
* Three source files (`packages/audit/src/export.ts`, `packages/audit/src/report-json.ts`, `website/src/lib/export-epoch.ts`) contain a literal NUL byte inside composite-key template strings, so git classifies them as binary in diffs. Functionally correct; replacing the literal NUL with the `"\u0000"` escape would restore text diffs.
