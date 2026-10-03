# @mikeargento/bitgraph-mcp

MCP server for BitGraph. It gives any MCP client, Claude Code and Claude Desktop among them, the same three gestures the website has: make a BitGraph, check whether bytes are on record, and fetch a proof.

Making a BitGraph is one call for any number of files or folders, and everything in the call becomes ONE BitGraph: one Merkle tree under one position (tree/1), every file one leaf; a single file is a tree of one. On your machine each file is read once for its SHA-256 (the origin) and a hasher state; an unused position and its floor block are allocated in the ledger before any new file exists; every file's committed bytes, the original plus a registered placement carrying that position's commitment (a 48-byte trailer for formats that ignore trailing bytes, a small tar container with the original first for everything else), are hashed from that state without being written or held; with as_is=true the files go in as they are, each its own digest (recorded after the floor block, the bytes themselves not dated), the user's choice and never a size's; a file of any size is streamed; and the tree's 84-byte root document is committed under the same position. The committed bytes could not have been finished before the floor block and were committed no later than the commit; a file recorded as is existed by the commit, and nothing bounds it from below. The committed bytes are virtual: the original plus the proof rebuilds them. The proof commits only the tree's root, so every call writes the BitGraph's export (bitgraph-export/1) beside what was recorded: with a file, it shows that file is in the BitGraph, with nothing of BitGraph's required. Keep it.

BitGraph gives bytes a causal position in a forward-only ledger. Ethereum serves as a public clock, not a storage layer: the ledger periodically records the hash of a recent Ethereum block, and since a block's hash cannot be known before the block exists, the sequence is pinned to a public timeline. Nothing is ever written to Ethereum. This server reads files locally; only digests, the tree's root document, position records and each file's sealed recovery entry ever leave the machine. A recovery entry is stored under a name derived from the file's hash and encrypted with a key derived from it too, so only someone holding the file can find or open it; it is how a file finds its proof again when the export is lost (recovery=false keeps none). File contents are never uploaded, and files are never modified.

```sh
claude mcp add bitgraph -- npx -y @mikeargento/bitgraph-mcp
```

Tools:

- `bitgraph_record` makes a BitGraph of files and folders: one tree, one position, every file a leaf. A directory is every regular file under it, recursively, with hidden entries and symbolic links left out. Files already on record, as a recording, as the origin of a fused file or as a member of a set, are returned as-is instead of being made again; pass `again: true` to deliberately make a new BitGraph of them. Each file comes back with its leaf (one of N), the tree with its position and proof page, and the export with its path. `export_dir` (default: the folder that holds the first path given, so a folder's export sits beside it, never inside it) and `exports` (`owner`, the default: one file listing every leaf and its name; `members`: one export per file; `both`; `none`) choose what is written, with SPEC.md, the rules the proof pins, beside it when the site serves that exact text. BitGraphs are permanent.
- `bitgraph_check` reports whether files, folders or digests are on record (`on_record`: a recording of the exact bytes, a fused file made from them, or a set they are a member of), with every position each one occupies and, for a set member, its row. Read-only.
- `bitgraph_get_proof` fetches a proof by digest, BitGraph number, or file path, including the anchor window, the two Ethereum block times that bracket when it was BitGraphed, and the row a set member holds. Read-only.

Configuration is by environment variable. `BITGRAPH_API_URL` overrides the endpoint (default `https://bitgraph.ing`). `BITGRAPH_API_KEY`, when set, is sent as a Bearer token on recordings. A client that passes a progress token gets progress notifications through the scan and the tree's phases.

Proofs are the bitgraph/1 schema and exports are bitgraph-export/1; both verify offline, without this server or any service, using `@mikeargento/bitgraph-verify`: `verifyExport` checks an export with the file it is about, one claim per line (the proof and its attestation, the spec pin, the root, the file's leaf, the floor, and the Base and Ethereum ceilings once `npx -p @mikeargento/bitgraph-sdk bitgraph export complete <export>` has added them). The tree pipeline itself comes from `@mikeargento/bitgraph`, the licensed package; this client is MIT.

BitGraph itself lives at [bitgraph.ing](https://bitgraph.ing). The protocol, this package's source, and the rest of the documentation are in the main repository: [github.com/mikeargento/bitgraph](https://github.com/mikeargento/bitgraph).

## License

MIT. Copyright (c) 2024-2026 Argento Computing Inc. The BitGraph protocol is patent pending; this client is licensed for use, the protocol implementation it talks to is not.
