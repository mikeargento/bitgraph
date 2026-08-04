# BitGraph for Zapier

A Zapier integration for BitGraph. It adds three steps to any Zap:

- **Create BitGraph** takes a file and records it, returning a proof.
- **Verify BitGraph** checks that a file matches its proof and that the proof is genuine.
- **Retrieve Proof** looks up an existing proof by file, digest, or BitGraph number.

Together they make BitGraph an ordinary step in ordinary business workflows:

```
Google Drive (new file) -> Create BitGraph -> Google Drive (write proof URL back)
DocuSign (envelope completed) -> Create BitGraph -> Salesforce (attach proof)
Dropbox (new file) -> Create BitGraph -> Slack (post the causal window)
```

## What this package is, and is not

It is an adapter. Every protocol behaviour lives behind the hosted API at
bitgraph.ing, inside the enclave: slot allocation, Ed25519 signing, epochs,
counters, and Ethereum anchoring. This package allocates nothing, signs
nothing, and constructs no proofs.

The one computation it does perform is SHA-256 of the caller's bytes, and that
is the point rather than an exception. **A file's contents are never sent to
BitGraph.** The file is hashed inside the Zapier step, the bytes are discarded,
and a 32-byte digest is what travels. Zapier itself does hold the bytes, since
it is what fetched them from Drive or Dropbox, but they go no further.

Verification is the same principle. It runs inside the step using
`@mikeargento/bitgraph-verify`, the MIT-licensed verifier anyone can run
offline, rather than asking a server for a verdict. A verification that
consists of a service saying "trust me" is worth much less than one you perform
yourself.

## Layout

```
src/
  index.ts                    app definition
  authentication.ts           API key connection and its test
  lib/
    digest.ts                 encoding + streaming SHA-256, the only place bytes are touched
    client.ts                 HTTP client over the existing endpoints
    fields.ts                 proof -> flat Zap output fields
    types.ts                  wire types
    sample.ts                 editor samples, taken from the real public example proof
  creates/create-bitgraph.ts
  creates/verify-bitgraph.ts
  searches/find-proof.ts      Retrieve Proof, as a search so "find or create" works
test/
  fixtures/example-proof.json the real public example proof, used for verification tests
```

Only endpoints that already exist are used: `POST /api/commit`,
`POST /api/proofs/batch`, `GET /api/proofs/digest/{digest}`, `GET /api/search`.

## Running it

```bash
npm install
npm test
```

The suite is 48 tests. Most run against a scripted `z` with no network, six run
read-only against production to catch wire-shape drift. Skip those with
`BITGRAPH_SKIP_LIVE=1` when offline.

**No test may record anything.** The BitGraph ledger is S3 Object Lock
COMPLIANCE storage with ten-year retention and no deletes, so a test proof
would be permanent and unremovable. The live harness enforces this rather than
trusting it: its `z` throws if anything attempts `POST /api/commit`.

To exercise a step by hand against the real API:

```bash
npx --yes zapier-platform-cli@19.1.0 invoke search find_proof --inputData '{"digest":"mYNezUiNnzhS3V0xqDsGUWCg2ZsKshiftAI016JPBUc"}'
```

The CLI's binary is `zapier-platform`, not `zapier`, and it is run through
`npx` rather than installed here. See Deploying below for why.

`invoke create create_bitgraph` will mint a real, permanent proof. Point
`baseUrl` at a non-production boundary first, or use a file you genuinely want
on record.

## Deploying

Registered and pushed. App id `244638`, version `0.0.0`, state `private`.

The integration's icon is `assets/bitgraph-zapier-icon.png`: the site wordmark
in Acumin Pro 900 at `#111827`, the nav's own colour and `-0.02em` tracking,
1024x1024 on a transparent background as Zapier requires. It is uploaded by
hand in the Platform UI (gear icon beside the app name), not by the CLI. Note
that `website/public/logo.png` is the retired OCC mark from before the rebrand
and must not be used anywhere.

```bash
npm run login    # writes ~/.zapierrc, not in this repo
npm run push     # builds, then uploads
```

`.zapierapprc`, `.env`, `build/`, and the deploy key are gitignored. Nothing in
this package reads a credential from source.

Five things about this toolchain that are not obvious and cost time once:

- **`index.js` at the package root is MANDATORY, and `main` is ignored.** The
  generated `zapierwrapper.js` hardcodes `path.resolve(__dirname, 'index.js')`,
  so the deployed runtime always requires `/var/task/index.js` no matter what
  `package.json` `main` says. Delete that file and every call fails with
  `Cannot find module '/var/task/index.js'`, which the Zap editor reports as
  **"authentication failed"** — a packaging fault wearing a credentials
  costume. The same file also decides what gets uploaded: `push` traces
  requires with esbuild from the wrapper, whose require is built from a
  variable esbuild cannot follow, and the CLI only compensates by adding a root
  `index.js` when one exists. Without it the zip ships `definition.json`,
  `package.json`, `zapierwrapper.js` and `node_modules` and **no `dist/`**.
