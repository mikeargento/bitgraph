# Changelog

All notable changes to `@mikeargento/bitgraph-audit` are documented here.

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
