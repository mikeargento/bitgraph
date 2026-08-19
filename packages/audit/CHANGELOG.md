# Changelog

All notable changes to `@mikeargento/bitgraph-audit` are documented here.

## 0.2.2 (2026-08-19)

### Fixed

- Reports written by 0.2.1 stamped themselves `toolVersion: "0.2.0"`: the
  source constant had not moved with the package version. It now does, and a
  test pins the two together.

### Changed

- Depends on `@mikeargento/bitgraph-verify` ^1.3.0, which checks a WebAuthn
  declaration's `origin` against its `rpIdHash` and accepts an `allowedOrigins`
  policy. No audit-side behaviour changed; the pin records what the stage
  already resolves to on a fresh install.

## 0.2.1 (2026-08-18)

### Fixed

- **The attestation stage compared the wrong hash, and every DECLARED
  recording read FALSE because of it.** `user_data` was checked against
  `proof.proofHash` — `computeProofHash`, the frozen ledger-identity subset
  that deliberately excludes `actor` and `policy` — while the enclave puts
  SHA-256 of the FULL canonical signed body there. The two are identical for
  every proof carrying neither field, which is every ordinary recording, so
  this passed every fixture and every real bundle until the first agency proof
  existed and was then reported as belonging to "some other proof": a valid
  proof turned into a contradiction. Found on ledger position #12,010, the
  first declaration made on the public chain.
- Now uses `computeSignedBodyHash` from `@mikeargento/bitgraph-verify` 1.2.0,
  the same reconstruction the signature check already used, so the two cannot
  drift apart again.

⚠️ Anyone auditing a declared recording with 0.2.0 sees FALSE. There is
nothing wrong with those proofs; upgrade the reader.

## 0.2.0 (2026-08-15)

The filesystem-free path. Nothing about verification, reconstruction, or
reporting changed; every existing result is byte-identical.

### Added

- `ingestEntries(entries, { label? })`: ingest a bundle from in-memory
  entries (`{ path, open }`, where `open` returns bytes, a promise of bytes,
  or an async chunk stream). Same discovery, hashing, classification, and
  content-addressed matching as `ingestBundle`, so a directory, an archive,
  and an entry set holding the same bytes at the same paths classify
  identically. Entries are ordered by path before scanning. This is what a
  browser hands over when a bundle is dropped on a page.
- `auditIngest(ingest, options)`: the pure tail of the pipeline over an
  already-ingested bundle (every stage after ingest, no filesystem).
  `runAudit(path)` is now exactly `ingestBundle` followed by this. Accepts
  `startedAt` so an embedder can produce a fully deterministic result.
- `ContainerKind` gains `"memory"`; `IngestResult.bundlePath` is then the
  caller's label (or `""`).
- `AUDIT_VERSION`: the package version as a source constant.
  `auditToolVersion()` returns it instead of reading `package.json` from
  disk at runtime, which broke bundled embedders (wrong version from a
  foreign `package.json`, or ENOENT). A test pins the constant to
  `package.json`.
- `BoundaryEntryPoint` is now re-exported from the package index (it was
  reachable only structurally before).

## 0.1.1 (2026-07-10)

Correctness fixes found by running against a real production epoch bundle.
0.1.0 mis-audited every real bundle (all proofs reported as verification
failures, and an intact chain reported as almost entirely broken); upgrade is
recommended. Requires `@mikeargento/bitgraph-verify` 1.1.1 or later.

### Fixed

- Chain reconstruction now links `commit.prevB64` (and epoch lineage links
  `epochLink.prevProofHashB64`) against `computeChainHash`, the whole-proof
  hash the enclave actually writes, instead of `computeProofHash` (the
  signed-body subset). 0.1.0 could not link any real chain and reported
  `chain-break-missing` on every non-genesis proof of an intact chain. This
  affects reconstruction, chain-break and predecessor-reuse anomalies, epoch
  lineage edges, and temporal bound derivation.
- Real proofs with clockless slot allocations now verify, via the
  `slotAllocation.time` fix in bitgraph-verify 1.1.1.

### Added

- `ObservedProof.chainHash`: the whole-proof chain hash, computed at ingest and
  used for all predecessor-pointer resolution. `proofHash` remains the identity
  hash used for dedup.
- A regression test built on real ledger proofs, so this class of
  synthetic-only blind spot cannot recur.
