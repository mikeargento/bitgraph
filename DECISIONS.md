# DECISIONS.md

Date: 2026-07-09
Branch: audit-bundle

This file records assumptions confirmed, corrections made, and judgment calls
during the Audit Bundle build, per the build brief's authority rule: the code
outranks the prompt, and every confirmation or correction against source is
logged here so the maintainer can review the reasoning after the run.

## Phase 1: Ground-truth spot-check (G1 through G10)

Each item below was re-verified against current source on branch audit-bundle
(HEAD e324da47). Line numbers cited are the actual current lines.

### G1. Epoch genesis and lineage: CONFIRMED

- Chain state is in-memory only, created as `{ counter: 0n, lastProofHashB64: undefined, pendingEpochLink: undefined }` at `server/commit-service/src/enclave/app.ts:143`.
- `prevB64` is set only when `chain.lastProofHashB64 !== undefined` (app.ts:572-574), which happens only after a prior proof in the same boot (state updated at app.ts:694). Field is absent at genesis, not null.
- `verifyAndLinkChain()` at app.ts:704-770 builds the six-field `epochLink` (prevEpochId, prevPublicKeyB64, prevCounter, prevProofHashB64, toEpochId, toPublicKeyB64) and sets ONLY `chain.pendingEpochLink`; it never seeds `lastProofHashB64`, so even the continuation path would not produce a cross-epoch prevB64. Lineage rides exclusively on epochLink.
- The epochLink is injected on the first commit of the chain and consumed single-use (app.ts:581-586).
- The deployed parent always sends fresh genesis with no lastProof: `initEnclave()` at `server/commit-service/src/parent/server.ts:164-176` (cited 159-175; drifted by a few lines, behavior identical). The comment block above it states: always fresh genesis, each epoch starts at counter 1, Ethereum anchors order epochs.
- Canonical verifier's `verifyEpochLink` at `packages/verify/src/verifier.ts:865` (exact match) checks structure, successor binding, cross-epoch requirement, key change requirement, and the single-successor invariant via module-level state.
- Audit design consequence stands: treat epochs as independent chains ordered only by verified anchor evidence, support epochLink as lineage evidence when present, never treat prevB64 as bridging epochs.

### G2. Two-position counter semantics: CONFIRMED

- Slot allocation increments the per-chain counter and takes it: `chain.counter += 1n` at app.ts:257 (inside `handleAllocateSlot`, app.ts:248).
- Commit increments again and takes the later value: `chain.counter += 1n` at app.ts:543 with `counterStr` at app.ts:544 (cited 542-544; matches).
- First proof of an epoch therefore has slot=1, commit=2. Slot positions never produce stored proof files. Gap logic must treat a position as explained if it is some proof's `commit.counter` OR referenced by some proof's `commit.slotCounter`. Confirmed as the design basis for the gap anomaly class.

### G3. Commit schema: CONFIRMED

- The schema lives in `packages/verify/src/types.ts`. There is NO `src/types.ts` at repo root; `src/` contains only `__tests__/`, `constructor.ts`, `host.ts`, `index.ts`, `policy.ts`. (The repo-root CLAUDE.md structure diagram listing `src/types.ts` and `src/proof-hash.ts` is stale; the code wins.)
- Commit block spans types.ts:98-190 exactly. Fields: `nonceB64` (only required), optional `counter?`, `time?`, `prevB64?`, `epochId?`, `slotCounter?`, `slotHashB64?`, `epochLink?` (six required sub-fields).
- The live enclave injects an undeclared `chainId` into commit for non-default chains via a type cast: `(commitFields as Record<string, unknown>).chainId = chainId` at app.ts:577-579. Live proofs on `bitgraph:main` carry it inside the signed body. Audit schema validation MUST tolerate unknown fields.
- `slotAllocation.epochId` is required in the slot record and built to match (app.ts:265-272).

### G4. proofHash is not on the wire: CONFIRMED

- No `proofHash` field anywhere in `packages/verify/src/types.ts`.
- `computeProofHash()` at `packages/verify/src/proof-hash.ts:46` (exact match).
- Appended at storage/serving time by the parent server (`server/commit-service/src/parent/server.ts:67-73` on store, :323-329 on serve) and by the ledger (`packages/ledger/src/s3.ts:62-66`).
- Audit tool computes canonical identity itself and cross-checks any embedded `proofHash` field, flagging mismatches with a stable code.

