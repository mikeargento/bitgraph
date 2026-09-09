# The Recorder — a desktop app that makes and checks BitGraphs

Status: **specification, nothing built.** Written 2026-09-08.

Mike's ruling that night, after building local-first in the browser and hitting
every wall it has: **the website becomes a spec and a software download. Every
interaction — making and checking — happens in the app.**

This document is what to build and, more usefully, what not to.

---

## 1. Why this exists

Local-first shipped in the browser on 2026-09-08 and works. It is also the
strongest argument for leaving the browser, because every problem it has is the
same problem:

| | browser | app |
|---|---|---|
| where the proof lands | Downloads, or a save dialog per make | beside the file |
| the `BitGraphs` folder | the user makes it by hand | it makes itself |
| pointing at a folder | impossible — a page cannot be told a path | a normal picker |
| updating the ledger | re-download the whole file | write in place |
| durability | **evictable** — `navigator.storage.persist()` returns `false` | ordinary files |
| files over 256 MB | **not fused at all** — degrade to digest-only | fused |
| a package | a zip you must unzip | a folder |
| making | a gesture you remember | a folder that is watched |

The measured one is the fifth row. `MAX_FUSE_BYTES` is 256 MB because the
browser must hold the whole file in memory to build the new bytes; past it
`fuseFile` throws `FuseTooLargeError` and the caller silently falls back to the
digest-only compatibility path. That is a **degraded product**, not a slow one,
and it is invisible to the person it happens to.

### What it is not

⚠️ **It is not Folder.** Folder is dead by ruling: the package was removed and
every release deleted over an RCE. See `project_folder_retired_2026_09_01`. The
name is **The Recorder** (`project_recorder_saas`).

⚠️ **Its attack surface is deliberately tiny.** It hashes bytes and speaks HTTPS
to one pinned host. It parses no untrusted input, renders no HTML, executes
nothing it downloads, and loads no plugins. Everything Folder grew that made an
RCE possible is out of scope forever.

⚠️ **No login, ever.** Standing ruling. Nothing here needs one.

---

## 2. The protocol is two calls, and a package already does them

Do **not** hand-roll the sequence. `@mikeargento/bitgraph` exports `fuse()`,
which orchestrates the whole thing (`src/fuse.ts:398`):

```
fuse(builder, { placement, original, fusedFile, keepFused, transport })
  1. allocateSlot(transport)            POST /api/fuse/allocate
  2. build the new bytes locally        original + the placement's carrier
  3. commit the artifact digest         POST /api/fuse/commit
```

Only two requests leave the machine, and **neither carries file content** —
digests, the slot record, and the placement id only.

### `POST /api/fuse/allocate`
Body `{}`. Returns the enclave's slot record (`nonceB64`, `counter`,
`epochId`, signature). Returns **503 `tee-restarting`** while the enclave is
rotating or before the epoch's first anchor has landed. That is not an error;
see §6.

### `POST /api/fuse/commit`
```
{ slot,                     the record from allocate, verbatim
  slotId,                   MUST equal slot.nonceB64
  digests: [ ... ],         the artifact digest(s), base64
  attribution: { name: "bitgraph-fuse/1",
                 title: <placement id>,
                 message?: <origin digest> },
  metadata?                 the set manifest, for a set }
```
Returns the signed proof.

### Placements
`placementFor(bytes)` chooses: a 48-byte **trailer/1** for JPEG, PNG, GIF,
TIFF and TIFF-based raws, BMP, WebP, WAV, AVI; a small tar **container/2**
(original first) for everything else.

### ⚠️ Language choice is load-bearing

`fuse()`, the placements, the set manifest and the verifier are TypeScript
packages that already exist and are already correct. A **Node/Electron** app
reuses them directly. A **Swift** app must reimplement the placement builders,
the canonical manifest encoding and the slot commitment — each of which has a
byte-exact contract that the published verifier enforces, and each of which has
already been got wrong once.

