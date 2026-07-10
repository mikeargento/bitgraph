# Epoch Export: Integration Notes

Status: Informative (operator documentation)
Applies to: the bitgraph.ing epoch export route (`website/src/app/api/export/epoch/[epochId]/route.ts`) and its assembly library (`website/src/lib/export-epoch.ts`).

## 1. What the export produces

`GET /api/export/epoch/{safeEpochId}` streams a `bitgraph-bundle/1` archive named `bitgraph-epoch-{safeEpochId}.tar.gz`, conforming to the normative spec in [BUNDLE-FORMAT.md](./BUNDLE-FORMAT.md):

* every `bitgraph/1` proof of the epoch (user proofs and Ethereum anchor proofs interleave on one chain), in the ledger's stored form, at entry paths that mirror the ledger keys;
* a root `manifest.json` with the deterministic contents hash (spec section 8), per-partition counter ranges, and, for the currently minting epoch, an `openEpochs` snapshot declaration with the counter at snapshot time;
* no artifact bytes, ever. The ledger stores no artifacts; proofs are capability-gated by the file itself, which only its holder has. `artifactsIncluded` is always `false`.

A closed epoch exports completely and immutably. The current epoch exports as a labeled snapshot through the current counter; re-exporting later yields a longer snapshot of the same epoch.

Anyone can audit the download fully offline:

```
npx bitgraph-audit bitgraph-epoch-{safeEpochId}.tar.gz
```

## 2. The self-notarization hook, and why it is disabled

`notarizeArchiveHook(archiveSha256B64)` in `website/src/lib/export-epoch.ts` is exported but deliberately disabled: it throws unconditionally, and no code path calls it.

The idea it reserves: after exporting an epoch archive, commit the archive's own SHA-256 through the live bitgrapher. The archive then becomes a committed fact in the causal chain, so any later dispute about what the operator exported ("did this bundle exist in this exact form by anchor block N?") is answerable with an ordinary BitGraph proof over the archive bytes.

Why it must stay disabled by default:

* Committing mints a permanent proof. The production ledger (`occ-ledger-prod`) is S3 Object Lock COMPLIANCE with 10-year retention; nothing written there can be removed.
* An automated hook would mint one proof per export request, including every crawler hit, retry, and test, permanently.
* Notarization is an operator statement ("I published this archive"), and statements should be deliberate. A manual act, one archive at a time, is the correct shape.

## 3. How the maintainer wires it (when deliberately chosen)

The hook rides the existing commit flow. The website's `/api/commit` route forwards `{ digests: [{ digestB64, hashAlg: "sha256" }], chainId: "bitgraph:main", attribution? }` to the live TEE and indexes the returned proof by digest, exactly like a user photo drop.

1. Replace the `throw` in `notarizeArchiveHook` with a POST to `/api/commit`:
   * `digests: [{ digestB64: archiveSha256B64, hashAlg: "sha256" }]`
   * `chainId: "bitgraph:main"`
   * `attribution: { name: "Epoch Export", message: "bitgraph-epoch-{safeEpochId}.tar.gz" }` so the proof is self-describing on its proof page.
2. Call the hook from the export route only behind an explicit operator control. Never on the plain GET path: a query parameter such as `?notarize=1` gated on a secret operator header is the minimum; an offline script the operator runs by hand against a downloaded archive is better, because it notarizes the exact bytes the operator holds.
3. Keep the closed-epoch requirement: only notarize archives of closed epochs. An open-epoch snapshot changes on every proof, so its hash is stale the moment the next commit lands.

## 4. Exercising it once, by hand

1. Bring the TEE online (the operator's "fire it up" runbook).
2. Download a closed epoch: `curl -fsSL -o epoch.tar.gz https://bitgraph.ing/api/export/epoch/{safeEpochId}`.
3. Audit it first: `npx bitgraph-audit epoch.tar.gz`. Do not notarize an archive that does not audit clean.
4. Compute the hash: `openssl dgst -sha256 -binary epoch.tar.gz | base64`.
5. Commit that digest through the normal flow (the home page drop zone accepts any file, including this archive; or POST to `/api/commit` as in section 3). This mints ONE permanent proof; that is the point, and also why this is a manual step.
6. Verify the round trip: look the archive up by its digest on the site (`/proof/...` via the file-check flow) and confirm the proof page shows the commit, its causal position, and the anchor window.
7. Record the archive filename, its SHA-256, and the resulting proof hash in the operator log. The archive plus that proof is now a self-contained "this export existed by then" package.

Until all of section 3 is deliberately implemented, the hook throws with a message pointing here, and tests or CI must never call it.
