# BitGraph

[![npm @mikeargento/bitgraph-sdk](https://img.shields.io/npm/v/@mikeargento/bitgraph-sdk?label=%40mikeargento%2Fbitgraph-sdk&color=cb3837)](https://www.npmjs.com/package/@mikeargento/bitgraph-sdk)
[![npm @mikeargento/bitgraph-verify](https://img.shields.io/npm/v/@mikeargento/bitgraph-verify?label=%40mikeargento%2Fbitgraph-verify&color=cb3837)](https://www.npmjs.com/package/@mikeargento/bitgraph-verify)
[![Website](https://img.shields.io/badge/bitgraph.ing-live-0065A4)](https://bitgraph.ing)

---

```
Position commitments for computing.
```

Give files, records, and computations verifiable positions in a cryptographically linked sequence. One BitGraph establishes a position. Two establish an interval.

## How BitGraph works

```
     ┌────────────────────────────────────┐
     │              Content               │
     │              Any bits              │
     └────────────────────────────────────┘
                       │
                       ▼
┌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌┐
┆             Secure enclave / TEE             ┆
┆    ┌────────────────────────────────────┐    ┆
┆    │       1. Position commitment       │    ┆
┆    │      Unpredictable and unused      │    ┆
┆    └────────────────────────────────────┘    ┆
┆                       │                      ┆
┆                       ▼                      ┆
┆    ┌────────────────────────────────────┐    ┆
┆    │     2. Content fills position      │    ┆
┆    │         Position consumed          │    ┆
┆    └────────────────────────────────────┘    ┆
┆                                              ┆
┆              One atomic action.              ┆
└╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌┘
                       │
                       ▼
     ┌────────────────────────────────────┐
     │           Portable proof           │
     │  Checks offline, without BitGraph  │
     └────────────────────────────────────┘
```

If any step fails, nothing is released and the counter does not move.

## What it proves

**BitGraph gives every computation a unique position with a portable proof that verifies offline.**

Inside a hardware enclave, one atomic action counts twice. First, a fresh, unpredictable value takes one position. At the very next count, your content's digest is bound to the sequence. Both counts are signed together.

The proof establishes that your bits were bound after a value nobody could predict, with nothing counted in between.

Every BitGraph occupies a unique position that can never be reused. It proves where your bits were bound in the sequence, not when the content was created.

No blockchain or external clock is required. Anyone can verify the proof offline.

## Between two

**Two BitGraphs make an interval.**

```
┌──────────────┐     ┌────────┐     ┌────────┐     ┌────────┐     ┌──────────────┐
│  BitGraph A  │ ──▶ │ Record │ ──▶ │ Record │ ──▶ │ Record │ ──▶ │  BitGraph B  │
│    Opens     │     └────────┘     └────────┘     └────────┘     │    Closes    │
└──────────────┘                                                  └──────────────┘
       └────────────────────────────────┬────────────────────────────────┘
              Everything here is bound after A and before B.
```

The sequence is cryptographically linked. Positions cannot be inserted or rearranged without breaking verification. Missing intermediate positions can be detected.

## Work between two

**BitGraph A makes the work possible. BitGraph B records the result.**

BitGraph A creates an unpredictable value. That value can be the input to the work: it can generate a question, seed an image, or choose what an AI must process.

Work made from that value could not have been determined before A. When the result is ready, BitGraph B binds it at a later position.

[See it working](https://bitgraph.ing/demos)

## Try it

**Make or check a BitGraph** in the drop box at [bitgraph.ing](https://bitgraph.ing/make). The file is hashed in your browser; only its SHA-256 is sent.

## For software

**Send a SHA-256, get the proof.**

```bash
curl -X POST https://bitgraph.ing/api/commit \
  -H 'content-type: application/json' \
  -d '{"digests":[{"digestB64":"<sha-256, base64>","hashAlg":"sha256"}]}'
```

Every BitGraph is kept. Fetch one by its hash, here or on the [ledger](https://bitgraph.ing/ledger):

```bash
curl https://bitgraph.ing/api/proofs/<sha-256, base64url>
```

For an AI agent:

```bash
claude mcp add bitgraph -- npx -y @mikeargento/bitgraph-mcp
```

A proof checks offline with [`@mikeargento/bitgraph-verify`](https://www.npmjs.com/package/@mikeargento/bitgraph-verify). Pin the enclave's measurement, reproducible from the published source: [`PINS.md`](server/commit-service/reproducible-build/PINS.md).

---

Anyone can put a recent block hash in a file or write a file's hash to a blockchain. Neither requires BitGraph, and neither gives the file a position of its own.

BitGraph does. It binds the file to a fresh, unpredictable value used exactly once, at a unique position in an unbroken sequence. That position can never be reused, reassigned, or occupied by anything else.

## What is in this repository

| Path | What it is |
|---|---|
| [`server/commit-service`](server/commit-service) | The enclave, its parent host, and the reproducible build. |
| [`packages/verify`](packages/verify) | `@mikeargento/bitgraph-verify`, MIT. Checks a proof offline. |
| [`packages/sdk`](packages/sdk) | `@mikeargento/bitgraph-sdk`. Make and check BitGraphs from code or the `bitgraph` CLI. |
| [`packages/mcp`](packages/mcp) | `@mikeargento/bitgraph-mcp`. The same for AI agents. |
| [`packages/audit`](packages/audit) | `@mikeargento/bitgraph-audit`, MIT. Checks a folder of proofs offline. |
| [`website`](website) | [bitgraph.ing](https://bitgraph.ing): the page, the drop box, the ledger and the proof pages. |

## License

Copyright 2024-2026 Argento Computing Inc. All rights reserved. Patent Pending.

This repository is source-available, not open-source. The code is published so anyone can read, audit, and reproduce the enclave build, but it is proprietary: copying, modification, distribution, and commercial use require a separate written agreement with the copyright owner. See [LICENSE](LICENSE).

Certain prior versions were distributed under the Apache License, Version 2.0; rights validly granted with respect to those prior versions are not affected.

Verification of BitGraph proofs is and remains permissionless. Anyone can verify a proof without asking permission: the standalone verifier is published as [@mikeargento/bitgraph-verify](https://www.npmjs.com/package/@mikeargento/bitgraph-verify) under the MIT license, and the [LICENSE](LICENSE) here additionally grants express, irrevocable permission to copy, build, and run this repository's code for verifying proofs and for reproducing and auditing the published enclave measurements.
