# Changelog

All notable changes to `@mikeargento/bitgraph-verify` are documented here.

## 1.16.0 (2026-10-03, prepared, not yet published)

- **tree/1** (`tree.ts`): every BitGraph is a Merkle tree under one position; a single file is a tree of one. 65-byte leaves (`placement || artifact || origin`; codes 0x00 as is, 0x01 trailer/1, 0x02 container/1, 0x03 container/2), RFC 6962 tree, 84-byte root document (`"bitgraph-tree/1" 0x00 || u32be count || root || commitment/2`) whose SHA-256 is the signed digest, signed attribution `{name: "bitgraph-fuse/2", title: "tree/1", message: B64 SHA-256(SPEC.md)}`. `verifyTreeMember` (categories TREE_MEMBER_DIRECT / FROM_ORIGIN / AS_IS, TREE_PATH_VALID, TREE_ROOT_VALID, and every refusal), `verifyTreeLeaves` (the only check of order and uniqueness), builders and parsers, `KNOWN_TREE_SPEC_HASHES` and `currentTreeSpecHash`. No enclave change.
- **bitgraph-output-root/1** (`output-root.ts`): a Base ceiling settled on Ethereum through Base's output root and an EIP-2935 storage proof of the ceiling block's hash (or the output root's own block hash when B = P), with the Ethereum transaction carrying the claim. No blob data and no KZG. `verifyOutputRootSettlement`, `computeOutputRoot`, `historySlot`.
- **bitgraph-export/1** (`export.ts`): one JSON file that, with the file, checks a tree/1 BitGraph. `verifyExport` answers one claim per line (proof, attestation with the user_data binding, spec pin, tree root, member or owner's list, the file, floor header, Base ceiling, Ethereum ceiling, and the reader's own confirmed lookups), with the three time claims kept apart and the Base time provisional until confirmed. `parseExport`, `buildExport`.
- A part in a format this verifier does not know is never called false: a proof that pins an unknown spec hash, a ceiling other than `bitgraph-ceiling/1` and a settlement other than `bitgraph-output-root/1` are UNDETERMINED, with every claim that rests on them (SPEC sections 8.4 and 12.1). FALSE is kept for a part that names a known format and fails its checks. So a later spec, ceiling or settlement leaves this version saying "not judged", the way a /1 carrier reader treats a /2 block.
- **Which enclave is BitGraph's is decided by default.** `PUBLISHED_ENCLAVE_MEASUREMENTS` / `PUBLISHED_PCR0S` (SPEC section 16) are the default measurement policy of `verifyExport` and `verifyCarrier`: a PCR0 outside it is FALSE (a genuine attestation from someone else's enclave is not a BitGraph), and an empty list leaves `attestation.pins` and the verdict UNDETERMINED. Before, no list meant the claim was set aside and the verdict could read TRUE.
- **A refuted lookup decides.** `verifyExport`'s verdict is FALSE when any claim is FALSE, the reader's own lookups included; the reading never states a refuted or unchecked time as fact (an unchecked header is said to be taken as given). A BitGraphed file is TRUE only when its image passes the policy.
- **The Base time as a bound** (SPEC 10.4): `baseTimeIsBound` withholds a Base stamp earlier than the floor block or more than `BASE_STAMP_TOLERANCE_SECONDS` (2) before the attestation document, as after a Base halt; the inclusion stays TRUE and `baseTimeWithheld` says why.
- **Every carried part must hold.** `verifyCeiling` fails a sidecar whose carried floor header is not the signed floor (it was skipped), and its `status` field no longer decides anything when the transaction is present. Container placements locate only when the original inside hashes to the origin the manifest declares. `verifyOutputRootSettlement` checks the chain labels and the chain id signed in the claim transaction.
- **Malformed is FALSE, unknown is UNDETERMINED, advisory changes nothing.** A malformed part of export/1 is a FALSE claim and never an exception; an optional part is absent (null or missing) or well formed; the export's own root document is the one checked, never the proof's unsigned echo.
- The normative text is `spec/SPEC.md` in the repository; its SHA-256 is the pinned spec hash.

## 1.15.2 (2026-10-02)

- `verifyCarrier`'s reading now ends by saying plainly that the file's own SHA-256 is not the committed digest, naming both hashes: the proof names the bytes before the proof block, and the file being verified includes that block. An outside review asked for it because a BitGraphed file travels without its package's README, and a recipient who hashes the file they were handed and compares it with the proof would otherwise conclude the proof is wrong. Only the reading changed: no claim, verdict or check is different, and `verifyCarrierPayload` (which has no outer file) is unchanged.

