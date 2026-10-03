# Changelog

All notable changes to `@mikeargento/bitgraph-audit` are documented here.

## 0.9.0 (2026-10-03, prepared, not yet published)

- Exports (`bitgraph-export/1`). Ingest finds an export by its `format` field wherever it sits (directory, `.tar`, `.tar.gz`, in memory); it is evidence, never an artifact. The tree/1 proof it carries is recorded as an observed proof from the export's path, so it joins verification tiers, partitions, chain links, counter gap and collision checks, authority and attestation analysis like any proof file (its artifact is the 84-byte root document, which travels inside the export, so at the proof level it counts as observed without artifact bytes). A file that declares another `bitgraph-export/` format (`export-unsupported-format`), lacks an export's structure (`export-malformed`), or opens an export but is past the export JSON cap (`export-too-large`) is reported and not checked.
- New stage `verifyExports` (run by `auditIngest` after attestations): each export is checked with `verifyExport` from bitgraph-verify once per file in the bundle it covers, matched by SHA-256 (a member export: its leaf's committed bytes or original; the owner's export: any leaf's), or once without a file when none is there (the claims about the file read NOT_CARRIED, never a failure). The result (`AuditResult.exports`, and `exports` in the JSON report) gives per export its verdict, the FALSE claim ids, the covered files (leaf, placement, matched as committed bytes / original / as is, the export's unsigned name), the claims every run states alike once (`claims`), each run's own claims with their positions (`exportRunClaims(check, run)` puts a run's whole list back), what the floor covers for each file, the verifier's reading, and the three time claims apart: floor, ceiling on Base (provisional until checked against Base), ceiling on Ethereum.
- Exit codes: an export with any FALSE claim sets bit 1, as a bad proof does. Its attestation claims count (an export is one self-contained object, like a carrier), so an export signed by a key with no AWS Nitro attestation fails. A rejected export-shaped file also sets bit 1. NOT_CARRIED and UNDETERMINED never set a bit.
- Owner exports at scale: when the owner's list holds, each file's member evidence is derived from the list exactly as `verifyExport` derives it and checked in member form, with the list's claim put back in place (the same run, tested equal to the as-given run), so m files cost m paths instead of m whole-list rebuilds (measured: 20,000 files in 45 s, about 2.2 ms per file). When the list fails, files are checked as given within `asGivenLeafBudget` rebuilt leaves (default 2,000,000); the rest are listed as unchecked.
- Ingest buffers an entry that opens an export object (`{"format": "bitgraph-export/...`) up to `IngestLimits.maxExportJsonBytes` (default 192 MiB, every container) instead of the 8 MiB JSON cap, so the owner's export of a large tree is found; ordinary JSON keeps the 8 MiB cap.
- Options: `AuditOptions.exports` (`extraSpecHashes`, `pcr0`, `lookups` for embedders that allow network, `asGivenLeafBudget`). An export's Base ceiling is held to `ceilings.writer` / `ceilings.chainId` (`--ceiling-writer`, `--ceiling-chain`), and a trust policy's `allowedMeasurements` is the PCR0 list for its `attestation.pins` claim. The CLI prints one line per export and its three time claims, and makes no lookup.
- Reports: a Markdown section in the executive summary and one in the details (claims, covered files, time claims, per-file claims and runs); `summary.exports` counts. For a bundle without exports both reports are unchanged; the in-memory `IngestResult.counts.exports` is 0.
- Requires `@mikeargento/bitgraph-verify` 1.16.0 (`verifyExport`, `parseExport`, the tree/1 functions). The report's `toolVersion` is `0.9.0`.

## 0.8.0 (2026-09-30)

- Settlement of a Base ceiling on Ethereum (`bitgraph-settlement/1`, L1 data inclusion). A ceiling sidecar that carries a `settlement` pointer is checked offline: the Ethereum block header re-hashes to its hash, the batcher's type-3 transaction is in that block (re-encoded, and placed in the transactions trie), the blob versioned hashes are the ones the signed transaction commits to, and the pointer's Base block and ceiling transaction agree with the sidecar. When the blob bytes are in the bundle (`<versioned hash>.bin` beside the ceiling file, under `blobs/`, or at the root) the KZG commitment is recomputed per blob, the frames are decoded into the channel (whole, or as a prefix when only some blobs are held), the batches are decompressed, the Base block is found by timestamp and parent hash, and the ceiling transaction's bytes are compared with the sidecar's. Reported as two lines under the ceiling: `settlement: pointer ok, Ethereum block N at <time>` and `settlement: blobs decoded (...), ceiling tx located in Base block N`; blobs not in the bundle read `blobs not in bundle` and never fail. A wrong pointer or blob fails the ceiling (exit bit 2). Pins for Base mainnet (batcher, inbox) are built in and overridable.
- Two dependencies for the KZG check, loaded only when a blob is present: `micro-eth-signer` 0.20.1 and `@paulmillr/trusted-setups` 0.3.0, pinned exactly, as the zero-network dependency test now admits. Everything else in the audit still makes no network call.
- Requires `@mikeargento/bitgraph-verify` 1.15.0, which carries the pointer layer (`verifySettlementPointer`).
- The report gains `CeilingSettlementCheck` on each ceiling entry; `toolVersion` is `0.8.0`.

## 0.4.1 (2026-09-03)

- Ingest reads the proof carried by a bitgraph-fuse/1 Frame (`{ type: "bitgraph-fuse/1", manifest, fusePayload?, proof }`): the nested proof is the member and the Frame file is never an artifact candidate. Before this, `bitgraph-play check <frame> <fused bytes>` reported "no BitGraph proofs were found"; found on the first production fused artifact.

## 0.4.0 (2026-09-03)

- The report's `toolVersion` (and `AUDIT_VERSION`) is `0.4.0`; every other field of an audit over a bundle without fused proofs is unchanged from 0.3.0, checked byte for byte on the shipped TRACE bundles.
- `streamArtifactsByHash(ingest, hexes)`: re-read specific artifacts by content hash, matched or not, for profiles whose evidence is a file other than the committed bytes (the original of a fused artifact). `streamMatchedArtifacts` is unchanged.

## 0.3.0 (2026-09-01)

### Changed, and it is a report-shape change

An inbound Ethereum anchor cannot supply a proof-carried upper bound: a proof
before an anchor precedes the anchor's COMMIT, and the block's timestamp bounds
that commit from below, not the proof from above. Reading it as a ceiling
assumes the anchor consumed a recently published block. The prose on every
bound already said this; the machine fields did not, and a consumer reading
`kind: "not-after"` with `weaker: false` under a status of `bracketed` was
being told something the evidence does not support.

- `SegmentBound` gains `boundClass: "evidence" | "assumption"`. Every
  not-before bound is `"evidence"`; every not-after bound is `"assumption"`,
  and its `claim` now begins `NOT a proof-carried upper bound.`
- `TemporalSegmentStatus` `"bracketed"` is renamed
  `"lower-bounded-with-following-anchor"`.
- `summary.temporal.segmentsBracketed` is renamed
  `segmentsWithFollowingAnchor`.
- `reportSchemaVersion` is now `bitgraph-audit-report/2`, because the report
  shape changed. Consumers pinned to `/1` should update the three names above.
- The markdown report's summary row and bound lines say the same thing.

Nothing about verification, ingestion, anchors, witnesses, attestation, or
anomaly detection changed. `weaker` keeps its existing meaning (counter-order
evidence rather than a hash-link path).

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
