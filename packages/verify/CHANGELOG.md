# Changelog

All notable changes to `@mikeargento/bitgraph-verify` are documented here.

## 1.4.0 (unreleased)

- BitGraph Fuse, profile `bitgraph-fuse/1` (working name): construction and
  parsing (`computeSlotRecordHash`, `computeSlotCommitment`, the placement
  registry `trailer/1`, `container/1`, `produced/1`, Form C payload,
  Frame helpers) and `verifyFuse`, which verifies a proof against either the
  fused bytes or the original and reports a category, never a collapsed
  verdict. bitgraph/1 verification is unchanged; `verify` and
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
