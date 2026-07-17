# @mikeargento/bitgraph-mcp

MCP server for BitGraph. It gives any MCP client, Claude Code and Claude Desktop among them, the same three gestures the website has: take a BitGraph of a file, check whether bytes are on record, and fetch a proof.

BitGraph records a file's SHA-256 digest at a causal position in a forward-only ledger. Ethereum serves as a public clock, not a storage layer: the ledger periodically records the hash of a recent Ethereum block, and since a block's hash cannot be known before the block exists, the sequence is pinned to a public timeline. Nothing is ever written to Ethereum. This server hashes files locally; only the digest ever leaves the machine. File contents are never uploaded.

```sh
claude mcp add bitgraph -- npx -y @mikeargento/bitgraph-mcp
```

Tools:

- `bitgraph_record` records files at new causal positions. Files already on record are returned with their existing proof instead of being re-recorded; pass `again: true` to deliberately record the same bytes at a new position. Recordings are permanent.
- `bitgraph_check` reports whether files or digests are on record, with every causal position each one occupies. Read-only.
- `bitgraph_get_proof` fetches a proof by digest, BitGraph number, or file path, including the anchor window, the two Ethereum block times that bracket when it was BitGraphed. Read-only.

Configuration is by environment variable. `BITGRAPH_API_URL` overrides the endpoint (default `https://bitgraph.ing`). `BITGRAPH_API_KEY`, when set, is sent as a Bearer token on recordings.

Proofs are the bitgraph/1 schema and can be verified offline, without this server or any service, using `@mikeargento/bitgraph-verify`.

## License

MIT. Copyright (c) 2024-2026 Mike Argento. The BitGraph protocol is patent pending; this client is licensed for use, the protocol implementation it talks to is not.
