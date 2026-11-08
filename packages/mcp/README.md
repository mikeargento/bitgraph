# @mikeargento/bitgraph-mcp

MCP server for BitGraph. It gives any MCP client, Claude Code and Claude Desktop among them, three tools: make a
BitGraph, check whether bytes are on record, and fetch a proof. The same server is hosted at `https://bitgraph.ing/mcp`
for clients that connect by URL; this package runs it locally, reading files on your machine.

A BitGraph is one atomic action inside a hardware enclave (AWS Nitro). The file's SHA-256 arrives; the enclave draws a
fresh nonce that never existed before, gives it one count, binds the digest at the very next count, and signs both
together, chained to the previous proof. Files are hashed on your machine and never uploaded or changed: only the
SHA-256 leaves. The proof is saved beside the file and verifies offline, without BitGraph.

```sh
claude mcp add bitgraph -- npx -y @mikeargento/bitgraph-mcp
```

Tools:

- `bitgraph_record` makes a BitGraph exactly as the website's drop does (paths or directories; a directory is every
  regular file under it, hidden entries and symbolic links left out). One new file is one BitGraph; several new files
  are one tree and one BitGraph, and each file's own proof verifies against the file alone. Files that already have a
  BitGraph are not made again. Each proof is saved beside its file as `<file>.bitgraph.json`, and the result returns
  the BitGraph's number, its two counts and its nonce. BitGraphs are permanent: only make them of files the user asked
  for.
- `bitgraph_check` reports whether files, folders or digests are on record, with every position each occupies.
  Read-only.
- `bitgraph_get_proof` fetches a proof by digest, BitGraph number, or file path, with every position the same bytes
  occupy. Read-only.

The nonce carries forward to the next BitGraph. Put a BitGraph's nonce into content made afterward (a prompt, a seed,
a field) to make that content unique and to show it was made after the nonce existed.

Configuration is by environment variable. `BITGRAPH_API_URL` overrides the endpoint (default `https://bitgraph.ing`).
`BITGRAPH_API_KEY`, when set, is sent as a Bearer token.

Proofs verify offline with [`@mikeargento/bitgraph-verify`](https://www.npmjs.com/package/@mikeargento/bitgraph-verify).

BitGraph lives at [bitgraph.ing](https://bitgraph.ing); the source is at
[github.com/mikeargento/bitgraph](https://github.com/mikeargento/bitgraph).

## License

MIT. Copyright (c) 2025-2026 Argento Computing Inc. The BitGraph protocol is patent pending; this client is licensed for use, the protocol implementation it talks to is not.