### G5. Anchor proofs: CONFIRMED

- `packages/hosted/src/bitcoin-anchor.ts` (legacy filename, Ethereum): `digestB64 = SHA-256 of the block-hash STRING` at lines 188-189 (exact match): `sha256(new TextEncoder().encode(block.hash))`.
- Signed attribution: `name: "Ethereum Anchor"` (line 199), `message: block.hash` (line 200), `title: https://etherscan.io/block/{number}` (line 201). Block number appears in the signed body only inside the title URL.
- Block timestamp exists ONLY in unsigned advisory `metadata.anchor` (lines 204-213, `blockTime`/`blockTimeISO`). Never trust it.
- Anchor commits use `chainId: "bitgraph:main"` (line 196).
- Identification rule stands: signed `attribution.name === "Ethereum Anchor"` primary, unsigned `metadata.type === "ethereum-anchor"` corroboration only.

### G6. Chains are per-chainId: CONFIRMED

- Per-chain state map and `getChain()` at app.ts:125-148; `DEFAULT_CHAIN = "global"` at app.ts:137. A caller omitting chainId lands on the separate `"global"` chain.
- Website commits use `chainId: "bitgraph:main"` (`website/src/lib/bitgraph.ts:304` and :361); the anchor service uses the same (bitcoin-anchor.ts:196). Caller convention, not enclave enforcement.
- User proofs and anchors interleave on one chain in production: same counter sequence, same prevB64 links, same key. Partition reconstruction by (signer key, epochId, chainId).

### G7. Verifier boundary: CONFIRMED

- `verify()` at `packages/verify/src/verifier.ts:98-103`: `{ proof, bytes: Uint8Array (required), trustAnchors?: VerificationPolicy }`.
- It checks structure, artifact digest vs bytes, canonical Ed25519 signature, agency envelope, slot allocation, epochLink, then policy. It does NOT check prevB64 chain integrity or counter continuity (audit tool's job) and does not interpret attestation report content.
- `VerificationPolicy` at `packages/verify/src/types.ts:386` has exactly 14 all-optional fields: requireEnforcement, allowedMeasurements, allowedPublicKeys, requireAttestation, requireAttestationFormat, minCounter, maxCounter, minTime, maxTime, requireEpochId, requireActor, allowedActorKeyIds, allowedActorProviders, requireSlot.
- `verifyEpochLink` (verifier.ts:865) uses module-level `consumedPredecessors` state; exported `resetEpochLinkState()` at verifier.ts:942. The audit tool must reset it between runs.

### G8. Fixtures reality: CONFIRMED

- Zero standalone JSON proof fixtures anywhere in the repo (searched all non-node_modules JSON for bitgraph/1 and occ/1: none).
- `MOCK_PROOF` at `src/__tests__/proof-hash.test.ts:7` (placeholder values, e.g. digestB64 "abc123==").
- `REALISTIC_PROOF` at `src/__tests__/proof-hash-regression.test.ts:17` (real-shaped Ethereum anchor proof: slotAllocation `bitgraph/slot/1` at line 45, attribution "Ethereum Anchor" at line 54, truncated attestation blob).
- `makeFixture()` at `src/__tests__/verifier.test.ts:23`; default fixtures are chainless (counter only when `withCounter` is set, epochId optional).
- All carry `bitgraph/1`. Static fixtures will fail FULL verification for non-version reasons by design; treat them as canonical-hash and ingest fixtures.

### G9. Attestation validator exists: CONFIRMED

- `website/src/lib/nitro-verify.ts`: COSE_Sign1 CBOR decode, ECDSA P-384 signature vs leaf cert, certificate chain walk, topmost cert verified against the AWS Nitro root CA embedded as a constant (`./aws-nitro-root-ca`), PCR0 match against expected measurement, user_data binding to the proofHash. Header comment states "No network calls."
- Port target for the audit tool's offline attestation validation, with the root CA bundled locally. If a genuinely correct offline port is not achievable, report `attestation-validation-unsupported`.

### G10. Repo mechanics: CONFIRMED

- Root `package.json`: `@mikeargento/bitgraph` 1.1.0, `"license": "SEE LICENSE IN LICENSE"`, `"workspaces": ["packages/verify"]` exactly.
- Build/typecheck chaining pattern: `"build": "npm run build --workspace=packages/verify && tsc"` and the same for typecheck. `packages/audit` must be added to the workspaces array and chained the same way.
- `packages/verify/package.json`: `@mikeargento/bitgraph-verify` 1.0.0, MIT, `"type": "module"`, no engines field, no test script (no in-package tests). tsconfig: NodeNext module + moduleResolution, strict true.
- Test convention: node:test suites run from repo root via `test:core` (tsc then `node --test dist/__tests__/...`).
- No naming collisions: nothing named "audit" or "bundle" exists in product code (packages/, src/, website/src/).

### Mission premise (bytes-free API gap): CONFIRMED

- `packages/verify/src/index.ts` exports only `verify`, `resetEpochLinkState`, `computeProofHash`, `canonicalize`, `canonicalizeToString`, `constantTimeEqual`, and types. No bytes-free full-integrity API exists.
- Partial signature-only helpers confirmed at exactly the cited lines: `verifyProofSignature` at `website/src/lib/bitgraph.ts:169` and `verifySignatureOnly` at `server/commit-service/src/parent/verify-helper.ts:13`. Neither checks slot binding; neither is exported from packages/verify. They are future consumers of the Phase 2 API; not modified in this run.

## Version policy (owner directive)

The audit system supports exactly one proof schema: `bitgraph/1`. The legacy
`occ/1` schema is pre-release beta testing data and is permanently out of
scope. Any input whose version field is not exactly `bitgraph/1` is rejected
at ingest with the stable code `unsupported-version`, counted, listed with
source path and offending version string, and excluded from verification,
chain reconstruction, and anomaly analysis. No compatibility mode, no
tolerant parsing, no migration logic, no legacy tier, no softening flags.

This matches the canonical verifier exactly: `packages/verify/src/verifier.ts:269`
rejects any version other than `bitgraph/1` with strict equality
(`if (p["version"] !== "bitgraph/1")`). Slot records have their own
discriminator: `slotAllocation.version` must be exactly `bitgraph/slot/1`
(`packages/verify/src/types.ts:698`, exact match). For exit-code purposes,
`unsupported-version` inputs count under the verification-failures flag.

## Phase 2: Bytes-free proof integrity API in @mikeargento/bitgraph-verify

Date: 2026-07-09

### Naming decision

Following the package's existing design language (`verify` / `VerifyResult` /
`computeProofHash`), the new API is:

