# Changelog

All notable changes to `@mikeargento/bitgraph-verify` are documented here.

## 1.27.0 (2026-10-31)

- **The block timeline.** Block reads of Base and Ethereum are BitGraphs: the host binds a small `bitgraph-block-read/1` file (CAIP-2 chain id, block number, hash, timestamp, epoch) on the same counter sequence as files, so every file has a block read before it and after it. `blockReadFileText`, `parseBlockReadFile`, `blockReadDigestB64`, `checkBlockRead` (the block's number and timestamp are taken from the chain's answer about its hash, never from the file; a hash off the canonical chain fails).
- **`bitgraph-timeline-bundle/1` and `verifyTimelineBundle`.** A file's proof with the run of proofs from a block read before it to one after it, the block files and the epoch's genesis record, checked offline (every attestation, the unbroken run) and, with lookups, against the chains. The floor is the highest confirmed block stamped at or before the file's Nitro time ("bound after block A was produced"); the ceiling the first confirmed block stamped after it, above the floor, read within the lag limits ("bound before block B's timestamp, by the Nitro hardware clock, checked against the chain"). Lag limits: Base -2 s to 5 s, Ethereum -2 s to 60 s. Status verified, unconfirmed or failed; a bundle without its epoch's genesis record is never verified.
- **`buildTimelineBundle`** cuts a file's bundle from the timeline's records; **`attestationTimeMs`** reads an attestation's time.
- `checkEpochGenesis` takes `position: "any"`: a timeline epoch's genesis record may follow reads made while the Base write was pending.

## 1.26.0 (2026-10-23)

- **`bitgraph-epoch-genesis/1`: an epoch opens with a write to Base.** A block read bound as an epoch's first BitGraph proves the epoch began after that block, but the host chooses the block, so an old one leaves the floor loose and nothing in the proofs says how old. Now the host puts the new epoch's id in a self-addressed Base transaction from the ceiling writer (calldata `BGE1` and the 32 bytes of the id), and once it is mined binds a record of it as the epoch's first BitGraph. The transaction cannot be made before the epoch's key, since the id is derived from it, and the first BitGraph cannot be made before the transaction's block. Epochs order by their genesis blocks on Base alone. `epochGenesisCalldata`, `epochIdOfCalldata`, `epochGenesisFileText`, `parseEpochGenesisFile`, `checkEpochGenesis`.

## 1.25.0 (2026-10-20)

- **The BitGraphed file for atomic proofs: `bitgraph-carrier/5`.** Proofs made in one atomic action (enclave v11 on) sign no floor of their own, so versions /2 to /4, which need one, could not be built for them. A /5 block holds exactly `{ carrier, proof, ceilingInTime }`: the proof as the ledger serves it for the bytes (a tree member's carries its `bitgraph-tree-member/1` block, with the tree's floor leaf, base-block.json) and its Base ceiling. `verifyCarrier` checks it offline: the bytes before the block are the bound bytes or the named member; the proof is BitGraph's (`verifyAttested`); the floor block is a leaf of the bound tree and before the attested bind time; the ceiling's batch holds the proof. `buildBitGraphedFileV5`, `assembleCarrierV5Payload`, `verifyCarrierV5`, `CARRIER_VERSION_5`.
- **`checkTreeFloor`**: a member's floor block, when base-block.json walks up to the root the proof binds.
- A test that used `bitgraph-carrier/5` as its example of an unknown version now uses `/9`.

## 1.24.0 (2026-10-20)

- **Tree members check by their own file.** bitgraph.ing's Make page now makes a drop of many files one tree, one BitGraph, with each file's SHA-256 as its leaf data, and serves each file a proof of its own: the tree's proof with a `bitgraph-tree-member/1` block (index, path, the root's text) in its unsigned metadata. `verifyAttested({ proof, bytes })` walks the file's hash up that path to the root the proof binds, then checks the proof against the root's text, and reports `treeMember: { index, files }`; a file that is not that member is refused ("the file is not in the tree this proof binds"). `checkTreeMember`, `treeMemberOf`, `treeRootFromPath`, `digestTreeRootText`, `parseDigestTreeRootText` and `treeRootTextBytes` are exported. Proofs without the block verify exactly as before.

## 1.23.0 (2026-10-19)

- Enclave v13 published: PCR0 `adaad0bef62292d35197ae8db19e40685229f1a1e6070a7c77a148c4ada88ee66a1ca50819eebc2017c6716a49f2692f` (tag `enclave-v13`, two host builds agree) joins `PUBLISHED_ENCLAVE_MEASUREMENTS`; `verifyAttested` requires the atomic form on its proofs too.

## 1.22.0 (2026-10-18)

- **`verifyAttested`: the full check of a plain proof.** `verify()` checks a proof's own consistency against the key the proof carries, so on its own it cannot tell BitGraph's enclave from anyone who made a key and signed a body (found in an audit, 2026-10-18). `verifyAttested({ proof, bytes?, pcr0? })` adds the AWS Nitro attestation in full (`verifyNitroAttestation`: the ES384 signature, the chain to the AWS Nitro root, every certificate valid at the document's own instant, `user_data` equal to the signed body's hash) and requires the PCR0 inside the hardware-signed document to be one BitGraph published (`PUBLISHED_PCR0S`) or one the caller names. Proofs from v11 and later images must be in the atomic form (the content's count right after the nonce's). Returns the attested image and the attested bind time.
- `verify()` is unchanged; its documentation now says what it does not check.

