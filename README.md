# BitGraph

**A BitGraph gives bits a place.**

[![npm @mikeargento/bitgraph](https://img.shields.io/npm/v/@mikeargento/bitgraph?label=%40mikeargento%2Fbitgraph&color=cb3837)](https://www.npmjs.com/package/@mikeargento/bitgraph)
[![Website](https://img.shields.io/badge/bitgraph.ing-live-0065A4)](https://bitgraph.ing)
[![Docs](https://img.shields.io/badge/docs-0065A4)](https://bitgraph.ing/docs)

---

A file is chosen. A position is opened with nothing from that file in the request. The enclave reveals the signed slot, and only then can the new file be finished, because its final ingredient comes from that slot. You hash the finished bytes and send the digest back, with the original file's hash attached as a declaration. The enclave spends the position on that digest, and it can never be spent again. It signs a record binding the digest to that position, linked to the proof before it. The hardware attests which code produced it, and this record in particular. The signed record is a BitGraph.

All of it happens off-chain, and the proof is permanently bound to that exact digital state.

Provenance can be enforced or it can be claimed. Most systems claim it: they bind a statement about the content to the content itself. That binding can be cryptographically strong, and it can be made at the moment of capture rather than afterward, so the weakness is not timing. The weakness is that a claim is something a trusted signer can attach to any artifact at all. The artifact does not have to satisfy any prior condition to receive one.

BitGraph enforces it instead. A measured trusted execution environment creates an unpredictable cryptographic slot before the artifact's hash reaches it. The artifact's hash arrives later and is bound into the slot. The slot is consumed and cannot be reused. What emerges is not a description of provenance but a proof of placement.

> This exact digital state was committed through this measured process, in this order, under these constraints.

## The primitive

Nonce first. Hash second. Atomic binding third.

The TEE generates hardware entropy inside the enclave. That entropy becomes a slot, signed with the enclave's key, with an identity that could not feasibly have been predicted. The slot exists as a cryptographic object before it has seen any artifact hash.

The artifact hash arrives. The TEE binds the hash into the slot, signs the binding, and advances its internal order. The slot becomes consumed.

> UNUSED slot exists first. Artifact hash enters later. TEE binds the hash to the slot. Slot becomes CONSUMED. Proof travels with the artifact.

The atomicity is the whole guarantee, and it constrains the record rather than the artifact. The artifact itself can be produced anywhere, by any process, using any tools. What matters is that when the hash arrives, the slot is already there waiting.

Most systems begin with the bits. BitGraph begins with the place. They say: "Here is a file hash. Now let's sign it." BitGraph says: "Here is a pre-existing position. Now this file hash has occupied it."

## Why nonce-first matters

If a nonce, timestamp, or credential is added after the hash is already witnessed, it is just a label. It can prove someone signed something. It can prove a record existed by some moment. It cannot impose a prior condition merely by being attached afterward. The credential may describe where the artifact came from, but the artifact never had to consume a pre-existing, single-use position in order to receive one.

That leaves a forgery window. A malicious actor can prepare old hashes, replay prior material, backfill records, or attach fresh randomness to something never produced through the claimed path. The label looks valid. Nothing had to be true before it was attached.

BitGraph narrows that window by requiring the slot to exist first. It does not stop an old file being committed today: the hash occupies a slot allocated today, and the position claims nothing about when the bytes were made. What it stops is a position being invented after the fact, or occupied twice. The slot is not evidence added afterward. It is the condition the artifact must satisfy.

## What a BitGraph proof contains

A BitGraph proof is a portable proof object, a JSON document, that travels with the artifact. It can include:

| Component | Purpose |
|---|---|
| Artifact hash | Identifies the exact file or digital state |
| Nonce | Hardware entropy giving the slot an identity that cannot feasibly be predicted |
| Slot counter | Shows the slot was allocated before the commit |
| Commit counter | Shows the artifact consumed the slot later |
| Epoch ID | Groups an ordered run of commitments |
| Previous hash link | Connects proofs into a chain |
| Signer public key | Identifies the proof-signing authority |
| Signature | Verifies the proof was issued by the enclave-controlled key |
| TEE measurement | Shows what code and environment produced the proof |
| Attestation | Shows the proof came from measured hardware |
| Public anchor | Tethers BitGraph logical time to a public reference |

Taken together: this hash was committed into this causal slot, by this measured environment, at this position in logical order, under this signing identity.

## Logical time

Every proof has order. Every slot and commit has a position. The system can prove that this happened after that, that this slot existed before this hash was bound, that this proof came before the next, that this epoch has an internal cryptographic history.

BitGraph proves causal order. It does not assert a clock time.

## Establishing wall clock time

BitGraph's internal ordering does not require Ethereum. The chain creates internal order through slot allocation, consumption, counters, signatures, and chained proof history. What that order lacks, on its own, is a clock. The enclave keeps no trusted one; any clock reading inside a proof is advisory.

Ethereum is where the order meets the wall clock. An anchor is an ordinary proof on the same chain whose artifact is the hash of a recent Ethereum block. A block hash does not exist before its block is produced, so the anchor, and every proof chained after it, came after that block and its public date. Anchors recur throughout every epoch. This is the wall-clock statement every proof page shows, and it runs in one direction: provably no earlier than. The other side of the window narrows through the chain's cadence, measured enclave behavior rather than public data, which is why it is narrowed, not closed.

The anchors also fix history backward, through content. Each anchor is hash-linked to everything before it, so once an anchor exists, the history behind it is fixed: alter any earlier proof and the chain no longer reaches the anchor. When the epoch ends, its signing key is destroyed, and the set closes.

Ethereum is not asked to be a good source of randomness, and it is not asked to establish the artifact's position. BitGraph establishes the position. Ethereum ties the positions to the public timeline, so anyone, years later, can check the order and the earliest date each position could have existed.

## Compromise and containment

BitGraph assumes the boundary can be compromised and bounds the damage instead of claiming it cannot happen.

The signing key exists only in enclave memory. Every restart destroys it and begins a new epoch with a fresh key and a fresh counter. Proofs from prior epochs were signed by keys that no longer exist, so a compromise cannot reach backward.

Forgery requires more than key theft. Every proof carries a hardware attestation whose user_data must equal the hash of that exact proof body, and only the enclave's secure module can produce one. A useful breach must execute inside the running enclave, and it dies at the next restart.

Damage control is precise. Every proof names its epoch permanently, so a suspect window is identified exactly: rotate the epoch, publish the affected epochId as quarantined, and every other epoch is untouched. Verifiers that pin measurements and track epochs account for the gap.

The production deployment makes rotation routine rather than exceptional: the boundary restarts every day at 23:59 UTC, destroying the epoch key and starting a fresh one, so a normally operating epoch runs about a day. An unexpected restart ends one early and a failed rotation extends one; either way the boundary is recorded in the proofs themselves. A breach that depends on staying resident inside the enclave cannot outlive its epoch without freshly re-compromising a new one. The schedule is deliberately public: rotation times are visible on the ledger regardless, and the protection comes from the key dying, not from anyone guessing when.

## The trust model

BitGraph does not ask for blind trust in any single component. It has real dependencies, and the point is that each one is inspectable rather than assumed: the enclave's attestation chains to the AWS Nitro Attestation PKI root, and the measurement it carries is published, so both are things you check rather than things you take on faith. Each layer adds an independently verifiable property.

| Layer | What it contributes |
|---|---|
| TEE | Measured execution and protected key use |
| Nonce-first slot | Causal precondition |
| Atomic binding | Prevents post-hoc attachment |
| Counters | Internal logical order |
| Proof chain | Historical continuity |
| Ethereum anchor | Public wall-clock bound |
| Epoch rotation | Damage containment |
| Portable verification | Independence from the original server |

## What BitGraph applies to

BitGraph works on any digital state that can be hashed. The same primitive applies whether the artifact is a photograph, a contract, a model output, a dataset, or a software release.

**Media.** Photos, videos, audio, edited files, generative outputs. The question shifts from "is this real?" to "what position does this exact digital state occupy?"

**AI outputs.** Model results bound to a causal position, and optionally to a key that authorized the recording, without requiring the model to run inside an enclave.

**Software supply chain.** Build artifacts, releases, model weights, and deployment packages bound to a position in a measured sequence.

**Legal and clinical records.** Contracts, filings, telehealth session manifests, lab results, and consent forms with independently verifiable causal ordering.

**Research and IP.** Datasets, experimental outputs, and possession proofs that commit to a hash without requiring the file to leave the user's device.

## How BitGraph differs from existing approaches

BitGraph is often confused with adjacent systems. The differences are structural:

| System | Says | BitGraph says |
|---|---|---|
| Signatures | This key signed this data | This key was controlled by a measured environment that consumed an unused slot |
| Timestamps | This hash existed by time T | This hash consumed a pre-existing slot at this position in causal order |
| C2PA | Here are signed claims about this content | This exact digital state occupied this pre-existing position |
| Blockchains | Public ordering of shared transactions | Ordering established inside a measured enclave, then anchored publicly |

Signatures, timestamps, content credentials, and blockchains all answer "who claimed what, when?" BitGraph answers "what position does this exact digital state occupy?" They are complementary, not competing. A signature can be inside a BitGraph proof. A timestamp can decorate one. Content credentials can ride alongside one. None of them, alone, do what BitGraph does.

## Every copy carries the same position

Physical originality depended on singularity. There was one canvas, one negative, one signed paper, and the object's uniqueness was how you knew it came from the author's hand. Digital files broke that. Perfect copies are indistinguishable from the source, so the physical anchor for originality stopped working.

BitGraph does not restore originality. It makes it unnecessary. The artifact's hash is the proof's anchor, so any exact copy of the bytes carries the same position, and no copy has to be the special one. The proof object itself can travel with the file, stay on the server that issued it, or be stored anywhere, and each of those can have copies too. Verification does not depend on where anything lives. What used to need a unique object now needs only the exact bytes.

## The simplest version

A measured TEE creates a random unused slot before the artifact hash arrives. The hash arrives. The TEE binds it to the slot, consumes the slot, signs the result, and links it into an ordered chain. Every restart begins a new epoch with a new key, so a compromised boundary is bounded, never retroactive. The same mechanism periodically commits an Ethereum block hash, fixing the history behind it and giving everything after it a public date it provably followed.

The result is a protocol that does not say "someone signed this."

**It proves: these exact bits occupy this position.**

---

## Quickstart

Try it live: drop a file at [bitgraph.ing](https://bitgraph.ing). The file never leaves your device; only its SHA-256 hash is sent to the enclave.

Verify a proof in code:

```bash
npm install @mikeargento/bitgraph
```

```ts
import { verify } from "@mikeargento/bitgraph";

const result = await verify({ proof, bytes });
if (result.ok) {
  // signature, slot binding, attestation, and chain link all checked
}
```

See [bitgraph.ing/docs](https://bitgraph.ing/docs) for the full proof format, verification checklist, attestation handling, and self-host instructions.

## Verification and audit packages

Two MIT-licensed packages in this repository make BitGraph evidence checkable without permission:

**[`@mikeargento/bitgraph-verify`](https://www.npmjs.com/package/@mikeargento/bitgraph-verify)** verifies one proof. `verify()` checks a proof against the original artifact bytes: structure, canonical Ed25519 signature, slot binding, epoch link, and the digest match. `verifyProofIntegrity()` runs every check except the artifact binding for cases where the bytes are not available, and its result states explicitly that the binding was not checked.

**`@mikeargento/bitgraph-audit`** audits a whole bundle of proofs, fully offline. It ingests a directory, `.tar`, or `.tar.gz`, verifies every proof through the canonical verifier, reconstructs causal order from the hash links and counters, classifies anomalies with stable machine-readable codes, and preserves divergence between valid proofs for the reader to adjudicate instead of choosing a winner. It ships a CLI (`bitgraph-audit <bundle>`) that writes machine-readable and human-readable reports. The bundle format is specified in [docs/BUNDLE-FORMAT.md](docs/BUNDLE-FORMAT.md); the recipient walkthrough is [docs/HOW-TO-AUDIT.md](docs/HOW-TO-AUDIT.md).

## License

Copyright 2024-2026 Mike Argento. All rights reserved. Patent Pending.

This repository is source-available, not open-source. The code is published so anyone can read, audit, and reproduce the enclave build, but it is proprietary: copying, modification, distribution, and commercial use require a separate written agreement with the copyright owner. See [LICENSE](LICENSE).

Certain prior versions were distributed under the Apache License, Version 2.0; rights validly granted with respect to those prior versions are not affected.

Verification of BitGraph proofs is and remains permissionless. Anyone can verify a proof without asking permission: the standalone verifier is published as [@mikeargento/bitgraph-verify](https://www.npmjs.com/package/@mikeargento/bitgraph-verify) under the MIT license, and the [LICENSE](LICENSE) here additionally grants express, irrevocable permission to copy, build, and run this repository's code for verifying proofs and for reproducing and auditing the published enclave measurements.