Recommendation: **Node core, native shell.** Reuse `@mikeargento/bitgraph` and
`@mikeargento/bitgraph-verify` verbatim; write only the watcher, the file
writing and the UI natively. A second implementation of the fuse pipeline is
how the old page generator drifted until it had to be deleted.

---

## 3. On disk

```
Photos 2024/                     the folder being watched
  IMG_4021.CR3                   untouched, always
  BitGraphs/
    IMG_4021.CR3.bitgraph        the proof, beside the file it is about
    _ledger.sqlite               positions, paths, anchor state
    _anchors/
      1546/anchor-before.json    per POSITION, not per file
      1546/anchor-after.json
      1546/anchor-*-witness.json
```

- **The original is never modified and never moved.** Standing rule.
- **The new fused bytes are NOT written.** They are virtual; the proof plus the
  original rebuilds them on demand (`rebuildFromOrigin`). This is settled —
  writing them doubles the folder for no gain.
- **A set is ONE position.** 48,000 files share one proof; the proof carries the
  manifest. Anchors are stored per position, never per member: a position's four
  anchor files are ~18.5 KB, so per-member would be 887 MB for one set.
- **The database is an index, never the authority.** The `.bitgraph` files are.
  Deleting the database must cost a rescan and nothing else.

---

## 4. Making

```
file appears in a watched folder
  → is its digest already in the ledger?      yes → stop. Nothing to do.
  → hash it (streaming, no full read into memory)
  → allocate a slot
  → build the new bytes for its placement (streaming)
  → commit the artifact digest
  → write <name>.bitgraph beside it, fsync
  → record the position in the index
  → queue the anchor fetch
```

⚠️ **The write is the commit's completion, not a step after it.** A proof that
was minted and not written is a consumed position with no evidence — the exact
loss the hosted ledger used to absorb. If the write fails, that is a **loud**
error, retried, and surfaced. Never a warning in a log.

⚠️ **Dedup is a convenience, not a rule.** Mike, 2026-09-08: losing dedup is a
*correction* — "a clock that ticks when you ask should tick every time you ask."
The check above exists so a watcher does not re-mint on every filesystem event,
not to prevent a person from deliberately making a second BitGraph. An explicit
"BitGraph again" must always be available.

### Batching
Files that arrive together become **one set under one slot** — one position for
all of them, each a member with its row. That is what a drop does today and what
an export from Lightroom should do. A debounce window (suggested 2s of quiet)
decides "together".

---

## 5. Anchors, later

The floor is inside the signed proof at commit time. The **upper bound is
deferred, never lost**: the counter is in the signed body and anchors are
permanent, so a proof made today completes in a year, and anyone holding it can
complete it.

```
every N seconds, for positions with no anchor-after:
  GET /api/proofs/anchors?counter=&epoch=          → the anchor
  GET /api/proofs/witness?block=&hash=             → its block header
  write into BitGraphs/_anchors/<counter>/
```

⚠️ **Both routes are keyed by COUNTER and BLOCK, never by digest.** That is
precisely why they survived the 2026-09-08 cutover when the by-digest index did
not. Nothing about the file is sent.

⚠️ **An absence must say which kind it is.** The route answers with a `bound`
state: `anchored` · `pending` (the epoch is open, one is coming) · `closed` (the
epoch closed without one; none will ever exist) · `none` (lower bound only,
permanent) · `unknown-epoch` · `undetermined`, and a read failure is a **503,
never an empty answer**. Write `anchors-status.json` whenever a side is missing,
saying why and when it was asked. "No upper bound was fetched" and "no upper
bound exists" are opposite claims and the folder must be able to tell them
apart — this is the single most repeated lesson in this codebase.

Back off when idle: anchors land every ~12s while the TEE is busy and up to an
hour when it is not.

---

## 6. Epoch rotation and retries

