# BitGraph Fuse

Working name. Outwardly this is simply BitGraph: the same enclave, the same
proof format, the same slot-then-commit primitive, used by a producer that
asks for its slot before its artifact is finished. Profile identifier
`bitgraph-fuse/1`. Underlying proof format `bitgraph/1`, unchanged. Nothing
in the enclave, its measurement, its signing key, its counters, its
attestation, or the proof schema changes.

## Doctrine

Recorded BitGraph proves that exact bytes existed no later than their commit.
BitGraph Fuse creates a new artifact containing a commitment to a signed slot
allocation, then commits that artifact through the unchanged BitGraph primitive.
The fused bytes were therefore assembled after allocation and no later than
commit. For a file that already exists, the fused bytes are a rebuildable view
and the file itself receives only the ceiling; for a produced artifact, the
fused bytes are the artifact and the interval speaks for it. Fuse does not prove
when a source's content was created, whether it is authentic, or whether the
events it describes occurred.

## Trust

Fuse does not eliminate reliance on measured code. It narrows the freshness
reliance to the enclave generating the nonce freshly and not disclosing it
before the signed allocation, together with the existing signature, attestation,
hash, and single-use slot assumptions.

## Distinction

Never write "the only construction that dates an artifact from below."
Challenge-response and embedded public randomness also produce lower bounds. The
defensible distinction is the combination: a measured single-use allocation,
causal ordering against every other commit in the epoch, a matching commit
ceiling, and portable offline verification.

## The theorem

For a valid fused artifact F:

```
slot allocation < finalization(F) <= commit(F)
```

The four beats: nonce, fuse, hash, fill slot. Plain language: proof that the
nonce kissed the file, and that the file could not have been there before the
kiss.

What a valid Fuse proof establishes, assuming SHA-256 preimage resistance,
valid signatures and attestation, correct verification of the measured
enclave, and fresh nonce generation without disclosure before allocation:

- The fused bytes contain a value computationally dependent on the nonce and
  the exact signed slot record.
- The nonce did not exist before the enclave generated it for that allocation.
- Therefore the exact fused bytes could not feasibly have been finalized before
  allocation.
- The commit binds their digest at the commit position, so they existed by then.
- A supplied original that rebuilds the committed fused artifact byte for byte
  existed no later than the commit. An origin digest inside the fused bytes
  only shows consistency with the signed marker; it says nothing about the
  original until the original is supplied and rebuilt.

What it does not establish. Never state or imply that Fuse proves: the original
was created after slot allocation; the original's content is fresh, authentic,
truthful, unique, or first of its kind; who or what produced the original,
absent a separate authenticated producer mechanism; that work described by a
report occurred; that the operator did not know the origin digest before
allocation; a wall-clock upper bound (a later anchor is an assumption, never a
ceiling); that the original preceded the fused bytes in time (both may have
been produced inside the allocation-to-commit interval; strict order needs two
commits); anything about the Frame's outer whitespace or key order.

A twenty-year-old image fused today remains a twenty-year-old image. Fuse
proves that the fused bytes naming it were assembled today inside the proved
interval.

## Definitions

```
slotRecordHash = SHA256(canonical slot record body)                  32 bytes
slotCommitment = SHA256(UTF8("bitgraph-fuse/1") || 0x00 || slotRecordHash || nonce)
```

The canonical slot record body is the enclave's own signed subset (version,
nonceB64, counter, epochId, publicKeyB64, chainId when present; signatureB64
excluded), serialized by the verify package's canonicalize. There is exactly
one serialization of a slot record, and `slotRecordHash` equals the proof's
`commit.slotHashB64`. The domain is 16 bytes. The nonce is its raw 32 bytes.
The raw nonce never enters a fused file; a partially written file cannot be
used to claim the slot.

