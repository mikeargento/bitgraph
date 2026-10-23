# @mikeargento/bitgraph-mcp

MCP server for BitGraph. It gives any MCP client, Claude Code and Claude Desktop among them, three tools: make a
BitGraph, check whether bytes are on record, and fetch a proof. The same server is hosted at `https://bitgraph.ing/mcp`
for clients that connect by URL; this package runs it locally, reading files on your machine.

A BitGraph is one atomic action inside a hardware enclave (AWS Nitro). The file's SHA-256 arrives; the enclave draws a
fresh random value nobody has seen, gives it one count, binds the digest at the very next count, and signs both
together. Files are hashed on your machine and never uploaded or changed: only the SHA-256 leaves. The proof is saved
beside the file and verifies offline, without BitGraph.

```sh
claude mcp add bitgraph -- npx -y @mikeargento/bitgraph-mcp
```

Tools:

- `bitgraph_record` makes a BitGraph of each file given (paths or directories; a directory is every regular file under
  it, hidden entries and symbolic links left out). Each proof is saved beside its file as `<file>.bitgraph.json`.
  BitGraphs are permanent: only make them of files the user asked for.
- `bitgraph_check` reports whether files, folders or digests are on record, with every position each occupies.
  Read-only.
- `bitgraph_get_proof` fetches a proof by digest, BitGraph number, or file path, with every position the same bytes
  occupy. Read-only.

Two BitGraphs bracket everything made between them: make one of the task, do the work, make one of the result.

Configuration is by environment variable. `BITGRAPH_API_URL` overrides the endpoint (default `https://bitgraph.ing`).
`BITGRAPH_API_KEY`, when set, is sent as a Bearer token.

Since 0.12.0 a BitGraph is made one way. The `bitgraph_open` and `bitgraph_commit` tools, which held a position ahead
of the content, are gone. Proofs made in earlier formats still check and verify with
[`@mikeargento/bitgraph-verify`](https://www.npmjs.com/package/@mikeargento/bitgraph-verify).

BitGraph lives at [bitgraph.ing](https://bitgraph.ing); the source is at
[github.com/mikeargento/bitgraph](https://github.com/mikeargento/bitgraph).

## License

MIT. Copyright (c) 2024-2026 Argento Computing Inc. The BitGraph protocol is patent pending; this client is licensed for use, the protocol implementation it talks to is not.