- `verifyProofIntegrity(opts: { proof: BitGraphProof; trustAnchors?: VerificationPolicy }): Promise<ProofIntegrityResult>`
- `ProofIntegrityResult = { valid: boolean; artifactBinding: "not-checked"; reason?: string }`

The `artifactBinding: "not-checked"` field is a literal type carried on every
result, success or failure, so no caller can mistake a passing integrity
check for full verification. "Integrity" was chosen over alternatives like
`verifyOffline` (wrong: verify() is also offline) or `verifySignatureOnly`
(wrong: it checks far more than the signature).

### Refactor shape (no duplicated checks)

`verify()` and `verifyProofIntegrity()` now delegate to a single internal
`runChecks(proof, bytes | undefined, trustAnchors)` pipeline in
`packages/verify/src/verifier.ts`. Every check has exactly one
implementation. When `bytes` is undefined, only the artifact digest
comparison is skipped; check order and failure strings are otherwise
identical. `verify()` result semantics are byte-for-byte unchanged:
same checks, same order, same failure strings, same result shapes
(verified by exact-string regression tests plus the pre-existing 114-test
suite passing unmodified).

One deliberate judgment call: the bytes-free path still requires
`artifact.digestB64` to decode as valid base64 (failure string
"artifact.digestB64 is not valid base64", same as verify()). That is a
proof-internal well-formedness property, not artifact binding; a proof
whose digest field cannot decode could never verify against any bytes.
The digest-versus-bytes comparison is the only skipped check. Ordering
note: in bytes mode, sha256(bytes) is still computed before the digest
decode, exactly as before the refactor.

### Tests