Canonical JSON: the verify package's canonicalize is RFC 8785-equivalent for
this schema (string-valued fields, ASCII keys, no numbers, no undefined). Form C
payloads carry digests as lowercase hex; the signed attribution carries the
origin digest in standard base64, the encoding every other digest field in a
proof uses.

## Placements

| id | form | byte-exact | bytes |
|---|---|---|---|
| `trailer/1` | A | yes | original, then `BGFUSE01`, 8 zero bytes, the 32-byte commitment. Safe only for formats that tolerate trailing bytes. |
| `container/1` | B | yes | uncompressed ustar: `bitgraph-fuse/manifest.json` (the Form C payload with the origin digest) then `bitgraph-fuse/original`; zeroed mode, uid, gid, mtime, names; two zero blocks. |
| `produced/1` | C | no | the canonical Form C payload itself: `{"origin":{...},"slotCommitment":{...},"type":"bitgraph-fuse/1"}`, origin omitted when there is no source. |

A verifier tries registered placements in that fixed order when none is
declared, and never an unregistered one. Metadata placements (XMP, PDF Info,
ID3, JSON field) are Form A too but enter the registry only once their
serialization is pinned and round-trip tested.

## The signed marker

The proof declares placement and origin in the attribution the enclave signs:

```
attribution.name    = "bitgraph-fuse/1"
attribution.title   = placement id
attribution.message = origin digest (standard base64); absent for Form C with no source
```

`attribution.name` is the profile id: the stable wire identifier of this
construction, ruled 2026-09-03. The nested proof remains an ordinary
`bitgraph/1` proof; `bitgraph-fuse/1` names the construction on the wire, not
a new proof format. A product name may change; the v1 wire identifier does
not.

The signature proves the enclave sealed the claim, not that the claim is true.
Reconstruction is the truth check: a false origin cannot yield bytes that hash
to the signed artifact digest.

## The public drop (ruled 2026-09-03, later)

