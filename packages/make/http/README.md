# BitGraph in Make with HTTP modules

This is the path that works today with no custom app, no review, and nothing
installed. Everything below uses Make's built-in **HTTP** and **Tools** modules
against the existing BitGraph API.

It works because of one fact about Make: its built-in
`sha256(text; [encoding])` supports **base64** output, and base64 of the raw
32 digest bytes is exactly the form `/api/commit` accepts. So Make can compute
the digest itself and there is no encoding gymnastics and no API change.

That is also what keeps the privacy property intact. The hash is computed
inside Make, and only the hash is sent. **The file's contents never reach
BitGraph.**

## The three expressions everything is built from

Given a file's binary data mapped as `1.data` (from Google Drive, Dropbox,
HTTP, or any module that outputs a file):

| What | Expression |
|---|---|
| Digest, base64 (for `/api/commit`) | `{{sha256(1.data; "base64")}}` |
| Digest, URL-safe (for lookup URLs and proof links) | `{{replace(replace(replace(sha256(1.data; "base64"); "/\+/g"; "-"); "/\//g"; "_"); "/=+$/g"; "")}}` |
| Proof page URL | `https://bitgraph.ing/proof/` + the URL-safe form |

Put the URL-safe form in a **Tools > Set variable** step named `digest` and
reference it as `{{3.digest}}` afterward, rather than repeating that
`replace` chain in every module.

Verified against production: the example file `preston.jpg` (4,609,150 bytes)
hashes to `mYNezUiNnzhS3V0xqDsGUWCg2ZsKshiftAI016JPBUc=`, whose URL-safe form
`mYNezUiNnzhS3V0xqDsGUWCg2ZsKshiftAI016JPBUc` resolves to proof `#7910`.

## Module 1: check whether it is already recorded

Re-running a scenario over the same file must not record it twice. A second
recording is a second causal position and means something different from the
first, so it should be deliberate.

**HTTP > Make a request**

- **URL** `https://bitgraph.ing/api/proofs/digest/{{3.digest}}`
- **Method** `GET`
- **Parse response** yes

Then add a **Filter** on the connection to the next module:

- Condition: `{{length(4.data.proofs)}}` **equal to** `0`

Only files with no proof continue to the recording step.

## Module 2: Create BitGraph

**HTTP > Make a request**

- **URL** `https://bitgraph.ing/api/commit`
- **Method** `POST`
- **Headers**
  - `Content-Type: application/json`
  - `Authorization: Bearer <your API key>`
- **Body type** Raw, **Content type** JSON
- **Request content**

```json
{
  "digests": [{ "digestB64": "{{sha256(1.data; \"base64\")}}", "hashAlg": "sha256" }],
  "chainId": "bitgraph:main"
}
```

Add `"attribution": { "name": "..." }` for a self-attributed submitter's note.
It is stored inside the signed proof, bound cryptographically but not checked,
and shown as a note rather than as verified identity.

The response is an **array** of proofs. Reference the first as `{{5.data[1]}}`
(Make collections are 1-indexed):

| Field | Path |
|---|---|
| `artifactHash` | `{{5.data[1].artifact.digestB64}}` |
| `counter` | `{{5.data[1].commit.counter}}` |
| `epochId` | `{{5.data[1].commit.epochId}}` |
| `chainId` | `{{5.data[1].commit.chainId}}` |
| `proofHash` | `{{5.data[1].proofHash}}` |
| `proofUrl` | `https://bitgraph.ing/proof/{{3.digest}}?counter={{5.data[1].commit.counter}}` |

## Module 3: Verify BitGraph

**HTTP > Make a request**

- **URL** `https://bitgraph.ing/api/verify`
- **Method** `POST`
- **Body type** Raw, JSON

```json
{ "digest": "{{sha256(1.data; \"base64\")}}" }
```

Returns `verified`, `status`, `reason`, `artifactBinding`, `onRecord`, and the
whole proof. Read `artifactBinding` carefully: `checked` means the file was
hashed and matches the proof, `not-checked` means the proof is genuine but
nothing tied it to a file, `mismatch` means the proof is genuine and is for
different bytes.

To verify a proof you are carrying rather than whatever the ledger holds, send
`{"proof": {{6.data.proof}}, "digest": "..."}`.

To reject anything not signed by a specific enclave build, add
`"allowedMeasurements": ["<PCR0>"]`.

## Module 4: Retrieve Proof

**HTTP > Make a request**

- **URL** `https://bitgraph.ing/api/proofs/digest/{{3.digest}}`
- **Method** `GET`

Add `?counter=&epoch=` to pin one causal position when the same bytes have
been recorded more than once. Without them you get the earliest, that is the
originating, position.

The two-sided Ethereum time bracket is here and nowhere else:

| Reading | Path |
|---|---|
| BitGraphed **after** (lower bound) | `{{7.data.causalWindow.anchorBefore.blockTime}}` |
| BitGraphed **before** (upper bound) | `{{7.data.causalWindow.anchorAfter.blockTime}}` |

Note the inversion, because getting it backwards inverts every statement built
on it: `anchorBefore` is the **earlier** Ethereum block, so it is the moment
the file was BitGraphed *after*.

## Two things that will bite otherwise

**A fresh proof has no upper time bound yet.** BitGraph proofs contain no clock
reading at all. Time comes from the two Ethereum blocks that bracket the
recording, and the later one lands with the next anchor, usually within a
minute. Right after recording, `anchorAfter` is `null`. If your scenario posts
a timestamp to Slack, either use the lower bound and say "after", or add a
**Sleep** and re-run Retrieve Proof.

**HTTP 503 with `"code": "tee-restarting"` is not an error to alert on.** The
boundary restarts once a day for epoch rotation and holds recordings until the
new epoch's first Ethereum anchor lands. Nothing is minted when that happens,
so the safe handling is a Make **error handler** with **Retry** after a minute.
The same applies to 429.

## Blueprints

`blueprints/` holds importable scenarios. They are a starting point rather than
a validated artifact: they were written against Make's documented blueprint
format but have not been imported into a live Make organization, so treat an
import error as expected and fall back to building from the module settings
above, which are exact.
