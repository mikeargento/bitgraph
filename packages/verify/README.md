# @mikeargento/bitgraph-verify

Offline, deterministic verification of [BitGraph](https://bitgraph.ing) proofs.

A BitGraph is made inside a hardware enclave in one atomic action: a fresh nonce from the hardware's random number generator takes one count on a monotonic counter, the content's SHA-256 takes the next, and both are signed together. This package checks that proof offline. `verifyAttested` is the full check: the signature, the two counts, and the AWS Nitro attestation, pinned to the enclave images BitGraph published.

Verification of BitGraph proofs is permissionless by design. This package is MIT-licensed so that anyone, including parties adverse to the proof's issuer, can verify a proof without asking permission, online or offline, forever.

```bash
npm install @mikeargento/bitgraph-verify
```

Proofs made by enclave v11 and later are plain proofs: check them with `verifyAttested`, below. Trees made on the Make page bind `merkle-root.txt` as an ordinary proof. Earlier BitGraphs were tree/1 positions: one Merkle tree of files under one proof, one file a tree of one. Their holder keeps an **export** (bitgraph-export/1) beside the files, with `SPEC.md`, the exact text the proof pins. `verifyExport` checks an export with the file it is about and answers one claim per line, each saying what it rests on:

```ts
import { verifyExport, parseExport } from "@mikeargento/bitgraph-verify";

const result = await verifyExport(exportJson, { bytes });   // or { source } to stream a file of any size
result.verdict;   // TRUE, FALSE or UNDETERMINED
result.claims;    // proof, attestation, spec pin, tree root, this file's leaf, floor, Base ceiling, Ethereum settlement
result.times;     // floor, ceilingBase, ceilingEthereum: three time claims, never merged
```

The three time claims are kept apart. The floor is in time: the committed bytes were finished after floor block N, the Base block signed into the proof as `commit.slotFloor` (an Ethereum block, `commit.slotAnchor`, on proofs made before the switch; v12 proofs sign no floor). The ceiling on Base is in time: the record existed by Base block B, provisional until B is confirmed as Base's own. Settlement is Ethereum's record of that Base block through Base's output root (`bitgraph-output-root/1`). A pending section reads NOT_CARRIED, never FALSE. A part in a format this version does not know is UNDETERMINED. The spec hash a proof pins must be one this verifier knows: `KNOWN_TREE_SPEC_HASHES` holds SPEC.md version 1, `QazdIR0JYtHQwQuIISo7bvH1gxUvTS2cY+tW6BjUIRs=`, frozen 2026-10-04 and never changed; a later version is added beside it.

`verifyTreeMember` checks one leaf and path against a tree/1 proof. `verifyCarrier` judges a BitGraphed file, a file that carries its own proof: carrier/2 and /3 for a single-file position, carrier/4 for one member of a tree/1 BitGraph (its bytes walked to the signed root document through the member's leaf and path). `verifyCeiling` checks a ceiling in time, `verifyOutputRootSettlement` its settlement, `verifyNitroAttestation` the attestation to the AWS Nitro root. `PUBLISHED_PCR0S` is the default measurement policy: a proof from any other enclave image is not a BitGraph.

A bare bitgraph/1 proof is checked against its bytes with `verifyAttested`. This is the check to rely on:

```ts
import { verifyAttested } from "@mikeargento/bitgraph-verify";

const r = await verifyAttested({ proof, bytes });   // bytes optional; pcr0: [...] to name your own accepted images
if (r.valid) {
  // the bytes match the digest; the Ed25519 signature, the nonce's record and the two consecutive counts hold;
  // the AWS Nitro attestation verifies to the AWS root, at its own signed time, over this exact signed body;
  // and the image it attests (r.pcr0, r.image) is one BitGraph published. r.attestedAtMs is when it was bound.
} else {
  console.error(r.reason);
}
```

`verify({ proof, bytes })` is the lower layer: structure, the Ed25519 signature, the slot record, the counts and the digest match. It checks the signature against the key **the proof itself carries**, and does not open the attestation, so on its own it cannot tell BitGraph's enclave from anyone who made a key and signed a body. Use it only beneath `verifyAttested`, or with your own `allowedPublicKeys`.

Verification runs entirely locally: the artifact bytes and the proof JSON are the only inputs. No network access, no account, no contact with BitGraph.

What a valid result does **not** assert: anything about when or how the content was made (only where and when its digest was bound); that the proof is in BitGraph's ledger; and `commit.prevB64` is checked as a field, never against the predecessor proof, which this call does not have (`verifyStretch` checks a run of consecutive proofs you hold).

Verification is a function of its inputs. The single-successor (fork) history is the one piece of state it keeps, and only a proof that passed every check records anything in it. Pass a context of your own to keep one run's history separate:

```ts
import { verify, createVerificationContext } from "@mikeargento/bitgraph-verify";

const context = createVerificationContext();
await verify({ proof, bytes, context });
```

The proof schema (`bitgraph/1`), canonical serialization, and proofHash computation live here as well, so independent implementations can be checked against this one. The normative text is `spec/SPEC.md` in the repository; earlier formats (plain recordings, single fused files, set/1, set/2, carrier/1) keep verifying.

See [bitgraph.ing/tools](https://bitgraph.ing/tools) for the verification checklist and attestation handling, and [CHANGELOG.md](./CHANGELOG.md) for what 1.16.0 added.

Making a BitGraph is separate and proprietary: [`@mikeargento/bitgraph-sdk`](https://www.npmjs.com/package/@mikeargento/bitgraph-sdk) for software, built on [`@mikeargento/bitgraph`](https://www.npmjs.com/package/@mikeargento/bitgraph).

## License

MIT. Copyright 2024-2026 Argento Computing Inc. The BitGraph protocol is patent pending; this package's MIT grant covers this verification code.
