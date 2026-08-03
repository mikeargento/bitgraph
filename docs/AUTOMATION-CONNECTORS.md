# Automation connectors

BitGraph reaches three audiences through one backend.

| Surface | Audience | Where |
|---|---|---|
| HTTP API | developers | `bitgraph.ing/api/*` |
| MCP | AI clients | `packages/mcp/` (stdio), `website/src/app/mcp/` (remote) |
| Zapier and Make | no-code business automation | `packages/zapier/`, `packages/make/` |

They record to the same ledger, so a file recorded by a Zap is the same proof a
developer or an agent finds, at the same causal position, verifiable by the
same offline verifier.

## The rule every connector follows

**Connectors are adapters. Protocol behaviour stays behind the API.**

Slot allocation, Ed25519 signing, epochs, counters, chain hashing, and Ethereum
anchoring all happen inside the enclave. No connector reimplements any of it,
and none ever should: a second implementation of the protocol is a second thing
that can be wrong, and the whole value of a proof is that exactly one thing
produced it.

The single computation a connector does perform is SHA-256 of the caller's
bytes. That is not an exception to the rule, it is the reason the rule can hold
at all: **the hash must be computed on the caller's side, because the file's
contents never reach BitGraph.** Only 32 bytes of digest travel.

This is why there is no `fileUrl` parameter anywhere in the API, and why there
should not be one. An endpoint that accepted a URL and hashed the file
server-side would make every connector trivial to write, and it would end the
property that makes the connectors worth having.

## What each platform needed

**Zapier** is a Node app, so it hashes the file as it streams and uses the
canonical MIT verifier in-process. Verification never asks a server for a
verdict.

**Make** turned out to need almost nothing, because Make's built-in
`sha256(text; "base64")` emits base64 of the raw digest, exactly the form
`/api/commit` accepts. A Make scenario built from HTTP modules can record and
retrieve today with no custom app and no API change.

The one thing Make could not do for itself was verify: a scenario has no way to
run an npm package. That is what `POST /api/verify` was added for, and it is
the only API addition this work required. It delegates to
`@mikeargento/bitgraph-verify` rather than reimplementing anything, so the
endpoint and the published verifier cannot drift apart, and its response states
plainly that a verdict from the issuing service is a convenience rather than
evidence. It returns the whole proof so anyone can redo the check offline.

An earlier plan to accept hex digests on the commit path was dropped once Make
turned out to emit base64 natively. Changing the most safety-critical route for
a convenience nobody needed would have been unjustified risk.

## Shared vocabulary

Output fields carry the proof's own field names on every platform, so the same
word means the same thing in a proof, a Zap, a Make scenario, and the API:
`artifactHash`, `counter`, `slotCounter`, `epochId`, `chainId`, `proofHash`,
`measurement`, `enforcement`.

Two names deliberately depart from the API's internals:

- **`bitgraphedAfter` / `bitgraphedBefore`** rather than the API's
  `anchorBefore` / `anchorAfter`. The API's `anchorBefore` is the *earlier*
  Ethereum block, so it is the moment the file was BitGraphed *after*. Carrying
  the internal names outward would invert the meaning for everyone downstream.
- **`artifactBinding`** is reported separately from `verified`, because "this
  proof is genuine" and "this file is the one the proof describes" are
  different claims. A workflow acting on the first while believing the second
  is the failure mode worth designing against.

## Two failures that are not failures

**`503` with `"code": "tee-restarting"`** is the daily epoch rotation. The
boundary restarts once a day and holds recordings until the new epoch's first
Ethereum anchor lands, so that no proof is ever minted without a same-epoch
lower bound.

**`429`** is the digest-denominated rate limiter.

Neither mints anything before rejecting, so a retry cannot double-record. Both
connectors surface them as retryable rather than as errors: Zapier raises
`ThrottledError` and re-runs the step by itself, Make uses an error handler
with Retry.

## Recordings are permanent

The ledger is S3 Object Lock COMPLIANCE storage, ten-year retention, no
deletes. Consequences that shaped both connectors:

- Neither records a file that is already on record unless asked to. A re-run of
  a workflow is safe by default.
- A partial or unconfirmed commit is reported as a failure, never as success.
  Claiming a recording that cannot be confirmed is worse than failing.
- After a successful recording, enrichment failures do not fail the step.
  Failing at that point would push a user to re-run and mint a second position
  for the same bytes.
- No test in either package may record. The Zapier live suite enforces this
  structurally: its HTTP client throws if anything attempts `POST /api/commit`.

## Before either goes public

`API_KEYS` is unset on the TEE parent, so the boundary currently accepts any
bearer token and nobody receives the rate-limit exemption a key is meant to
buy. Both platforms send all customers' traffic through shared egress
addresses, so until keys are enforced every user of either connector competes
for a single per-IP bucket of 5000 digests refilling at 20 per minute. Setting
`API_KEYS` is a launch prerequisite, not a hardening step.

See `packages/zapier/README.md` and `packages/make/README.md` for how to run,
test, and deploy each.