- ⚠️ **A correct-looking connection dialog is NOT evidence of a deploy.**
  `definition.json` uploads separately and is only data, so fields, labels and
  help text render perfectly while no executable app is present. Likewise
  `zapier-platform invoke auth test` runs the app **locally**; only
  `invoke -r` touches the Lambda, and it needs an `--authentication-id`, which
  only exists after a connection has been saved successfully. So the real
  smoke test is `unzip -l build/build.zip` — confirm `index.js` at the root and
  a non-empty `dist/` before believing a push.

- **The CLI's binary is `zapier-platform`, not `zapier`.** There is no npm
  package called `zapier`, so `npx zapier ...` fails with "could not determine
  executable to run".
- **The CLI is deliberately NOT a devDependency**, which is why the scripts
  invoke it through `npx --yes zapier-platform-cli@19.1.0` (pinned, but
  installed outside this tree). Adding it locally pulls in ~480 extra packages,
  and `push` copies the whole project to a temp directory, which then blows past
  macOS's `kern.maxfilesperproc` of 10240 and fails with `EMFILE`. Keeping
  `node_modules` at ~93 packages avoids it.
- **A new integration's first version must be `0.0.0`.** Zapier rejects any
  higher first version, one step at a time: `0.1.0` demands `0.0.x` exist, then
  `0.0.1` demands `0.0.0`. The app's version comes from this package.json.
- **While a version has no Zap users, `push` overwrites it in place.** Leave the
  package.json version alone and re-push; `versions` shows the same row with a
  new `Updated at`. This is what you want for a fix: bumping instead would leave
  anyone already connected on the old version until a separate `promote`, so a
  one-line correction would ship to nobody. Once a version has users, that stops
  being safe and the bump plus promote is the honest path.

`zapier-platform-core` must be pinned to an exact version, not a range, or
`validate` refuses to run.

## Verified against the deployed build

`invoke` runs the built app through the CLI's real machinery. Read-only calls
are safe to repeat:

```bash
npx --yes zapier-platform-cli@19.1.0 invoke auth test
```

Confirmed working: the connection test, `find_proof` (returns counter 7910, the
settled anchor window, and 9 causal positions for the public example), and
`verify_bitgraph` for both an on-record digest (`valid`, `artifactBinding:
checked`) and bytes never recorded (`not on record`, with the same field set
returned as nulls rather than a smaller object).

`create_bitgraph` is deliberately untested against production, because invoking
it mints a real, permanent proof.

## Connection

One field, an API key, sent as `Authorization: Bearer <key>` on writes only.
Reads are served from the ledger and take no credential.

The connection test posts an empty digest array to the real commit endpoint.
That passes through the identical auth check a real recording does and then
fails validation, so the credential is proven end to end while nothing can be
minted: the boundary checks the key before it looks at the body.

**Before public launch:** `API_KEYS` must be set on the TEE parent. It is
currently unset, which means the boundary accepts any bearer token, and more
importantly that no caller gets the rate-limit exemption a key is supposed to
buy. Since every Zapier customer's traffic leaves through Zapier's own egress
addresses, without working keys they all share one per-IP bucket of 5000
digests refilling at 20 per minute, and one busy account throttles everyone
else. See `server/commit-service/src/parent/rate-limit.ts`.

## Behaviour worth knowing

**Re-running a Zap does not double-record.** A file already in the ledger comes
back with its existing proof and nothing new is created. That matches the
product: a second recording is a second causal position and means something
different from the first. Turn on *Record Again If Already Recorded* when you
want that second position deliberately.

**A fresh proof has a lower time bound but not yet an upper one.** BitGraph
proofs contain no clock reading. Time comes from the two Ethereum blocks that
bracket the recording, and the later one lands with the next anchor, usually
within a minute. `bitgraphedAfter` is populated immediately, `bitgraphedBefore`
and `anchorSettled` fill in shortly after. Use *Retrieve Proof* later to pick
up the settled window.

**The daily epoch rotation is a retry, not a failure.** The boundary restarts
once a day and holds commits until the new epoch's first anchor lands. Nothing
is minted when that gate fires, so the step raises a throttle and Zapier
re-runs it by itself.

**Every outcome returns the same output keys.** A file that is not on record
returns the full field set with nulls rather than a smaller object, so a Zap's
field mapping cannot break on an unexpected outcome.

## Output fields

`artifactHash` (and `artifactHashHex`, `artifactHashUrlSafe`), `proofUrl`,
`counter`, `slotCounter`, `epochId`, `chainId`, `proofHash`, `publicKey`,
`signature`, `enforcement`, `measurement`, `attestationFormat`,
`bitgraphedAfter`, `bitgraphedBefore`, `bitgraphedAfterBlock`,
`bitgraphedBeforeBlock`, `causalWindow`, `anchorSettled`, `totalPositions`,
and the whole proof object under `proof`, passed through verbatim because a
reshaped proof no longer verifies.

Verify adds `verified`, `status`, `reason`, `onRecord`, `artifactBinding`, and
`checkedAgainst`.

`artifactBinding` is worth reading carefully. `checked` means the file was
hashed and its digest matches the proof. `not-checked` means the proof is
genuine but nothing tied it to a particular file, which is what you get when
you supply a proof without a file. `mismatch` means the proof is genuine and is
for different bytes.

## License

MIT. Copyright (c) 2024-2026 Mike Argento. The BitGraph protocol is patent
pending; this connector is licensed for use, the protocol implementation it
talks to is not.