The site's drop makes a fused artifact by default. The visitor's file is the
origin; it is never modified and never uploaded. In the browser: hash the
origin, allocate an unused slot through `/api/fuse/allocate`, derive the slot
commitment, build the fused bytes with the registered placement chosen from
the bytes (`trailer/1` for formats that ignore trailing data: JPEG, PNG, GIF,
TIFF and TIFF-based raws, BMP, RIFF such as WebP; `container/1` for everything
else: PDF, ZIP-based documents, ISO base media video and HEIC, Matroska, MP3,
structured and plain text, unknown formats), hash them, and consume that exact
slot through `/api/fuse/commit`. The fused bytes are transient: they exist in
memory until the visitor leaves or explicitly downloads them (the results
export includes the Frame and the fused copy; the proof page offers "Download
fused copy", rebuilt on the spot). The durable state is the original plus the
signed proof, whose attribution carries the placement id and the origin
digest; the same registered placement rebuilds the exact fused bytes from
those at any time, and verifying that reconstruction against the signed
artifact digest is the evidence.

Lookups work from either hash. Dropping the original finds its recordings and
every fused artifact that names it as origin, listed by position and
placement, never ranked; dropping the fused artifact finds its proof directly,
and its page shows the origin digest and the placement. A fused proof's page
accepts the original by reconstruction, so the visitor never has to keep the
fused copy. Ordinary recording remains as the compatibility operation ("Record
N files instead" on the results card, the API, MCP and Zapier): it selects
existing bytes and gives them a position; Fuse obtains an unused position
first, creates new bytes from the origin, then consumes that same position
with them. Files larger than 256 MB are recorded rather than fused, because
the fused bytes are built in memory. Existing proofs and old drops are not
reinterpreted. Form C (`produced/1`) is a producer operation of the SDK and
CLI, where the produced artifact is the substantive artifact and is kept.

## The Frame

The Frame is the shipped container. The offline verifier (`bitgraph-play check`, `verify.html`) reads the proof out of it from player 0.8.1 / audit 0.4.1 on; the site's drop reader and the CLI `check` always did.

`<original-basename>.bitgraph-fuse.json`:

```json
{
  "type": "bitgraph-fuse/1",
  "manifest": { "placement": "trailer/1", "origin": {...}, "artifact": {...}, "fusedFile": "..." },
  "fusePayload": { "...": "Form C payload view, when applicable" },
  "proof": { "...": "the bitgraph/1 proof, unchanged" }
}
```

The manifest is advisory. The Frame is never hashed as a whole and is never
proof-shaped, so every existing reader treats it as an ordinary file. A Frame
may be assembled later from retained evidence; that is retrieval, never a
retroactive commit.

## Verification

`verifyFuse({ proof, bytes, frame?, trustAnchors?, maxPositions? })` in the
MIT package `@mikeargento/bitgraph-verify` (1.4.0):

1. Verify the proof as an ordinary bitgraph/1 proof. Fail: `INVALID_UNDERLYING_PROOF`.
2. Hash the file.
3. Hash equals the artifact digest: `RECORDED` when nothing marks the proof
   fused; otherwise recompute the commitment from the proof's own slot record,
   locate it per the declared placement, compare: `FUSED_DIRECT` or
   `INVALID_SLOT_COMMITMENT`; a declared origin that contradicts the origin
   inside the bytes: `INVALID_ORIGIN_ATTRIBUTION`.
4. Hash equals the origin digest: rebuild the fused bytes from this file, the
   proof's slot record, and the placement; hash; compare: `FUSED_FROM_ORIGIN`
   or `RECONSTRUCTION_MISMATCH`.
5. Neither: `NO_MATCH`. The proof proves nothing about this file.

An unregistered declared placement is `UNDETERMINED_PLACEMENT`: a check that
cannot run is never a verdict. The span policy (`maxPositions`) is reported
separately and never changes a category. A Fuse failure is never reinterpreted
as a valid recorded proof.

The Player (`bitgraph-play check`, 0.8.0) adds a `fused` line per recording
and the floor: the timestamp of the last verified anchored block whose counter
precedes the SLOT counter in the same epoch chain, counter-order evidence. When
no anchor precedes the slot: "floor undetermined: no anchor precedes this slot
in its epoch." A following anchor is never a ceiling. The Player also requires
`slot.chainId` to be the anchored chain before comparing any anchor to the
slot; a slot on any other chain has no floor.

Statements, fused. The origin sentence depends on the path: the first below
only when the supplied file is the original and rebuilds the artifact
(FUSED_FROM_ORIGIN); the second only when the fused bytes were supplied and
carry an origin digest (FUSED_DIRECT):

```
The supplied original rebuilds the committed fused artifact byte for byte, so
these exact original bytes existed no later than commit position M.

The fused bytes carry an origin digest that matches the signed marker; the
original itself was not supplied and was not checked.

The exact fused bytes could not feasibly have been finalized before their signed
slot allocation at position N, which followed anchored block B (timestamp T),
and were committed no later than position M.
```

Strict ordering, where counters are comparable (same signer key, epoch, chain):
`commitCounter(A) < slotCounter(B)` implies fused artifact B was assembled after
artifact A was committed (`assembledAfterCommit`). An old pooled slot makes this
fail; it never produces a false positive. The origin digest alone does not
prove the original preceded the fused bytes; record the original first, then
allocate, for strict order.

## Producing

Service surfaces (all behind `FUSE_ENABLED`, on in production since 2026-09-03):

- Parent: `POST /allocate-slot` (metered per address in slots, sized to the
  120 s TTL; same key policy as `/commit`; chain pinned to `bitgraph:main`)
  and `POST /commit { slotId }` (one digest per held slot; a slot the enclave
  no longer has is `409 slot-unavailable`, never silently replaced).
- Site: `POST /api/fuse/allocate` (behind the anchor-first gate, refuses a slot
  from an epoch the gate did not approve) and `POST /api/fuse/commit`
  (position-aware gate: an anchor must precede the slot in its epoch; never
  returns a proof under a different slot; writes the by-digest index including
  the origin's descendants).
- Hosted MCP (`bitgraph.ing/mcp`): `bitgraph_open` and `bitgraph_commit`, the
  two site routes above for a caller that holds a file this endpoint never
  sees. Open takes the origin digest, size and first bytes and returns the
  slot's token and a recipe (the bytes the new file adds after or around the
  original, computed here from the digest, the size and the commitment);
  commit takes the token and the digest of the file the caller built. If a
  caller can hash the file it can build the virtual new file and hash that.
  `bitgraph_record` remains the compatibility recording of digests alone.

Posture (ruled 2026-09-03, revised the same day): allocation is the gated
parent route above, under the existing key mechanism and limiter; a commit
consumes the exact allocation that route returned, with no slot substitution
and no fresh allocation during commit; the commit path stays behind the
anchor-first gate. Fuse is ENABLED in production as the standard BitGraph
production path: `FUSE_ENABLED=true` on the parent and on the site, the
harness on behind its token, the edge rate-limit rule covering the two Fuse
routes. The parent's per-address allocation bucket is set no tighter than its
global window (250 per 120 s) because site traffic reaches it under the
proxy's egress addresses; per-user limiting is the edge rule's job.

SDK (in the core package `@mikeargento/bitgraph`, licensed): `fuse(builder, options)`: allocate, hand the
commitment to the builder, hash, commit under the same slot, verify the
returned proof locally, return the Frame. It refuses to commit bytes that do
not carry the commitment, refuses a proof under any other slot, and on a lost
or refused commit reads back by digest and matches `commit.slotHashB64` against
the held slot record; it never allocates again on its own. The raw nonce lives
in process memory only.

### Sets

A set is N files fused under one slot. The commitment is computed once from
the one slot record and written into every member by that member's own
placement (`trailer/1` or `container/1`, chosen from the bytes as today). The
committed artifact is the canonical set manifest, placement `set/1`: one row
per member holding the fused artifact digest, the origin digest and the
placement id, rows ascending by artifact digest, plus the commitment itself.
The signed attribution is name `bitgraph-fuse/1`, title `set/1`, and no
message, because a set has no single origin. The proof is an ordinary
`bitgraph/1` proof: one position, N files.

`fuseSet(members, options)` in the core package takes an array of members,
each an original (never modified) with an optional placement (default: chosen
from the bytes), an optional name (advisory; it names the virtual fused file)
and an optional builder. The options mirror `fuse()` (`agency`, `transport`)
with `keepFused` defaulting to false. Refused before any allocation: an empty
set, more than `MAX_SET_MEMBERS` (2000) members, a `produced/1`, `set/1` or
unregistered member placement, and the same original twice under the same
placement (the same original under two placements is two rows). Burns a slot
without committing: a member whose bytes do not carry the commitment or embed
an origin that is not its own, a builder failure, a refused commit. One
allocate, one commit, never a second allocation; a lost or refused commit is
read back by the manifest digest and matched on the held slot record. The
error codes are those of `fuse()`; a message about one member names that
member's index.

What comes back: the proof, the manifest bytes, the parsed manifest, the
manifest's digest (which is the artifact digest), and per member the origin
digest, the fused digest, the placement, the row's index in the manifest, the
virtual file names and the member's own verification, with the fused bytes
only when kept. Before anything is returned the manifest is verified
`FUSED_DIRECT` under `set/1` and every member `SET_MEMBER_DIRECT` against the
explicit manifest bytes. A proof that fails any check is not returned.

The echo. The commit sends the parsed manifest under
`proof.metadata["bitgraph-fuse/1"]`. Metadata is unsigned and advisory; a
reader trusts it only because its canonical bytes hash to the signed artifact
digest. No production boundary returns the echo today: the site's
`/api/fuse/commit` does not forward metadata, and the enclave's `commitDigest`
action (the one the parent uses for a held slot) drops it, so a set minted
through the default transport or parent-direct returns `manifestEchoed:
false`. The flag is true only against a boundary that mints from the received
body, which is what the SDK's own test harness does. Keep `manifestBytes`
beside the proof and pass them to `verifyFuseMember`; explicit bytes always
win over the echo. Forwarding metadata is a website and enclave decision
outside this phase.

Reading: `verifyFuse` answers for the manifest and `verifyFuseMember` for a
member or an original. Bytes that carry the commitment but are listed nowhere
are `SET_NOT_MEMBER`. Render the verifier's own statements; there is no new
bounded copy for a set.

Limits stated plainly. Building and hashing every member must finish inside
the 120 s slot TTL after allocation, and a miss is reported, never retried
into a new slot. Every member's fused bytes are held in memory until the
return-time verification (`container/1` doubles its original). That
verification runs `verifyFuseMember` once per member, and each run re-parses
the whole manifest, so its cost grows with the square of the member count:
under a second at 100 members, a few seconds at 500, and tens of seconds at
the cap of 2000. All of it happens after the commit, so the slot TTL is not
at risk and no slot is burned by it; a batch verifier is a later phase. A
failed member fails the set, and one refused commit burns one slot for the
whole set. There is no Frame for a set this phase: the proof, the manifest bytes
and the originals are the durable state. `produced/1` members and nested sets
are out of scope. A drop of a member's original does not find its set proof
on the site today: the descendant index reads `attribution.message`, which a
set does not carry.

In the harness, `bitgraph-fuse set <file>... [--out <dir>] [--keep]` mints a
set through `fuseSet` and writes `set.proof.json` beside `set.manifest.json`
(the manifest bytes exactly); under `--keep` two inputs that would be written
under the same fused name are refused before any allocation.
`bitgraph-fuse check <set.proof.json> <file> [--manifest <set.manifest.json>]`
runs `verifyFuseMember` when the proof is signed `set/1` and the file is not
the manifest itself.

### Harness

The site's `/fuse` page and `/api/fuse/harness` route (404 unless
`FUSE_ENABLED` and `FUSE_HARNESS_ENABLED` are set, and a shared
`FUSE_HARNESS_TOKEN`), which runs the same `fuse()` against the site's own
routes; plus the `bitgraph-fuse fuse|produce|check` command in the core
package for vectors from a shell. The website depends on the published core
package (`^1.2.0`, which brings verify 1.4.0); the earlier repo-root link
could not build on Vercel. Bounded copy, verbatim:

```
Original recorded
These exact original bytes existed no later than the commit.

Fused artifact created
These bytes were assembled after their slot allocation and committed at this position.
```

Never write: "causally fresh record for this file," "created after this time,"
"the content is fresh," "original," "authentic," "one of a kind," "impossible
to copy," or "the original came before the fused bytes" unless a separate
earlier commit proves it.

## Ledger

A fused proof is indexed under its artifact digest and, per position, under
its origin digest. A lookup by a file's hash returns the recordings of that
file first and then every fused artifact naming it as origin, labelled
`recorded` or `fused`, descendants unranked. A fused-only list means the origin
bytes themselves were never committed: `/api/verify`, the MCP tools and the
camera treat it that way.

## Limits stated plainly

The whole operation must complete inside the enclave's 120 s slot TTL, and an
enclave restart voids pending slots; a producer that misses the window
allocates again (new nonce) and re-fuses. A refused commit burns its slot. The
pending pool is shared with every commit, anchors included, which is why
allocation is metered. The anchor-first gate is a promise of the site's
surface, not a verifier invariant: a slot allocated host-direct before the
epoch's first anchor yields an undetermined floor, and the verifier says so.

In written copy reserve "measurement" for PCR0 and call the fused digest a
reproducible digest.
