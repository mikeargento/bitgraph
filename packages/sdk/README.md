# @mikeargento/bitgraph-sdk

Make and check BitGraphs from any stack.

A BitGraph is one atomic action inside a hardware enclave (AWS Nitro). Your file's SHA-256 arrives; the enclave draws a
fresh random value nobody has seen, gives it one count, binds your digest at the very next count, and signs both
together. Nothing can be counted between them, and the value does not exist until the content it is for is known. The
proof that comes back verifies offline, without BitGraph.

Files are hashed on your machine and never uploaded or changed: only the SHA-256 leaves. **A BitGraph is permanent**:
make them of what you were asked to, nothing more.

- **TypeScript**: `import { BitGraph } from "@mikeargento/bitgraph-sdk"`
- **Any language that can spawn a process**: `npx bitgraph <verb> --json`
- **Any runtime that can call localhost**: `npx bitgraph serve` (127.0.0.1 only)
- **Agents**: [`@mikeargento/bitgraph-mcp`](https://www.npmjs.com/package/@mikeargento/bitgraph-mcp) runs this same engine.

## Make a BitGraph

```ts
import { BitGraph } from "@mikeargento/bitgraph-sdk";

const bg = new BitGraph();
const r = await bg.record("run-042.log");
console.log(r.made?.number, r.made?.counts); // the BitGraph's number, and its two counts [N, N+1]
console.log(r.made?.nonce);                   // the fresh nonce this BitGraph made
console.log(r.files[0]?.proofPath);           // run-042.log.bitgraph.json: keep it with the file
```

Each BitGraph is its own bucket. One call makes a fresh nonce that never existed before, at count N, and binds the
file's SHA-256 at count N+1. The proof is attested by AWS Nitro and chained to the previous proof by `prevB64`.

`record` takes one path or many (a directory is every regular file under it, hidden entries and symbolic links left
out):

- **One new file** is one BitGraph of the file's own SHA-256.
- **Several new files** are one tree and one BitGraph: an RFC 6962 tree whose leaves are the files' SHA-256s, sorted by
  name, with the tree's root text bound. Each file's proof is the tree's proof with the file's place in the tree, and
  it verifies against the file alone.
- **Files already on record** are not made again; they come back as `"on record"` with their first BitGraph. If the
  lookup cannot be completed, nothing is made.
- Proof files (`*.bitgraph.json`) and BitGraphed files are never made.

Each new proof is saved beside its file as `<file>.bitgraph.json`; pass `{ write: false }` to keep it in memory
instead. The result's `made` is the one BitGraph the call made (`number`, `counts`, `nonce`, `prev`, `proof`,
`proofUrl`, and `tree` for several files); `files` has one row per file with its `outcome`, `nonce`, `proof` and
`proofPath`.

## Use the nonce

The nonce carries forward: the next BitGraph is made after it. You can also put any BitGraph's nonce into your own
content (a prompt, a seed, a field) to make that content unique and to show it was made after the nonce existed.
Record the result, and everything between the two BitGraphs sits between them in the sequence.

## Check and verify

```ts
await bg.check(["run-042.log"]);            // read-only: is this exact file on record, and where?
await bg.proof({ path: "run-042.log" });    // the proof and every position the same bytes occupy
await bg.verify("run-042.log", proof);      // offline: the file's hash, signature, two counts, AWS Nitro attestation, published image
```

Verification is free and offline, through [`@mikeargento/bitgraph-verify`](https://www.npmjs.com/package/@mikeargento/bitgraph-verify).
A file recorded as part of a tree verifies with its own proof the same way, and the reading says which file of the tree it is.
A BitGraphed file (one that carries its proof inside) checks and verifies on its own.

## Any language

```sh
npx -p @mikeargento/bitgraph-sdk bitgraph record run-042.log --json
npx -p @mikeargento/bitgraph-sdk bitgraph check run-042.log --json
npx -p @mikeargento/bitgraph-sdk bitgraph verify run-042.log
npx -p @mikeargento/bitgraph-sdk bitgraph serve        # POST /record, /check, /proof, /verify on 127.0.0.1
```

`BITGRAPH_API_URL` overrides the endpoint (default `https://bitgraph.ing`); `BITGRAPH_API_KEY`, when set, is sent as
a Bearer token.

## License

MIT for this package. Recording through the public boundary is licensed; verification is free, for anyone, forever.
