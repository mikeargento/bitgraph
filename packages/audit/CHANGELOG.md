# Changelog

All notable changes to `@mikeargento/bitgraph-audit` are documented here.

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
