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

## Phase 4b: Causal reconstruction and anomaly classification

Date: 2026-07-09

### Module split

- `packages/audit/src/reconstruct.ts`: partitioning per (signer
  publicKeyB64, epochId, chainId), chain components from prevB64 hash
  links, epoch relationship derivation (epochLink lineage edges, hard-edge
  transitive ordering). Exports `reconstructChains(ingest)`.
- `packages/audit/src/anomalies.ts`: G2 gap logic, collisions, predecessor
  reuse, chain breaks, multiple genesis, slot ordering, epochLink
  anomalies, divergence records. Exports
  `classifyAnomalies(ingest, reconstruction)`.
- `packages/audit/src/authority.ts`: authority grouping and intra-epoch
  change flags. Exports `analyzeAuthorities(ingest)`.
- `packages/audit/src/validity.ts` (internal, not exported): the shared
  intrinsic-validity helper plus counter parsing and deterministic
  ordering helpers.
- All new data structures live in `types.ts` (which stays logic-free);
  everything is re-exported from `index.ts`.

### Intrinsic validity (the one place validity meets topology)

Divergence parties and hard lineage edges require cryptographic validity,
but the run verification record alone cannot supply it: the canonical
verifier's epoch link single-successor check is order-dependent (whichever
fork consumer verifies second fails with FORK DETECTED), and policy
rejections are trust decisions, not cryptographic unsoundness. The helper
`isIntrinsicallyValid` therefore treats run statuses "verified" and
"artifact-unavailable" as valid and gives everything else one isolated
bytes-free recheck via `verifyProofIntegrity` with fresh epoch link state
and NO policy. The run verification record is never modified and is shown
unmodified on every divergence party. Consequence tested: in an
epochlink-fork, BOTH branches appear as valid competing parties even
though one carries a run FORK failure; the divergence explanation states
that the failure is an artifact of verification order, not evidence of
which branch is authoritative. State discipline: the recheck resets the
verify package's module-level epoch link state before and after each
call, so reconstruction and classification are documented to run after
verifyObservedProofs (which resets its own state at the start of every
run; a later audit run is unaffected).

### G2 gap logic decisions

- Explained set: every parseable commit.counter and every parseable
  commit.slotCounter of the partition's observed members, as distinct
  positions, never deduplicated against each other. Range: [min, max]
  over both position kinds. Positions outside the observed range are
  never flagged (a bundle missing an epoch's head produces a chain-break,
  not phantom gaps at positions 1..k).
- One "unexplained-counter-positions" anomaly per partition with a
  UnexplainedPositionsDetail payload: complete contiguous `ranges`,
  BigInt-safe total `count`, flat `positions` list capped at 10,000
  entries with a `truncated` flag. The cap prevents a fabricated
  counter pair like (1, 10^18) from exploding the report; ranges and
  count stay complete and exact.
- Topology anomalies are computed over ALL observed members regardless of
  verification outcome (dimension separation): a forged proof's counters
  still explain positions, and its dangling prevB64 is still a chain
  break, with statuses reported alongside. Exceptions below.

### Anomaly definitions as implemented

- counter-collision / slot-collision / predecessor-reuse follow the brief
  letter: they exist only between two or more VALID non-identical proofs
  (canonical identities are distinct by construction since ingest dedups).
  Invalid proofs sharing the contested resource appear in the divergence's
  invalidContext, never as parties; with fewer than two valid claimants no
  collision or fork is declared (the invalid objects are already reported
  on the verification dimension).
- multiple-genesis has no validity qualifier in the brief, so the anomaly
  counts all observed no-prevB64 members (with validity in details); the
  divergence still requires two or more valid parties.
- chain-break sub-cases became three stable codes: `chain-break-missing`,
  `chain-break-malformed` (prevB64 not strict base64 of 32 bytes), and
  `chain-break-cross-partition` (the hash resolves to an observed proof in
  a DIFFERENT partition; the mission brief calls this case
  "known-conflicting"). Cross-partition links are never honored as edges:
  prevB64 never bridges epochs or chains per G1/G6.
- `epochlink-terminal-missing` = the prior epoch IS observed but the
  referenced terminal proof is absent; `epochlink-dangling` = neither the
  referenced proof nor the prior epoch is observed.
