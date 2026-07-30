# BitGraph

**Portable cryptographic proof of construction for digital artifacts.**

[![npm @mikeargento/bitgraph](https://img.shields.io/npm/v/@mikeargento/bitgraph?label=%40mikeargento%2Fbitgraph&color=cb3837)](https://www.npmjs.com/package/@mikeargento/bitgraph)
[![Website](https://img.shields.io/badge/bitgraph.ing-live-0065A4)](https://bitgraph.ing)
[![Docs](https://img.shields.io/badge/docs-0065A4)](https://bitgraph.ing/docs)

---

Just as a photograph captures photons through the constraint of a single frame of film, a BitGraph captures bits through the constraint of a single mathematical slot.

Origin can be enforced or it can be claimed. Most digital provenance systems claim it. They produce an artifact and then attach a signature, a timestamp, or a metadata block describing where the artifact came from. The claim arrives after the artifact already exists, which is the wrong end of the timeline.

BitGraph enforces origin. A measured trusted execution environment creates an unpredictable cryptographic slot before the artifact's hash is known. The artifact's hash arrives later and is bound into the slot. The slot is consumed and cannot be reused. What emerges is not a description of provenance but a proof of construction.

> This exact digital state was committed through this measured process, in this order, under these constraints.

## The primitive

Nonce first. Hash second. Atomic binding third.

The TEE generates hardware entropy inside the enclave. That entropy becomes a slot, signed with the enclave's key, with an identity no attacker could have precomputed. The slot exists as a cryptographic object before any artifact hash has been seen.

The artifact hash arrives. The TEE binds the hash into the slot, signs the binding, and advances its internal order. The slot becomes consumed.

> UNUSED slot exists first. Artifact hash enters later. TEE binds the hash to the slot. Slot becomes CONSUMED. Proof travels with the artifact.

The atomicity is the whole guarantee. The slot is allocated and signed before the hash is known. The slot can be consumed exactly once by a single binding operation. The artifact itself can be produced anywhere, by any process, using any tools. What matters is that when the hash arrives, the slot is already there waiting.

Most systems say: "Here is a file hash. Now let's sign it." BitGraph says: "Here is a pre-existing origin slot. Now this file hash has occupied it."

## Why nonce-first matters

If a nonce, timestamp, or credential is added after the hash is already witnessed, it is just a label. It can prove someone signed something. It can prove a record existed by some moment. It cannot constrain the artifact's origin, because the artifact already existed before the nonce entered the picture.

That leaves a forgery window. A malicious actor can prepare old hashes, replay prior material, backfill records, or attach fresh randomness to something never produced through the claimed path. The label looks valid. The construction was never constrained.

BitGraph closes the window by requiring the slot to exist first. The slot is not evidence added afterward. It is the condition the artifact must satisfy.

## What a BitGraph proof contains

A BitGraph proof is a portable proof object, typically JSON, that travels with the artifact. It can include:

| Component | Purpose |
|---|---|
| Artifact hash | Identifies the exact file or digital state |
| Nonce | The pre-existing causal slot |
| Slot counter | Shows the slot was allocated before the commit |
| Commit counter | Shows the artifact consumed the slot later |
| Epoch ID | Groups an ordered run of commitments |
| Previous hash link | Connects proofs into a chain |
| Signer public key | Identifies the proof-signing authority |
| Signature | Verifies the proof was issued by the enclave-controlled key |
| TEE measurement | Shows what code and environment produced the proof |
| Attestation | Shows the proof came from measured hardware |
| Public anchor | Tethers BitGraph logical time to a public reference |

The result is not "a file was signed." It is: this hash was committed into this causal slot, by this measured environment, at this position in logical order, under this signing identity.

## Logical time

Every proof has order. Every slot and commit has a position. The system can prove that this happened after that, that this slot existed before this hash was bound, that this proof came before the next, that this epoch has an internal cryptographic history.

BitGraph proves causal order first. Clock time is optional.

## Ethereum: the backward seal

BitGraph's internal ordering does not require Ethereum. The chain creates internal order through slot allocation, consumption, counters, signatures, and chained proof history. Ethereum anchors add a different property on top: a public backward seal that any third party can independently verify.

An Ethereum block hash that becomes available after the artifact has been committed could not have been known at the moment of commitment. This produces an entropy sandwich:

1. Private TEE entropy before the artifact.
2. Artifact commitment in the middle.
3. Public blockchain entropy after it.

The artifact was committed after the TEE-created slot existed and before the later Ethereum block was knowable. That bounds the commitment in adversary-resistant entropy, witnessed in a public timeline anyone can check years later.

Ethereum is not asked to prove the artifact's origin. BitGraph does that. Ethereum provides the backward seal that makes the commitment publicly verifiable.

## Compromise and containment

BitGraph assumes the boundary can be compromised and bounds the damage instead of claiming it cannot happen.

The signing key exists only in enclave memory. Every restart destroys it and begins a new epoch with a fresh key and a fresh counter. Proofs from prior epochs were signed by keys that no longer exist, so a compromise cannot reach backward.

Forgery requires more than key theft. Every proof carries a hardware attestation whose user_data must equal the hash of that exact proof body, and only the enclave's secure module can produce one. A useful breach must execute inside the running enclave, and it dies at the next restart.

Damage control is precise. Every proof names its epoch permanently, so a suspect window is identified exactly: rotate the epoch, publish the affected epochId as quarantined, and every other epoch is untouched. Verifiers that pin measurements and track epochs account for the gap.

The production deployment makes rotation routine rather than exceptional: the boundary restarts once a day at an unpredictable time, destroying the epoch key and starting a fresh one. A breach that depends on staying resident inside the enclave cannot outlive the day without freshly re-compromising a new enclave.

## The trust model

BitGraph does not depend on blind trust in any single component. Not the operator, the TEE, Ethereum, the clock, a certificate authority, or a live server. Each layer adds an independently verifiable property.

| Layer | What it contributes |
|---|---|
| TEE | Measured execution and protected key use |
| Nonce-first slot | Causal precondition |
| Atomic binding | Prevents post-hoc attachment |
| Counters | Internal logical order |
| Proof chain | Historical continuity |
| Ethereum anchor | Public backward seal |
| Epoch rotation | Damage containment |
| Portable verification | Independence from the original server |

## What BitGraph applies to

BitGraph works on any digital state that can be hashed. The same primitive applies whether the artifact is a photograph, a contract, a model output, a dataset, or a software release.

**Media.** Photos, videos, audio, edited files, generative outputs. The question shifts from "is this real?" to "what origin path does this artifact satisfy?"

**AI outputs.** Model results bound to authenticated identity and causal position without requiring the model to run inside an enclave.

**Software supply chain.** Build artifacts, releases, model weights, and deployment packages bound to a measured construction path.

**Legal and clinical records.** Contracts, filings, telehealth session manifests, lab results, and consent forms with independently verifiable causal ordering.

**Research and IP.** Datasets, experimental outputs, and possession proofs that commit to a hash without requiring the file to leave the user's device.

## How BitGraph differs from existing approaches

BitGraph is often confused with adjacent systems. The differences are structural:

| System | Says | BitGraph says |
|---|---|---|
| Signatures | This key signed this data | This key was controlled by a measured environment that consumed an unused slot |
| Timestamps | This hash existed by time T | This hash consumed a pre-existing slot at this position in causal order |
| C2PA | Here are signed claims about this content | Here is the construction path this content satisfied |
| Blockchains | Public ordering of shared transactions | Private origin coordinates with optional public anchoring |

Signatures, timestamps, content credentials, and blockchains all answer "who claimed what, when?" BitGraph answers "what construction path did this exact artifact satisfy?" They are complementary, not competing. A signature can be inside a BitGraph proof. A timestamp can decorate one. Content credentials can ride alongside one. None of them, alone, do what BitGraph does.

## Multiple copies of the same original

Physical originality depends on singularity. There is one canvas, one negative, one signed paper. Digital files broke that because perfect copies are indistinguishable from the source.

BitGraph introduces a different category. A digital artifact can be copied without losing its original provenance. The proof travels with the bytes or alongside them. Instead of every copy being a degraded copy, BitGraph allows multiple copies of the same original. Originality moves from physical container to causal proof. Singularity is no longer required for originality.

## The simplest version

A measured TEE creates a random unused slot before the artifact hash arrives. The hash arrives. The TEE binds it to the slot, consumes the slot, signs the result, and links it into an ordered chain. Every restart begins a new epoch with a new key, so a compromised boundary is bounded, never retroactive. The same mechanism periodically commits an Ethereum block hash, sealing everything before it in a public timeline.

The result is a provenance system that does not say "someone signed this." It says: this exact artifact occupied this origin coordinate.

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
