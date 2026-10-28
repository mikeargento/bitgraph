# BitGraph

[![npm @mikeargento/bitgraph-sdk](https://img.shields.io/npm/v/@mikeargento/bitgraph-sdk?label=%40mikeargento%2Fbitgraph-sdk&color=cb3837)](https://www.npmjs.com/package/@mikeargento/bitgraph-sdk)
[![npm @mikeargento/bitgraph-verify](https://img.shields.io/npm/v/@mikeargento/bitgraph-verify?label=%40mikeargento%2Fbitgraph-verify&color=cb3837)](https://www.npmjs.com/package/@mikeargento/bitgraph-verify)
[![Website](https://img.shields.io/badge/bitgraph.ing-live-0065A4)](https://bitgraph.ing)

**A new primitive for digital proof.**

BitGraph is a recording mechanism for companies that already sell proof: content provenance, Content Credentials, trusted
capture, timestamping, audit trails. Inside a measured AWS Nitro enclave, one atomic action binds a SHA-256 at a counted
position, right after a fresh hardware nonce, signed and attested. The proof is a small JSON file that checks offline, without
BitGraph. Keep your product. Upgrade your proof.

[Technology](https://bitgraph.ing/technology) · [Evaluate](https://bitgraph.ing/evaluate) · [Integrate](https://bitgraph.ing/integrate) · [Licensing](https://bitgraph.ing/licensing)

## The mechanism

```
     ┌────────────────────────────────────┐
     │              SHA-256               │
     │            Of any data             │
     └────────────────────────────────────┘
                       │
                       ▼
┌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌┐
┆          Measured AWS Nitro enclave          ┆
┆    ┌────────────────────────────────────┐    ┆
┆    │           Count N: nonce           │    ┆
┆    │    Fresh from the hardware RNG     │    ┆
┆    └────────────────────────────────────┘    ┆
┆                       │                      ┆
┆                       ▼                      ┆
┆    ┌────────────────────────────────────┐    ┆
┆    │         Count N+1: digest          │    ┆
┆    │ Bound right after, signed together │    ┆
┆    └────────────────────────────────────┘    ┆
┆                                              ┆
┆              One atomic action.              ┆
└╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌┘
                       │
                       ▼
     ┌────────────────────────────────────┐
     │           Attested proof           │
     │  Checks offline, without BitGraph  │
     └────────────────────────────────────┘
```

When a digest arrives, the enclave draws a 32-byte nonce from the Nitro Secure Module's hardware RNG, signs a slot record at
count N, binds the digest at count N+1 with the hash of the previous proof, asks the hardware for an attestation over the
exact signed body, signs it with its Ed25519 key, and only then advances the counter. If any step fails, nothing is released,
the counter does not move, and the nonce never leaves the enclave
([`app.ts`](server/commit-service/src/enclave/app.ts), tested in
[`bind-failure.test.ts`](server/commit-service/src/enclave/__tests__/bind-failure.test.ts)).

## What a BitGraph establishes

1. **Position.** These exact bytes were bound at count N+1 of one enclave's sequence, immediately after a fresh hardware nonce
   at count N. Nothing was counted between them, no count is given out twice, and each proof carries the hash of the one
   before it, so gaps show.
2. **Origin of the record.** The binding was done by a specific enclave build whose measurement (PCR0) is published and
   reproducible, as AWS Nitro hardware attests in a document signed for that exact proof.
3. **Time.** It happened by the time in the hardware's signed attestation. Through bitgraph.ing it also falls inside a window
   of public time: after a named Base block, and before the block where the proof's hash was written.

It does not establish when content was created, who made it, or that it is true. It binds bytes. No blockchain is needed to
verify a proof; Base is only needed to check the time window.

Many items are bound at once as an RFC 6962 Merkle tree in one action, and each proves its own inclusion. Two BitGraphs bracket
everything bound between them, and work made from one BitGraph's nonce could not have existed before it.

Full mechanism, threat model and comparisons with signatures, RFC 3161, transparency logs, blockchain anchoring and C2PA:
[bitgraph.ing/technology](https://bitgraph.ing/technology).

## Evaluate it in fifteen minutes

Verify a real v13 production proof offline, pinned to the published measurement:

```bash
curl -O https://bitgraph.ing/evaluate/sample.txt -O https://bitgraph.ing/evaluate/sample.txt.bitgraph.json
npx @mikeargento/bitgraph-sdk verify sample.txt --proof sample.txt.bitgraph.json \
  --pcr0 adaad0bef62292d35197ae8db19e40685229f1a1e6070a7c77a148c4ada88ee66a1ca50819eebc2017c6716a49f2692f
```

```
TRUE

  These exact bytes are file 2 of a tree of 2, whose root was bound by BitGraph's published enclave image v13,
  as the AWS Nitro hardware attests, at 2026-10-21T01:37:40.960Z.
```

Then edit any field of the proof, or one byte of the file, and verify again: each change fails, for its own reason, with
exit code 2. A second sample is a ChatGPT image whose OpenAI-signed Content Credentials were bound in the same tree.

Rebuild the enclave's measurement from source (Docker on linux/amd64; no Nitro hardware needed):

```bash
./server/commit-service/reproducible-build/verify-pcr0.sh enclave-v13 \
  adaad0bef62292d35197ae8db19e40685229f1a1e6070a7c77a148c4ada88ee66a1ca50819eebc2017c6716a49f2692f
```

Run the verifier's tests, including a forgery with an attacker's key that passes a signature check and fails the attested one:

```bash
npm install && npm test --workspace=packages/verify
```

The whole guide, with every tamper case and its expected result: [bitgraph.ing/evaluate](https://bitgraph.ing/evaluate).

## Integrate

Send a SHA-256, get a proof. Content never leaves your systems.

```bash
curl -X POST https://bitgraph.ing/api/commit \
  -H 'content-type: application/json' \
  -d '{"digests":[{"digestB64":"<sha-256, base64>","hashAlg":"sha256"}]}'

curl https://bitgraph.ing/api/proofs/<sha-256, base64url>
```

From code, and for AI agents:

```bash
npm install @mikeargento/bitgraph-sdk
claude mcp add bitgraph -- npx -y @mikeargento/bitgraph-mcp
```

Verify inside your own product, so your customers check proofs without you or BitGraph:

```js
import { verifyAttested } from "@mikeargento/bitgraph-verify";

const r = await verifyAttested({ proof, bytes });
// r.valid, r.attestedAtMs, r.image ({ version: "v13", … }), r.treeMember ({ index, files })
```

Where it fits, as integration patterns: Content Credentials, watermark discovery, trusted capture, asset registries, AI agents,
software supply chains, research and enterprise records ([bitgraph.ing/applications](https://bitgraph.ing/applications)).
The public endpoint is rate-limited; production integrations use an API key.

## Licensing

BitGraph is offered through Argento Computing Inc. as:

- **Managed recording:** call the service; nothing to operate.
- **Mechanism license:** run the recording mechanism under your own control, with scope and deployment set by agreement.
- **Strategic:** broader rights, including exclusivity in a field or acquisition, handled confidentially.

No terms are published here. Start at [bitgraph.ing/licensing](https://bitgraph.ing/licensing).

## What is in this repository

| Path | What it is |
|---|---|
| [`server/commit-service`](server/commit-service) | The enclave, its parent host, and the reproducible build. The deployed v13 source is the [`enclave-v13`](https://github.com/mikeargento/bitgraph/tree/enclave-v13) branch. |
| [`packages/verify`](packages/verify) | `@mikeargento/bitgraph-verify`, MIT. Checks a proof offline. |
| [`packages/sdk`](packages/sdk) | `@mikeargento/bitgraph-sdk`. Make and check BitGraphs from code or the `bitgraph` CLI. |
| [`packages/mcp`](packages/mcp) | `@mikeargento/bitgraph-mcp`. The same for AI agents. |
| [`packages/audit`](packages/audit) | `@mikeargento/bitgraph-audit`, MIT. Checks a folder of proofs offline. |
| [`website`](website) | [bitgraph.ing](https://bitgraph.ing): the technology and evaluation pages, Make, Check, the ledger and the proof pages. |

## License

Copyright 2025-2026 Argento Computing Inc. All rights reserved. Patent Pending.

This repository is source-available, not open-source. The code is published so anyone can read, audit, and reproduce the enclave build, but it is proprietary: copying, modification, distribution, and commercial use require a separate written agreement with the copyright owner. See [LICENSE](LICENSE).

Certain prior versions were distributed under the Apache License, Version 2.0; rights validly granted with respect to those prior versions are not affected.

Verification of BitGraph proofs is and remains permissionless. Anyone can verify a proof without asking permission: the standalone verifier is published as [@mikeargento/bitgraph-verify](https://www.npmjs.com/package/@mikeargento/bitgraph-verify) under the MIT license, and the [LICENSE](LICENSE) here additionally grants express, irrevocable permission to copy, build, and run this repository's code for verifying proofs and for reproducing and auditing the published enclave measurements.
