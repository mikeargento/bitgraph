import type { Metadata } from "next";
import { CopyUrl } from "./copy-url";

export const metadata: Metadata = {
  title: "MCP",
  description: "Connect an AI agent to BitGraph with one URL. Record files, check bytes, and fetch proofs over the Model Context Protocol.",
};

const MCP_URL = "https://bitgraph.ing/mcp";

export default function McpPage() {
  return (
    <article className="prose-doc">
      <h1 className="text-3xl sm:text-4xl font-semibold tracking-[-0.03em] mb-6">MCP</h1>
      <p className="text-[#1f2937] mb-10">
        BitGraph is an MCP server. Any AI agent that speaks the Model Context Protocol can
        record files, check whether bytes are on record, and fetch proofs with one URL.
      </p>

      <div className="code-block">
        <div className="code-block-header">
          <span>MCP endpoint</span>
          <CopyUrl text={MCP_URL} />
        </div>
        <pre className="text-xs font-mono leading-relaxed text-[#1f2937] overflow-x-auto">{MCP_URL}</pre>
      </div>
      <p className="text-sm text-[#4b5563] mt-3 mb-10">
        The same URL serves both audiences: an MCP client gets the protocol, a browser gets
        this page.
      </p>

      <h2 className="text-xl font-semibold mt-12 mb-4">Connect</h2>
      <p className="text-[#1f2937] mb-4">
        <strong className="text-text">claude.ai</strong> · Settings, then Connectors, then
        Add custom connector. Paste the URL.
      </p>
      <p className="text-[#1f2937] mb-4">
        <strong className="text-text">Claude Code</strong>
      </p>
      <div className="code-block">
        <div className="code-block-header"><span>Shell</span></div>
        <pre className="text-xs font-mono leading-relaxed text-[#1f2937] overflow-x-auto">{`claude mcp add --transport http bitgraph ${MCP_URL}`}</pre>
      </div>
      <p className="text-[#1f2937] mt-6 mb-4">
        <strong className="text-text">ChatGPT</strong> · Requires Developer Mode. Enable it
        in settings, then add the URL as a custom connector.
      </p>
      <p className="text-[#1f2937] mb-4">
        <strong className="text-text">Other clients</strong> · Cursor, VS Code, and any
        other client that supports remote MCP servers: add the URL as a Streamable HTTP
        server. No key, no configuration.
      </p>

      <h2 className="text-xl font-semibold mt-12 mb-4">Three tools</h2>
      <ul className="space-y-2 text-sm text-[#1f2937]">
        <li>• <strong className="text-text">bitgraph_record</strong> · Take a BitGraph: record a file&apos;s SHA-256 digest at a new causal position. Bytes already on record come back with their existing proof; <span className="font-mono text-xs">again=true</span> deliberately records the same bytes at a new position.</li>
        <li>• <strong className="text-text">bitgraph_check</strong> · Is this file on record? Read-only, every causal position, with proof page URLs.</li>
        <li>• <strong className="text-text">bitgraph_get_proof</strong> · Fetch a proof and its Ethereum anchor window: BitGraphed between block X and block Y.</li>
      </ul>

      <h2 className="text-xl font-semibold mt-12 mb-4">Working with local files</h2>
      <p className="text-[#1f2937] mb-4">
        The hosted endpoint accepts digests, not files: the agent hashes a file where it
        lives and sends only the SHA-256. For clients that run on your machine, the stdio
        package does the hashing itself and takes plain file paths:
      </p>
      <div className="code-block">
        <div className="code-block-header"><span>Shell</span></div>
        <pre className="text-xs font-mono leading-relaxed text-[#1f2937] overflow-x-auto">{`claude mcp add bitgraph -- npx -y @mikeargento/bitgraph-mcp`}</pre>
      </div>

      <h2 className="text-xl font-semibold mt-12 mb-4">Notes</h2>
      <ul className="space-y-2 text-sm text-[#1f2937]">
        <li>• <strong className="text-text">Files are never uploaded.</strong> Only the SHA-256 digest crosses the network, to either endpoint.</li>
        <li>• <strong className="text-text">Recordings are permanent.</strong> The ledger has 10-year retention and no deletes. Agents are instructed to record only files you asked to record.</li>
        <li>• <strong className="text-text">A BitGraph is a selection.</strong> The record tool takes the digest of a file that already exists; it does not create anything.</li>
        <li>• <strong className="text-text">One ledger.</strong> A recording made through MCP is indistinguishable from one made by dropping the file on the site, and shows up on the same Roll.</li>
      </ul>
    </article>
  );
}
