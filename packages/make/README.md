# BitGraph for Make

Two paths, in the order you should use them.

**`http/`** works today. Make's built-in HTTP and Tools modules against the
existing BitGraph API, no custom app and no review. Start here.

**`app/`** is a scaffold for a native BitGraph app, so the three operations
appear in Make's app list as ordinary modules instead of raw HTTP calls.

Both preserve the property that matters: **the file's contents never reach
BitGraph.** Make hashes the file itself and only the 32-byte digest is sent.

## Why the HTTP path works at all

Make's built-in `sha256(text; [encoding])` supports **base64** output, and
base64 of the raw digest bytes is exactly what `/api/commit` accepts. So Make
can produce the digest natively:

```
{{sha256(2.data; "base64")}}
```

This was the open question for the whole Make integration, and it settles it.
No hex-to-base64 conversion, and no API change was needed to support Make.
Verified end to end against production: `preston.jpg` (4,609,150 bytes) hashes
to `mYNezUiNnzhS3V0xqDsGUWCg2ZsKshiftAI016JPBUc=`, which resolves to proof
`#7910`.

See [http/README.md](http/README.md) for exact module settings.

## The native app

```
app/
  base.json                       baseUrl, shared error messages, log sanitization
  connection/
    parameters.json               the API key field
    communication.json            credential test
  modules/
    create-bitgraph/              communication, parameters, interface, samples
    verify-bitgraph/
    retrieve-proof/
```

Paste each file into the matching tab of Make's app editor
(developers.make.com). The JSON follows Make's documented block structure.

Modules are named and shaped to match the Zapier connector field for field, so
`artifactHash`, `counter`, `epochId`, `chainId`, `bitgraphedAfter` and the rest
mean the same thing on both platforms and in the API.

### Status: scaffold, not validated

Written against Make's published documentation for
[base](https://developers.make.com/custom-apps-documentation/app-components/base.md),
[connections](https://developers.make.com/custom-apps-documentation/app-components/connections/basic-connection.md),
and
[action modules](https://developers.make.com/custom-apps-documentation/app-components/modules/action/components.md),
but never loaded into a Make organization, which needs a Make account. Expect
to fix small things in the editor. Three specifically:

1. **The two-request Create module.** `create-bitgraph/communication.json` is
   an array: first a lookup, then a conditional commit, so that re-running a
   scenario over the same file does not record it twice. This depends on a
   skipped conditional request leaving the first request's `output` intact.
   **Confirm that behaviour before trusting it.** If it does not hold, drop the
   second request and use the filter pattern from `http/README.md` instead,
   which is guaranteed correct. Getting this wrong means silent duplicate
   recordings, and recordings are permanent.
2. **Array indexing.** `/api/commit` returns an array; the module reads
   `{{body[1]}}` on the basis that Make collections are 1-indexed.
3. **The `buffer` parameter type** for the File input, and that
   `sha256(parameters.data; "base64")` accepts a buffer. The documentation
   confirms base64 output and that `length()` takes a buffer, but does not
   state outright that `sha256` takes one.

### Before submitting for review

`API_KEYS` must be set on the TEE parent. It is currently unset, so the
boundary accepts any bearer token and, more importantly, nobody receives the
rate-limit exemption a key is meant to buy. Every Make customer's traffic
leaves through shared egress addresses, so without working keys they all
compete for one per-IP bucket of 5000 digests refilling at 20 per minute.
See `server/commit-service/src/parent/rate-limit.ts`.

## Endpoints used

| Operation | Call |
|---|---|
| Create BitGraph | `POST /api/commit` |
| Verify BitGraph | `POST /api/verify` |
| Retrieve Proof | `GET /api/proofs/digest/{urlSafeDigest}` |
| Check on record | `GET /api/proofs/digest/{urlSafeDigest}` |

`/api/verify` was added for this work. It is the one thing Make genuinely could
not do for itself: a scenario built from HTTP modules cannot run the
`@mikeargento/bitgraph-verify` npm package, so without a server-side verifier
Make could record and retrieve but never check. The endpoint delegates to that
same MIT package rather than reimplementing anything, and its response says
plainly that a verdict from the issuing service is a convenience rather than
evidence, returning the whole proof so anyone can redo the check offline.

## Handling the two retryable failures

`503` with `"code": "tee-restarting"` is the daily epoch rotation: the boundary
restarts once a day and holds recordings until the new epoch's first Ethereum
anchor lands. `429` is the rate limiter. **Neither mints anything before
rejecting**, so both are safe to retry, and a Make error handler with Retry is
the right response to each. Treating them as failures turns a one-minute daily
window into a broken scenario.

## License

MIT. Copyright (c) 2024-2026 Mike Argento. The BitGraph protocol is patent
pending; these connector definitions are licensed for use, the protocol
implementation they talk to is not.
