# Statement of what did not change (deliverable 11)

Everything below is on the local branch `bitgraph-fuse` (worktree `occ-fuse`),
created from `main` at `442e2428`. Nothing was pushed, published, deployed,
or minted on the ledger.

- The enclave binary and its measurement: `server/commit-service/src/enclave/app.ts`
  and `server/commit-service/reproducible-build/` are byte-for-byte unchanged
  (`git diff main..bitgraph-fuse -- server/commit-service/src/enclave server/commit-service/reproducible-build` is empty).
  The local harness copies `app.ts` into an ignored build directory and patches
  only the NSM client and the listen call in the copy.
- The `bitgraph/1` schema: `packages/verify/src/types.ts` is unchanged; the
  verifier's `verify` and `verifyProofIntegrity` are unchanged; every fused proof
  is an ordinary `bitgraph/1` proof produced by the unchanged enclave path.
- Existing endpoints: `POST /commit` without `slotId`, `POST /challenge`,
  `GET /key`, `POST /verify`, `GET /health`, `/api/commit`, `/api/challenge`,
  every `/api/proofs/*` route and `/api/verify` keep their request and response
  shapes; the additions are optional fields (`slotId`, `kind`, `lookupKind`,
  `fusedDescendants`, `fused_descendants`) and new routes behind `FUSE_ENABLED`.
  `POST /allocate-slot` keeps its path and success shape and gains the key
  policy, a limiter, and a body.
- Existing fixtures: nothing under `src/__tests__/real-fixtures/` or
  `packages/player/src/__tests__/fixtures/` was modified; the Fuse fixtures are
  new files under `src/__tests__/fuse-fixtures/`.
- The Imran-facing package: nothing under `~/Desktop/imran/` or
  `~/Desktop/Claude Code/trace-binding/` was opened for writing; no file there
  has a modification time inside this session. The published tarballs verify
  1.3.0, audit 0.3.0, player 0.7.0 are still what the registry serves; the
  version bumps to 1.4.0, 0.4.0, 0.8.0 exist only on the branch.
- The `main` working tree and its uncommitted allocate-slot removal diff were
  not touched; `main` still equals `origin/main`.
