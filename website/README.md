# bitgraph.ing

The BitGraph website: the drop box that makes a BitGraph (everything dropped becomes one tree/1 position, and the page hands back its export/1), the proof pages, the Base ceilings page, the page of earlier Ethereum anchors, the recovery service, the docs, the spec at `/spec/SPEC.md`, and the hosted MCP endpoint at `/mcp`.

Next.js (App Router) on Vercel. It builds from this directory.

```bash
npm install
npm run dev     # http://localhost:3000
npm run build   # production build
```

Tests, from this directory:

```bash
npm run test:fuse      # tree/1, placements, exports, the spec pin, recovery entries, scan hashing, floors and earlier anchors, local ledger, the download package
npm run test:mcp       # the hosted MCP server
npm run test:ledger    # the day/archive feed
```

## What is where

| Path | What it is |
|---|---|
| `src/app` | Routes. `page.tsx` is the home page, `proof/[digest]` a proof, `ceilings` the Base ceilings, `ledger` the Ethereum anchors that floor earlier proofs, `docs/*` the documentation, `mcp` the hosted MCP endpoint. |
| `src/app/api` | The site's own API: `POST fuse/allocate` and `POST fuse/commit` open and commit positions, `GET proofs/<digest>` and `POST proofs/batch` read, `verify` checks, `ceilings/*` serve ceilings and settlement, `POST recovery`, `GET recovery/<address>` and `POST recovery/lookup` are the recovery service (SPEC section 13), `explorer` and `ledger` feed the earlier anchors page. |
| `public/spec` | `SPEC.md`, served at `/spec/SPEC.md`: the exact text every tree/1 proof pins (version 1, frozen 2026-10-04). The SDK copies it beside each export only when its hash matches the pin. |
| `src/components` | The drop box and its results (`bitgraph-camera.tsx`, the file keeps its old name), the folder check (`folder-list.tsx`, `tree-export-list.tsx`), the earlier anchors explorer, the figures. |
| `src/lib` | Client and server helpers: the tree/1 make (`fuse-tree-make.ts`), exports, the recovery store and queue, the S3 reader, the hosted MCP, the download package layout, formatting. |
| `src/app/globals.css` | Every token and rule. Colours are tokens; the type ladder is enforced at the end of the file. |

## What it talks to

The enclave (v10) binds the newest Base block into each position, from a header the host reads from Base and the enclave hashes and checks itself, and signs through the commit service; nothing is written to a chain for the floor. The Base ceiling writer puts a Merkle root over new records on Base. Proofs, floor headers, earlier Ethereum anchors and recovery entries are read from BitGraph's copy in S3. None of it is needed to verify a BitGraph you hold: verification runs offline from the file and its export, or from a BitGraphed file, through [`@mikeargento/bitgraph-verify`](https://www.npmjs.com/package/@mikeargento/bitgraph-verify).

The protocol, the trust model and the proof format are explained at [bitgraph.ing/docs](https://bitgraph.ing/docs), and the repository as a whole is described in the [root README](../README.md).

## License

Copyright 2024-2026 Argento Computing Inc. All rights reserved. Patent Pending. Source-available, not open-source: see [LICENSE](../LICENSE).