- Added `epochlink-mismatch` beyond the four listed codes: the link's
  prevProofHashB64 matches an observed proof but the declared prevEpochId,
  prevPublicKeyB64, or prevCounter disagrees with that proof. The
  canonical verifier cannot detect this (it never sees the predecessor);
  hiding it under another code would misreport. Such edges are recorded
  with `metadataConsistent: false` and are never hard ordering evidence.
- `epochlink-fork` requires two or more DISTINCT successor epochs on one
  predecessor tuple, matching the verifier's single-successor semantics
  (keyed prevEpochId|prevCounter|prevProofHashB64, comparing toEpochId).
- slot-order-violation (slotCounter >= counter) is reachable on
  verifier-valid proofs: the canonical slot ordering check runs only when
  a slotAllocation record is embedded, so a bare commit.slotCounter can
  violate ordering without failing verification. Classified per member.
- Deliberately NOT flagged in this phase: one proof's slotCounter equal to
  a DIFFERENT proof's commit counter (cross-kind position sharing). The
  brief's collision codes are same-kind only. Noted as a candidate future
  code (e.g. position-collision) for the report stage to consider.

### Reconstruction decisions

- Components are built by union-find over hash-link edges only; an edge
  exists when a member's prevB64 equals another member's computed
  canonical hash within the same partition. Counters never create or
  break edges. Link order is a deterministic iterative DFS (no recursion,
  safe for 50k-length chains) from genesis and broken-link entry points,
  branches ordered by counter then hash. prevB64 cycles are impossible
  among observed members (a cycle requires a proof whose canonical
  SHA-256 appears inside its own signed body, a hash fixpoint), but the
  traversal still covers leftovers defensively.
- Genesis (no prevB64 field) is distinguished from broken-link entry
  points (prevB64 present but unresolved); a single genesis is normal per
  G1 and produces nothing.
- Proofs with chain fields but no signer key cannot join a lineage and
  are listed as `unpartitionedProofHashes` (their structural failure is
  reported by the verification dimension). Chainless proofs are
  `unchainedProofHashes`, not anomalies. Multiple signer lineages are
  never merged; same signer + epoch on different chainIds are separate
  partitions per G6.
- Epoch ordering derives ONLY from hard lineage edges (matched,
  metadata-consistent, both endpoint proofs intrinsically valid),
  propagated transitively into `orderedPairs`. In an epochlink-fork BOTH
  edges stay hard: each genesis embeds the terminal's hash in its signed
  body, so "terminal existed before each successor" holds regardless of
  which branch is authoritative; the fork itself is separately classified
  and diverged. A lineage cycle makes ordering claims contradictory:
  pairs reachable in both directions are REMOVED from orderedPairs
  (asserting neither direction) and the cycle is classified
  `epochlink-cycle`. Cycles are constructible from fabricated
  signature-valid proofs, hence detected over all matched edges.
- `EpochRecord.anchorBounds` (typed `EpochAnchorBound[]`) is the Phase 4c
  extension point for anchor-derived one-sided bounds; reconstruction
  always leaves it undefined. Epochs with no hard edge are
  "observed-but-unordered"; overlapping or absent bounds are
  concurrent-or-unordered, never divergence (tested).
- A malformed epochLink shape (any of the six fields missing or
  non-string) produces no lineage edge; the canonical verifier reports it
  on the verification dimension. An edge whose matched predecessor has an
  observed in-partition successor is recorded with
  `referencedProofIsTerminal: false` but still counts as ordering
  evidence (the hash embedding is unaffected); no dedicated code, the
  field is on the edge for the report stage.

### Authority analysis decisions

- Groups key on (declared measurement, signer key, epochId, chainId,
  attestation presence) over ALL observed proofs including chainless.
- mid-epoch-signer-change and mid-epoch-measurement-change aggregate per
  epochId ACROSS chains: an epochId is boot-scoped (one keypair, one
  measurement per boot, shared by every chain the boot serves), so a
  per-chain scope would miss real intra-epoch changes.
- Same signer across epochs is surfaced as `sharedSignersAcrossEpochs`
  (normal transition evidence), never an anomaly.
- `AuthorityGroup.attested` (typed `AttestedMeasurementEvidence`) is the
  clearly typed extension point for Phase 4c; authority analysis never
  populates it and never treats a declared measurement as attested.

### Fixtures and tests

