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

## Notes and minor drift observed (no ground-truth corrections needed)

- `initEnclave()` cited at server.ts:159-175 now sits at server.ts:164-176. Behavior unchanged.
- The repo-root CLAUDE.md structure diagram still lists `src/types.ts` and `src/proof-hash.ts`; both actually live in `packages/verify/src/`. G3's statement is the correct one. Not modified in this run.
- Stale DynamoDB comments confirmed present for Phase 6: `packages/verify/src/types.ts:448` and `packages/adapter-nitro/src/kms-counter.ts:8`.
