# @mikeargento/bitgraph-verify

Offline, deterministic verification of [BitGraph](https://bitgraph.ing) proofs.

Verification of BitGraph proofs is permissionless by design. This package is MIT-licensed so that anyone, including parties adverse to the proof's issuer, can verify a proof without asking permission, online or offline, forever.

```ts
import { verify } from "@mikeargento/bitgraph-verify";

const result = await verify({ proof, bytes });
if (result.ok) {
  // signature, slot binding, attestation, and chain link all checked
}
```

Verification runs entirely locally: the artifact bytes and the proof JSON are the only inputs. No network access, no account, no contact with BitGraph.

The proof schema (`bitgraph/1`), canonical serialization, and proofHash computation live here as well, so independent implementations can be checked against this one.

See [bitgraph.ing/docs/verification](https://bitgraph.ing/docs/verification) for the verification checklist and attestation handling.

The BitGraph construction side (proof creation) is separate and proprietary: [`@mikeargento/bitgraph`](https://www.npmjs.com/package/@mikeargento/bitgraph).

## License

MIT. Copyright 2024-2026 Mike Argento. The BitGraph protocol is patent pending; this package's MIT grant covers this verification code.