- `makeCounterChain` in src/__tests__/audit-fixtures.ts builds real
  Ed25519-signed linked chains with enclave-style slot/commit pairs
  (slot 1/commit 2, slot 3/commit 4, ...), prevB64 = computeProofHash of
  the predecessor, genesis omitting prevB64 per G1. The chains carry
  commit.slotCounter/counter WITHOUT embedded slotAllocation records:
  the verifier's slot checks run only when the record is present (G7),
  so the proofs are verifier-valid, and reconstruction/gap logic read
  only the commit fields. makeEpochLinkProof gained optional
  prevPublicKeyB64/key/counter/slotCounter/prevB64/chainId (backwards
  compatible) so lineage tests can reference real observed predecessors.
- New suites `src/__tests__/audit-reconstruct.test.ts` (11 tests) and
  `src/__tests__/audit-anomalies.test.ts` (21 tests), wired into the root
  test:core script. Baseline before this phase: 178 tests. After: 210,
  all passing. The critical regression is pinned: a healthy slot/commit
  chain (including interleaved concurrent slot allocation, slot 1/slot 2/
  commit 3/commit 4) produces one component, zero anomalies, zero
  unexplained positions, zero divergences.

### Report language

Gap and chain-break messages state absence from the bundle and explicitly
say the absence "does not, by itself, establish" authority failure or
predecessor nonexistence. Divergence explanations state that the audit
does not choose between parties. No em dashes anywhere.

## Phase 4c: Anchor analysis, witness verification, temporal bounds, offline attestation

Date: 2026-07-09

### Module map

- `packages/audit/src/anchors.ts`: anchor identification per G5. Exports
  `identifyAnchors(ingest)`.
- `packages/audit/src/rlp.ts` (internal, not exported): minimal RLP
  decoder (list-of-items, bounds-checked, exact-consumption), big-endian
  integer reads, hex helpers. No dependency; canonical-form minimality is
  not enforced because the Keccak hash comparison is the actual gate
  (any re-encoding changes the hash).
- `packages/audit/src/witness.ts`: the full BUNDLE-FORMAT.md section 10.3
  procedure. Exports `verifyAnchorWitnesses(ingest, identification)` and
  the single-pair `verifyAnchorWitness(witnessFile, observedProof)`.
- `packages/audit/src/temporal.ts`: segment bounds from verified-witness
  anchors, EpochRecord.anchorBounds population, cross-epoch ordering
  pairs. Exports `deriveTemporalBounds(ingest, reconstruction,
  identification, witnessAnalysis)`.
- `packages/audit/src/attestation.ts`: offline Nitro attestation
  validation. Exports `validateAttestations(ingest, authority?, options?)`
  and the low-level `validateNitroAttestationDocument(reportB64, options?)`.
- `packages/audit/src/aws-nitro-root-ca.ts`: the AWS Nitro Enclaves Root
  CA G1 PEM, byte-for-byte the same constant the website embeds
  (website/src/lib/aws-nitro-root-ca.ts). DER SHA-256 fingerprint
  641a0321a3e244efe456463195d606317ed7cdcc3c1756e09893f3c68f79bb5b,
  matching the value AWS publishes for Root G1 (verified locally during
  the build). Exported as `AWS_NITRO_ROOT_CA_PEM` for transparency.
- Pipeline ordering (documented on each module): verifyObservedProofs ->
  reconstructChains -> identifyAnchors -> verifyAnchorWitnesses ->
  deriveTemporalBounds; analyzeAuthorities -> validateAttestations.

### Anchor identification decisions (G5)

- Signed `attribution.name === "Ethereum Anchor"` is the only
  discriminator. Unsigned `metadata.type` is corroboration: "agrees",
  "disagrees" (present and different, finding
  `anchor-metadata-disagreement`), or "absent" (missing type is absent
  corroboration, not disagreement). A metadata-only claim never makes an
  anchor; it is listed in `metadataOnlyProofHashes` with finding
  `anchor-metadata-only-claim`.
- Block number parses ONLY from the strict signed Etherscan form
  `https://etherscan.io/block/{digits}` (anchored regex, the exact string
  bitcoin-anchor.ts signs). Anything else is treated as absent with
  finding `anchor-title-unparseable`, never guessed. The website's loose
  `/\/block\/(\d+)/` parse was deliberately not copied: for evidence,
  a stricter parse that refuses is better than a looser one that guesses.
