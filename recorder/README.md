# BitGraph Recorder

A macOS app. Drop files on the box and each drop becomes a **recording**: one
self-contained folder holding the files, the proof, and the Ethereum anchors.

```
~/BitGraph/Recordings/2026-09-09/
  BitGraph (IMG_4021.png)/
    IMG_4021.png            a hard link to your file
    proof.json              bitgraph/1
    ethereum-anchors/       when they land
  BitGraph (Photos 2026, 412 files)/
    …the tree, mirrored…
    proof.json
    manifest.json           the committed artifact
    members.jsonl           every member's row and inclusion path
```

Nothing points at anything: `proof.json` **is** the proof. Hand somebody the
folder and they have the whole BitGraph.

## What it does not do

- **It never writes into your folders.** The folder you dragged out of is left
  exactly as it was.
- **It never moves or copies your files.** On the same volume a recording's
  files are HARD LINKS: one copy of the bytes, two names. Deleting the
  recording leaves your original; deleting your original leaves the recording.
  Across volumes there is no such thing, so it copies, and the recording says
  which it did.
- **It never writes the fused bytes.** They are virtual, rebuilt from the
  original and the proof when you export, hashed on the way out, and refused if
  they do not match what was committed.
- **No login, no account, no upload.** Files are hashed here. Two HTTPS calls
  leave the machine and neither carries file content: digests, a slot record,
  a placement id.

## The window

One surface, and the whole of it takes a drop. Drag files or a folder anywhere
onto the window, at any time: the moment a drag crosses in, the window goes
blue under a dashed frame and says the one word. **+ New** is the same thing
for people who would rather pick than drag: it opens a page that is one dashed
frame, the site's home, with the browse link in it. Under the header, the library is
one list, newest first, every month's days under its name: each day a row
saying how many recordings it holds, and a day opens to its recordings. A
recording opens to its proof, read off the disk. **Calendar** drops a little
month to jump by day; **search** finds recordings by name across every day,
and a day's name in the results is the way back to it in the list. A filled
dot on a recording means its Ethereum anchors are in; a ring means they are
still on the way, and they arrive by themselves. When they do while the
window is not in front, a notification says so, and that is the only thing
the app ever announces on its own. The menu bar item is the same thing in
short: what the library holds, what needs saying, and the way into the window.

The keys: **⌘N** record, **←** **→** (or ⌘←, ⌘→) the month before or after,
**T** (or ⌘T) today, **⌘F** search, **Esc** puts away whatever is up. The
plain keys are Calendar's own and only work while nothing is being typed.

An update is offered when the feed at `bitgraph.ing/recorder/latest.json`
names a newer version. **Install** downloads the package, checks it against
the checksum the feed carries, and opens it in macOS Installer, which is the
thing that runs it, behind Gatekeeper's check of the signature and
notarization. A download that does not match is thrown away; a feed with no
checksum installs nothing.

First run asks one thing: what to call your BitGraph folder, and where it
lives. An existing folder is continued, never replaced. Move or rename it
later and the app says so and asks where it went; **Change…** beside the folder
name at the foot of the window does the same on purpose, and the name itself
reveals the folder. Pointing at a folder that has Recordings in it
carries on with everything in it.

## The gesture

- **One new file**: recorded on landing.
- **One file already on record**: opens its BitGraph instead.
- **Two or more**: listed first, then made as ONE BitGraph at ONE position,
  each file a member. Only a batch gets asked.
- **A folder of BitGraphs**: checked, and the report shown. Nothing is
  recorded, nothing is changed, nothing leaves the machine. It is how a folder
  somebody sent you gets read, and how a recording of your own is re-checked.

Two files with the same bytes in one drop are one member: the record is by
content, so the second name is covered by the first and said so. Your BitGraph
folder itself can never be dropped, and a drop of the folder above it walks
around it: what is in there is already recorded.

The app does not offer to **watch** a folder. The core can (`bitgraph-recorder
watch`), and it is tested; pointed at a folder holding anything but the files
you mean, it records everything, and every mistake consumes a real position.
That is a decision for a narrower form of it, not a default.

## The reader

A dropped folder of BitGraphs is read and nothing is recorded. A folder
somebody sends you checks **on its own** — no library, no index, no settings,
no network — because a recording carries everything a check asks for.

Four outcomes, and the differences between them are the point:

| | |
|---|---|
| **verified** | the bytes rebuild the artifact this position committed |
| **failed** | something contradicted. It names which side |
| **could not be checked** | a gap on this side. Never counted as a failure |
| **not recorded** | these bytes have no BitGraph. Not a fault, and never "not on the ledger" |

Bytes alone cannot tell a file that was altered from one that was never
recorded, so neither is called a failure. A proof signed by an enclave
measurement this build does not carry reads as **could not be checked**, never
as invalid and never as verified. A proof that declares one enclave and attests
to another **fails**: the declared measurement is a claim in a document, and the
PCR0 inside the signed attestation is what the hardware said.

## Building

```
mac/build.sh
```

Produces `mac/build/BitGraph Recorder.app`, ad hoc signed so it runs locally, and
checks the thing it built rather than the tree it built from. For a release,
`SIGN_IDENTITY="Developer ID Application: …" mac/build.sh` signs with the
hardened runtime; notarizing and stapling need credentials this repository does
not hold.

## Testing

```
./test.sh          unit tests, the surface's tests, and end to end
./test.sh --app    the above, plus the built app end to end
```

The end-to-end suites run the unmodified enclave as a local process with a
stubbed NSM, so they exercise the real slot protocol and mint real proofs under
a per-run key with a deliberately fake PCR0. **No test consumes a position on
the live ledger, and no test can reach the real library**: an explicit settings
path isolates the recordings too.

## The core on its own

```
bitgraph-recorder make <file-or-folder>...
bitgraph-recorder check <folder>
bitgraph-recorder watch <folder>...
bitgraph-recorder anchors
bitgraph-recorder status
```

⚠️ **The core is platform-free.** It is Node, `node:crypto`, `node:fs` and one
HTTPS host: no macOS APIs anywhere. The CLI runs on Linux today, unchanged.
Only the window is Mac-only.

## What this is not

It parses no untrusted input, renders no HTML, executes nothing it downloads
and loads no plugins. It reads bytes to hash them and speaks HTTPS to one host.
The one thing it downloads is its own update, which it hashes, matches to the
feed, and hands to macOS Installer rather than running.

The pipeline is not reimplemented here: `fuse()`, `fuseSet()`, the placements,
the canonical set manifest and the verifier are `@mikeargento/bitgraph` and
`@mikeargento/bitgraph-verify`, used as published. The Nitro attestation is
opened and checked to the AWS root by `@mikeargento/bitgraph-audit`.

⚠️ **This is not the 2026 `bitgraph-recorder` npm package**, which was removed
along with every release over an RCE. It shares the name and the shape of what
it wrote; it shares no code, and it is an app rather than a hot folder.