## 1.19.0 (2026-10-12)

- **Faster trees and containers, identical bytes.** A million-file tree/1 builds about 30% faster on one thread (leaves bucketed by their first two bytes before sorting; one reusable buffer per leaf and node hash; numeric subtree keys), and container/1 and container/2 build two to three times faster (each ustar header is built once per name and size and reused). Every root, path, order and archive byte is unchanged: checked against 1.18.0 for a million leaves and every container size class.
- `MerkleTree` takes an optional second argument, `known`: subtree roots computed elsewhere (another thread) for ranges of its own split. `@mikeargento/bitgraph` 1.13.0 uses it to build trees on every core.

## 1.18.0 (2026-10-11)

- **bitgraph-carrier/4: a tree member carries its own proof.** In a tree/1 BitGraph the signed digest names the tree's root document, so a member could not travel as a BitGraphed file. Version 4 puts the member's committed bytes before the block and carries, in the block, export/1's one-file tree part (`tree: { rootDocument, member: { index, count, leaf, path } }`) beside everything version 2 carries; its floor is the one the proof signs, as an Ethereum anchor (version 2's shape) or a Base header (version 3's, no ceiling in position). `verifyCarrier` walks the bytes to the signed digest (the leaf's artifact digest, the commitment inside a placed leaf, the path, the root document's hash and commitment, the spec pin) and states the two floors of SPEC 8.6 for that one member: a placed leaf's bytes were finished after the floor block; a leaf kept as is is recorded after it, the bytes themselves not dated. New: `CARRIER_VERSION_4`, `assembleCarrierV4Payload`, `memberArtifactDigest`, `CarrierTree`; `verifyCarrier` returns `member` and `floorCovers` and takes `extraSpecHashes`; `innerDigestMatches` compares a /4 block's bytes with its leaf. The format is in `spec/CARRIER-4.md` (SPEC.md and SPEC-v2.md are frozen and unchanged).
- Versions 1 to 3 parse and verify exactly as before. A reader of 1.17.0 or earlier given a version 4 file reports the block unreadable (UNDETERMINED: "a damaged or newer block, not a verdict on the file"), never a verdict.

## 1.17.0 (2026-10-06)

- **The Base floor** (enclave v10, SPEC v2 in `spec/SPEC-v2.md`). A proof's floor can now be a Base block, signed as `commit.slotFloor = {chain: "base", evmChainId: 8453, blockNumber, blockHash, blockTimestamp}`; earlier proofs keep their Ethereum floor (`commit.slotAnchor`) and verify exactly as before. `signedFloorOf(proof)` reads either, and refuses a proof that signs both (ambiguous) or a `slotFloor` that does not name Base mainnet.
- **bitgraph-fuse/3**: `commitment/3 = SHA-256("bitgraph-fuse/3" || 0x00 || slotRecordHash || nonce || floorBlockHash)` binds the Base floor; `FUSE3_*`, `computeSlotCommitment3`, `slotCommitment3Preimage`, `fuseNameOfVersion`. `commitmentForProof` and `producerCommitment` pick fuse/3 for a Base floor. A fuse/2 marker over a Base floor, or fuse/3 over an Ethereum one, is refused.
- **tree/1 under SPEC v2**: each spec pins its marker (v1: fuse/2, v2: fuse/3) and a tree whose marker disagrees with its pinned spec is INVALID_TREE_MARKER. `TREE_SPEC_V1_HASH`, `TREE_SPEC_V2_HASH`; `currentTreeSpecHash(2 | 3)` follows the floor.
- **Floor headers on their own chain**: `checkFloorHeader` (keccak, number, and for Base the signed time and Base mainnet's schedule, 1686789347 + 2n); a header given as one chain's block for a proof that signs the other fails. `floorTimeIsBound`: a floor stamped after the commit's attestation document has its time withheld (the hash still floors the record). The export's `floor` names `chain: "base"`; `confirmed.floor` asks the floor's own chain for the block at that height.
- **carrier/3**: a BitGraphed file for a Base-floored proof carries the floor header (`basis: "base-header"`) and no closing anchor (`ceiling: {status: "none", basis: "hash-chain"}`); /1 and /2 parse and verify as before.
- The ceiling sidecar's floor may name `chain: "base"`; `verifyCeiling` checks it against the signed floor.

## 1.16.0 (2026-10-04)

- **The specification is frozen.** `spec/SPEC.md` version 1, SHA-256 `QazdIR0JYtHQwQuIISo7bvH1gxUvTS2cY+tW6BjUIRs=` (`spec/FROZEN.json`), is the one hash every tree/1 proof signs in `attribution.message`; it is the first entry of `KNOWN_TREE_SPEC_HASHES` and never changes. A later specification is a new hash added beside it.
- **Streaming verification** (`stream.ts`): `verifyTreeMember({ source })` and `verifyExport({ source })` check a file of any size against its leaf in one pass with flat memory (`ByteSource`, `bytesSource`, `blobSource`, `streamDigest`, `streamLeafCheck`); the whole-bytes forms stay. No size limit remains in the format: a file above tar's 8 GiB entry size takes the trailer placement (`MAX_CONTAINER_ENTRY_BYTES`).
- **Two floors, named apart** (SPEC 8.6): the claims are `floor.record` (every member: the signed root document carries the commitment to block N) and `floor.content` (placed leaves only: the committed bytes carry it); `floorCovers` is `"content"` or `"record"`; an as-is member reads "recorded after Ethereum block N; the bytes themselves are not dated".

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