- AnchorRecord carries no time field of any kind (pinned by test): the
  unsigned metadata.anchor timestamps are never read, and no wall-clock
  time is ever derived from a block number.

### Witness verification decisions (spec 10.3)

- Failure code taxonomy, stable AnomalyCode literals, one distinct code
  per corruption class: `witness-malformed` (field rules of 10.2,
  including hex format violations of headerRlpHex), `witness-rlp-invalid`
  (bytes are not a single well-formed RLP list), `witness-hash-mismatch`
  (step 3: recomputed hash vs signed message; this is where a tampered
  header lands), `witness-digest-mismatch` (step 4, including an anchor
  digest that fails strict base64-of-32-bytes decoding),
  `witness-block-number-mismatch` (step 5, detail states whether the
  witness claim or the signed Etherscan URL disagreed),
  `witness-claimed-hash-mismatch` (step 5, claimed blockHash vs
  recomputed), `witness-header-shape` (RLP items at index 8 or 11 missing
  or not byte strings; the spec does not gate on item count, so this
  surfaces exactly where the fields are needed), `witness-anchor-invalid`
  (precondition), `witness-unmatched`.
- Pipeline matching: a witness is a candidate for every anchor whose
  signed message equals (case-insensitively) the RECOMPUTED hash OR the
  CLAIMED blockHash. The second route exists so a tampered-header witness
  still fails loudly against its intended anchor (hash-mismatch) instead
  of disappearing as unmatched. One witness may verify multiple anchors
  (the same block hash can legitimately be anchored in different epochs).