New suite `src/__tests__/proof-integrity.test.ts` (30 tests), wired into
the root `test:core` script alongside the existing files (repo convention:
root node:test over dist/__tests__). Baseline before: 114 tests. After:
144 tests, all passing. Slot-carrying and epochLink-carrying fixtures are
built manually with real Ed25519 signatures over the canonical SignedBody
(the root Constructor does not produce slots or epoch links); no verifier
semantics are bypassed. Covers: valid proof without bytes; the contrast
case (verify() fails on wrong bytes while verifyProofIntegrity passes,
proving binding is genuinely not checked); tampered signature; tampered
version (exact reason); slot binding (tampered slotHashB64, swapped slot
record, tampered slot counter, slot ordering violation); epochLink (valid,
idempotent re-verify, same-key rejection, fork detection); policy
enforcement via trustAnchors (allowedMeasurements, requireEnforcement,
requireSlot, minCounter); and exact-failure-string regression tests for
verify().

### Version and changelog

`packages/verify` bumped 1.0.0 to 1.1.0 (minor: additive API). Created
`packages/verify/CHANGELOG.md` with 1.1.0 and 1.0.0 entries. NOT published;
publishing is the maintainer's decision. The root package's dependency
range `^1.0.0` already accepts 1.1.0; root package.json version untouched.

### Scope choices

- The root package (`src/index.ts`, `@mikeargento/bitgraph`) does NOT
  re-export `verifyProofIntegrity` in this run. The Phase 2 task scopes the
  API to packages/verify; adding a root re-export would change the
  proprietary package's public API outside its own version bump. The new
  test suite imports from `@mikeargento/bitgraph-verify` directly (the same
  import path `src/constructor.ts` already uses), which also exercises the
  workspace export. The maintainer can add the root re-export with a root
  version bump later if desired.
- Consolidation opportunity (not done in this run, per the brief): the
  partial helpers `verifyProofSignature` (`website/src/lib/bitgraph.ts:169`)
  and `verifySignatureOnly`
  (`server/commit-service/src/parent/verify-helper.ts:13`) are future
  consumers of `verifyProofIntegrity`. Both check only the Ed25519
  signature; neither checks slot binding, agency, or epochLink. Replacing
  them would strengthen both call sites.
- The existing test files' describe titles use em dashes; the new test file
  uses colons per the current style rule. Existing files were not reworded.

## Phase 3: Bundle format specification (docs/BUNDLE-FORMAT.md)

Date: 2026-07-09

### Placement

Created `docs/BUNDLE-FORMAT.md` (new `docs/` directory at the repo root). The
repo had no prior docs directory or docs-file convention beyond root-level
markdown (README.md, BITGRAPH-DOCS.md, DECISIONS.md) and the live site pages
under `website/src/app/docs` (off-limits per the hard rules, and site content
rather than normative spec). BITGRAPH-DOCS.md is a monolithic site-content
draft, not a home for a normative interchange spec, so a dedicated `docs/`
directory was created per the brief's default path. Future spec documents
(e.g. the audit report schema) can live beside it.

### Format identifiers

- Bundle format version: `bitgraph-bundle/1`, carried only in the manifest's
  `version` field. Follows the repo's existing discriminator convention
  (`bitgraph/1`, `bitgraph/slot/1`). Distinct from the proof schema version by
  design; the two evolve separately.
- Anchor witness discriminator: `version: "bitgraph-anchor-witness/1"`, same
  convention, so witnesses are discovered by shape exactly like proofs and no
  filename is ever load-bearing (the sole exception being the reserved root
  `manifest.json`, which cannot be shape-discovered because it describes the
  bundle rather than participating in it).

### Deterministic contents hash scheme

Chose the hash-of-hashes variant of the scheme sketched in the brief, fully
specified in spec section 8: per entry e = SHA-256(UTF-8(path) || 0x00 ||
content bytes); sort entries by raw UTF-8 path bytes (unsigned byte-wise, no
locale, no Unicode normalization); final hash = SHA-256 of the concatenated
32-byte entry digests; base64-standard encoded as `contentsHashB64`.
Rationale for hashing per-entry digests instead of hashing one long
path/NUL/content concatenation: raw concatenation is boundary-ambiguous
(content bytes may contain NULs, and nothing terminates content, so two
different bundles could serialize to identical streams). Fixed 32-byte entry
digests make the final concatenation unambiguous, and the NUL separator
inside each entry digest is unambiguous because paths cannot contain NUL.
The hashed set is every entry except the root manifest.json itself
(interpretation-free file-level fixity; unrelated files included). Two test
vectors embedded in the spec, including the empty-set value
(47DEQpj8HBSa+/TImW+5JCeuQeRkm5NMpJWZG3hSuFU=), computed and verified locally.

