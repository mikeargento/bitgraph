# BitGraph

[![npm @mikeargento/bitgraph-sdk](https://img.shields.io/npm/v/@mikeargento/bitgraph-sdk?label=%40mikeargento%2Fbitgraph-sdk&color=cb3837)](https://www.npmjs.com/package/@mikeargento/bitgraph-sdk)
[![npm @mikeargento/bitgraph-verify](https://img.shields.io/npm/v/@mikeargento/bitgraph-verify?label=%40mikeargento%2Fbitgraph-verify&color=cb3837)](https://www.npmjs.com/package/@mikeargento/bitgraph-verify)
[![Website](https://img.shields.io/badge/bitgraph.ing-live-0065A4)](https://bitgraph.ing)
[![Docs](https://img.shields.io/badge/docs-0065A4)](https://bitgraph.ing/docs)

---

BitGraphs are not labels or metadata added after the fact. They are new computations created when your file's hash *fills* a pre-existing, cryptographically reserved position, constraining the commitment so it cannot be made after the fact. The commit happens off-chain, inside the enclave, and produces a proof permanently bound to that exact digital state. Seconds later, a Merkle root over new records' proof hashes is written to Base, so each record also gets a ceiling in time.

Provenance can be enforced or it can be claimed. Most systems claim it: they bind a statement about the content to the content itself. That binding can be cryptographically strong, and it can be made at the moment of capture rather than afterward, so the weakness is not timing. The weakness is that a claim is something a trusted signer can attach to any artifact at all. The artifact does not have to satisfy any prior condition to receive one.

BitGraph enforces it instead. A measured trusted execution environment reserves an unpredictable position before the artifact's hash reaches it. The producer writes that position's commitment into the bytes it then hashes, so those bytes could not have been finished earlier, and that hash is bound to the position. The position is consumed and cannot be reused. What emerges is not a description of provenance but a proof of placement.

> This exact digital state was committed through this measured process, in this order, under these constraints.

The first thing built on it is AI audit. A BitGraph is a verifiable receipt for an AI audit record: a trust record, a log, an evaluation result, an agent's account of its own run. It replaces nothing you already run. It adds the one thing your records cannot give themselves: a provable place outside your system. The protocol is the same for any bytes.

## Quickstart

Make one in your browser at [bitgraph.ing/docs/try](https://bitgraph.ing/docs/try): the drop box. The file never leaves your machine; only its fingerprint does. From an agent, connect the [MCP server](https://bitgraph.ing/docs/mcp) at `bitgraph.ing/mcp` with one URL. From code, `npx -p @mikeargento/bitgraph-sdk bitgraph record <paths...>`. To put a commitment inside a record your own system writes, follow the [integration guide](https://bitgraph.ing/docs/integration).

Making a BitGraph of one or more files yields ONE position: a Merkle tree of the files (tree/1), one file a tree of one. What you keep is the **export** (bitgraph-export/1) beside the files, with `SPEC.md`, the exact text the proof pins. The owner's export lists every leaf and name; a member export holds one file's leaf and path. An export holds no copy of any file and no anchors. `bitgraph export complete` adds the floor header, the Base ceiling and the Ethereum settlement later. If the export is lost, the file alone finds its proof again through its recovery entry (SPEC section 13).

Verify a file with its export in code, with the MIT verifier:

```bash
npm install @mikeargento/bitgraph-verify
```

```ts
import { verifyExport } from "@mikeargento/bitgraph-verify";

const result = await verifyExport(exportJson, { bytes });
console.log(result.verdict);          // TRUE, FALSE or UNDETERMINED
for (const c of result.claims) console.log(c.name, c.result, c.restsOn);
```

`verifyExport()` answers one claim per line: the proof and its attestation, the spec pin, the tree root, this file's leaf, the floor, the Base ceiling and the Ethereum settlement, each saying what it rests on. `verify()` in the same package checks a bare bitgraph/1 proof against bytes, and `verifyCarrier()` judges a BitGraphed file (carrier/2), the single-file form that carries its own proof inside it.

See [bitgraph.ing/docs](https://bitgraph.ing/docs) for the full proof format, verification checklist, attestation handling, and self-host instructions.

## What is in this repository

| Path | What it is |
|---|---|
| [`spec/SPEC.md`](spec/SPEC.md) | The specification, version 1, frozen 2026-10-04. Its SHA-256 (`QazdIR0JYtHQwQuIISo7bvH1gxUvTS2cY+tW6BjUIRs=`, [`spec/FROZEN.json`](spec/FROZEN.json)) is signed into every tree/1 proof. It never changes; a later version is added beside it. |
| [`packages/verify`](packages/verify) | `@mikeargento/bitgraph-verify`, MIT. The canonical verifier: the `bitgraph/1` schema, canonical serialization, proof and chain hashes, tree/1, exports, BitGraphed files, ceilings and settlement. Every other component checks proofs through this one. |
| [`packages/audit`](packages/audit) | `@mikeargento/bitgraph-audit`, MIT. Offline audit of a whole bundle: ingest, tiered verification, exports, causal reconstruction, anomaly codes, CLI. |
| [`packages/sdk`](packages/sdk) | `@mikeargento/bitgraph-sdk`. How software makes a BitGraph: the `BitGraph` class, the `bitgraph` CLI, and `bitgraph serve` on 127.0.0.1. New integrations start here. |
| [`src`](src) | `@mikeargento/bitgraph`. The older package the SDK is built on: the tree/1 pipeline, the placements, export building and recovery writes. Still published. |
| [`packages/mcp`](packages/mcp) | `@mikeargento/bitgraph-mcp`. The MCP server an agent connects to; the same engine as the SDK. |
| [`packages/player`](packages/player) | `@mikeargento/bitgraph-player`. Deterministic evaluation of causal rules over verified evidence. |
| [`server/commit-service`](server/commit-service) | The enclave that allocates and commits, its parent host, and the reproducible build whose published measurement is in [`PINS.md`](server/commit-service/reproducible-build/PINS.md). |
| [`website`](website) | [bitgraph.ing](https://bitgraph.ing), including the drop box, the recovery service and the hosted MCP endpoint. |

Trust assumptions, and what each one buys, are in [The trust model](#the-trust-model) below and at [bitgraph.ing/docs/trust-model](https://bitgraph.ing/docs/trust-model).

---

## The primitive

Nonce first. Its commitment into the bytes. Hash second. Atomic binding third.

The TEE generates hardware entropy inside the enclave. That entropy becomes a reserved position, signed with the enclave's key, with an identity that could not feasibly have been predicted. The position exists as a cryptographic object before it has seen any artifact hash.

The producer derives the position commitment from it and combines that with the file to produce new bytes: the original with the commitment at a registered placement, or a field of a format it writes itself, such as an audit record. The commitment is a function of a record that did not exist until the position was allocated, so nothing made before the position can contain it. Every BitGraph made on bitgraph.ing, in the SDK and in the MCP server is made this way.

The hash of those new bytes arrives. The TEE binds it to the position, signs the binding, and advances its internal order. The position becomes consumed.

> UNUSED position exists first. Its commitment goes into new bytes. Their hash enters later. TEE binds the hash to the position. Position becomes CONSUMED. Proof travels with the artifact.

The atomicity is the whole guarantee, and it constrains the record rather than the artifact. The artifact itself can be produced anywhere, by any process, using any tools. What matters is that when the hash arrives, the position is already there waiting.

Most systems begin with the bits. BitGraph begins with the place. They say: "Here is a file hash. Now let's sign it." BitGraph says: "Here is a pre-existing position. Now this file hash has occupied it."

## Why nonce-first matters

If a nonce, timestamp, or credential is added after the hash is already witnessed, it is just a label. It can prove someone signed something. It can prove a record existed by some moment. It cannot impose a prior condition merely by being attached afterward. The credential may describe where the artifact came from, but the artifact never had to consume a pre-existing, single-use position in order to receive one.

That leaves a forgery window. A malicious actor can prepare old hashes, replay prior material, backfill records, or attach fresh randomness to something never produced through the claimed path. The label looks valid. Nothing had to be true before it was attached.

BitGraph narrows that window by requiring the position to exist first, and by putting its commitment inside the bytes that fill it: the position was open before the new bytes were final, so they could not have been finished before it. It does not stop an old file being committed today: the original inside those bytes can be any age, and the position claims nothing about when it was made. What it stops is a position being invented after the fact, or occupied twice. The position is not evidence added afterward. It is the condition the artifact must satisfy.

## What a BitGraph proof contains

A BitGraph proof is a portable proof object, a JSON document, that travels with the artifact. It can include:

| Component | Purpose |
|---|---|
| Artifact hash | Identifies the exact file or digital state |
| Nonce | Hardware entropy giving the position an identity that cannot feasibly be predicted |
| Reserved position | Shows the position was allocated before the commit |
| Commit counter | Shows the artifact consumed the position later |
| Epoch ID | Groups an ordered run of commitments |
| Previous hash link | Connects proofs into a chain |
| Signer public key | Identifies the proof-signing authority |
| Signature | Verifies the proof was issued by the enclave-controlled key |
| TEE measurement | Shows what code and environment produced the proof |
| Attestation | Shows the proof came from measured hardware |
| Public anchor | Tethers BitGraph logical time to a public reference |
| Tree marker | Signed: the format (tree/1) and the SHA-256 of SPEC.md, the exact text the proof pins. The artifact hash is then the tree's 84-byte root document; each file's leaf and path live in the export |

Taken together: this hash was committed into this reserved position, by this measured environment, at this point in logical order, under this signing identity.

## Logical time

Every proof has order. Every reservation and commit has a position. The system can prove that this happened after that, that this position existed before this hash was bound, that this proof came before the next, that this epoch has an internal cryptographic history.

BitGraph proves causal order. It does not assert a clock time.

## Establishing wall clock time

BitGraph's internal ordering does not require Ethereum. The chain creates internal order through position allocation, consumption, counters, signatures, and chained proof history. What that order lacks, on its own, is a clock. The enclave keeps no trusted one; any clock reading inside a proof is advisory.

Ethereum is where the order meets the wall clock. An anchor is an ordinary proof on the same chain whose artifact is the hash of a recent Ethereum block. A block hash does not exist before its block is produced, so the anchor, and every proof chained after it, came after that block and its public date. Anchors recur throughout every epoch, and they write nothing to Ethereum. A tree/1 proof signs its own floor: the Ethereum block fixed when the position opened. This is the floor in time, and it runs in one direction: no earlier than.

The other side is stated in two units, never merged. The ceiling in position is the next anchor: the record was committed before that anchor was made, a bound in the sequence and never a clock time. The ceiling in time is the Base block carrying a Merkle root over the record: the record existed by that block. Settlement is Ethereum's record of that Base block through Base's output root (bitgraph-output-root/1), so the Base time rests on Ethereum too.

The anchors also fix history backward, through content. Each anchor is hash-linked to everything before it, so once an anchor exists, the history behind it is fixed: alter any earlier proof and the chain no longer reaches the anchor. When the epoch ends, its signing key is destroyed, and the set closes.

Ethereum is not asked to be a good source of randomness, and it is not asked to establish the artifact's position. BitGraph establishes the position. Ethereum ties the positions to the public timeline, so anyone, years later, can check the order and the earliest date each position could have existed.

## Compromise and containment

BitGraph assumes the boundary can be compromised and bounds the damage instead of claiming it cannot happen.

The signing key exists only in enclave memory. Every restart destroys it and begins a new epoch with a fresh key and a fresh counter. Proofs from prior epochs were signed by keys that no longer exist, so a compromise cannot reach backward.

Forgery requires more than key theft. Every proof carries a hardware attestation whose user_data must equal the hash of that exact proof body, and only the enclave's secure module can produce one. A useful breach must execute inside the running enclave, and it dies at the next restart.

Damage control is precise. Every proof names its epoch permanently, so a suspect window is identified exactly: rotate the epoch, publish the affected epochId as quarantined, and every other epoch is untouched. Verifiers that pin measurements and track epochs account for the gap.

The production deployment makes rotation routine rather than exceptional: the boundary restarts every day at 23:59 UTC, destroying the epoch key and starting a fresh one, so a normally operating epoch runs about a day. An unexpected restart ends one early and a failed rotation extends one; either way the boundary is recorded in the proofs themselves. A breach that depends on staying resident inside the enclave cannot outlive its epoch without freshly re-compromising a new one. The schedule is deliberately public: rotation times are visible in BitGraph's public copy regardless, and the protection comes from the key dying, not from anyone guessing when.

## The trust model

BitGraph does not ask for blind trust in any single component. It has real dependencies, and the point is that each one is inspectable rather than assumed: the enclave's attestation chains to the AWS Nitro Attestation PKI root, and the measurement it carries is published, so both are things you check rather than things you take on faith. Each layer adds an independently verifiable property.

| Layer | What it contributes |
|---|---|
| TEE | Measured execution and protected key use |
| Nonce-first position | Causal precondition |
| Atomic binding | Prevents post-hoc attachment |
| Counters | Internal logical order |
| Proof chain | Historical continuity |
| Ethereum anchor | Public wall-clock bound |
| Epoch rotation | Damage containment |
| Portable verification | Independence from the original server |

## What BitGraph applies to

BitGraph works on any digital state that can be hashed. The same primitive applies whether the artifact is a photograph, a contract, a model output, a dataset, or a software release.

**AI audit records.** A trust record, a log, an evaluation result, an agent's account of its own run. The record carries its position's commitment before it is signed, so a reviewer checks the record and its BitGraph together, offline, without trusting the system that wrote the record or the auditor that keeps it. The record never leaves the machine that made it; only its fingerprint does, and the model does not have to run inside an enclave.

**Media.** Photos, videos, audio, edited files, generative outputs. The question shifts from "is this real?" to "what position does this exact digital state occupy?"

**Software supply chain.** Build artifacts, releases, model weights, and deployment packages bound to a position in a measured sequence.

**Legal and clinical records.** Contracts, filings, telehealth session manifests, lab results, and consent forms with independently verifiable causal ordering.

**Research and IP.** Datasets, experimental outputs, and possession proofs that commit to a hash without requiring the file to leave the user's device.

## How BitGraph differs from existing approaches

BitGraph is often confused with adjacent systems. The differences are structural:

| System | Says | BitGraph says |
|---|---|---|
| Signatures | This key signed this data | This key was controlled by a measured environment that consumed an unused position |
| Timestamps | This hash existed by time T | This hash consumed a pre-existing position in causal order |
| C2PA | Here are signed claims about this content | This exact digital state occupied this pre-existing position |
| Blockchains | Public ordering of shared transactions | Ordering established inside a measured enclave, then anchored publicly |

Signatures, timestamps, content credentials, and blockchains all answer "who claimed what, when?" BitGraph answers "what position does this exact digital state occupy?" They are complementary, not competing. A signature can be inside a BitGraph proof. A timestamp can decorate one. Content credentials can ride alongside one. None of them, alone, do what BitGraph does.

## Every copy carries the same position

Physical originality depended on singularity. There was one canvas, one negative, one signed paper, and the object's uniqueness was how you knew it came from the author's hand. Digital files broke that. Perfect copies are indistinguishable from the source, so the physical anchor for originality stopped working.

BitGraph does not restore originality. It makes it unnecessary. The artifact's hash is the proof's anchor, so any exact copy of the bytes carries the same position, and no copy has to be the special one. The proof object itself travels with the file or is stored wherever its holder keeps it, and each of those can have copies too. Verification does not depend on where anything lives. What used to need a unique object now needs only the exact bytes.

## The simplest version

A measured TEE reserves a random unused position. The producer writes the position's commitment into the bytes, whether that is a new file around an original or a record with a field of its own, and hashes the finished bytes. That hash arrives. The TEE binds it to the position, consumes the position, signs the result, and links it into an ordered chain. Every restart begins a new epoch with a new key, so a compromised boundary is bounded, never retroactive. The same mechanism periodically commits an Ethereum block hash, fixing the history behind it and giving everything after it a public date it provably followed.

The result is a protocol that does not say "someone signed this."

**It proves: these exact bits occupy this position.**

---

## Verification and audit packages

Two MIT-licensed packages in this repository make BitGraph evidence checkable without permission:

**[`@mikeargento/bitgraph-verify`](https://www.npmjs.com/package/@mikeargento/bitgraph-verify)** (1.16.0) verifies one record. `verifyExport()` checks a tree/1 export with the file it is about, one claim per line, the three time claims kept apart. `verifyCarrier()` judges a BitGraphed file. `verify()` checks a bare proof against the artifact bytes: structure, canonical Ed25519 signature, position binding, epoch link, and the digest match. `verifyProofIntegrity()` runs every check except the artifact binding for cases where the bytes are not available, and its result states explicitly that the binding was not checked.

**`@mikeargento/bitgraph-audit`** (0.9.0) audits a whole bundle of proofs, fully offline. It ingests a directory, `.tar`, or `.tar.gz`, or a single BitGraphed file; finds every export by its `format` field and checks it against each file it covers; verifies every proof through the canonical verifier, reconstructs causal order from the hash links and counters, classifies anomalies with stable machine-readable codes, and preserves divergence between valid proofs for the reader to adjudicate instead of choosing a winner. It ships a CLI (`bitgraph-audit <bundle>`) that writes machine-readable and human-readable reports. The bundle format is specified in [docs/BUNDLE-FORMAT.md](docs/BUNDLE-FORMAT.md); the recipient walkthrough is [docs/HOW-TO-AUDIT.md](docs/HOW-TO-AUDIT.md).

## License

Copyright 2024-2026 Argento Computing Inc. All rights reserved. Patent Pending.

This repository is source-available, not open-source. The code is published so anyone can read, audit, and reproduce the enclave build, but it is proprietary: copying, modification, distribution, and commercial use require a separate written agreement with the copyright owner. See [LICENSE](LICENSE).

Certain prior versions were distributed under the Apache License, Version 2.0; rights validly granted with respect to those prior versions are not affected.

Verification of BitGraph proofs is and remains permissionless. Anyone can verify a proof without asking permission: the standalone verifier is published as [@mikeargento/bitgraph-verify](https://www.npmjs.com/package/@mikeargento/bitgraph-verify) under the MIT license, and the [LICENSE](LICENSE) here additionally grants express, irrevocable permission to copy, build, and run this repository's code for verifying proofs and for reproducing and auditing the published enclave measurements.