- The 10.3 precondition ("its own cryptographic verification has
  succeeded") uses the Phase 4b intrinsic-validity helper, consistent
  with divergence parties and lineage edges: a run-order epoch-link
  artifact never disqualifies a sound anchor, and run verification
  records are never modified.
- Case handling as specified: step 3 compares lowercased, step 4 hashes
  the exact signed string bytes (tested with an uppercase-signed hash).
- `timestamp` appears on an outcome ONLY when verified; a rejected
  witness confers nothing and the anchor's own standing is unchanged.

### Temporal bounds: correction toward honesty (the main judgment call)

The 4c brief asked for "existed by block time T" upper bounds for proofs
before a verified anchor. Verified against source, the anchor mechanism
is inbound-only: the Railway service READS the latest block over RPC and
commits its hash INTO the chain (packages/hosted/src/bitcoin-anchor.ts;
no transaction is ever sent to Ethereum, no key material exists for one).
An inbound commitment cannot cryptographically upper-bound prior events:
the consumed block proves the anchor commit came AT OR AFTER the block's
timestamp, not how promptly, so "existed by T" for prior proofs
additionally assumes the anchor consumed a recently published block.
That is the deployed service's designed behavior (latest block, 12s
interval) but it is service behavior, not proof. Per the build brief's
halt rule 6 ("when honesty and the prompt conflict, correct toward
honesty, never toward the stronger claim") the bounds are implemented as:

- `not-before` (proofs causally after an anchor): committed no earlier
  than T. Grounded in block-hash unpredictability; cryptographically
  sound. basis: "block-hash-unpredictability".
- `not-after` (proofs causally before an anchor): existed before the
  anchor commit that consumed a block published at T; the wall-clock
  ceiling reading carries the explicitly stated freshness assumption on
  every bound record and in every claim string. basis:
  "causal-precedence".
- Cross-epoch ordering pairs derived from a not-after below a not-before
  are marked `assumptionDependent: true` and scoped to the COVERED
  portions of the two epochs, with covered/total proof counts on the
  pair. Overlapping or absent bounds produce no pair
  (concurrent-or-unordered, never divergence). Strict inequality: equal
  timestamps order nothing.
- BUNDLE-FORMAT.md was updated accordingly (sections 10.1 and 10.3 step
  6): the old sentence "proofs causally before the anchor existed no
  later than a block bearing this timestamp" overstated; the spec now
  states both directions with their exact strength and requires the
  ceiling assumption to be stated. This is the Phase 3 rule
  ("implementation forces a spec change, update the spec and note it")
  applied to claim language. The website's two-sided "Recorded between"
  window and CLAUDE.md's "BitGraphed before" language rest on the same
  freshness assumption; website copy is out of scope for this run (hard
  rule: website/ untouched), noted here for the maintainer.

Other temporal decisions:

- Bounds are commit-event bounds. A not-before bound says the COMMIT came
  no earlier than T; the proof's slot may predate the anchor (slot
  counter below the anchor's counter) even when its commit follows it.
  Slot positions are never used to derive bounds. A not-after bound
  automatically covers the slot as well (the slot precedes the commit).
- Evidence classes per bound: "chain-link" (a verified prevB64 path
  connects proof and anchor inside the partition; for not-before the
  anchor is an ancestor, for not-after a descendant walk from the anchor
  reaches the proof) versus "counter-order" (commit-counter comparison
  only, relies on the authority's counter discipline, marked
  weaker: true). An anchor is its own strongest not-before source (it
  consumed the hash directly), reported as chain-link.
- Bound selection per segment and direction: the tightest bound overall
  (max T for not-before, min T for not-after), plus the tightest
  chain-link bound as a second entry when the overall tightest rests only
  on counter ordering. At most two entries, tightest first.
- Segments group members of one partition sharing an identical selected
  bound set (anchor + evidence per direction), so an anchor and the
  proofs it brackets identically land in one segment. Statuses:
  bracketed, lower-bounded, upper-bounded, ordered-but-unanchored. A
  one-sided bound is never presented as an interval; no individual
  proof's creation time is ever stated.
- Epoch-level anchorBounds use conservative representatives: not-before =
  MINIMUM lower-bound timestamp over covered members (every covered
  member is not-before at least that), not-after = MAXIMUM upper-bound
  timestamp. Coverage ("members-after-anchor" / "members-before-anchor")
  plus covered/total counts ride on each EpochAnchorBound: anchors sit
  inside epochs, so a bound never covers a whole epoch, and the uncovered
  remainder is stated. EpochAnchorBound gained optional fields (coverage,
  coveredProofCount, totalProofCount, basis, claim); reconstruction
  still never populates the field, temporal analysis does.
- Anchors without a verified witness are listed
  (`unverifiedAnchorProofHashes`): causal order only, no wall-clock
  evidence, their segments report ordered-but-unanchored.

### Offline attestation port: fidelity notes (G9)

Ported from website/src/lib/nitro-verify.ts. Kept exactly:

- Check sequence and check names: CBOR Decode, COSE Structure, Payload
  Decode, Leaf Certificate, ECDSA P-384 Signature, Certificate Chain,
  AWS Nitro Root CA, PCR0 Match, Bound to this proof. Document checks
  short-circuit in the same order.
- CBOR reader subset (same major types, tag skipping, indefinite
  lengths, map keys stringified), Sig_structure construction per RFC
  9052 section 4.4, X.509 walk (TBS slice, skipped signatureAlgorithm,
  BIT STRING signature, SPKI extraction by position), DER ECDSA to raw
  r||s conversion, cabundle order [root, intermediates] with leaf last,
  top-of-bundle verified against the trust root, PCR extraction with
  all-zero PCRs treated as absent (a debug-mode enclave's zero PCR0
  therefore never matches), strict `===` PCR0 comparison, user_data
  binding = base64(user_data bytes) === canonical proof hash (confirmed
  against the enclave: user_data is the raw SHA-256 of the canonical
  signed body, app.ts "attestation-correct" flow, and against the
  website caller, proof/[digest]/page.tsx runVerify), lowS not enforced
  (webcrypto never enforces it; the website passed lowS: false).

Changed, all fail-closed or additive:

- ECDSA via node:crypto webcrypto (raw point import, SHA-384 named hash)
  instead of @noble/curves; no new dependency. WebCrypto hashes the
  message itself, so the manual sha384 prehash step disappears.
- Strict base64: the website's atob throws on stray characters, Node's
  Buffer.from silently filters them, so the port restores strictness via
  a round-trip check after the same base64url normalization the website
  applies. The REALISTIC_PROOF truncated blob fails here with a precise
  reason (it fails in the website too, via atob throwing).
- CBOR and DER reads are bounds-checked with precise errors; the website
  indexes past the end and fails with NaN artifacts. Same outcomes,
  better reasons.
- ADDED: certificate validity windows evaluated at the attestation
  document's OWN timestamp ("Certificate Validity Window" check). The
  4c brief assumed the website performs this check; verified against
  source it does NOT (no notBefore/notAfter logic anywhere in
  nitro-verify.ts; the May 17-19 session note describes intent that
  never landed in this file). The audit validator adds it because audits
  run long after the short-lived leaf certs expire and the document
  timestamp is the only offline-evaluable instant; the choice and the
  discrepancy are recorded here as instructed. Documents without a
  timestamp fail the window check with a precise reason.
- Trust root: default is the bundled AWS constant; an explicit
  `trustedRootCaDer` override exists for tests and user-supplied trust
  material (sanctioned by the brief's "locally bundled or user-supplied
  trust material"). The audit pipeline never sets it unless the caller
  passes it through. A test pins that a synthetic chain FAILS against
  the default root.

Fact separation (G9): per-proof records track declared measurement
present, document present, document cryptographically validated,
attested-PCR0-matches-declared, user_data-bound separately.
`pcr0MatchesDeclared` and `userDataBoundToProof` are set ONLY on a
validated document: values parsed from an unvalidated document prove
nothing and are never compared. Findings: `attestation-invalid`
(document present, validation failed, precise reason),
`attestation-measurement-mismatch`, `attestation-user-data-mismatch`.
`AuthorityGroup.attested` is populated only for groups with documents:
status "validated" (all member documents validated) or
"validation-failed", with validatedProofCount/failedProofCount,
attestedMeasurement only when the validated documents attest exactly one
value (attestedMeasurements lists them when mixed; the interface gained
these optional fields), matchesDeclared only when both sides exist.
"unsupported" remains in the type but is never emitted: every check was
genuinely implementable offline, so attestation-validation-unsupported
was not needed.

### Fixture and test decisions

- REALISTIC_PROOF moved verbatim (values byte-for-byte unchanged) from
  proof-hash-regression.test.ts to the shared non-test module
  src/__tests__/realistic-proof-fixture.ts, re-imported by the
  regression test. Importing a .test.js from another suite would
  re-register its describes under node:test; a pure move avoids that
  without editing any fixture value.
- audit-fixtures.ts gained: signBody extras (attribution in the signed
  body; attestationFormat in the signed body with reportB64 outside it,
  so tests can attach the real document after computing the canonical
  hash, exactly like the enclave), makeAnchorProof (digest over the
  block-hash STRING per bitcoin-anchor.ts, with deliberate wrong-digest
  and wrong-title variants that stay validly signed), a minimal RLP
  encoder, makeEthereumHeader (20 items, number at index 8, timestamp at
  index 11), witnessJson.
- Synthetic attestation fixtures build a real self-signed P-384 chain
  in-test with node:crypto webcrypto plus hand-rolled DER and CBOR
  (certificate generation with builtins proved practical, so nothing in
  the validator went untested; no attestation sub-check is exempt). A
  pinned assertion shows swapping reportB64 never changes the canonical
  proof hash.
- New suites wired into root test:core: audit-anchors.test.ts (7),
  audit-witness.test.ts (12), audit-temporal.test.ts (9),
  audit-attestation.test.ts (9). Baseline before this phase: 210 tests.
  After: 247, all passing (npm run build green, npm test green).

### New stable codes added to AnomalyCode

anchor-metadata-disagreement, anchor-metadata-only-claim,
anchor-title-unparseable, witness-malformed, witness-rlp-invalid,
witness-header-shape, witness-hash-mismatch, witness-digest-mismatch,
witness-block-number-mismatch, witness-claimed-hash-mismatch,
witness-anchor-invalid, witness-unmatched, attestation-invalid,
attestation-measurement-mismatch, attestation-user-data-mismatch.

## Phase 4d: Report generators and CLI

Date: 2026-07-09

### Module map

- `packages/audit/src/audit.ts`: `runAudit(bundlePath, options)` executes
  the full pipeline in canonical order (ingest, verify tiers, reconstruct,
  classify anomalies, analyze authorities, identify anchors, verify
  witnesses, derive temporal bounds, validate attestations) and returns
  an AuditResult. Also exports `computeExitFlags(result)` and
  `auditToolVersion()` (version read from the package's own package.json
  via import.meta.url; a file read, not a network or clock read).
- `packages/audit/src/report-json.ts`: `buildJsonReport(auditResult)`,
  schema `bitgraph-audit-report/1`.
- `packages/audit/src/report-md.ts`: `buildMarkdownReport(auditResult)`,
  rendered FROM the buildJsonReport object so markdown ordering is
  identical to the JSON by construction.
- `packages/audit/src/cli.ts`: `bitgraph-audit` binary (shebang + `bin`
  wiring in packages/audit/package.json). Plain process.argv parsing, no
  dependency, no network.
- New types in types.ts: AuditOptions, AuditRunMetadata, AuditResult,
  ExitFlags, AnomalyStage, ReportAnomaly, ReportProofRecord,
  ReportPartition, UnorderedEpochPair, ReportEpochRelationships,
  ReportInputSummary, ReportSummary, AuditJsonReport. All exported from
  index.ts alongside runAudit, computeExitFlags, auditToolVersion,
  buildJsonReport, buildMarkdownReport.

### Determinism contract

The ONLY wall-clock read in the pipeline is runMetadata.startedAt, taken
once at the top of runAudit. The JSON report carries it inside a
runMetadata block explicitly marked `nondeterministic: true` with a note
saying it is the only nondeterministic section; toolVersion also appears
at the report top level (deterministic per install). The markdown's only
nondeterministic content is the run line naming that start time.
Attestation certificate validity windows are evaluated at each document's
OWN timestamp (a 4c property), so no clock leaks in through validation.
Pinned by test: two runs over the same bundle produce deep-equal JSON
reports after stripping runMetadata, and byte-equal markdown after
substituting out each run's own startedAt string.

### JSON report design decisions

- Unified anomaly list: ingest findings, chain anomalies, authority
  anomalies, anchor findings, witness findings, and attestation findings
  are merged into one `anomalies` array, each entry tagged with a
  `stage` field ("ingest" | "chain" | "authority" | "anchor" | "witness"
  | "attestation") and carrying its stable code, optional path/partition/
  proofHashes, and details. Order is stage order then the producing
  stage's documented detection order, so it is deterministic without
  re-sorting mixed shapes.
- Array ordering: per-proof records sorted by canonical proof hash;
  unsupported-version records by path; partitions/components/members keep
  the reconstruction pass's deterministic order (partition key, then
  counter-then-hash within); epochs by epochId; unordered epoch pairs by
  (epochIdA, epochIdB). anomalyCountsByCode has sorted keys.
- `unorderedPairs` (epoch pairs with no ordering evidence from hard
  lineage OR anchor bounds, in either direction) is computed here rather
  than in reconstruction: it needs both the lineage orderedPairs and the
  temporal anchorOrderedPairs. Epoch counts are boot counts, so the
  O(n^2) pair list is small in practice; it is complete, not capped.
- Per-partition `intact` verdict: exactly one connected component AND no
  chain anomaly or divergence scoped to that partition. summary.chainIntact
  additionally requires zero chain anomalies, zero authority anomalies,
  and zero divergences bundle-wide (epoch-level anomalies carry no
  partition scope and would otherwise escape the per-partition test).
- The raw parsed proof objects retained on ObservedProof are never
  serialized; ReportProofRecord carries compact fields only. Pinned by
  test: the JSON never contains a "signatureB64" key.
- Anchor bounds ride on epochRelationships.epochs[].anchorBounds (the 4c
  extension point, populated by deriveTemporalBounds mutating the
  reconstruction's EpochRecords) with their basis and claim fields; the
  assumption-dependent cross-epoch pairs are in
  epochRelationships.anchorOrderedPairs (assumptionDependent: true).

### Markdown report decisions

- Rendered from the JSON report object plus nothing else, guaranteeing
  identical ordering and that every markdown fact exists in the JSON.
- Executive summary follows the brief's two style examples exactly. Gap
  sentences use the G2 language verbatim pattern: "N counter positions
  are neither commit positions nor referenced slot positions in the
  supplied bundle. This means the auditor cannot reconstruct those
  positions from the supplied evidence. It does not, by itself, prove
  that the BitGraph authority failed to create them." (singular variant
  for N=1). Divergence sentences always contain "The audit tool does not
  choose between them." Both phrases are pinned by test.
- Every stable code has a plain-language "what it means" consequence
  sentence in the anomalies table (codeMeaning map covering all 40 codes,
  with a generic fallback for future codes).
- Long tables cap at MAX_TABLE_ROWS = 200 with an explicit "and N more
  (complete list in the JSON report)" line, so a 50k-proof bundle cannot
  produce an unreadable markdown file; the JSON is always complete.
- Timestamps render as "unixSeconds (ISO UTC)" via a pure conversion,
  not a clock read. Prose numbers get thousands separators (matching the
  brief's "48,997" style) via a locale-independent regex.
- Language guardrails applied throughout: "cryptographically bound",
  "detectably invalid if altered", "causal order"; never "unforgeable",
  "impossible to fake", "proves authorship", "proves when". No em dashes
  anywhere; pinned programmatically on the raw markdown AND raw JSON
  strings.

### CLI decisions

- `bitgraph-audit <path-to-bundle> [--out <dir>] [--format json,md]
  [--trust-policy <path>]`. Defaults: both formats, out = current
  directory (created with mkdir -p if missing, a deliberate convenience).
- Exit codes as bit flags, exactly as documented in --help:
  0 clean; bit 1 = verification failures (verification.failed > 0 OR
  unsupportedVersion > 0); bit 2 = chain anomalies or divergences
  (classifyAnomalies anomalies, authority anomalies, or divergence
  records non-empty); 3 both; 64 usage or input error (unknown option,
  unreadable bundle, invalid trust policy; no report produced). 64 was
  chosen (sysexits EX_USAGE) because 1 and 2 are taken by the flag space.
- Deliberate exit-code interpretation, recorded: benign ingest findings
  (exact/semantic duplicates, duplicate-path, unsafe-path, manifest
  advisories, embedded proofhash-mismatch) NEVER set exit bits. They are
  reported in full; proofhash-mismatch in particular is a stored-label
  disagreement on a copy of an otherwise-identified proof, not a chain
  anomaly, and the computed identity always governs. Consumers who care
  can key on summary.anomalyCountsByCode.
- artifact-unavailable is not a failure: automatic, because bit 1 reads
  verification.failed and a policy that an integrity-tier proof cannot
  satisfy (e.g. requireSlot) flips that proof's status to "failed"
  through the canonical verifier itself. Attestation results never
  affect exit codes on their own: computeExitFlags never reads the
  attestation analysis. Both behaviors are pinned by CLI tests
  (requireSlot policy on a bytes-free bundle exits with bit 1 set).
- --trust-policy validates keys against the 14 canonical
  VerificationPolicy fields (G7); an unknown key errors with the full
  valid-field list and usage, exit 64. Values are passed through to the
  verifier untyped (the verifier's own checks govern semantics).
- stdout carries exactly two lines: the written file list and the exit
  meaning. All report content goes to files. Errors go to stderr.

### Tests

- `src/__tests__/audit-report.test.ts` (5 tests) and
  `src/__tests__/audit-cli.test.ts` (9 tests), wired into root test:core.
  Baseline before this phase: 247 tests. After: 261, all passing.
- Shared scenario builder `makeStandardAuditBundle()` added to
  src/__tests__/audit-fixtures.ts: healthy signed chain (4 proofs,
  slot/commit pairs 1..8, chainId bitgraph:main), proof index 1 dropped
  (gap positions 3,4 plus chain break), predecessor-reuse fork off the
  tail (slots 9/11, commits 10/12, same key/epoch/measurement), occ/1
  reject, artifact present for genesis only, Ethereum anchor in its own
  epoch with a valid RLP witness, one exact-duplicate and one
  semantic-duplicate (stored-form) copy of the genesis. Both suites use
  it, so the report and CLI expectations cannot drift apart.
- CLI tests spawn the built packages/audit/dist/cli.js with
  process.execPath from the compiled test's location; root npm test
  builds workspaces first, so the binary always exists.
- Test-observed ingest semantics honored rather than changed: a
  stored-form copy whose embedded proofHash MATCHES does not upgrade the
  record's embeddedProofHash from "absent" (first-observed copy governs;
  only a mismatch on any copy escalates, per Phase 4a). The report test
  initially assumed "match" and was corrected to assert non-mismatch
  plus zero proofhash-mismatch findings.
- Manual verification performed as required: built a standard bundle in
  a temp dir, ran the CLI once against it, confirmed both
  audit-report.json and audit-report.md were written, exit 3 with the
  correct completion lines, and reviewed the generated markdown by hand.