### Manifest design choices

- All fields advisory and unsigned; only `version` is required. Unknown
  manifest fields tolerated, mirroring the G3 unknown-field tolerance rule.
- `counterRanges` is an array of { epochId, chainId, min, max } partitions
  rather than the brief's singular "counter range", because counters are
  epoch-local and chain-local (G6); a flat cross-epoch range would be
  meaningless. Recorded as a deliberate widening of the brief's field list.
- Default chain representation: proofs lacking commit.chainId belong to the
  enclave's default "global" chain (app.ts DEFAULT_CHAIN), so the manifest
  uses the literal string "global" for them in `chainIds`/`counterRanges`.
- Open-epoch snapshot: `openEpochs?: Array<{ epochId, counterAtSnapshot }>`;
  a non-empty array IS the snapshot flag (flag and counter in one field, per
  the brief's "flag with counter at snapshot time").
- `proofCount` counts distinct canonical proof hashes, not files, so
  duplicate copies do not skew it.

### Discovery and matching choices

- "Proof-shaped" defined precisely: top-level JSON object with string
  `version` plus object-valued `artifact`, `commit`, and `signer`. Shaped +
  version === "bitgraph/1" -> member candidate (then full canonical
  structural validation; structural failures are reported members, not
  silently dropped). Shaped + any other version -> `unsupported-version`.
  Not shaped -> ignored. Standalone bitgraph/slot/1 records are not
  proof-shaped and are therefore ignored, which is correct: slots ride
  embedded in proofs.
- Base64 digest comparison specified as decode-then-compare-bytes with the
  strict round-trip decoding the canonical verifier uses (fromBase64 in
  verifier.ts rejects non-round-tripping strings), never string comparison.
- Stored-form proofs (S3 StoredProof with appended proofHash) explicitly
  anticipated: the extra field is tolerated at ingest and cross-checked per
  G4, never trusted.

### Anchor witness design (per G5)

Narrow three-required-field JSON (headerRlpHex, blockNumber, blockHash, plus
optional network label) around the RLP-encoded header as the only
load-bearing field. Mandatory six-step consumer procedure in spec 10.3:
decode RLP; recompute the block hash locally with Ethereum's Keccak-256
(original Keccak padding, explicitly not FIPS-202 SHA3-256); compare against
signed attribution.message (lowercased, full 0x string); bind message to
artifact.digestB64 via SHA-256 over the UTF-8 bytes of the exact signed
message string (matching bitcoin-anchor.ts:188-189, which hashes the block
hash STRING); cross-check block number against the header's RLP field index 8
and the signed etherscan URL in attribution.title; only then read the
timestamp from RLP field index 11. Case handling is deliberate: the
hash-string comparison in step 3 normalizes case (hex is case-insensitive),
but the digest binding in step 4 uses the exact signed string bytes, because
that is what the enclave hashed and signed. Witness is optional inbound
evidence, never fetched, and an unverified or failed witness confers nothing;
a failed witness does not change the anchor proof's own standing.

### Spec-versus-brief deltas worth flagging

- The ledger's `anchorKey()` (`anchors/{epoch}/{counter12}-{hash}.json`) and
  the live anchor service's write path (`anchors/{epoch}/{counter12}.json`,
  bitcoin-anchor.ts:110-115) disagree on the anchor filename shape. The spec
  lists both as acceptable advisory forms; discovery is shape-based so the
  divergence is harmless in bundles. Not fixed in product code in this run.
- Tar bundle-root normalization (single common top-level directory is
  stripped) was specified to make `tar -czf bundle.tgz mybundle/` output
  conform naturally; the rule is deterministic (applies iff all entries share
  the same first path component).

## Notes and minor drift observed (no ground-truth corrections needed)

- `initEnclave()` cited at server.ts:159-175 now sits at server.ts:164-176. Behavior unchanged.
- The repo-root CLAUDE.md structure diagram still lists `src/types.ts` and `src/proof-hash.ts`; both actually live in `packages/verify/src/`. G3's statement is the correct one. Not modified in this run.
- Stale DynamoDB comments confirmed present for Phase 6: `packages/verify/src/types.ts:448` and `packages/adapter-nitro/src/kms-counter.ts:8`.

## Phase 4a: Audit package core (scaffold, ingest, verification tiers)

