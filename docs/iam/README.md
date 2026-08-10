# Ledger access, split by job

One AWS key did everything until 2026-08-10: the website's reads and the roll
archive's writes, with write permission across the whole of `occ-ledger-prod`.

That is worse than ordinary over-permission, because of what the bucket is.
`occ-ledger-prod` is **Object Lock COMPLIANCE, 10-year**. The lock stops
deletion and modification, including by the root account, which is exactly what
makes the ledger worth trusting. It does not stop *creation*. Anything written
into `proofs/` or `anchors/` by mistake or by a leaked key is therefore
permanent until 2036, by design and with no remedy.

So the writes are the risk, and only one job needs any.

## roll-archive-policy.json

For the nightly GitHub Actions job (`.github/workflows/roll-archive.yml`),
which rebuilds sealed days into display pages.

Derived from what `website/scripts/build-roll-archive.mjs` actually calls, not
from a guess:

| it does | where |
|---|---|
| `ListObjectsV2` | `anchors-by-time/`, `proofs/{epoch}/`, and a full-key prefix under `roll/v1/day/` (that is how `exists()` works) |
| `GetObject` | objects under those read prefixes |
| `PutObject` | `roll/v1/day/*` and nowhere else |

No `DeleteObject`: the job has never needed it. The script also refuses in code
to write outside `roll/v1/day/`, so the policy is the second of two locks, not
the only one.

Everything this key can write is derived, rebuildable from `proofs/`, and not
Object-Locked. The worst a leak does is corrupt pages that can be deleted and
rebuilt.

**If the job ever fails with AccessDenied on a list**, the `Condition` block is
the thing to suspect: it enumerates the three prefixes the builder walks today,
so a new prefix needs adding there. Removing the whole `Condition` block is the
safe fallback, since listing is read-only metadata.

## website-readonly-policy.json

For the key the site uses on Vercel. The website only ever reads: proof pages,
the Roll feed, by-digest lookups. It has no reason to hold `PutObject` on a
bucket where a stray write cannot be undone.

## Applying either

IAM → Users → create a user → attach as an **inline** policy → create an access
key. Nothing here is a secret; the keys themselves never belong in this repo.

For the archive job the two values go in as repository secrets,
`AWS_ACCESS_KEY_ID` and `AWS_SECRET_ACCESS_KEY`, and the workflow can be run
by hand to confirm before the next 00:20 UTC firing.
