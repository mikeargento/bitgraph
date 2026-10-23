# Base floor (enclave v10): release and cutover

Branch `base-floor`. Everything below the line "built and tested" in the session notes is in the
branch; this file is the order the irreversible steps happen in, and who does each. Nothing here
has been run against production.

## Why the order is fixed

- The website installs `@mikeargento/bitgraph` and `@mikeargento/bitgraph-verify` from npm, so the
  packages are published before `main` is pushed, or the Vercel build fails.
- The enclave image contains `packages/verify` (the core library re-exports it), and
  `packages/verify/src/tree.ts` pins SPEC v2's hash. So SPEC v2 is frozen BEFORE the image is
  built, and the image's own PCR0 is published AFTER (it cannot be inside the image or the spec).
- The site must accept both floors before the enclave starts making Base ones: every change on the
  branch reads either floor, and the parent sends Base headers only when `BASE_FLOOR=on`, which an
  older enclave ignores.

## Steps

1. **Mike: read SPEC v2** (`spec/SPEC-v2.md`). Any edit changes its hash; after an edit run
   `node spec/pin-hash.mjs`, copy it to `website/public/spec/SPEC-v2.md`, and rerun the tests.
2. **Freeze SPEC v2**: add a `v2` entry to `spec/FROZEN.json` (sha256_b64 as `pin-hash.mjs` prints,
   frozen_on, frozen_at_commit). From then on `pin-hash.mjs` refuses to move it.
3. **Tag the source** `enclave-v10` on the commit that freezes SPEC v2, and push the branch and the
   tag (not `main`): `git push origin base-floor enclave-v10`.
4. **Host: build v10** from the tag in `/home/ec2-user/bitgraph-build` (`git fetch --tags && git
   checkout enclave-v10`), with a copy of the v9 build script renamed for v10; reproduce PCR0 at
   least twice. Stage the EIF beside the v9 one. Do not switch the cycle script yet.
5. **Pins commit** (local, on the branch): the v10 PCR0 into `packages/verify/src/measurements.ts`
   (`PUBLISHED_ENCLAVE_MEASUREMENTS`), the player's `KNOWN_ENCLAVE_MEASUREMENTS`, `PINS.md`,
   `/docs/self-host-tee`, and a rebuilt `website/public/verify.html`. Run the full tests.
6. **Mike: publish** (each ends in a browser auth step; wait for `+ pkg@ver`), in dependency order:
   verify 1.17.0, core (`@mikeargento/bitgraph`) 1.12.0, audit 0.10.0, player 0.16.0, sdk 0.5.0, mcp 0.10.0.
7. **Lockfile and site deps**: `npm install` at the root (refreshes package-lock.json against the
   published versions), `cd website && npm install` (the ranges are already bumped). Root `npm test`
   and the website tests, then merge `base-floor` into `main` and push. Vercel deploys the site;
   Railway redeploys the anchor service with the stream still ON (no `ANCHOR_STREAM` set).
   The live enclave is still v9: nothing changes for users yet.
8. **Host: parent patch** (never `git pull` on the host): `git diff` of
   `server/commit-service/src/parent/{server.ts,base-head.ts,vsock-client.ts,ceiling-queue.ts}`
   against the host checkout, applied as a patch; `./node_modules/.bin/tsc -p tsconfig.parent.json`;
   set `BASE_FLOOR=on` and `BASE_FLOOR_RPC_URLS=https://mainnet.base.org,<a second Base RPC>` in the
   parent's unit; restart the parent (the epoch stays). Check: the parent log says "Base floor
   enabled", and `base-floors/` objects appear in S3 only after v10 is running.
9. **Host: ceiling writer**: rebuild (`npm run build:ceiling`) with the floor-chain change
   (`src/ceiling/{base-chain.ts,writer.ts}`) and restart `bitgraph-ceiling.service`.
10. **Cutover at 23:59 UTC**: point `/usr/local/bin/bitgraph-epoch-cycle.sh` at the v10 EIF (keep a
    backup), let the nightly cycle run (or run it by hand on Mike's word). Check `/key` shows a
    fresh epochId AND `"floor": "base"`.
11. **One proof, on Mike's go**: make one record, open its proof page: three rows (Base floor,
    recorded, Base ceiling), the package README names the Base block, `bitgraph verify` on its
    export is TRUE, the floor confirms on Base by number.
12. **Anchor stream off** (after a quiet day): set `ANCHOR_STREAM=off` on the Railway service
    `BitGraph`. Setting it back restarts anchoring; v10 still accepts anchor claims.

## Still outside the branch

- Terms and privacy pages (anchors named in sections 2, 3, 5, 7 of the terms; privacy lines on
  Ethereum anchors and Railway): counsel.
- `website/public/example/bitgraph-demonstration*`: recorded files with Ethereum floors; re-record.
- CANON (`occ/CANON.local.md`, untracked): sections 3.4 to 3.6 and the anchor rules, Mike's rulings
  of 2026-10-06 (the position is the floor in order; the next BitGraph replaces the ceiling in
  position; Base floor and ceiling).
