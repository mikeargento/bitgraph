# How to Audit a BitGraph Bundle

You have been handed an Audit Bundle: a `.tar.gz` (or `.tar`, or a plain directory) containing BitGraph proof JSON files, and optionally the original artifact files, Ethereum anchor witness files, and a `manifest.json`. This page is the recipient's walkthrough. The audit runs entirely on your machine, fully offline, and reports exactly what the supplied evidence supports, nothing more.

## 1. Get the bundle

Bundles come from an operator's export (for example the bitgraph.ing epoch export at `/api/export/epoch/{epochId}`) or from anyone who collected proofs. How you received it does not matter; the contents carry their own evidence.

## 2. Optionally check the archive hash

Two different hashes exist, and they pin different things:

* **The archive file's SHA-256** (`shasum -a 256 bundle.tar.gz`) identifies the exact archive you received. If the producer notarized the archive (committed its SHA-256 through a bitgrapher as its own proof), compare your computed hash against that notarization commit. This step is optional and only meaningful when such a commit exists.
* **The manifest's `contentsHashB64`** is a deterministic hash over the bundle's entries, defined in `docs/BUNDLE-FORMAT.md` section 8. You do not check this by hand: the audit tool recomputes it and reports `manifest-contents-hash-mismatch` if the declared value does not match.

## 3. Run the audit

Once the package is published to npm:

```bash
npx @mikeargento/bitgraph-audit ./bundle.tar.gz --out ./audit
```

Until it is published (or if you prefer building from source):

```bash
git clone https://github.com/mikeargento/bitgraph
cd bitgraph
npm install
npm run build
node packages/audit/dist/cli.js /path/to/bundle.tar.gz --out ./audit
```

Both write `audit-report.json` (machine-readable, complete) and `audit-report.md` (human-readable) into the output directory. No network access occurs in either mode.

## 4. Read the executive summary

Open `audit-report.md`. The executive summary at the top is written for a reader with no cryptography background: how many proofs were observed, how many fully verified, how many lacked their artifact bytes (their binding to a specific file was not independently checked), whether the observed chain is intact, what anomalies and divergences exist, and what externally verifiable time evidence the bundle carries. Every anomaly is explained by consequence, and absence of evidence is stated as exactly that: a counter position missing from the bundle means the supplied evidence cannot reconstruct it, not that the authority failed to create it. The engineer-level detail sections and the JSON report carry the full records.

## 5. Exit codes

The CLI exit code is a bit-flag summary of the report:

| Code | Meaning |
|---|---|
| 0 | Clean: no verification failures, no chain anomalies, no divergences |
| 1 | Verification failures (including proof-shaped files rejected as unsupported versions; only `bitgraph/1` is supported) |
| 2 | Chain anomalies or divergences between valid proofs |
| 3 | Both 1 and 2 |
| 64 | Usage or input error; no report produced |

A proof whose artifact bytes are absent from the bundle is not a failure by itself; it is reported as artifact-unavailable and its bytes-free checks decide.

## 6. If you do not trust this tool

You do not have to. The audit package and the verifier it delegates to (`@mikeargento/bitgraph-verify`) are MIT-licensed source you can read: `packages/audit/` and `packages/verify/` in this repository. The bundle format is specified in `docs/BUNDLE-FORMAT.md` precisely so a stranger can reimplement both the producer and the consumer from the document alone and check the same evidence independently.
