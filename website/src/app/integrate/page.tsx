import type { Metadata } from "next";
import { CopyCode } from "@/components/copy-code";
import { PUBLISHED_PCR0 } from "@/lib/enclave-measurements";

/**
 * Integrate (2026-10-27): the managed service's real interface, from the code: /api/commit (website/src/app/api/commit),
 * the lookups (api/proofs, api/proofs/batch), the SDK (packages/sdk 0.7.4), the MCP servers (packages/mcp 0.12.0, the
 * hosted /mcp route) and the verifier (packages/verify 1.26.0, MIT). The verify snippet was run against the v13 sample.
 */
export const metadata: Metadata = {
  title: "Integrate",
  description: "Add BitGraph to your product: send a SHA-256, get a proof. The HTTP API, collections, the SDK and CLI, MCP for agents, and verifying proofs inside your own product.",
};

function Code({ children }: { children: string }) {
  return (
    <div className="code-block mk-code">
      <pre className="hiw-code">{children}</pre>
      <CopyCode />
    </div>
  );
}

const SECTIONS = [
  ["i-api", "HTTP API"],
  ["i-collections", "Collections"],
  ["i-sdk", "SDK and CLI"],
  ["mcp", "MCP for agents"],
  ["i-verify", "Verify in your product"],
  ["i-volume", "Production volume"],
] as const;

