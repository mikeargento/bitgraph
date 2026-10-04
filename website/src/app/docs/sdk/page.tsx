import type { Metadata } from "next";
import Link from "next/link";
import { CopyCode } from "@/components/copy-code";
import { Code } from "@/components/code";

export const metadata: Metadata = {
  title: "SDK",
  description:
    "One engine, three sockets: the TypeScript SDK, the bitgraph CLI for any language that can spawn a process, and bitgraph serve for any runtime that can call localhost. Files are read locally and never uploaded.",
};

/* The SDK page: how software plugs in, whatever it is written in. The engine
   is @mikeargento/bitgraph-sdk; the MCP server runs the same one, so every
   socket makes a BitGraph the same way (one way to make a BitGraph). */
export default function SdkPage() {
  return (
    <article className="prose">
      <h1>SDK</h1>
      <p className="lede">
        One engine, three sockets. The same pipelines the drop box runs, packaged so software can plug in whatever it is written in: a TypeScript library, a CLI for any language that can spawn a process, and a localhost daemon for any runtime that can make an HTTP call. Files are read on your machine and never uploaded; only digests, the committed root document, position records and each file&rsquo;s sealed recovery entry leave it.
      </p>

      <h2 id="typescript">TypeScript</h2>
      <div className="code-block">
        <div className="code-block-header"><span>install</span><CopyCode /></div>
        <Code lang="text">{`npm install @mikeargento/bitgraph-sdk`}</Code>
      </div>
      <div className="code-block">
        <div className="code-block-header"><span>record.ts</span><CopyCode /></div>
        <Code lang="typescript">{`import { BitGraph } from "@mikeargento/bitgraph-sdk";

const bg = new BitGraph();
const r = await bg.record("run-042.log", { exportDir: "." });
console.log(r.files[0].proofUrl);     // the record's public proof page
console.log(r.made?.exports?.owner);  // ./bitgraph-<n>.bitgraph.json: keep it with the file`}</Code>
      </div>
      <p>
        Every call makes one BitGraph: a tree/1, every file one leaf of one Merkle tree under one position, and a single file is a tree of one. Bytes already on record come back <code>&quot;on record&quot;</code> untouched, and a file in an earlier tree is found by its sealed recovery entry before it is called new; a lookup that did not complete refuses the file with the reason, because unknown is not new, unless <code>again</code> asks for a new BitGraph regardless. A <Link href="/docs/carrier">BitGraphed file</Link> is judged offline from the proof it carries and never minted: the envelope is not the recorded thing, the bytes inside are. Earlier forms (sets, the Frame file) still verify; new recordings are tree/1.
      </p>
      <p>
        The proof commits only the tree&rsquo;s root, so each file shows it is in its BitGraph with its export (bitgraph-export/1), written beside the files: the owner&rsquo;s export holds every leaf and name, a member export holds one file&rsquo;s leaf and path, and <Link href="/spec">SPEC.md</Link>, the text the proof pins, is written beside them. Exports hold no file copies and no anchors. Keep export/1 and SPEC.md with the files. Each file made also gets a sealed recovery entry, stored under a name derived from the file&rsquo;s hash and encrypted with a key derived from it, so the file alone can find its proof again when the export is lost; <code>recovery: false</code> keeps none but still checks them.
      </p>
      <p>
        The verbs: <code>record</code>, <code>check</code>, <code>proof</code>, <code>open</code> and <code>seal</code>, <code>verify</code> and <code>verifyExport</code>, <code>ownerExport</code>, <code>memberExport</code>, <code>writeExports</code>, <code>completeExport</code>, <code>bitgraphedFile</code>, <code>complete</code>. <code>verify</code> needs no network: a BitGraphed file argues for itself, and a file with its export is judged one line per claim, each saying what it rests on. The window is stated in the protocol&rsquo;s units: the floor in time (the Ethereum block fixed when the position opened), the ceiling in position (committed before the anchoring of the next anchor, a bound in position and never a clock time), the ceiling in time (the Base block carrying a Merkle root over the record) and the settlement (Ethereum&rsquo;s record of that Base block through Base&rsquo;s output root), each once it exists. <code>completeExport</code> adds the floor header, the Base ceiling and the settlement to an export once they exist, each verified first. <code>check</code> is read-only and asks the recovery entries too, so a tree member is reported on record with its leaf and the tree&rsquo;s proof page.
      </p>

      <h2 id="position-first">The position before the work</h2>
      <p>
        <code>open</code> holds a position while no work exists; put its commitment string inside the task, then <code>seal</code> the task within the position&rsquo;s life. The commitment did not exist before the position did, so the task could not have either, and outputs recorded afterwards sit later. A task that does not carry the commitment is refused before the position is spent.
      </p>
      <div className="code-block">
        <div className="code-block-header"><span>position-first.ts</span><CopyCode /></div>
        <Code lang="typescript">{`const slot = await bg.open();
const task = prompt + "\\n<!-- " + slot.commitment + " -->";
const sealed = await slot.seal(Buffer.from(task));
// slot.fuseVersion is 2 when the boundary returned its floor (enclave v9): the commitment then
// binds the floor block's hash, so the task could not have been written before that block existed.`}</Code>
      </div>

      <h2 id="cli">Any language: the CLI</h2>
      <p>
        Every command takes <code>--json</code> and prints one JSON document, so anything that can spawn a process is integrated. <code>record &lt;paths...&gt;</code> makes one tree and writes its export/1 beside the files (<code>--out DIR</code>; <code>--exports owner|members|both|none</code>, the owner&rsquo;s by default; <code>--again</code> records files already on record; <code>--as-is</code>; <code>--no-recovery</code>). <code>verify &lt;file&gt; &lt;export.json&gt;</code> (or <code>--export</code>) judges a file with its export offline, one line per claim, and exits 2 on FALSE or a corrupt block; <code>--eth-rpc</code> and <code>--base-rpc</code> confirm each block against a node, <code>--pcr0</code> names the enclave images you accept. <code>export complete &lt;export.json&gt;</code> adds the floor header, the Base ceiling and the Ethereum settlement once they exist; <code>export member &lt;owner.json&gt; &lt;file&gt;</code> derives one member&rsquo;s export. <code>check</code> is read-only. <code>recovery list|flush|keep</code> manage pending recovery entries, saved under <code>$BITGRAPH_HOME/recovery</code> (default <code>~/.bitgraph</code>). The single-file form: <code>bitgraphed</code> writes the <Link href="/docs/carrier">BitGraphed file</Link> (carrier/2) beside the original, <code>complete</code> fetches in what has landed since, and <code>ceiling verify</code> checks a ceiling in time.
      </p>
      <div className="code-block">
        <div className="code-block-header"><span>shell</span><CopyCode /></div>
        <Code lang="text">{`npx bitgraph record run-042.log --json                     # one tree; writes ./bitgraph-<n>.bitgraph.json and SPEC.md beside it
npx bitgraph verify run-042.log bitgraph-<n>.bitgraph.json   # the file with its export, offline, one line per claim
npx bitgraph export complete bitgraph-<n>.bitgraph.json      # add the floor header, the Base ceiling and the settlement once they exist
npx bitgraph export member bitgraph-<n>.bitgraph.json run-042.log   # one file's own export, from the owner's
npx bitgraph verify photo.bitgraph.jpg --eth-rpc https://ethereum-rpc.publicnode.com --base-rpc https://mainnet.base.org
npx bitgraph bitgraphed photo.jpg --wait 30000
npx bitgraph open
npx bitgraph seal --token <token> task.txt`}</Code>
      </div>

      <h2 id="serve">Any runtime: the localhost daemon</h2>
      <p>
        <code>bitgraph serve</code> puts the same verbs on <code>127.0.0.1</code>, and only there: the daemon reads local files by path and is never reachable from off the machine. <code>GET /</code> returns the map.
      </p>
      <div className="code-block">
        <div className="code-block-header"><span>shell</span><CopyCode /></div>
        <Code lang="text">{`npx bitgraph serve`}</Code>
      </div>
      <div className="code-block">
        <div className="code-block-header"><span>plug.py</span><CopyCode /></div>
        <Code lang="text">{`import requests
requests.post("http://127.0.0.1:8791/record",
              json={"paths": ["run.log"]}).json()`}</Code>
      </div>

      <h2 id="agents">Agents</h2>
      <p>
        AI clients plug in through the <Link href="/docs/mcp">MCP server</Link>, which runs this same engine: the record, check and proof tools, plus the position-first task flow. One way to make a BitGraph, whichever socket is speaking.
      </p>

      <h2 id="boundary">Pointing at a licensed boundary</h2>
      <p>
        <code>new BitGraph(&#123; baseUrl, apiKey &#125;)</code>, or <code>BITGRAPH_API_URL</code> and <code>BITGRAPH_API_KEY</code>, or <code>--base-url</code> and <code>--api-key</code>. The public boundary is anonymous. Recording is permanent, so record what was asked for and nothing more; verification is free, for anyone, forever.
      </p>
    </article>
  );
}
