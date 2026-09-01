# BitGraph Folder is retired

**Retired 2026-09-01.** BitGraph Folder was a beta. It is no longer developed, no longer distributed, and should be uninstalled.

Folder was a macOS-only recorder: a watched folder on your Desktop that hashed anything dropped into it, sent only the SHA-256 digest, and wrote the resulting proof into an export beside the file. It proved the shape of the idea. It was never the shape of the product. A recorder belongs inside the workflows people already have, not in a folder they have to remember to use, and that is what replaces it.

## Uninstall it

Every release has been delisted, which means `uninstall.sh` is no longer downloadable. These four commands are exactly what it did. They are safe to run in any order, and they do not touch your recordings.

```bash
launchctl bootout "gui/$UID/com.bitgraph.hotfolder"
rm -f "$HOME/Library/LaunchAgents/com.bitgraph.hotfolder.plist"
rm -f "$HOME/.bitgraph/hotfolder.sh" "$HOME/.bitgraph/export.js" "$HOME/.bitgraph/config" "$HOME/.bitgraph/hotfolder.err"
rm -f "$HOME/Desktop/BitGraph"
```

The last one removes a symlink, not a folder. If `~/Desktop/BitGraph` is a real directory on your machine rather than a link, leave it alone.

## Your recordings are unaffected

Nothing about retiring the tool touches what it recorded.

Positions on the ledger are permanent and public. The exports in your `BitGraph/Recordings` folder are self-contained: each one holds `proof.json`, the file itself, and the Ethereum anchors that bracket its position. They verify with no network, no account, and no BitGraph software running anywhere.

Three ways to check them, none of which need Folder:

- **[bitgraph.ing/verify.html](https://bitgraph.ing/verify.html)** is the offline verifier that used to ship inside the installer. Save the page and open it from disk. It makes no network request of any kind. Drop a recording folder on it and it renders the same report the CLI prints.
- **`npx @mikeargento/bitgraph-audit <folder>`** audits a whole archive. It finds proofs by schema shape rather than by filename, so it does not care how the folder is laid out.
- **Drag `Recordings` onto [bitgraph.ing](https://bitgraph.ing)** to read the archive as a roll, with every row checked against the public ledger. Dragging a single day folder scopes it, which is much faster on a large archive.

If your `verify.html` predates this change it still works. It carries its own copy of the code and always did.

## Why the releases were delisted rather than left up

The shipped `notify()` function built an AppleScript string by interpolating values into its source. A filename containing a double quote, or an API response carrying one, could execute arbitrary code as the logged-in user when a drop was announced. It was present in every release, from the first commit that added Folder through 1.15.1.

Rather than ship a fix to a tool that was being retired the same week, the installers were withdrawn so no one else installs a vulnerable copy. The remediation is to uninstall, not to update. If you ran Folder and want to check whether it ever fired on your machine, look for filenames containing `"` anywhere under your BitGraph folder, and for AppleScript errors in `~/.bitgraph/hotfolder.err`.

## The record

The source is not deleted, only unshipped. Every released version remains reachable by its git tag:

```bash
git show folder-v1.15.1:packages/folder/src/hotfolder.sh
```

37 releases were published between 2026-08-03 and 2026-08-27, versions 1.1.0 through 1.15.1, totalling 73 downloads. All 37 tags are intact.

## What replaces it

A recorder that plugs into the workflows you already have, rather than a folder you have to remember to drop things into. Not yet announced.
