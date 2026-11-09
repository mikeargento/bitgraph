# bitgraph.ing

The BitGraph website: the drop box that makes a BitGraph, the proof pages, the ledger, the technology and evaluation
pages, the developer pages, and the hosted MCP endpoint at `/mcp`.

Next.js (App Router) on Vercel. It builds from this directory.

```bash
npm install
npm run dev     # http://localhost:3000
npm run build   # production build
```

A drop on a local copy makes a real, permanent BitGraph: the site sends the hash to the live enclave.

Tests, from this directory:

```bash
npm run test:fuse      # trees and members, BitGraphed files, earlier proof formats, the spec pin, recovery entries, hashing, the local ledger
npm run test:ledger    # the page format for archived ledger days
npm run test:timeline  # the ledger's rows and the check of the enclave host
```

## What is where

| Path | What it is |
|---|---|
| `src/app` | Routes. `page.tsx` is the home page, `make` and `demos` the drop box, `proof/[digest]` a proof, `ledger` every BitGraph by day, `technology`, `evaluate`, `integrate` and `tools` the explanation and the developer pages, `examples` the demos, `mcp` the hosted MCP endpoint. A path at the root that is the start of a recorded digest opens its proof. |
| `src/app/api` | The site's own API. `POST commit` makes a BitGraph: one atomic bind in the enclave. `GET proofs/<digest>` and `POST proofs/batch` read proofs by the file's SHA-256. `tree-members` indexes each file of a tree under its own hash. `ledger/*` feeds the ledger page. `recovery/*` stores sealed recovery entries the site cannot open. |
| `public/spec` | `SPEC.md` and `SPEC-v2.md`, served at `/spec/`. Both are frozen: tree proofs made under them sign the file's SHA-256, so the text never changes. A test holds `SPEC.md` to `spec/SPEC.md` byte for byte. |
| `public/evaluate` | The sample files and proofs the evaluation page and the root README verify. |
| `src/components` | The drop box (`drop-box.tsx`), the ledger rows, the list of a tree's files, the figures, the navigation. |
| `src/lib` | Client and server helpers: hashing and binding a drop, trees and their members, the S3 reader, the reading of earlier proof formats, the recovery store, the hosted MCP, formatting. |
| `src/app/globals.css` | Every token and rule. Colors are tokens; the type ladder is enforced at the end of the file. |

## What it talks to

A drop is hashed in the browser. Only the SHA-256 is sent, to `POST /api/commit`, which forwards it to the enclave's
host. The enclave (image v13) draws a fresh nonce at count N, binds the digest at count N+1, signs and attests both,
and returns one proof. The site stores the proof in S3 and serves it by the file's digest. Many files in one drop are
hashed into one Merkle tree in the browser, and one BitGraph binds its root.

The site reads and writes no blockchain. While the enclave restarts, at the daily rotation, a drop gets a retryable
answer and nothing is made.

None of this is needed to verify a BitGraph you hold. Verification runs offline from the file and its proof, through
[`@mikeargento/bitgraph-verify`](https://www.npmjs.com/package/@mikeargento/bitgraph-verify).

The mechanism, the trust model and the proof format are explained at
[bitgraph.ing/technology](https://bitgraph.ing/technology), and the repository as a whole is described in the
[root README](../README.md).

## License

Copyright 2025-2026 Argento Computing Inc. All rights reserved. Patent Pending. Source-available, not open-source: see [LICENSE](../LICENSE).