Date: 2026-07-09

### Scaffold and wiring

- Created `packages/audit` = `@mikeargento/bitgraph-audit` 0.1.0, MIT
  (LICENSE copyright 2024-2026 Mike Argento, matching packages/verify),
  pure ESM, NodeNext, tsconfig byte-identical to packages/verify's.
- Runtime dependencies: `@mikeargento/bitgraph-verify` `^1.1.0` (the
  bytes-free integrity API landed in 1.1.0, so `^1.0.0` would be wrong)
  and `@noble/hashes` `^1.4.0` (the range the repo already uses). Nothing
  else: the tar reader is implemented in-package (`src/tar.ts`), gzip via
  `node:zlib`, hashing via @noble/hashes' incremental API. No runtime
  network access; the only node builtins imported are fs, path, zlib.
- Root package.json: workspaces now `["packages/verify", "packages/audit"]`;
  build and typecheck chain audit after verify
  (`npm run build --workspace=packages/verify && npm run build --workspace=packages/audit && tsc`).
- Root `test:core` changed from `tsc && node --test ...` to
  `npm run build && node --test ...`: the new audit tests import
  `@mikeargento/bitgraph-audit`, so the workspace dists must exist before
  the root tsc compile. `npm run build` ends in the same root `tsc` the
  script ran before; this is a strict superset, and it makes `npm test`
  self-sufficient on a fresh checkout.
- Root devDependencies gained `@mikeargento/bitgraph-audit": "^0.1.0"`
  (declares what the root test suite imports; npm resolves it to the
  workspace). The root package does NOT re-export anything from the audit
  package and its version is untouched.

### Test placement (repo convention decision)

Tests live at root `src/__tests__/` and run via the root node:test
`test:core` script, exactly like the Phase 2 proof-integrity suite:
`audit-ingest.test.ts` (21 tests), `audit-tiers.test.ts` (13 tests), plus
a shared non-test helper module `audit-fixtures.ts` (Constructor-built and
manually signed Ed25519 fixtures, in-memory tar writer with ustar + PAX +
GNU long-name support, bundle directory writer). Root placement also lets
fixtures use the real root Constructor commit path, which an in-package
suite could not import. Baseline before this phase: 144 tests; after: 178,
all passing.

### Module map

- `src/types.ts`: ObservedProof, ProofSource, ProofVerification,
  UnsupportedVersionRecord, ArtifactRecord, AnchorWitnessFile,
  BundleManifest, ManifestReport, IngestResult, IngestCounts,
  VerificationSummary, AuditFinding, and the status unions. AnomalyCode is
  an OPEN string-literal union (`| (string & {})`) so reconstruction,
  anchor, and attestation stages extend it without touching this file.
  Codes emitted by this phase: unsupported-version, proofhash-mismatch,
  exact-duplicate, semantic-duplicate, unsafe-path, duplicate-path,
  manifest-unparseable, manifest-unrecognized-version,
  manifest-field-invalid, manifest-contents-hash-mismatch.
- `src/tar.ts` (internal, not exported): minimal streaming tar reader.
  ustar headers with checksum verification, prefix field, PAX 'x' records
  (path, size applied; others parsed and ignored), PAX 'g' global defaults,
  GNU 'L' long names, 'K' long linknames consumed and discarded, GNU
  base-256 numeric fields. Bodies are async chunk generators; unconsumed
  remainders are skipped automatically, so nothing is ever buffered by the
  layer itself.
- `src/contents-hash.ts`: the spec section 8 scheme. `computeContentsHashB64`
  (one-shot, exported; the Phase 5 exporter can produce manifests with it)
  plus `combineEntryDigests` for streaming consumers. Path sort is over raw
  UTF-8 path bytes (Buffer-level compare), not JS string order.
- `src/ingest.ts`: `ingestBundle()` and `streamMatchedArtifacts()` (the
  latter exported as the low-level artifact-bytes hook for later stages).
- `src/verify-tiers.ts`: `verifyObservedProofs()`.
- `src/index.ts` public API: `ingestBundle`, `streamMatchedArtifacts`,
  `verifyObservedProofs`, `computeContentsHashB64`, `computeEntryDigest`,
  and the types above.

### Memory design (bounded relative to payload sizes, not constant)

