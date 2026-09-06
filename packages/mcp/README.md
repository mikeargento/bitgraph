# @mikeargento/bitgraph-mcp

MCP server for BitGraph. It gives any MCP client, Claude Code and Claude Desktop among them, the same three gestures the website has: make a BitGraph, check whether bytes are on record, and fetch a proof.

Making a BitGraph is one call for any number of files or folders, and everything in the call becomes ONE BitGraph, the way a drop on the site works: a single file is fused on its own slot, with its Frame; two or more files become a set under one slot, one position for all of them. For a set, on your machine each file is read once for its SHA-256 (the origin) and a hasher state; an unused slot is allocated in the ledger before any new file exists; every file's new fused bytes, the original plus a registered placement carrying a commitment to that signed slot (a 48-byte trailer for formats that ignore trailing bytes, a small tar container with the original first for everything else), are hashed from that state without being written or held; and the canonical list of those digests (above 2,000 files, a Merkle root over it) is committed under the same slot. Those bytes could not have been finalized before the slot was allocated and were committed no later than the commit. The new files are virtual: the original plus the set proof rebuilds them, and a lookup by any file's own digest finds the set.

BitGraph gives bytes a causal position in a forward-only ledger. Ethereum serves as a public clock, not a storage layer: the ledger periodically records the hash of a recent Ethereum block, and since a block's hash cannot be known before the block exists, the sequence is pinned to a public timeline. Nothing is ever written to Ethereum. This server reads files locally; only digests, the set's committed artifact and slot records ever leave the machine. File contents are never uploaded, and files are never modified.

```sh
claude mcp add bitgraph -- npx -y @mikeargento/bitgraph-mcp
```

Tools:

- `bitgraph_record` makes a BitGraph of files and folders: one file on its own, two or more as one set with one position. A directory is every regular file under it, recursively, with hidden entries and symbolic links left out. Files already on record, as a recording, as the origin of a fused file or as a member of a set, are returned as-is instead of being made again; pass `again: true` to deliberately make a new BitGraph of them. Each file comes back with its row in the set (one of N), and the set with its position and proof page. Above 2,000 files the set commits a Merkle root and each member's evidence is indexed on the site afterwards; evidence the site could not take is sent again before the next set is made. BitGraphs are permanent.
- `bitgraph_check` reports whether files, folders or digests are on record (`on_record`: a recording of the exact bytes, a fused file made from them, or a set they are a member of), with every position each one occupies and, for a set member, its row. Read-only.
- `bitgraph_get_proof` fetches a proof by digest, BitGraph number, or file path, including the anchor window, the two Ethereum block times that bracket when it was BitGraphed, and the row a set member holds. Read-only.

Configuration is by environment variable. `BITGRAPH_API_URL` overrides the endpoint (default `https://bitgraph.ing`). `BITGRAPH_API_KEY`, when set, is sent as a Bearer token on recordings. A client that passes a progress token gets progress notifications through the scan, the commit and the indexing.

Proofs are the bitgraph/1 schema and can be verified offline, without this server or any service, using `@mikeargento/bitgraph-verify`: `verifyFuse` checks the set proof against its committed artifact, and `verifyFuseMember` checks any member from its original or from its new bytes. The set pipeline itself comes from `@mikeargento/bitgraph`, the licensed package; this client is MIT.

BitGraph itself lives at [bitgraph.ing](https://bitgraph.ing). The protocol, this package's source, and the rest of the documentation are in the main repository: [github.com/mikeargento/bitgraph](https://github.com/mikeargento/bitgraph).

## License

MIT. Copyright (c) 2024-2026 Mike Argento. The BitGraph protocol is patent pending; this client is licensed for use, the protocol implementation it talks to is not.
