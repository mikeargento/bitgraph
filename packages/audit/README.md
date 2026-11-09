# @mikeargento/bitgraph-audit

Offline audit of BitGraph evidence: `npx @mikeargento/bitgraph-audit <bundle>`.

An Audit Bundle is a portable collection of BitGraph proofs, optionally with the original files and a manifest, packaged as a directory, a `.tar`, or a `.tar.gz`. A folder of files with their `.bitgraph.json` proofs beside them is such a bundle. The premise: the operator's database is not the evidence. BitGraph proofs are self-contained objects, and this package lets an independent reader take a bundle, verify whatever evidence it contains fully offline, and reconstruct the sequence without asking the operator which history to trust. The on-disk format is specified in [docs/BUNDLE-FORMAT.md](https://github.com/mikeargento/bitgraph/blob/main/docs/BUNDLE-FORMAT.md).

The tool reports exactly what the evidence supports, nothing more. Incomplete input produces an incomplete reconstruction: missing proofs surface as unexplained counter positions and broken predecessor links, which means the supplied evidence cannot reconstruct those positions, not that the enclave failed to create them. Divergence between valid objects is presented, never resolved; the reader adjudicates. Proofs without their file pass through the checks that need no bytes and are reported as artifact-unavailable, never as fully verified. A file is matched to a proof when its SHA-256 is the digest the proof binds. A file that is one of a tree is not: its proof binds the tree's root, so the audit reports that proof as artifact-unavailable. Check such a file against its own proof with `verifyAttested` from `@mikeargento/bitgraph-verify`, or `bitgraph verify` from the SDK, which walk the file's hash up to the root. There is no network access at runtime of any kind.

Exactly one proof schema is supported: `bitgraph/1`. Proof-shaped files with any other version are rejected at ingest with the stable code `unsupported-version`. All verification semantics come from `@mikeargento/bitgraph-verify` (MIT), the same verifier anyone can run against a single proof. The `bitgraph-audit` CLI runs the whole pipeline (ingest, verification, reconstruction of each epoch's sequence from counts and predecessor hashes, anomaly classification, offline attestation validation) and writes `audit-report.json` and `audit-report.md`; `runAudit()` is the one-call library entry point, and every stage is also exported individually. See [docs/HOW-TO-AUDIT.md](https://github.com/mikeargento/bitgraph/blob/main/docs/HOW-TO-AUDIT.md) for the recipient walkthrough.

Counts order proofs inside one epoch. Epochs are separate runs of the enclave, each with its own key and a count from zero, so counts never order proofs across epochs.

## Evidence in earlier formats

Bundles made from earlier proofs still audit. The tool finds each of these by what it is, not by its name: a `bitgraph-export/1` file (checked with `verifyExport` once for each file in the bundle it covers), a BitGraphed file (a file with its proof inside, unpacked and audited as the bundle it carries), block header witnesses for proofs that sign an Ethereum or Base block, and a download package from a bitgraph.ing proof page. An export with a FALSE claim fails the audit (exit 1); a claim an export does not carry never does.

## License

MIT. See LICENSE.