Ingest is a single streaming pass: every entry is hashed incrementally
(three parallel SHA-256 states per tar entry: content hash, contents-hash
entry digest under the full path, and the same under the stripped-root
path variant, so the root-strip decision never forces a second pass over
the container). Only JSON candidates up to MAX_CANDIDATE_JSON_BYTES
(8 MiB, a documented constant; real proofs are kilobytes) are buffered
whole; artifact bytes are hashed and dropped. Retained state scales with
the number of entries plus the total size of the proof JSONs. The
verification pass re-reads matched artifact bytes one artifact at a time
(direct file reads for directories, one sequential re-stream of the
archive for tars), because the canonical verify() API takes a whole byte
array; peak memory is bounded by the largest matched artifact. Re-read
bytes are re-hashed before use: bytes that no longer match the recorded
digest (file changed between passes, shadowed duplicate tar paths) are
never fed to verify() under a stale identity.

### Judgment calls and interpretations

- ObservedProof retains the parsed proof object (`proof` field) in
  addition to the compact chain metadata. The verification pass needs the
  full object after ingest completes (artifact bytes can precede their
  proofs in a stream, so verification cannot run inline), and proofs ARE
  payload, so this stays within the bounded-memory contract. Report
  emitters serialize the compact fields, not the object.
- Verification ordering is deterministic and documented: full-tier proofs
  are verified as their artifact bytes stream by (container order), then
  the rest in first-observation order. `resetEpochLinkState()` runs
  exactly once per `verifyObservedProofs()` call, before any proof.
  Consequence tested: within one run, the second consumer of a shared
  epochLink predecessor fails with the verifier's FORK reason; across
  runs, fresh state means a re-audit is never poisoned by a prior bundle.
- "Artifact mismatched digest" (the brief's tier test item) is realized
  honestly: matching is content-addressed, so an artifact that does not
  hash to a proof's digest simply never binds (proof lands at the
  integrity tier), and a proof whose digestB64 was corrupted fails with
  the verifier's exact signature reason, because the digest lives inside
  the signed body. There is no code path that feeds non-matching bytes to
  verify(); the digest-mismatch branch of verify() itself stays covered by
  the verify package's own suite. Both bundle-level scenarios (corrupted
  digest, decoy filename) are tested.
- Tar bundle-root normalization counts EVERY file entry in the archive,
  including unsafe-path entries that are skipped and reported: the spec
  says the rule applies iff all entries share one top-level directory, and
  an entry outside the candidate root (or with no directory component, or
  escaping the root) rules stripping out. Initially implemented over safe
  entries only; corrected during testing, and the unsafe-path test now
  pins the behavior.
- Unsupported-version proof-shaped files remain candidate artifacts after
  rejection, per spec section 6.3 (they are not member proofs). Harmless:
  matching is by content hash.
- Standalone anchor witness files are discovered by their version
  discriminator and retained (path, file hash, parsed object) but not
  cryptographically verified in this stage; the spec 10.3 procedure
  belongs to the anchor analysis stage. Witnesses are excluded from
  artifact candidacy per spec 6.3.
- Structurally invalid bitgraph/1 member candidates are still observed
  (spec 6.1): chain metadata is extracted best-effort with type guards,
  and the precise structural failure reason comes from the canonical
  verifier during the verification pass rather than a duplicated
  validator at ingest. No verification semantics are duplicated into the
  audit package anywhere.
- chainId: read from the signed commit body when it is a non-empty
  string; absent normalized to the literal "global" (the enclave's
  DEFAULT_CHAIN), per G6 and the Phase 3 manifest convention.
- Chainless proofs (no counter AND no epochId) are tagged
  `chainless: true` at ingest and counted in the verification summary.
  No finding is emitted: observed-but-unchained is not an anomaly.
- Duplicate semantics: exact duplicate = same canonical identity AND a
  byte-identical prior source (file SHA-256 equality); semantic duplicate
  = same canonical identity, new byte encoding. Both collapse into one
  ObservedProof with appended sources; counts and findings record each
  extra copy. An embedded proofHash mismatch on ANY copy marks the record
  "mismatch" and emits a per-file finding.
- The manifest is classified by its reserved root path only, before shape
  checks, so a manifest is never mistaken for a proof or artifact. The
  computed contents hash is always present on IngestResult
  (`computedContentsHashB64`), whether or not a manifest declared one;
  comparison and the advisory mismatch finding happen only when declared.
