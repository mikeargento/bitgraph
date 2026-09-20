# bitgraph.ing

The BitGraph website: the browser drop that makes a BitGraph, the proof pages, the Ethereum anchors page, the docs, and the hosted MCP endpoint at `/mcp`.

Next.js (App Router) on Vercel. It builds from this directory.

```bash
npm install
npm run dev     # http://localhost:3000
npm run build   # production build
```

Tests, from this directory:

```bash
npm run test:fuse      # fuse, sets, placements, scan hashing, anchors, local ledger
npm run test:mcp       # the hosted MCP server
npm run test:ledger    # the day/archive feed
```

## What is where

| Path | What it is |
|---|---|
| `src/app` | Routes. `page.tsx` is the home page, `proof/[digest]` a proof, `ledger` the Ethereum anchors, `docs/*` the documentation, `mcp` the hosted MCP endpoint. |
| `src/app/api` | The site's own API: `fuse/*` opens and commits positions, `proofs/*` and `verify` read and check, `explorer` and `ledger` feed the anchors page. |
| `src/components` | The drop and its results (`bitgraph-camera.tsx`), the folder check, the anchors explorer, the figures. |
| `src/lib` | Client and server helpers: fuse plumbing, the S3 reader, the hosted MCP, formatting. |
| `src/app/globals.css` | Every token and rule. Colours are tokens; the type ladder is enforced at the end of the file. |

## What it talks to

The enclave signs through the commit service; Ethereum anchors come from the anchor service; proofs and anchors are read from BitGraph's copy in S3. None of it is needed to verify a BitGraph you hold: verification runs offline from the record and its proof, through [`@mikeargento/bitgraph-verify`](https://www.npmjs.com/package/@mikeargento/bitgraph-verify).

The protocol, the trust model and the proof format are explained at [bitgraph.ing/docs](https://bitgraph.ing/docs), and the repository as a whole is described in the [root README](../README.md).

## License

Copyright 2024-2026 Argento Computing Inc. All rights reserved. Patent Pending. Source-available, not open-source: see [LICENSE](../LICENSE).
