# BitGraph Folder

A folder on your Desktop that records whatever you put in it.

Drop a file in. It gets hashed on your machine, the digest is recorded at a
causal position on the BitGraph ledger, and the file comes back wrapped in an
export folder holding its proof and the Ethereum anchors that bracket it.

```
BitGraph/
    bitgraph-proof-1858/
        proof.json
        sunset.jpg
        ethereum-anchors/
            anchor-before.json    anchor-before-witness.json
            anchor-after.json     anchor-after-witness.json
```

That folder is the same thing you would get by recording the file on
[bitgraph.ing](https://bitgraph.ing) and downloading the export from its proof
page. Identical layout, so the two are interchangeable.

## No dependencies

The exporter runs under JavaScript for Automation, which has shipped with macOS
since 10.10. There is nothing to install first and nothing that can be missing.
An earlier version needed Node.js; bundling a runtime would have meant a 229 MB
download for a folder watcher, so the exporter was rewritten instead.

## Your files never leave your machine

Only the SHA-256 digest is sent. Not the file, not its name, not its contents.
A digest is 32 bytes and tells the ledger nothing about what it came from.

The tool talks to exactly one host, `https://bitgraph.ing`, and every call it
makes is either a lookup or a request to record a digest you dropped in
deliberately.

## Install

Requires macOS. Nothing else: no runtime to install, no dependencies.

```bash
git clone https://github.com/mikeargento/bitgraph.git
cd bitgraph/packages/folder
./install.sh
```

Nothing needs sudo, and everything lands under your home directory. Read
`install.sh` before running it; it is short and deliberately boring.

To remove it:

```bash
./uninstall.sh
```

Uninstalling leaves your folder and every export in it alone. The proofs stay
valid and auditable whether or not this tool is installed.

## Updating

There is no auto-update, on purpose. This tool watches a folder and talks to
one host, and adding a background process that checks for new versions would
mean it phones home on its own schedule for reasons unrelated to what you asked
it to do.

To update, download the current version and install it over the top. Your
folder, your exports, and the record of what has already been recorded are all
preserved.

To see what you are running:

```bash
grep VERSION ~/.bitgraph/config
```

## Before you use it

**Recordings are permanent and public.** The ledger has a ten-year retention
policy and no deletes. A digest you record is on it for good, and anyone
holding the same bytes can look them up. Put files in this folder only when you
mean to record them.

**Dropping the same bytes twice does nothing new.** The second drop returns the
existing proof instead of creating another one. Recording the same file at a
second causal position is a deliberate act, not something a folder does to you
by accident.

## Checking an export

Every export folder audits offline, with no network and no account:

```bash
npx @mikeargento/bitgraph-audit bitgraph-proof-1858
```

**Expect exit code 2, and expect that to be fine.** An export holds one proof
and its two bracketing anchors, lifted out of a chain thousands of proofs long.
The audit tool is built to audit whole epochs, so it reports the positions it
cannot see as `unexplained-counter-positions`. In its own words, that "does not,
by itself, establish that the authority failed to create or withheld any proof."

What should come back clean in the report:

| Field | Meaning |
| --- | --- |
| `failed: 0` | no proof failed verification |
| `fullyVerified: 1` | your file's bytes match its proof |
| `attestation.documentsValidated` | every proof tied to measured enclave hardware |
| `attestation.pcr0MatchesDeclared` | the enclave measurement matches what is claimed |
| `attestation.userDataBound` | the attestation is bound to this exact proof |
| `temporal.anchorsWithVerifiedWitness` | block hashes recomputed from their headers |

The two anchors report `artifact-unavailable`, which is expected: an anchor's
artifact is a chain hash rather than a file.

To check just the bytes, skip the tool entirely:

```bash
shasum -a 256 sunset.jpg
```

and compare against `artifact.digestB64` in `proof.json`, which is the same
value in base64.

## How it works

`launchctl` watches the folder with a `WatchPaths` agent, so there is no polling
and no daemon sitting in memory. When the folder changes, the watcher:

1. Hashes each new top-level file, waiting for its size to settle first so a
   file still being copied is never hashed mid-write
2. Asks the ledger whether those bytes are already on it
3. Records the digest if they are not
4. Builds the export folder and moves the file into it

Hidden files and subfolders are skipped, so existing export folders are not
rescanned.

### Why the Desktop item is a symlink

The real folder lives at `~/BitGraph` and the Desktop item points to it. This is
load-bearing, not cosmetic. macOS TCC denies background launchd agents access to
`~/Desktop`, `~/Documents`, and `~/Downloads`. A watcher aimed straight at a
Desktop folder runs, exits successfully, and silently sees nothing at all, with
no error logged anywhere. Keeping the real folder outside those directories and
linking to it means Finder drops land where the agent can actually read them,
and no permission prompt is ever needed.

### The sealing anchor

A position is sealed by the first Ethereum anchor that lands *after* it, and
that anchor does not exist at the moment of recording. The export waits briefly
for it, normally 12 to 24 seconds. If it has not arrived, the folder is written
anyway and marked pending, and the next folder change completes it. You will see
`anchor-after.json` appear then.

### Files it installs

| Path | What it is |
| --- | --- |
| `~/BitGraph` | the watched folder |
| `~/Desktop/BitGraph` | symlink to it |
| `~/.bitgraph/hotfolder.sh` | the watcher |
| `~/.bitgraph/export.js` | the exporter (JavaScript for Automation) |
| `~/.bitgraph/config` | folder locations and the installed version |
| `~/.bitgraph/hotfolder.state` | digests already handled, so drops are not rechecked |
| `~/.bitgraph/hotfolder.err` | diagnostics |
| `~/Library/LaunchAgents/com.bitgraph.hotfolder.plist` | the watcher agent |

### Configuration

Edit `~/.bitgraph/config` and re-run `install.sh`.

| Variable | Default |
| --- | --- |
| `BITGRAPH_FOLDER` | `~/BitGraph` |
| `BITGRAPH_API` | `https://bitgraph.ing` |
| `BITGRAPH_SEAL_WAIT_MS` | `45000` |

## Turning it off

```bash
launchctl bootout gui/$UID/com.bitgraph.hotfolder    # stop
launchctl bootstrap gui/$UID ~/Library/LaunchAgents/com.bitgraph.hotfolder.plist    # start
```

## Other ways to record

- **[bitgraph.ing](https://bitgraph.ing)** drop a file in the browser
- **[MCP](https://bitgraph.ing/docs/mcp)** connect an AI agent with one URL

All three write to the same ledger and produce the same proofs. A recording made
here is indistinguishable from one made on the site.

## License

MIT. See [LICENSE](./LICENSE).

The MIT grant covers this code only. It conveys no license to any patent. The
BitGraph protocol is patent pending.