## 1.15.1 (2026-10-01)

- `verifyCeiling`'s label no longer says "settled on Ethereum" from the sidecar's `status`. That field is what BitGraph's Base node reported when the file was written and the file cannot prove it (an outside review changed it to `finalized` and every offline check still passed, as it should: the checks are about inclusion). The label now states the inclusion, quotes the reported status as a report, and says whether a settlement pointer is attached. `ceilingLabel` takes a fourth argument, `hasSettlementPointer`. Nothing about `ok`, the checks, or the window changed.

## 1.15.0 (2026-09-30)

- `bitgraph-fuse/2`: the position commitment also binds the floor block,
  `SHA-256("bitgraph-fuse/2" || 0x00 || slotRecordHash || nonce || floorBlockHash)`,
  marked by the signed attribution name. `computeSlotCommitment2`, `commitmentForProof`
  (picks the formula by the signed marker and the proof's signed `commit.slotAnchor`),
  `producerCommitment`, `fuseVersionOfName`, `isFuseMarkerName`; `fuseAttribution` and
  `inlineAttribution` take a version. `verifyFuse` and `verifyFuseMember` recompute
  either. Enclave v9 returns the floor anchor with the allocation.
- `bitgraph-carrier/2`: the same block also carries the ceiling in time (the
  `bitgraph-ceiling/1` sidecar), a `bitgraph-settlement/1` pointer when known, the
  declared pins, and the attestation as an `aws-nitro-witness/1` (checkable with
  openssl alone). `verifyCarrier` now answers one result per claim with what it rests
  on, at two levels (offline; confirmed through injected block-hash lookups), and
  writes the reading from the results. `assembleCarrierV2Payload`,
  `completeCarrierInTime`, `completeCarrierSettlement`, `carrierBlockSize`,
  `CARRIER_BLOCK_ZIP_LIMIT` (60,000: a ZIP-family file breaks past 65,535). A /1
  reader reports a /2 block as an unknown version, never a verdict.
- `nitro.ts`: `verifyNitroAttestation` (ES384 over the Sig_structure, chain to the
  embedded AWS Nitro root 641A0321…, every certificate evaluated at the document's
  own instant, PCR0 and user_data comparisons), `decodeNitroAttestation`,
  `attestationWitness`, `witnessMatchesAttestation`.
- `settlement.ts`: `verifySettlementPointer` (Ethereum header, batcher transaction
  inclusion, type-3 decode with sender recovery, batcher and inbox pins, KZG versioned
  hashes), `checkSettlementOnline`, `decodeEip4844`, `versionedHashOf`.
- Golden fixture: BitGraph #4,546 as a carrier/2, with negatives.

## 1.5.0 (2026-09-05)

- BitGraph Sets: one slot serves any number of files. Placement `set/1` (Form C)
  whose artifact is a canonical manifest of the members' fused digests, origin
  digests and placements, carrying the one slot commitment; `buildSetManifest`,
  `parseSetManifest` (strict byte-for-byte re-canonicalization), `readSetMetadata`
  (the manifest rides as a parsed object at `proof.metadata["bitgraph-fuse/1"]`,
  unsigned, and counts only once it hashes to the signed artifact digest), and
  `verifyFuseMember`, which verifies one member against a set proof and reports
  `SET_MEMBER_DIRECT`, `SET_MEMBER_FROM_ORIGIN`, `SET_NOT_MEMBER` (bytes that carry
  the set's commitment but are not in the committed manifest: made after the slot,
  not part of the set), `INVALID_SET_MANIFEST`, or the existing failure categories.
  Floor and membership are checked in one step and cannot be asked apart. A set
  marker is `{ name: "bitgraph-fuse/1", title: "set/1" }` with no message.
  `verifyFuse` reports a set manifest as `FUSED_DIRECT` under `set/1` and a member's
  bytes as `NO_MATCH`; every existing category and behaviour is unchanged.

## 1.4.0 (2026-09-03)

- BitGraph Fuse, profile `bitgraph-fuse/1` (working name): construction and
  parsing (`computeSlotRecordHash`, `computeSlotCommitment`, the placement
  registry `trailer/1`, `container/1`, `produced/1`, Form C payload,
  Frame helpers) and `verifyFuse`, which verifies a proof against either the
  fused bytes or the original and reports a category, never a collapsed
  verdict. A fused proof is marked by its signed attribution: `name` is the
  profile id `bitgraph-fuse/1` (exported as `FUSE_ATTRIBUTION_NAME`), `title`
  the placement id, `message` the origin digest in standard base64.
  bitgraph/1 verification is unchanged; `verify` and
  `verifyProofIntegrity` behave exactly as in 1.3.0.

## 1.3.0 (2026-08-19)

WebAuthn RP binding. Until now the verifier checked a declared proof's
challenge, user-presence and user-verification flags and P-256 signature, but
took the client data's word for which site asked: `clientDataJSON.origin` was
parsed and never compared with the authenticator's `rpIdHash`. A passkey is
scoped to an RP ID by the authenticator, and that RP ID covers every subdomain,
so a verifier that does not compare the two cannot tell an assertion made on
bitgraph.ing from one made on a page that merely shares its RP ID. This is the
RP-binding step of the WebAuthn verification procedure.

### Added

- Structural check, always on, for `format: "webauthn"` authorizations: the
  client data's `origin` must be a well-formed origin whose host, or a parent
  domain of it with at least two labels, hashes (SHA-256) to the first 32 bytes
  of `authenticatorData` (the `rpIdHash`). Runs before the signature check, so
  a changed origin is reported as the origin problem it is. Any origin passes
  as long as the authenticator agrees with it: the verifier stays
  origin-agnostic (self-hosted boundaries, development origins), and no
  existing proof changes verdict.
- `VerificationPolicy.allowedOrigins`: accept only the listed WebAuthn origins
  (exact match), e.g. `["https://bitgraph.ing"]`. A policy, because a
  specific origin is a reader's choice, like `allowedActorKeyIds`. A
  direct-format authorization carries no origin and does not satisfy it.

## 1.1.1 (2026-07-10)

Correctness fixes found by running against real production proofs. Earlier
versions could not verify a real proof carrying a slot (all of them); upgrade
is recommended.

### Fixed

- `verify()` / `verifyProofIntegrity()`: `slotAllocation.time` is now optional.
  The enclave builds slot allocations without a clock, so real proofs omit it;
  1.1.0 required it and rejected every real proof with a slot. The canonical
  slot body now includes `time` only when present, matching what the enclave
  signs.

### Added

- `computeChainHash(proof)`: SHA-256 over the canonicalized whole proof (minus
  the ledger-added `proofHash`). This is the value a successor's
  `commit.prevB64` and `epochLink.prevProofHashB64` reference. It differs from
  `computeProofHash` (the signed-body subset). Corrected the `computeProofHash`
  documentation, which had wrongly stated it was used for chain linking.

## 1.1.0 (2026-07-10)

### Added

- `verifyProofIntegrity()`: a bytes-free proof integrity check. It runs
  every check that `verify()` runs, in the same order, except the artifact
  digest comparison against caller-supplied bytes: structural validation
  (strict `version === "bitgraph/1"`), artifact digest base64
  well-formedness, canonical SignedBody reconstruction, Ed25519 signature
  verification, agency envelope verification when present, slot allocation
  verification when present, epoch link verification when present, and
  policy checks when a `VerificationPolicy` is supplied.
- `ProofIntegrityResult`: the result type for `verifyProofIntegrity()`.
  Every result carries the literal field `artifactBinding: "not-checked"`
  so that a passing integrity check cannot be mistaken for full
  verification. A valid result means the proof object is internally
  consistent and correctly signed. It does not mean any particular file
  matches the committed digest. Use `verify()` with the original bytes to
  establish artifact binding.

### Changed

- Internal only: `verify()` and `verifyProofIntegrity()` now share a
  single implementation of every check. `verify()` behavior is unchanged:
  same checks, same order, same result shapes, same failure strings.

## 1.0.0

Initial extraction of the verification side of BitGraph into a standalone
MIT-licensed package, so that anyone can verify a proof without asking
permission.

### Added

- `verify()`: offline, deterministic verification of a BitGraph proof
  against the original artifact bytes, with optional `VerificationPolicy`
  constraints.
- `computeProofHash()`: canonical proof hash over the signed body.
- `canonicalize()`, `canonicalizeToString()`, `constantTimeEqual()`:
  canonical serialization and comparison utilities.
- `resetEpochLinkState()`: resets the in-memory single-successor tracking
  used by epoch link verification.
- Proof schema types: `BitGraphProof`, `SignedBody`, `SlotAllocation`,
  `VerificationPolicy`, and related supporting types.
