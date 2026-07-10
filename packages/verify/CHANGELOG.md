# Changelog

All notable changes to `@mikeargento/bitgraph-verify` are documented here.

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
