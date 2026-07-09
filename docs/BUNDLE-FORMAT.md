# BitGraph Audit Bundle Format

Format identifier: `bitgraph-bundle/1`
Status: Normative
Applies to: `@mikeargento/bitgraph-audit` (consumer), the bitgraph.ing epoch exporter (producer), and any third-party implementation of either role.

This document defines the on-disk interchange format for collections of BitGraph proofs and their supporting evidence. It is written so that a stranger with no access to this repository can implement both a conforming producer and a conforming consumer. Where this document references source files, the references are informative pointers to the canonical implementation; the text here is self-contained.

## Contents

1. [Scope](#1-scope)
2. [Conventions and terminology](#2-conventions-and-terminology)
3. [Format version](#3-format-version)
4. [Containers](#4-containers)
5. [Bundle contents](#5-bundle-contents)
6. [Discovery and matching rules](#6-discovery-and-matching-rules)
7. [The manifest](#7-the-manifest)
8. [Deterministic contents hash](#8-deterministic-contents-hash)
9. [Advisory naming layout](#9-advisory-naming-layout)
10. [Anchor witness format](#10-anchor-witness-format)
11. [What a bundle does not claim](#11-what-a-bundle-does-not-claim)
12. [Conformance checklists](#12-conformance-checklists)

## 1. Scope

An Audit Bundle is a portable, fully offline-verifiable collection of:

* BitGraph proof JSON files (schema `bitgraph/1`), one proof per file;
* optionally, the original artifact files those proofs commit to;
* optionally, anchor witness files carrying externally sourced Ethereum block headers;
* optionally, a single unsigned manifest describing the collection.

A bundle makes no claims by itself. It is input material. A consumer (the audit tool) verifies whatever evidence the bundle contains and reports exactly what that evidence supports, nothing more. See section 11.

The bundle format version is independent of the proof schema version. A `bitgraph-bundle/1` bundle carries `bitgraph/1` proofs; the two identifiers version different things and evolve separately.

## 2. Conventions and terminology

* The key words MUST, MUST NOT, SHOULD, SHOULD NOT, and MAY are to be interpreted as in RFC 2119.
* "Producer" means any software that writes a bundle. "Consumer" means any software that reads one.
* "Base64" without qualification means standard base64 per RFC 4648 section 4, with padding (`=`), alphabet `A-Za-z0-9+/`. This matches every `*B64` field in the `bitgraph/1` schema.
* "Decimal counter string" means a base-10 ASCII string with no leading zeros (unless the value is `"0"`), no sign, compared as an arbitrary-precision integer (BigInt). This matches `commit.counter` semantics.
* "Member proof" (or "member") means a file the consumer has identified as a `bitgraph/1` proof per section 6.1.
* JSON files in a bundle MUST be encoded as UTF-8. Producers MUST NOT emit a byte order mark. Consumers MAY strip a single leading UTF-8 BOM before parsing, but the contents hash (section 8) is computed over raw bytes, so a BOM changes the hash; producers MUST NOT rely on BOM tolerance.
* No field defined in this document uses base64url. Path-safe transforms (section 9) apply to file names only, never to JSON field values.

## 3. Format version

The identifier for this format is the exact string:

```
bitgraph-bundle/1
```

It appears in exactly one place: the `version` field of the optional manifest (section 7). A bundle without a manifest is still a `bitgraph-bundle/1` bundle; the container and discovery rules below fully define it.

This identifier is distinct from:

* `bitgraph/1`, the proof schema version (top-level `version` field of each proof);
* `bitgraph/slot/1`, the slot allocation record version (`slotAllocation.version` inside proofs);
* `bitgraph-anchor-witness/1`, the anchor witness file version defined in section 10.

Any future incompatible change to the bundle format increments the suffix (`bitgraph-bundle/2`). Consumers encountering an unknown manifest `version` MUST NOT guess; they report the manifest as unrecognized and MAY still process the container under the rules of the highest version they implement, clearly reporting that the manifest was not interpreted.

### 3.1 Proof version rule (owner directive)

Verbatim from the build directive, and normative here:

> Only `bitgraph/1` proofs are bundle members; anything else is a foreign file that the auditor reports as `unsupported-version` if it is proof-shaped, or ignores if not.

There is no compatibility mode, no tolerant parsing, no version migration, and no legacy tier. The legacy `occ/1` schema is pre-release testing data and is permanently out of scope. This matches the canonical verifier, which rejects any version other than `bitgraph/1` by strict string equality (`packages/verify/src/verifier.ts`, `validateStructure`).

## 4. Containers

A bundle is presented to a consumer in exactly one of three container forms. Consumers MUST accept all three; producers MAY emit any of them.

1. **A plain directory.** Every regular file under the directory, at any depth, is a bundle entry. The directory itself is the bundle root.
2. **A tar archive** (`.tar`). POSIX ustar, PAX extensions, and GNU long-name extensions MUST be accepted. Only regular file entries carry content; directory entries, symbolic links, hard links, device nodes, and FIFOs are not bundle entries and MUST NOT be followed or dereferenced.
3. **A gzip-compressed tar archive** (`.tar.gz` or `.tgz`). A single gzip stream wrapping a tar archive as above. Multi-member gzip streams are out of scope; consumers MAY reject them.

Container type MAY be determined by filename suffix or by content sniffing (gzip magic bytes `1f 8b`; tar `ustar` magic at offset 257). The detection method is implementation-defined, but the accepted set of container forms is fixed by this section.

### 4.1 Bundle root and entry paths

Every entry has a path relative to the bundle root, using `/` as the separator, with no leading `/` and no leading `./` component.

* For a directory container, the bundle root is the directory itself.
* For a tar container, the bundle root is the archive root, with one normalization: if every entry in the archive sits under a single common top-level directory (the usual result of `tar -czf bundle.tgz mybundle/`), that directory is the bundle root and is stripped from all entry paths. This rule is deterministic: it applies if and only if all entries share the same first path component.

Path handling rules:

* Paths are case-sensitive byte strings. No Unicode normalization is applied for comparison, sorting, or hashing. Producers SHOULD restrict paths to ASCII letters, digits, `-`, `_`, `.`, and `/`.
* Paths MUST NOT contain a NUL byte (no real filesystem or tar permits one; the contents hash in section 8 depends on this).
* Consumers MUST skip and report any tar entry whose normalized path is absolute or escapes the bundle root via `..` components. Such entries are never members and never contribute to the contents hash.
* If a tar archive contains multiple entries with the same normalized path, the last entry wins (matching tar extraction semantics). Consumers SHOULD report the duplication. Exactly one entry per path participates in discovery and hashing.
* Producers SHOULD NOT emit paths that differ only in letter case; case-insensitive filesystems collapse them.

## 5. Bundle contents

A bundle may contain, in any directory layout (subject to the one reserved name below):

| Kind | Identified by | Required |
|---|---|---|
| Proof files | Schema shape (section 6.1) | At least one, or the bundle is empty input |
| Artifact files | Content addressing (section 6.3) | Optional |
| Anchor witness files | Schema shape (section 6.4 and 10) | Optional |
| Manifest | Reserved path `manifest.json` at the bundle root | Optional |
| Unrelated files | Everything else | Tolerated and ignored |

Rules:

* **One proof per file.** A proof file contains exactly one JSON object, the proof. Arrays of proofs, NDJSON, and concatenated JSON documents are not members; a file whose top level is not a single JSON object is not proof-shaped and is ignored.
* **Unrelated files are tolerated and ignored.** A `README`, an `.DS_Store`, an operator's notes, or any file that is neither a member proof, a matched artifact, a witness, nor the root manifest has no effect on audit results. It does participate in the contents hash (section 8), because that hash is a file-level fixity check with no interpretation.
* **Proof version rule.** Per section 3.1, only `bitgraph/1` proofs are bundle members. A proof-shaped file with any other version string is reported `unsupported-version` with its source path and the offending version string, and is excluded from verification, chain reconstruction, and anomaly analysis.
* **Stored-form proofs are expected.** Proofs exported from the live ledger carry a trailing `proofHash` field appended at storage time. That field is not part of the `bitgraph/1` wire schema and is never trusted; see section 6.2.
* **Unknown fields inside proofs are tolerated.** Live proofs on `bitgraph:main` carry a `chainId` field inside the signed `commit` body that the published TypeScript type does not declare. A strict unknown-fields validator would reject every live proof. Consumers MUST tolerate unknown fields at every level of a proof object.
* **Standalone slot records are not members.** Slot allocation records (`bitgraph/slot/1`) ride embedded inside proofs as `slotAllocation`. A standalone JSON file containing only a slot record is not proof-shaped (section 6.1) and is ignored.

## 6. Discovery and matching rules

### 6.1 Proof discovery is by schema shape, never by filename

A consumer MUST examine every entry that parses as UTF-8 JSON with a single top-level object, regardless of its filename or extension, except the reserved root `manifest.json` (section 7). Filenames, extensions, and directory placement are advisory presentation only (section 9) and MUST NOT gate discovery.

Definitions:

* A JSON object is **proof-shaped** when all of the following hold:
  * it has a top-level `version` field of type string;
  * it has top-level `artifact`, `commit`, and `signer` fields, each an object.
* A proof-shaped object is a **member candidate** when `version === "bitgraph/1"` by strict string equality.
* A proof-shaped object whose `version` is anything else (for example `occ/1`) is reported `unsupported-version` per section 3.1.
* An object that is not proof-shaped and is not an anchor witness (section 6.4) is unrelated and ignored.

Member candidates are then validated against the canonical structural rules of the `bitgraph/1` schema (the same checks as `validateStructure` in `packages/verify/src/verifier.ts`): `artifact.hashAlg === "sha256"`, non-empty `artifact.digestB64`, non-empty `commit.nonceB64`, non-empty `signer.publicKeyB64` and `signer.signatureB64`, `environment.enforcement` one of `stub | hw-key | measured-tee`, non-empty `environment.measurement`, plus type checks on optional fields. A member candidate that fails structural validation is still a member for reporting purposes: it is recorded as an observed object with a precise structural failure reason. It is not silently dropped.

### 6.2 Canonical identity and embedded `proofHash`

The identity of a proof is its canonical proof hash: base64 of SHA-256 over the canonicalized signed body (recursive key sort, compact JSON separators, UTF-8), exactly as computed by `computeProofHash()` in `@mikeargento/bitgraph-verify` (`packages/verify/src/proof-hash.ts`). The signed body is: `version`, `artifact`, `commit`, `publicKeyB64` (from `signer`), `enforcement` and `measurement` (from `environment`), plus `attribution` when present and `attestationFormat` when `environment.attestation` is present.

Consequences:

* The consumer always computes canonical identity itself.
* If a stored copy carries an embedded `proofHash` field, the consumer MUST compare it against the computed value and flag any mismatch with a stable code. An embedded `proofHash` is never trusted and never used as identity.
* Two files with different byte content but the same canonical hash are the same proof in different encodings (whitespace, key order, unsigned-field differences). Both source paths are recorded; the proof is one object.
* Byte-identical files are exact duplicates and create no ambiguity of any kind.

### 6.3 Artifact matching is content-addressed

Any entry that is not a member proof, not an anchor witness, and not the root manifest is a candidate artifact. Matching procedure:

1. Compute SHA-256 over the entry's raw bytes.
2. For each member proof, decode `artifact.digestB64` from base64 to bytes and compare the two 32-byte values for equality.

Base64 comparison rules, stated precisely:

* Comparison happens on **decoded bytes**, never on base64 strings. String comparison would be broken by padding differences and by base64url variants.
* `artifact.digestB64` MUST decode as strict standard base64: RFC 4648 section 4 alphabet, correct padding, and a round-trip property (re-encoding the decoded bytes reproduces the original string). This is the same strictness the canonical verifier applies (`fromBase64` in `packages/verify/src/verifier.ts`). A digest field that fails strict decoding is a structural failure of that proof, not a matching miss.
* The decoded digest MUST be exactly 32 bytes.

Matching semantics:

* One artifact file MAY satisfy any number of proofs; every proof whose decoded digest equals the file's SHA-256 is bound to it.
* Byte-identical copies of an artifact under different paths are harmless; they hash identically and create no ambiguity.
* Two different byte sequences cannot match the same digest absent a SHA-256 collision; this format assumes SHA-256 collision resistance, as does the proof schema itself.
* Filenames are advisory. An artifact named `sunset.jpg` that hashes to a proof's digest matches; an artifact named to look like a match but hashing differently does not. Nothing about matching reads names.
* A member proof with no matching artifact entry is recorded as artifact-unavailable. That is an evidence gap, not an error; see section 11.

### 6.4 Anchor witness discovery

An entry is an anchor witness candidate when it parses as UTF-8 JSON with a single top-level object and `version === "bitgraph-anchor-witness/1"` by strict string equality. Discovery is by this shape, never by filename. Full format and mandatory verification procedure: section 10.

## 7. The manifest

The manifest is a single optional JSON object stored at the reserved path `manifest.json` directly under the bundle root. This is the only load-bearing filename in the entire format. A file at that exact path is always interpreted as the manifest and never as a proof, artifact, or witness, regardless of its shape. `manifest.json` files at any other path are ordinary entries subject to the normal discovery rules.

The manifest is **unsigned and advisory in every field**. It exists so that a recipient can see what the producer intended to ship and so that transport corruption is detectable. Consumers MUST cross-check advisory fields against observed reality and report mismatches; consumers MUST NOT treat any manifest field as evidence about proofs, ordering, or time.

### 7.1 Fields

| Field | Type | Required | Meaning |
|---|---|---|---|
| `version` | string, exactly `"bitgraph-bundle/1"` | Yes | Bundle format version (section 3). |
| `epochIds` | string[] | No | Distinct `commit.epochId` values among member proofs, in raw base64 form as they appear in proofs (not the path-safe form of section 9). |
| `chainIds` | string[] | No | Distinct chain identifiers among member proofs. A proof that carries no `chainId` in its signed commit body belongs to the default chain and is represented here by the literal string `"global"`. |
| `proofCount` | integer >= 0 | No | Count of distinct member proofs by canonical proof hash (section 6.2), not a file count. |
| `counterRanges` | array of objects | No | Per-partition commit counter ranges. Each element: `{ "epochId": string, "chainId": string, "min": string, "max": string }` with `min`/`max` as decimal counter strings over the `commit.counter` values of member proofs in that (epochId, chainId) partition. Counters are epoch-local and chain-local; a single flat range across epochs would be meaningless, so none is defined. |
| `generatedAt` | string, ISO 8601 UTC (e.g. `"2026-07-09T18:30:00Z"`) | No | Producer wall-clock time at generation. Advisory and unsigned; confers no temporal evidence about any proof. |
| `contentsHashB64` | string, base64 of 32 bytes | No | Deterministic hash over bundle contents per section 8. |
| `artifactsIncluded` | boolean | No | Producer's statement of whether original artifact bytes are included. Consumers report the observed truth independently. |
| `openEpochs` | array of objects | No | Open-epoch snapshot declaration. Each element: `{ "epochId": string, "counterAtSnapshot": string }`. Presence of a non-empty array is the snapshot flag: the named epochs were still minting proofs when the bundle was generated, and `counterAtSnapshot` (decimal counter string) is the highest commit counter the producer included for that epoch. Absent or empty means the producer believed every included epoch was closed. |

Unknown manifest fields MUST be tolerated and ignored, mirroring the unknown-field tolerance required for proofs.

A manifest that fails to parse, or whose `version` is missing or unrecognized, does not invalidate the bundle. The consumer reports the manifest problem and proceeds as if no manifest were present.

## 8. Deterministic contents hash

`contentsHashB64` is a file-level fixity value over the bundle's contents. It involves no interpretation of any file: no JSON parsing, no membership decisions. It detects accidental corruption, truncation, and file addition, removal, or renaming in transit. Because the manifest is unsigned, this hash is tamper-evident only when the recipient obtains the manifest (or the hash value alone) through a channel they already trust; inside the bundle it is an integrity check, not an authenticity check.

### 8.1 Hashed set

The hashed set is every entry of the bundle (per section 4.1, after path normalization and duplicate-path resolution) **except** the root `manifest.json` itself, which cannot cover its own hash. Unrelated files are included: the hash covers what was shipped, with no interpretation.

### 8.2 Scheme

For each entry in the hashed set:

1. Let `pathBytes` be the UTF-8 encoding of the entry's bundle-root-relative path (section 4.1 form: `/` separators, no leading `/` or `./`).
2. Let `contentBytes` be the entry's raw content bytes, exactly as stored (no newline normalization, no BOM stripping, no decompression beyond the container's own gzip layer).
3. Compute the entry digest: `e = SHA-256(pathBytes || 0x00 || contentBytes)`, where `||` is byte concatenation and `0x00` is a single NUL byte. Paths cannot contain NUL (section 4.1), so the split is unambiguous, and because each `e` is a fixed 32 bytes, the final concatenation below is unambiguous even though content bytes may contain NULs.

Then:

4. Sort the entries by `pathBytes`, lexicographically as unsigned bytes (byte-wise comparison, no locale, no Unicode collation).
5. Concatenate the 32-byte entry digests in that order.
6. `contentsHashB64 = base64(SHA-256(concatenation))`, standard base64 with padding.

The scheme is versioned by the bundle format identifier; `bitgraph-bundle/1` defines exactly this scheme and no alternative.

### 8.3 Test vectors

Empty hashed set (a bundle containing only `manifest.json`): the concatenation is empty, so

```
contentsHashB64 = 47DEQpj8HBSa+/TImW+5JCeuQeRkm5NMpJWZG3hSuFU=
```

(the base64 SHA-256 of zero bytes).

Two entries:

* `artifacts/a.bin` containing the three bytes `0x00 0x01 0x02`
* `proofs/example.json` containing `{"hello":"world"}` followed by one LF (`0x0a`), 18 bytes in total

Entry digests (hex):

```
e(artifacts/a.bin)     = 158b1621f722c865620434c133fbc9bf90e2e032957814b4dfa701b9dfd77313
e(proofs/example.json) = 9b59dcb5ae70f860564b36dd96a7f5c7eb64b864c9fd38c303560ea9d873a882
```

Sorted order is `artifacts/a.bin`, then `proofs/example.json` (byte-wise path sort). Result:

```
contentsHashB64 = uO+wswRbTl4WWwAuXVrdRjEVDs2jKq72iJhI95XoH3s=
```

### 8.4 Mismatch semantics

A computed hash that differs from the manifest's `contentsHashB64` is reported as a manifest integrity mismatch. It is advisory: it does not fail any proof, because proofs are independently verifiable objects. It does tell the reader that the bundle they hold is not byte-for-byte the bundle the manifest describes.

## 9. Advisory naming layout

Nothing in this section is load-bearing. Discovery is by shape (section 6); a bundle with every file at the root under random names is fully conforming. Producers SHOULD use the following layout so that exported bundles look like the live S3 ledger and are navigable by humans.

The path-safe transform for base64 values used in file names (matching `packages/ledger/src/types.ts`): replace `+` with `-`, replace `/` with `_`, strip trailing `=`. This transform applies to file names only; JSON field values always carry standard base64. Counters in file names are zero-padded to 12 digits.

```
manifest.json                                            (reserved, root only)
proofs/{safeEpochId}/{counter12}-{safeProofHash}.json     one proof per file
anchors/{safeEpochId}/{counter12}-{safeAnchorHash}.json   anchor proofs, optionally mirrored here
artifacts/{safeDigest}[.ext]                              original artifact bytes, named by digest
witnesses/{blockNumber}.json                              anchor witness files
```

Notes:

* `proofs/{epoch}/{counter}-{proofHash}.json` matches the live ledger key convention exactly (`proofKey()` in `packages/ledger/src/types.ts`), so an epoch export looks like a slice of the ledger.
* Anchor proofs are ordinary `bitgraph/1` proofs on the same chain and normally live under `proofs/` like everything else. The `anchors/` prefix mirrors the ledger's anchor index (`anchorKey()`); the live anchor service also writes a variant without the hash suffix (`anchors/{epoch}/{counter12}.json`). Any of these is acceptable; none affects discovery.
* An artifact MAY keep its original filename or extension; the digest-based name is a convenience, not a rule.

## 10. Anchor witness format

### 10.1 Background

An anchor proof is an ordinary `bitgraph/1` proof minted by the anchor service (`packages/hosted/src/bitcoin-anchor.ts`; the filename is a legacy alias, the chain is Ethereum). Its structure, all within the signed body unless noted:

* `attribution.name` is exactly `"Ethereum Anchor"` (the identification rule; the unsigned `metadata.type === "ethereum-anchor"` is corroboration only);
* `attribution.message` is the Ethereum block hash string (`0x` + 64 hex characters);
* `attribution.title` is `https://etherscan.io/block/{blockNumber}` (the only signed appearance of the block number);
* `artifact.digestB64` is base64 of SHA-256 over the UTF-8 bytes of the block-hash **string** in `attribution.message`, not over the 32 raw hash bytes;
* `metadata.anchor` (unsigned, advisory) carries `network`, `blockNumber`, `blockHash`, `blockTime`, `blockTimeISO`. The block timestamp exists only here in the proof and MUST NOT be trusted.

An anchor proof by itself proves causal position: everything before it in the chain existed before a block with that hash was known. It does not by itself prove wall-clock time, because the block timestamp is not in the signed body. The anchor witness exists to add wall-clock evidence offline: it carries the raw Ethereum block header so a consumer can locally recompute the block hash and, only after that recomputation succeeds, read the timestamp out of the header itself.

### 10.2 Witness file schema

A witness is a JSON object:

| Field | Type | Required | Meaning |
|---|---|---|---|
| `version` | string, exactly `"bitgraph-anchor-witness/1"` | Yes | Discriminator; witnesses are discovered by this shape (section 6.4). |
| `headerRlpHex` | string | Yes | The complete RLP-encoded Ethereum block header, hex-encoded, `0x`-prefixed, even length. Case-insensitive on input. This is the load-bearing field; everything else is a claim about it. |
| `blockNumber` | integer >= 0 | Yes | Claimed block number. Advisory until confirmed against the header (step 4 below). |
| `blockHash` | string | Yes | Claimed block hash, `0x` + 64 hex characters. Advisory until confirmed by recomputation (step 2 below). |
| `network` | string | No | Claimed network, e.g. `"ethereum-mainnet"`. Advisory label; the witness verification below neither uses nor validates it. |

Unknown fields are tolerated and ignored. A witness that fails to parse or fails any required-field check is reported malformed and confers nothing.

Provenance is deliberately out of scope: the consumer does not care where the header bytes came from (the operator's own node, a block explorer's raw export, a peer), because verification is entirely local. **The consumer never fetches anything. There is no RPC fallback, no Etherscan lookup, no network access of any kind.**

### 10.3 Mandatory verification procedure

A witness confers evidence only for a specific anchor proof, and only after every step below passes. Consumers MUST perform all steps; a witness that has not completed them is unverified and confers nothing at all.

Preconditions: the candidate anchor proof is a member proof identified as an anchor by signed `attribution.name === "Ethereum Anchor"`, and its own cryptographic verification (signature over the canonical signed body, at minimum) has succeeded. A witness cannot rescue an invalid proof.

1. **Decode the header.** Hex-decode `headerRlpHex` (after the `0x` prefix; reject odd length or non-hex characters) to raw bytes. The bytes MUST be a single well-formed RLP list. The list's field count varies by fork (15 items pre-London, up to 21 as of recent forks); the count is not checked beyond RLP well-formedness, because the hash check in step 2 is the actual gate.
2. **Reconstruct the block hash locally.** Compute Keccak-256 over the exact decoded header bytes. This is Ethereum's Keccak-256 (original Keccak padding), not FIPS-202 SHA3-256. Render as `0x` followed by 64 lowercase hex characters. This value, `computedHash`, is the only block hash the consumer believes.
3. **Compare against the signed attribution.** Require `lowercase(anchor.attribution.message) === computedHash`. The comparison is on the full string including the `0x` prefix. If it fails, the witness does not correspond to this anchor; report and stop.
4. **Bind the signed message to the committed artifact.** Compute SHA-256 over the UTF-8 bytes of the exact `attribution.message` string as it appears in the proof (no case normalization here; the digest covers the signed string as signed). Decode the anchor's `artifact.digestB64` per the strict base64 rules of section 6.3 and require byte equality with the computed SHA-256. This confirms the block-hash string in the attribution is the same value the enclave committed and signed, closing the loop: header bytes -> recomputed block hash -> signed message -> signed artifact digest.
5. **Cross-check the claimed fields.** Decode the header's `number` field (the 9th RLP item, index 8, big-endian unsigned integer, empty byte string meaning 0) and require it to equal the witness's `blockNumber`. Additionally, if the anchor's signed `attribution.title` parses as an Etherscan block URL, require the number in the URL to match. Require `lowercase(witness.blockHash) === computedHash`. Any mismatch rejects the witness for this anchor; report which claim failed.
6. **Only now, read the timestamp.** Decode the header's `timestamp` field (the 12th RLP item, index 11, big-endian unsigned integer, Unix seconds). These indices are stable across forks; fork-dependent fields are appended after them. This timestamp is external wall-clock evidence for the anchor's position in the chain: proofs causally before the anchor existed no later than a block bearing this timestamp. It bounds; it does not date individual proofs.

Failure at any step means the witness confers nothing: no timestamp is reported as evidence, and the anchor proof's own standing (its causal position, its verification status) is unchanged in both directions. The witness is optional inbound evidence, nothing more. A bundle with zero witnesses is complete and conforming; its anchors still establish causal order, just without wall-clock bounds.

The strength of a verified witness's timestamp is exactly the strength of Ethereum's protocol constraints on header timestamps (strictly increasing per block, bounded by validator consensus). The consumer reports it as "block header timestamp from independently supplied and locally reconstructed header", never as a measured or certified time.

## 11. What a bundle does not claim

A bundle is evidence, not a verdict. Producers and consumers alike MUST NOT present it as more than the following:

* **An incomplete bundle yields an incomplete reconstruction.** If proofs are missing from the bundle, the consumer will report unexplained counter positions and broken predecessor links. That means the supplied evidence cannot reconstruct those positions. It does not, by itself, prove that the BitGraph authority failed to create them, nor that anyone withheld them.
* **The manifest is unsigned. Every manifest field, including `generatedAt`, is advisory.** A manifest can be wrong, stale, or fabricated without affecting the validity of a single proof. The contents hash detects transport corruption; it authenticates nothing unless the hash value itself arrived through a trusted channel.
* **Timestamps require verified external evidence.** Unsigned `metadata` timestamps inside proofs, manifest generation times, file modification times, and archive entry times carry no evidential weight. Wall-clock bounds come only from verified anchor witnesses (section 10), and even then they bound segments of the chain; no individual proof's exact creation time is ever established.
* **The bundle proves what it contains, not what the operator possesses.** A clean audit of a bundle demonstrates that the supplied proofs are internally consistent and cryptographically valid. It does not demonstrate that these are all the proofs that exist, that the operator's ledger holds nothing else, or that no conflicting proofs exist outside the bundle. Absence of evidence in a bundle is absence from the bundle.
* **Verification failures are properties of objects, not of the bundle.** A bundle containing an invalid proof is not an invalid bundle; the consumer reports the object's failure precisely and moves on.

## 12. Conformance checklists

### 12.1 Producer

A conforming producer:

* emits one of the three container forms (section 4) with UTF-8, BOM-free JSON;
* writes exactly one proof per file, `bitgraph/1` only;
* never emits path components that are absolute, contain `..`, or contain NUL;
* if it writes a manifest, writes it at the root as `manifest.json` with `version: "bitgraph-bundle/1"` and computes `contentsHashB64` per section 8 over the final bytes of every other entry;
* populates the advisory manifest fields it can compute (SHOULD), including `openEpochs` with `counterAtSnapshot` whenever any included epoch was still open at generation time;
* states artifact inclusion truthfully in `artifactsIncluded`;
* uses the section 9 layout (SHOULD).

### 12.2 Consumer

A conforming consumer:

* accepts all three container forms and applies the section 4.1 path rules, skipping and reporting unsafe entries;
* discovers proofs and witnesses by schema shape only, treats the root `manifest.json` as reserved, and ignores unrelated files;
* enforces the proof version rule of section 3.1 with strict equality, reporting `unsupported-version` for proof-shaped non-`bitgraph/1` files;
* tolerates unknown fields in proofs, the manifest, and witnesses;
* computes canonical proof identity itself via the canonical proof-hash algorithm and cross-checks any embedded `proofHash`;
* matches artifacts to proofs by decoded-byte digest comparison under the strict base64 rules of section 6.3;
* verifies anchor witnesses by the full procedure of section 10.3 before using any header timestamp, and treats unverified witnesses as conferring nothing;
* cross-checks manifest claims against observations and reports mismatches as advisory findings;
* performs no network access of any kind.
