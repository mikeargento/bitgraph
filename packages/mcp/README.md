# @mikeargento/bitgraph-mcp

MCP server for BitGraph. It gives any MCP client, Claude Code and Claude Desktop among them, the same three gestures the website has: take a BitGraph of a file, check whether bytes are on record, and fetch a proof.

Taking a BitGraph builds a fused artifact from the file, on your machine: the file's digest is the origin; an unused slot is allocated in the ledger before any artifact exists; a commitment to that signed slot is placed into a new artifact built from the file with a registered placement (a 48-byte trailer for formats that ignore trailing bytes, a small tar container otherwise); the artifact is hashed and its digest is committed under the same slot. Those bytes could not have been finalized before the slot was allocated and were committed no later than the commit. The fused bytes are not kept: the original plus the proof rebuilds them, and the Frame for each file comes back in the structured result.

BitGraph gives bytes a causal position in a forward-only ledger. Ethereum serves as a public clock, not a storage layer: the ledger periodically records the hash of a recent Ethereum block, and since a block's hash cannot be known before the block exists, the sequence is pinned to a public timeline. Nothing is ever written to Ethereum. This server reads files locally; only digests and slot records ever leave the machine. File contents are never uploaded, and files are never modified.

```sh
claude mcp add bitgraph -- npx -y @mikeargento/bitgraph-mcp
```

Tools:

- `bitgraph_record` takes a BitGraph of each file: a new fused artifact under its own slot. Files already on record, as a recording or as the origin of a fused artifact, are returned as-is instead of being BitGraphed again; pass `again: true` to deliberately make a new fused artifact from such a file. BitGraphs are permanent.
- `bitgraph_check` reports whether files or digests are on record (`on_record`: a recording of the exact bytes) and which fused artifacts name them as origin (`fused_descendants`), with every position each one occupies. Read-only.
- `bitgraph_get_proof` fetches a proof by digest, BitGraph number, or file path, including the anchor window, the two Ethereum block times that bracket when it was BitGraphed. Read-only.

Configuration is by environment variable. `BITGRAPH_API_URL` overrides the endpoint (default `https://bitgraph.ing`). `BITGRAPH_API_KEY`, when set, is sent as a Bearer token on recordings.

Proofs are the bitgraph/1 schema and can be verified offline, without this server or any service, using `@mikeargento/bitgraph-verify`: `verifyFuse` checks a fused artifact directly or rebuilds it from the original. The fuse pipeline itself comes from `@mikeargento/bitgraph`, the licensed package; this client is MIT.

BitGraph itself lives at [bitgraph.ing](https://bitgraph.ing). The protocol, this package's source, and the rest of the documentation are in the main repository: [github.com/mikeargento/bitgraph](https://github.com/mikeargento/bitgraph).

## License

MIT. Copyright (c) 2024-2026 Mike Argento. The BitGraph protocol is patent pending; this client is licensed for use, the protocol implementation it talks to is not.
