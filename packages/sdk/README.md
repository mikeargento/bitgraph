# @mikeargento/bitgraph-sdk

One engine, three sockets. BitGraph gives a file's bytes a causal position in a public sequence bracketed by Ethereum anchors: a floor it cannot move under, a position nothing can be slid beneath. This package is how software plugs in, whatever it is written in.

- **TypeScript**: `import { BitGraph } from "@mikeargento/bitgraph-sdk"`
- **Any language that can spawn a process**: `npx bitgraph <verb> --json`
- **Any runtime that can call localhost**: `npx bitgraph serve` (127.0.0.1 only)
- Agents already have their socket: [`@mikeargento/bitgraph-mcp`](https://www.npmjs.com/package/@mikeargento/bitgraph-mcp), which runs this same engine.

Files are read on this machine and never uploaded; only digests, the tree's root document, position records and each file's sealed recovery entry leave it. A recovery entry is stored under a name derived from the file's hash and encrypted with a key derived from it too, so only someone holding the file can find or open it; it holds the file's leaf, its path to the root, its name in the tree and where the proof is, which is how a file finds its proof again when the export is lost (pass `recovery: false`, or `--no-recovery`, to keep none). **Recording is permanent**: record what was asked for, nothing more. Verification is free and fully offline.

## Five lines, at write time

```ts
import { BitGraph } from "@mikeargento/bitgraph-sdk";

const bg = new BitGraph();
const r = await bg.record("run-042.log", { exportDir: "." });
console.log(r.files[0].proofUrl);     // the record's public receipt
console.log(r.made?.exports?.owner);  // ./bitgraph-<n>.bitgraph.json: keep it with the file
```

Every call makes **one BitGraph**: one Merkle tree under one position (tree/1), every file one leaf. A single file is a tree of one; a folder, or many paths, is one tree; a file over 256 MiB goes in as is, its own digest its leaf:

```ts
await bg.record(["logs/step-001.json", "logs/step-002.json", "logs/step-003.json"], { exportDir: "proofs", exports: "both" });
```

The proof commits only the tree's root, so a file shows it is in its BitGraph with its **export** (bitgraph-export/1): the owner's (`bitgraph-<n>.bitgraph.json`, every leaf and its name) or one per member (`<name>.bitgraph.json`), with SPEC.md, the rules the proof pins, beside them. Without `exportDir` nothing is written and `r.made` holds everything they are built from (`bg.ownerExport(r.made)`, `bg.memberExport(r.made, leaf)`, `bg.writeExports(r.made, dir)`).

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
await bg.verifyExport("bitgraph-4821.bitgraph.json", "photo.jpg");   // a file with its export, one line per claim
await bg.completeExport("bitgraph-4821.bitgraph.json");  // add the floor header, the Base ceiling and its settlement, later
await bg.bitgraphedFile("photo.jpg");          // build the file that carries its own proof
await bg.complete("photo.bitgraph.jpg");       // fetch the closing anchor and the Base ceiling in, later
```

An export starts with its Base ceiling and Ethereum settlement pending: the ceiling lands seconds after the commit, the settlement when Base posts its output root to Ethereum. `completeExport` fetches each from the site's public routes and adds it only once it verifies; nothing already inside is replaced.

`verify` needs no network and no server: a BitGraphed file argues for itself, one line per claim, each saying what it rests on (SHA-256, Ed25519, the AWS Nitro root, an Ethereum block, a Base block). The window is stated in the protocol's own units: no earlier than the floor block (a time), existed by the Base block (a time), committed before the anchoring of the later anchor (a position). Offline, the blocks are taken from their headers; `--eth-rpc` and `--base-rpc` confirm them against nodes you name.

## Any language

```bash
npx bitgraph record run-042.log --json          # one tree; writes ./bitgraph-<n>.bitgraph.json (--out DIR, --exports owner|members|both|none)
npx bitgraph verify run-042.log bitgraph-<n>.bitgraph.json   # a file with its export, one line per claim
npx bitgraph export complete bitgraph-<n>.bitgraph.json      # add the ceiling and settlement once they exist
npx bitgraph export member bitgraph-<n>.bitgraph.json run-042.log   # one file's own export, from the owner's
npx bitgraph verify photo.bitgraph.jpg          # one line per claim; exit 2 on FALSE or corrupt
npx bitgraph verify photo.bitgraph.jpg --eth-rpc https://ethereum-rpc.publicnode.com --base-rpc https://mainnet.base.org   # confirm the blocks against nodes
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