The enclave restarts daily (~23:59 UTC) with a new keypair and a counter reset.
During the window it returns **503 `tee-restarting`**, and it also returns that
before the epoch's first anchor has landed (the v8 floor gate).

```
allocate → 503 tee-restarting → hold, retry with backoff, resume
commit   → 503                → the slot may be gone; re-allocate, rebuild, retry
network  → any failure         → queue survives restart; retry forever
```

⚠️ **A slot has a TTL of 120 seconds**, not "until restart". A build that takes
longer than that must allocate again rather than commit a stale slot.

⚠️ **This is why a daemon beats a tab.** A browser closed mid-rotation loses the
work. The queue must be durable across app restarts and reboots.

---

## 7. Checking

Everything the site's folder-drop does, done properly and offline:

1. **bytes vs proof** — hash the file, compare to the proof's digest; a fused
   file is settled by rebuilding from the original, a set member through the
   manifest its proof carries.
2. **anchors vs chain** — recompute `keccak256(header)` against the anchor's
   signed block hash and read the block time from the header.
3. **the proof itself** — signature, Nitro attestation to the AWS root, slot
   binding, floor. Via `@mikeargento/bitgraph-verify`, unmodified.

⚠️ **There is no ledger side any more.** "Not on the ledger" stopped being a
finding on 2026-09-08: the bucket keeps only anchors, so a proof absent from it
is the ordinary case. Never show it as a fault.

⚠️ **Only failures speak.** Mike: "if its not verified it should say so
otherwise its just a viewer. if you see it its a bitgraph." A verified row shows
its name, position and time. A failure names the side it failed on. Something
unverifiable says so, in grey, and is never counted as a failure.

---

## 8. Honesty rules, carried forward

These are not style. Each one is a bug that shipped.

- **A failed read is never an absence.** "We could not check" and "this was
  never recorded" are opposite claims, and only one accuses the holder.
- **Nothing claims a count it did not count.** A partial answer says `partial`
  and suppresses the total.
- **An empty answer must carry its reason** or the reader cannot act on it.
- **Never assert a time from an untrusted clock.** The machine's clock is a
  convenience for reading a file; the Ethereum anchors are the claim.
- **Measure, do not reason, about anything performance-shaped.** Four attempts
  at the 2026-09-07 slowdown argued from the code and all failed; one timing
  line found it in a single run.

---

## 9. Packaging

Signed, notarized, stapled, with a real update channel. ⚠️ Folder's release
burned on exactly this: the version baked into the shipped page did not match
the pkg, and "check for updates" would have nagged forever. **Expand the built
artifact and check what is actually inside it before releasing** — inspecting
the source tree is not inspecting the build.

---

## 10. Build order

1. **Write beside the file.** Make → `.bitgraph` lands next to the original.
   This alone removes the download, the save dialog, the `BitGraphs` folder
   problem and the eviction risk.
2. **Watch a folder.** Making stops being remembered. Point it at a Lightroom
   export folder and it is the product.
3. **Background anchors.** The "drop the folder in again later" ceremony
   disappears.
4. **Streaming fuse.** The 256 MB ceiling goes; large files stop being
   second-class.
5. **Checking**, then everything else.

Steps 1 and 2 alone make the website's job purely a spec and a download, which
is the ruling this document exists to serve.

---

## 11. What the website becomes

The spec (trust model, proof format, the primitive, self-hosting the TEE), and
the download. ⚠️ **The site is still the only way to make a BitGraph until this
ships — do not strip making from it early.**

Verification without the app remains possible and cross-platform without the
website being involved: `npx @mikeargento/bitgraph-audit`, the MCP in any AI
client, and the reproducible enclave build (`PCR0 = eccfc1c7…`, two independent
builds). ⚠️ The MCP's `bitgraph_check` is a **digest lookup** and therefore
answers only for pre-cutover proofs; the local-first analogue is a
"verify this folder" tool that reads and checks locally. That is worth adding
alongside this app.