export default function IntegratePage() {
  return (
    <div className="frame home home-typing prose home-scroll docs-page tools-page sx-page">
      <div className="home-hero"><h1 className="sr-only">Integrate.</h1></div>

      <section className="home-section" aria-labelledby="i-intro">
        <p className="home-kicker">Integrate</p>
        <h2 id="i-intro">Send a SHA-256. Get a proof.</h2>
        <p>
          The recording step is one call. Your system hashes what it already produces, sends the 32-byte digest, and stores the proof
          that comes back beside its own record. Your content never leaves your systems, and the proofs check without BitGraph.
        </p>
        <ol className="tl-steps">
          <li><strong>Hash</strong> the asset, credential, log entry or release you already have.</li>
          <li><strong>Bind</strong> the digest through the API, the SDK or MCP. One item or a whole collection.</li>
          <li><strong>Store</strong> the proof JSON with your record, and show what it establishes in your own product.</li>
          <li><strong>Verify</strong> anywhere, with the open verifier, offline.</li>
        </ol>
      </section>

      <div className="tl-body">
        <nav className="tl-toc" aria-label="On this page">
          <p className="tl-label">On this page</p>
          <ul>{SECTIONS.map(([id, t]) => <li key={id}><a href={`#${id}`}>{t}</a></li>)}</ul>
        </nav>

        <div className="tl-main">
          <section className="home-section" aria-labelledby="i-api">
            <p className="home-kicker">HTTP API</p>
            <h2 id="i-api">Nothing to install.</h2>
            <p>Bind one digest, or many in one request (base64 SHA-256):</p>
            <Code>{`curl -X POST https://bitgraph.ing/api/commit \\
  -H 'content-type: application/json' \\
  -d '{"digests":[{"digestB64":"<sha-256, base64>","hashAlg":"sha256"}]}'`}</Code>
            <p>
              The reply holds one proof per digest sent. Each bind through this endpoint also gets its Base floor, and its
              proof hash is queued for a Base ceiling. Every proof is kept and can be fetched by the digest it bound, earliest first:
            </p>
            <Code>{`curl https://bitgraph.ing/api/proofs/<sha-256, base64url>
# {"proofs":[{"proof":{…},"writeTime":…}, …]}

curl -X POST https://bitgraph.ing/api/proofs/batch \\
  -H 'content-type: application/json' -d '{"digests":["<b64url>", …]}'   # up to 2,000 per call`}</Code>
            <p className="sx-fine">
              A 503 with <code>&quot;code&quot;:&quot;tee-restarting&quot;</code> means the enclave is starting a new epoch; retry after a
              few seconds. A 429 carries <span className="nb"><code>Retry-After</code>.</span>
            </p>
          </section>

          <section className="home-section" aria-labelledby="i-collections">
            <p className="home-kicker">Collections</p>
            <h2 id="i-collections">Thousands of items, one bind.</h2>
            <p>
              Build an RFC 6962 tree over your items&rsquo; SHA-256s on your side (leaf = SHA-256(0x00 ‖ digest), node = SHA-256(0x01 ‖
              left ‖ right), an odd last node rises), and bind the SHA-256 of this exact text:
            </p>
            <Code>{"Merkle root (RFC 6962, SHA-256; each leaf is a file's SHA-256) of <N> files:\n<root, hex>\n"}</Code>
            <p>
              Keep each item&rsquo;s path of sibling hashes. With it, any single item verifies against the one proof on its own, and the
              verifier reports which item of how many it is. Up to 1,000,000 items per tree.
            </p>
          </section>

          <section className="home-section" aria-labelledby="i-sdk">
            <p className="home-kicker">SDK and CLI</p>
            <h2 id="i-sdk">JavaScript, TypeScript, or any language that runs a command.</h2>
            <Code>{"npm install @mikeargento/bitgraph-sdk"}</Code>
            <Code>{`import { BitGraph } from "@mikeargento/bitgraph-sdk";

const bg = new BitGraph();
const [b] = await bg.bind("run-042.log");   // hashed locally; the proof is saved as run-042.log.bitgraph.json
console.log(b.number, b.proofUrl);`}</Code>
            <Code>{`npx -p @mikeargento/bitgraph-sdk bitgraph make run-042.log --json
npx -p @mikeargento/bitgraph-sdk bitgraph check run-042.log --json`}</Code>
            <p className="sx-fine">MIT licensed. <code>--api-key</code> or <code>BITGRAPH_API_KEY</code> for keyed access. Full reference: <a href="/tools">Docs</a>.</p>
          </section>

          <section className="home-section" aria-labelledby="mcp">
            <p className="home-kicker">MCP for agents</p>
            <h2 id="mcp">One tool call from any agent.</h2>
            <p>The local server hashes files where they are and saves each proof beside its file:</p>
            <Code>{`{
  "mcpServers": {
    "bitgraph": { "command": "npx", "args": ["-y", "@mikeargento/bitgraph-mcp"] }
  }
}`}</Code>
            <p>
              Tools: <span className="nb"><code>bitgraph_record</code>,</span> <span className="nb"><code>bitgraph_check</code>,</span> <span className="nb"><code>bitgraph_get_proof</code>.</span> Clients that connect by URL
              use <span className="nb"><code>https://bitgraph.ing/mcp</code>,</span> which binds digests (<code>bitgraph_bind</code>) and looks them up.
            </p>
          </section>

          <section className="home-section" aria-labelledby="i-verify">
            <p className="home-kicker">Verify in your product</p>
            <h2 id="i-verify">Your users check proofs without you, or us.</h2>
            <p>The verifier is its own MIT package. In your code:</p>
            <Code>{`npm install @mikeargento/bitgraph-verify`}</Code>
            <Code>{`import { verifyAttested } from "@mikeargento/bitgraph-verify";

const r = await verifyAttested({ proof, bytes });
r.valid          // true: attestation, published image, digest, signature, slot all check
r.attestedAtMs   // the hardware's signed time of the bind
r.image          // { version: "v13", since: "2026-10-19" }
r.treeMember     // { index, files } for an item of a collection`}</Code>
            <p>Or from a shell, pinning the measurement so nothing else is accepted:</p>
            <Code>{`npx @mikeargento/bitgraph-sdk verify <file> --proof <file>.bitgraph.json --pcr0 ${PUBLISHED_PCR0}`}</Code>
          </section>

          <section className="home-section" aria-labelledby="i-volume">
            <p className="home-kicker">Production volume</p>
            <h2 id="i-volume">Keys, limits and terms.</h2>
            <p>
              The public endpoint is rate-limited per address and in total, which is plenty for evaluation. Production integrations use an
              API key, which lifts those limits, under managed-recording terms. For a deployment you operate yourself, see{" "}
              <a href="/licensing">Licensing</a>.
            </p>
            <div className="sx-cta">
              <a className="bg-action-link is-make" href="/evaluate">Evaluate the technology</a>
              <a className="bg-action-link" href="/licensing#lic-form">Request an API key</a>
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}
