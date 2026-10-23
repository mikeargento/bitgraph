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
const [b] = await bg.bind("run-042.log");
console.log(b.number, b.counts, b.proofUrl); // BitGraph number, its two counts, the public proof page
console.log(b.wrote);                        // run-042.log.bitgraph.json: keep it with the file
```

`bind` takes one path or many (a directory is every regular file under it); each file is its own BitGraph. Pass
`{ write: false }` to keep the proof in memory instead of saving it beside the file.

## Work between two BitGraphs

Two BitGraphs bracket everything made between them: anything bound after the first and before the second sits
between them in the sequence. Make one of the task, do the work, make one of the result. If the work uses the first
one's nonce (in a prompt, a seed, a field), the result also shows it was made after that value existed.

## Check and verify

```ts
await bg.check(["run-042.log"]);            // read-only: is this exact file on record, and where?
await bg.proof({ path: "run-042.log" });    // the proof and every position the same bytes occupy
await bg.verify("run-042.log", proof);      // offline: the file's hash, signature, two counts, AWS Nitro attestation, published image
```

Verification is free and offline, through [`@mikeargento/bitgraph-verify`](https://www.npmjs.com/package/@mikeargento/bitgraph-verify).
A file recorded as part of a tree verifies with its own proof the same way, and the reading says which file of the tree it is.
Proofs and exports made in earlier formats (trees, fused files, BitGraphed files) still check and verify.

## Any language

```sh
npx -p @mikeargento/bitgraph-sdk bitgraph make run-042.log --json
npx -p @mikeargento/bitgraph-sdk bitgraph check run-042.log --json
npx -p @mikeargento/bitgraph-sdk bitgraph verify run-042.log
npx -p @mikeargento/bitgraph-sdk bitgraph serve        # POST /make, /check, /proof, /verify on 127.0.0.1
```

`BITGRAPH_API_URL` overrides the endpoint (default `https://bitgraph.ing`); `BITGRAPH_API_KEY`, when set, is sent as
a Bearer token.

Since 0.7.0 a BitGraph is made one way. `record()`, `open()` and `seal()`, which made BitGraphs under a position held
ahead of the content, answer 410 and point to `bind()`.

## License

MIT for this package. Recording through the public boundary is licensed; verification is free, for anyone, forever.
