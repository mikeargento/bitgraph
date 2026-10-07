# @mikeargento/bitgraph-verify

Offline, deterministic verification of [BitGraph](https://bitgraph.ing) proofs.

The records these proofs are about are often AI audit records: a trust record, a log, an evaluation result, an agent's account of its own run. A BitGraph proves the record is exactly what was committed and gives it a position its producer does not control.

Verification of BitGraph proofs is permissionless by design. This package is MIT-licensed so that anyone, including parties adverse to the proof's issuer, can verify a proof without asking permission, online or offline, forever.

```bash
npm install @mikeargento/bitgraph-verify
```

A BitGraph made today is a tree/1 position: one Merkle tree of files under one proof, one file a tree of one. Its holder keeps an **export** (bitgraph-export/1) beside the files, with `SPEC.md`, the exact text the proof pins. `verifyExport` checks an export with the file it is about and answers one claim per line, each saying what it rests on:

```ts
import { verifyExport, parseExport } from "@mikeargento/bitgraph-verify";

const result = await verifyExport(exportJson, { bytes });   // or { source } to stream a file of any size
result.verdict;   // TRUE, FALSE or UNDETERMINED
result.claims;    // proof, attestation, spec pin, tree root, this file's leaf, floor, Base ceiling, Ethereum settlement
result.times;     // floor, ceilingBase, ceilingEthereum: three time claims, never merged
```

The three time claims are kept apart. The floor is in time: the committed bytes were finished after floor block N, the Base block signed into the proof as `commit.slotFloor` (an Ethereum block, `commit.slotAnchor`, on proofs made before the switch). The ceiling on Base is in time: the record existed by Base block B, provisional until B is confirmed as Base's own. Settlement is Ethereum's record of that Base block through Base's output root (`bitgraph-output-root/1`). A pending section reads NOT_CARRIED, never FALSE. A part in a format this version does not know is UNDETERMINED. The spec hash a proof pins must be one this verifier knows: `KNOWN_TREE_SPEC_HASHES` holds SPEC.md version 1, `QazdIR0JYtHQwQuIISo7bvH1gxUvTS2cY+tW6BjUIRs=`, frozen 2026-10-04 and never changed; a later version is added beside it.

`verifyTreeMember` checks one leaf and path against a tree/1 proof. `verifyCarrier` judges a BitGraphed file (carrier/2), the single-file form that carries its own proof. `verifyCeiling` checks a ceiling in time, `verifyOutputRootSettlement` its settlement, `verifyNitroAttestation` the attestation to the AWS Nitro root. `PUBLISHED_PCR0S` is the default measurement policy: a proof from any other enclave image is not a BitGraph.

A bare bitgraph/1 proof is checked against its bytes with `verify`:

```ts
import { verify } from "@mikeargento/bitgraph-verify";

const result = await verify({ proof, bytes });
if (result.valid) {
  // structure, canonical Ed25519 signature, position binding, the attestation's
  // binding to this signed body, and the digest match are all checked
} else {
  console.error(result.reason);
}
```

Verification runs entirely locally: the artifact bytes and the proof JSON are the only inputs. No network access, no account, no contact with BitGraph.

What a `valid: true` does **not** assert: the attestation report is checked for binding to this exact signed body, not authenticated against the hardware vendor's PKI (that belongs in an adapter package, and `@mikeargento/bitgraph-audit` does it for a bundle); and `commit.prevB64` is checked as a field, never against the predecessor proof, which this call does not have.

Verification is a function of its inputs. The single-successor (fork) history is the one piece of state it keeps, and only a proof that passed every check records anything in it. Pass a context of your own to keep one run's history separate:

```ts
import { verify, createVerificationContext } from "@mikeargento/bitgraph-verify";

const context = createVerificationContext();
await verify({ proof, bytes, context });
```

The proof schema (`bitgraph/1`), canonical serialization, and proofHash computation live here as well, so independent implementations can be checked against this one. The normative text is `spec/SPEC.md` in the repository; earlier formats (plain recordings, single fused files, set/1, set/2, carrier/1) keep verifying.

See [bitgraph.ing/docs/verification](https://bitgraph.ing/docs/verification) for the verification checklist and attestation handling, and [CHANGELOG.md](./CHANGELOG.md) for what 1.16.0 added.

Making a BitGraph is separate and proprietary: [`@mikeargento/bitgraph-sdk`](https://www.npmjs.com/package/@mikeargento/bitgraph-sdk) for software, built on [`@mikeargento/bitgraph`](https://www.npmjs.com/package/@mikeargento/bitgraph).

## License

MIT. Copyright 2024-2026 Argento Computing Inc. The BitGraph protocol is patent pending; this package's MIT grant covers this verification code.
