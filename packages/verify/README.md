# @mikeargento/bitgraph-verify

Offline, deterministic verification of [BitGraph](https://bitgraph.ing) proofs.

Verification of BitGraph proofs is permissionless by design. This package is MIT-licensed so that anyone, including parties adverse to the proof's issuer, can verify a proof without asking permission, online or offline, forever.

```ts
import { verify } from "@mikeargento/bitgraph-verify";

const result = await verify({ proof, bytes });
if (result.valid) {
  // structure, canonical Ed25519 signature, slot binding, the attestation's
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

The proof schema (`bitgraph/1`), canonical serialization, and proofHash computation live here as well, so independent implementations can be checked against this one.

See [bitgraph.ing/docs/verification](https://bitgraph.ing/docs/verification) for the verification checklist and attestation handling.

The BitGraph construction side (proof creation) is separate and proprietary: [`@mikeargento/bitgraph`](https://www.npmjs.com/package/@mikeargento/bitgraph).

## License

MIT. Copyright 2024-2026 Argento Computing Inc. The BitGraph protocol is patent pending; this package's MIT grant covers this verification code.
