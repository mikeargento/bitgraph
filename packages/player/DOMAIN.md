# BitGraph Domain

A BitGraph Domain is a party's own domain publishing the keys that record
for it. A reader pins the domain once; `bitgraph-play check --from
<domain>` then answers offline, from the export in hand and the pin on
disk, whether a file holds a recorded position under a key the domain
published.

The domain's file is the party speaking for itself, never BitGraph
speaking about the party. A proof carries a key and nothing else. Which
domains to pin, and what to make of them, belongs to each reader; a
domain's file is one source among any number, never an authority.

## The file: `bitgraph-domain/1`

Served over HTTPS at `https://<domain>/.well-known/bitgraph`, at most
64 KiB:

```json
{
  "version": "bitgraph-domain/1",
  "domain": "acme.com",
  "party": "Acme Corp",
  "keys": {
    "invoices": { "alg": "es256",   "publicKey": "<SPKI DER, base64>" },
    "press":    { "alg": "ed25519", "publicKey": "<raw 32 bytes, base64>" }
  }
}
```

- `version` is exactly `"bitgraph-domain/1"`. The discriminator field is
  `version`, as in `bitgraph/1` proofs, because `domain` is the file's own
  subject field. Unknown fields are a parse error; additions are a new
  format version.
- `domain` is a lowercase hostname: no scheme, no port, no path. At pin
  time it must equal the domain the reader asked for, so a redirect cannot
  cause one party's file to be stored under another party's name.
- `party` is the name the domain gives itself. Display only; the domain is
  the binding.
- `keys` is a nonempty object. Names follow the trusted-key grammar of
  SPEC.md section 9.1 (`[A-Za-z0-9_.-]+`, at least one non-digit, unique),
  and each entry is exactly a section 9.1 trusted-key body: for `es256`
  the publicKey is SPKI DER in base64, the spelling actor proofs carry;
  for `ed25519` it is the raw 32-byte key in base64. An entry therefore
  pastes into a format 2 rule's `trustedKeys` unchanged.

A key's **fingerprint** is the lowercase hex SHA-256 of the decoded
publicKey bytes. For `es256` keys this is exactly the `keyId` actor proofs
carry. Fingerprints are always derived and never written in the file, so a
domain cannot claim a key it does not show.

## Pin

`bitgraph-play pin <domain>` fetches the file, prints the party and every
key's name, algorithm and fingerprint, and stores the file bytes verbatim
on the reader's machine after confirmation. Pinning is the only step that
touches the network, once per domain. Pinning again shows what changed,
added, removed or replaced keys, before asking again. `pin` alone lists
stored pins; `pin --forget <domain>` removes one.

A malformed file is refused at the pin, so a check never reads a bad one.
`check --from` never fetches; `--from` naming a domain with no stored pin
is an invocation error (exit 3) whose remedy is the pin command, because a
reader's missing setup is not evidence and gets no verdict.

## The domain line

With `--from <domain>`, one line joins the check report for each
recording.

TRUE when the recording verifies and either

- its actor's `keyId` equals the fingerprint of an `es256` key in the
  pinned file, or
- a `bitgraph-sig/1` file among the bundle's candidate signature files
  (SPEC.md section 9.4) verifies over the recording's digest under any
  pinned key.

UNDETERMINED otherwise. **The domain line is never FALSE**, by the same
open-world rule as `signedBy` (SPEC.md section 9.3): domain evidence can
exist outside any bundle, so its absence contradicts nothing. Evidence in
hand that contradicts the recording itself already reads FALSE on the
existing lines; the domain line does not restate them.

An enclave epoch key listed in a domain's file matches nothing: it is not
an actor key, and the enclave never signs the domain-separated
bitgraph-sig message. Exit codes are unchanged; the line joins the
report's conjunction.

## What it establishes, and the cost

TRUE establishes that a key published by the domain stands behind a
recording of exactly these bytes at a fixed causal position. Not
authorship: anyone can record a file they downloaded, under any key they
hold. Not content. Not exclusivity: the same bytes may hold other
positions, under other keys or none. The statement is as strong as the
domain and the keys behind it: a stolen key keeps the domain's standing
until it is removed and readers pin again.

Publishing a key names it in public, retroactively: every recording the
key has ever made or will make reads as the party's, positions and volume
included, and pins outlive the file that provided them. Only digests
travel, so no content is exposed, and unpublished keys and anonymous
recordings are untouched. Publish keys dedicated to what you intend to
stand behind, named for their purpose. A published key is per purpose,
never per document: the per-document evidence is the signature each
recording already carries, and a pin only works because the keys it
stores outlive it. Attribution without public grouping is the other
posture, and it needs no domain file: record under an unpublished key and
hand the counterparty the evidence directly; they declare the key in
their own rule's `trustedKeys`.

## Relation to the specification

Evaluation semantics (SPEC.md sections 1 through 9) are untouched. The
domain file shares section 9.1's key grammar, section 9.3's open-world
rule and section 9.4's candidate discipline; `check` remains the section
8 convenience surface, and its report format adds the domain entry as
`bitgraph-check/2`.
