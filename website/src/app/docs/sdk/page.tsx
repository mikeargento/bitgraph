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
        One engine, three sockets. The same pipelines the drop box runs, packaged so software can plug in whatever it is written in: a TypeScript library, a CLI for any language that can spawn a process, and a localhost daemon for any runtime that can make an HTTP call. Files are read on your machine and never uploaded; only digests, the committed artifact and slot records leave it.
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
const r = await bg.record("run-042.log");
console.log(r.files[0].proofUrl);`}</Code>
      </div>
      <p>
        One file is fused on its own slot; a folder or many paths become one set under one position. Bytes already on record come back <code>&quot;on record&quot;</code> untouched, and a <Link href="/docs/carrier">BitGraphed file</Link> is judged offline from the proof it carries and never minted: the envelope is not the recorded thing, the bytes inside are.
      </p>
      <p>
        The verbs: <code>record</code>, <code>check</code>, <code>proof</code>, <code>open</code> and <code>seal</code>, <code>verify</code>, <code>bitgraphedFile</code>, <code>complete</code>. <code>verify</code> needs no network: a BitGraphed file argues for itself, and the window is stated in the protocol&rsquo;s units, no earlier than the floor block, committed before the anchoring of the later block.
      </p>

      <h2 id="position-first">The position before the work</h2>
      <p>
        <code>open</code> holds a position while no work exists; put its commitment string inside the task, then <code>seal</code> the task within the slot&rsquo;s life. The commitment did not exist before the position did, so the task could not have either, and outputs recorded afterwards sit later. A task that does not carry the commitment is refused before the slot is spent.
      </p>
      <div className="code-block">
        <div className="code-block-header"><span>position-first.ts</span><CopyCode /></div>
        <Code lang="typescript">{`const slot = await bg.open();
const task = prompt + "\\n<!-- " + slot.commitment + " -->";
const sealed = await slot.seal(Buffer.from(task));`}</Code>
      </div>

      <h2 id="cli">Any language: the CLI</h2>
      <p>
        Every command takes <code>--json</code> and prints one JSON document, so anything that can spawn a process is integrated. <code>verify</code> exits 2 on FALSE or a corrupt block.
      </p>
      <div className="code-block">
        <div className="code-block-header"><span>shell</span><CopyCode /></div>
        <Code lang="text">{`npx bitgraph record run-042.log --json
npx bitgraph verify photo.bitgraph.jpg
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
