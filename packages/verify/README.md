# @mikeargento/bitgraph-verify

Offline, deterministic verification of [BitGraph](https://bitgraph.ing) proofs.

A BitGraph is made inside a hardware enclave in one atomic action: a fresh nonce from the hardware's random number generator takes one count, the content's SHA-256 takes the next, and both are signed together and attested by AWS Nitro. This package checks that proof offline. The inputs are the proof and the file. There is no network access, no account and no contact with BitGraph. Checking a BitGraph involves no blockchain.

Verification of BitGraph proofs is permissionless by design. This package is MIT-licensed so that anyone, including parties adverse to the proof's issuer, can verify a proof without asking permission, online or offline.

```bash
npm install @mikeargento/bitgraph-verify
```

## The check to rely on

```ts
import { verifyAttested } from "@mikeargento/bitgraph-verify";

const r = await verifyAttested({ proof, bytes });   // bytes optional; pcr0: [...] to name your own accepted images
if (r.valid) {
  // the bytes match the digest; the Ed25519 signature, the nonce's record and the two consecutive counts hold;
  // the AWS Nitro attestation verifies to the AWS root, at its own signed time, over this exact signed body;
  // and the image it attests (r.pcr0, r.image) is one BitGraph published. r.attestedAtMs is the attested time.
} else {
  console.error(r.reason);
}
```

`verifyAttested` is the full check: the file's hash, the signature, the position record, the two counts, and the AWS Nitro attestation, pinned to an enclave image. `PUBLISHED_PCR0S` is the default policy: the images BitGraph has published, each accepted for proofs the hardware dated no later than seven days after the next image went live. Pass `pcr0` to accept only images you have rebuilt and measured yourself. Attestation certificates are evaluated at the attestation document's own signed time, never at the reader's clock, so a proof does not expire.

Without `bytes` the proof is checked on its own, and the result says nothing about any file.

## Trees

Many files can be bound as one BitGraph: an RFC 6962 Merkle tree over the files' SHA-256s, with the root's text (`merkle-root.txt`) bound as an ordinary proof. Each file of a tree has a proof of its own: the tree's proof with a `bitgraph-tree-member/1` block (its index, the path to the root, the root's text) in the unsigned metadata. `verifyAttested({ proof, bytes })` walks the file's hash up that path to the root the proof binds before it checks the proof, and reports `treeMember: { index, files }`. `checkTreeMember` does the walk alone.

## A run of proofs

Each proof carries the hash of the one before it in `commit.prevB64`. `verifyAttested` checks that field's form, never its value, because it holds one proof. `verifyStretch(proofs)` checks a run of consecutive proofs you hold: the links and the counts, with no gap. `verifyBetween(stretch, record)` checks that a record sits strictly between the first and last proof of an unbroken run. Both check the run's shape; check each proof in it with `verifyAttested` as well.

## The lower layer

`verify({ proof, bytes })` checks structure, the Ed25519 signature, the position record, the counts and the digest. It checks the signature against the key **the proof itself carries**, and does not open the attestation, so on its own it cannot tell BitGraph's enclave from anyone who made a key and signed a body. Use it only beneath `verifyAttested`, or with your own `allowedPublicKeys`.

Verification is a function of its inputs. The single-successor (fork) history is the one piece of state it keeps, and only a proof that passed every check records anything in it. Pass a context of your own to keep one run's history separate:

```ts
import { verify, createVerificationContext } from "@mikeargento/bitgraph-verify";

const context = createVerificationContext();
await verify({ proof, bytes, context });
```

`verifyNitroAttestation` checks an attestation to the AWS Nitro root on its own.

## What a valid result does not assert

- When or how the content was made. The result says where the digest was bound and the time the hardware attested.
- Who made the content, or that it is true.
- That the proof is in BitGraph's ledger.
- That the predecessor named by `commit.prevB64` is the proof you think it is, unless you hold the run and check it with `verifyStretch`.

## Formats

The proof schema (`bitgraph/1`), the canonical serialization and the proof hash live here, so independent implementations can be checked against this one. In the signed fields the position record is named `slotAllocation`.

Proofs and files in earlier formats keep verifying, each through its own function: `verifyExport` for a `bitgraph-export/1` file with the file it is about, `verifyTreeMember` for a tree/1 member, `verifyCarrier` for a BitGraphed file (a file that carries its proof inside), and `verifyCeiling`, `verifyOutputRootSettlement` and `verifyTimelineBundle` for the Base and Ethereum block evidence some of those proofs carry. `spec/SPEC.md` and `spec/SPEC-v2.md` in the repository are the texts tree/1 proofs pin; both are frozen.

See [bitgraph.ing/tools](https://bitgraph.ing/tools) for the verification checklist and attestation handling, and [CHANGELOG.md](./CHANGELOG.md) for each release.

Making a BitGraph is separate and proprietary: [`@mikeargento/bitgraph-sdk`](https://www.npmjs.com/package/@mikeargento/bitgraph-sdk) for software, [`@mikeargento/bitgraph-mcp`](https://www.npmjs.com/package/@mikeargento/bitgraph-mcp) for AI agents.

## License

MIT. Copyright 2024-2026 Argento Computing Inc. The BitGraph protocol is patent pending; this package's MIT grant covers this verification code.
