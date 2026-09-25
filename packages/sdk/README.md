# @mikeargento/bitgraph-sdk

One engine, three sockets. BitGraph gives a file's bytes a causal position in a public sequence bracketed by Ethereum anchors: a floor it cannot move under, a position nothing can be slid beneath. This package is how software plugs in, whatever it is written in.

- **TypeScript**: `import { BitGraph } from "@mikeargento/bitgraph-sdk"`
- **Any language that can spawn a process**: `npx bitgraph <verb> --json`
- **Any runtime that can call localhost**: `npx bitgraph serve` (127.0.0.1 only)
- Agents already have their socket: [`@mikeargento/bitgraph-mcp`](https://www.npmjs.com/package/@mikeargento/bitgraph-mcp), which runs this same engine.

Files are read on this machine and never uploaded; only digests, the committed artifact and slot records leave it. **Recording is permanent**: record what was asked for, nothing more. Verification is free and fully offline.

## Five lines, at write time

```ts
import { BitGraph } from "@mikeargento/bitgraph-sdk";

const bg = new BitGraph();
const r = await bg.record("run-042.log");
console.log(r.files[0].proofUrl); // the record's public receipt
```

One file is fused on its own slot. A folder, or many paths, becomes **one set under one position**:

```ts
await bg.record(["logs/step-001.json", "logs/step-002.json", "logs/step-003.json"]);
```

Bytes already on record come back `"on record"`, untouched. A BitGraphed file (one that carries its own proof) is judged offline from the proof inside and is **never minted**: the envelope is not the recorded thing, the bytes inside are.

## The position before the work

The sealed-exam primitive, for logs that must be provably fresh:

```ts
const slot = await bg.open();          // a position exists; no work does
const task = `${prompt}\n<!-- ${slot.commitment} -->`;
const sealed = await slot.seal(Buffer.from(task));   // within slot.ttlSeconds
```

The commitment did not exist before the position did, so the task could not have either; outputs recorded afterwards sit later. That is the whole claim, and a stranger can check it offline.

## Reading and verifying

```ts
await bg.check("photo.jpg");                   // on record? read-only
await bg.proof({ digest });                    // the proof and its window
await bg.verify("photo.bitgraph.jpg");         // fully offline: verdict, floor, ceiling
await bg.bitgraphedFile("photo.jpg");          // build the file that carries its own proof
await bg.complete("photo.bitgraph.jpg");       // fetch the closing anchor in, later
```

`verify` needs no network and no server: a BitGraphed file argues for itself. The window is stated in the protocol's own units: no earlier than the floor block (a time), committed before the anchoring of the later block (a position).

## Any language

```bash
npx bitgraph record run-042.log --json
npx bitgraph verify photo.bitgraph.jpg          # exit 2 on FALSE or corrupt
npx bitgraph open                               # prints the commitment and a token
npx bitgraph seal --token <token> task.txt      # proof written beside the file
```

Or keep a daemon up and speak HTTP from anywhere:

```bash
npx bitgraph serve   # http://127.0.0.1:8791, GET / for the map
```

```python
import requests
requests.post("http://127.0.0.1:8791/record", json={"paths": ["run.log"]}).json()
```

The daemon binds 127.0.0.1 only: it reads local files by path and must never be reachable from off the machine.

## Pointing at a licensed boundary

`new BitGraph({ baseUrl, apiKey })`, or `BITGRAPH_API_URL` / `BITGRAPH_API_KEY`, or `--base-url` / `--api-key`. The public boundary at bitgraph.ing is anonymous.

## License

MIT for this package. Recording through the public boundary is licensed; verification is free, for anyone, forever.
