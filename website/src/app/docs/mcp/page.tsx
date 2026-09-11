import type { Metadata } from "next";
import { CopyUrl } from "./copy-url";
import { CopyCode } from "@/components/copy-code";

export const metadata: Metadata = {
  title: "MCP",
  description: "Connect an AI agent to BitGraph with one URL. Make BitGraphs of files over the Model Context Protocol.",
};

const MCP_URL = "https://bitgraph.ing/mcp";

/** Numbered setup steps. Grey tabular numeral, same treatment as the
 *  verification page's algorithm steps. UI labels inside a step are bolded. */
function Steps({ items }: { items: React.ReactNode[] }) {
  return (
    <ol className="mb-4">
      {items.map((item, i) => (
        <li key={i} className="flex text-[#1f2937] mb-2 leading-relaxed">
          <span className="text-[#4b5563] mr-3 tabular-nums shrink-0">{i + 1}.</span>
          <span>{item}</span>
        </li>
      ))}
    </ol>
  );
}

/** A literal label as it appears in the client's own interface. */
function Ui({ children }: { children: React.ReactNode }) {
  return <strong className="text-text font-semibold">{children}</strong>;
}

export default function McpPage() {
  return (
    <article className="prose-doc">
      <h1 className="mb-6">MCP</h1>
      <p className="text-[#1f2937] mb-10">
        BitGraph is an MCP server. Any AI agent that speaks the Model Context Protocol can
        make BitGraphs of files with one
        URL. It needs nothing more than the ability to hash a file: the file itself never
        leaves the agent.
      </p>

      <div className="code-block">
        <div className="code-block-header">
          <span>MCP endpoint</span>
          <CopyUrl text={MCP_URL} />
        </div>
        <pre className="text-xs font-mono leading-relaxed text-[#1f2937] overflow-x-auto">{MCP_URL}</pre>
      </div>
      <p className="text-base text-[#4b5563] mt-3 mb-10">
        The same URL serves both audiences: an MCP client gets the protocol, a browser gets
        this page.
      </p>

      <h2 className="text-xl font-semibold mt-12 mb-4">Connect</h2>
      <p className="text-[#1f2937] mb-8">
        There is nothing to install and no key to request. Every client below wants the same
        thing: that URL, pasted where it keeps remote MCP servers. Find yours and follow the
        three or four steps.
      </p>

      <h3 className="text-base font-semibold mt-8 mb-3">Claude</h3>
      <p className="text-base text-[#4b5563] mb-3">
        claude.ai, Claude Desktop, and the mobile apps.
      </p>
      <Steps
        items={[
          <>Open <Ui>Customize</Ui>, then <Ui>Connectors</Ui>.</>,
          <>Click <Ui>+</Ui>, then <Ui>Add custom connector</Ui>.</>,
          <>Paste the URL and click <Ui>Add</Ui>. Leave Advanced settings alone, there is no OAuth to configure.</>,
          <>In a conversation, open the <Ui>+</Ui> menu at the lower left, choose <Ui>Connectors</Ui>, and switch BitGraph on.</>,
        ]}
      />
      <p className="text-base text-[#4b5563] mb-8">
        Step 4 is the one people miss: adding a connector does not turn it on, each
        conversation opts in. Free accounts can hold one custom connector. On Team and
        Enterprise an Owner adds it once under <Ui>Organization settings</Ui>,
        then <Ui>Connectors</Ui>, and everyone else clicks <Ui>Connect</Ui>.
      </p>

      <h3 className="text-base font-semibold mt-8 mb-3">Claude Code</h3>
      <p className="text-[#1f2937] mb-4">One command, no menus.</p>
      <div className="code-block">
        <div className="code-block-header"><span>Shell</span><CopyCode /></div>
        <pre className="text-xs font-mono leading-relaxed text-[#1f2937] overflow-x-auto">{`claude mcp add --transport http bitgraph ${MCP_URL}`}</pre>
      </div>
      <p className="text-base text-[#4b5563] mb-8">
        Run <code>claude mcp list</code> to confirm, or <code>/mcp</code> inside a session.
        BitGraph should read Connected.
      </p>

      <h3 className="text-base font-semibold mt-8 mb-3">ChatGPT</h3>
      <p className="text-base text-[#4b5563] mb-3">
        Needs developer mode, which is a beta feature on Plus, Pro, Business, Enterprise, and
        Education accounts, on the web.
      </p>
      <Steps
        items={[
          <>Open <Ui>Settings</Ui>, then <Ui>Security and login</Ui>, and turn on <Ui>Developer mode</Ui>.</>,
          <>Go to <Ui>chatgpt.com/plugins</Ui> and click <Ui>+</Ui>.</>,
          <>Name it BitGraph, paste the URL, and choose <Ui>No authentication</Ui>. The URL already ends in <code>/mcp</code>, so paste it exactly as it is.</>,
          <>Create the connection. ChatGPT lists the four tools it found, which is your confirmation that it worked.</>,
          <>In a new chat, open the <Ui>+</Ui> menu, choose <Ui>Developer mode</Ui>, and select BitGraph.</>,
        ]}
      />
      <p className="text-base text-[#4b5563] mb-8">
        ChatGPT treats opening and committing as write actions and asks you to confirm
        each one, showing what it is about to send.  Every new conversation starts from the same cautious default.
      </p>

      <h3 className="text-base font-semibold mt-8 mb-3">Cursor, VS Code, and everything else</h3>
      <p className="text-[#1f2937] mb-4">
        Add the URL as a remote MCP server. Some clients label the transport
        <code> streamable-http</code> and some label it <code>http</code>; they are the same
        thing, and BitGraph speaks it. No key, no configuration.
      </p>
      <p className="text-base text-[#4b5563] mb-8">
        Client menus get renamed and moved. If a label above does not match what is in front
        of you, the URL is the part that matters: find wherever your client keeps remote MCP
        servers and paste it there.
      </p>

      <h2 className="text-xl font-semibold mt-12 mb-4">Check that it worked</h2>
      <p className="text-[#1f2937] mb-4">
        Point your agent at any file you have and ask:
      </p>
      <div className="code-block">
        <div className="code-block-header"><span>Ask your agent</span><CopyCode /></div>
        <pre className="text-xs font-mono leading-relaxed text-[#1f2937] overflow-x-auto">Which tools does BitGraph offer?</pre>
      </div>
      <p className="text-[#1f2937] mb-10">
        A
        connected client lists the four tools below; that answer means the connection is live.
        Asking costs nothing and writes nothing. Making a BitGraph is a deliberate second step,
        and the proof it returns is the record: BitGraph does not keep a copy, so the agent
        should save it next to the file.
      </p>

      <h2 className="text-xl font-semibold mt-12 mb-4">Four tools</h2>
      <ul className="space-y-2 text-sm text-[#1f2937]">
        <li>• <strong className="text-text">bitgraph_open</strong> · Make a BitGraph, step one. The agent sends each file&apos;s name, size, SHA-256 digest and first 16 bytes. An unused slot is allocated at the boundary before any new file exists, and the agent gets back, per file, a token and a recipe: the exact bytes the new file adds after the original (<span className="font-mono text-xs">trailer/1</span>, for formats that ignore trailing data) or around it (<span className="font-mono text-xs">container/2</span>, a tar that carries the original untouched and first). Files opened together share the one slot: they are one BitGraph, a set.</li>
        <li>• <strong className="text-text">bitgraph_commit</strong> · Step two. The agent builds each new file from its recipe, hashes it, and sends every token and digest in one call. For a set the manifest of those digests is committed under the shared slot with the signed marker, and the agent gets back one proof for the whole batch with each file&apos;s row; a single file gets its own proof and Frame. New files are virtual: an original plus the proof rebuilds its new file. That proof is the record: BitGraph does not keep a copy, so save it next to the originals.</li>
        <li>• <strong className="text-text">bitgraph_check</strong> · Read-only. Reports whether BitGraph still indexes a proof for the bytes, which is true only of recordings made before 8 September 2026. A miss is not a finding: BitGraph no longer indexes new proofs, which live with whoever holds them.</li>
        <li>• <strong className="text-text">bitgraph_get_proof</strong> · Fetch an indexed proof (made before 8 September 2026) and its floor: placed no earlier than Ethereum block X.</li>
      </ul>

      <h2 className="text-xl font-semibold mt-12 mb-4">How the hosted endpoint makes a BitGraph</h2>
      <p className="text-[#1f2937] mb-4">
        The endpoint never receives a file. If an agent can hash a file it can build the
        virtual new file and hash that, so the two steps above are all it takes: hash the
        originals, open a slot, build each new file exactly as its recipe says, hash it, commit
        them together. A batch is one position however many files it holds, the same as the Recorder. Only digests, byte sizes, a file&apos;s first bytes, the signed slot record
        and the recipes cross the network. Agents with code execution, ChatGPT and Claude among
        them, do this on any files you give them.
      </p>
      <p className="text-[#1f2937] mb-4">
        For clients that run on your machine, the stdio package does the same in one call from
        plain file paths, and makes one BitGraph of everything in the call: a folder of any size
        becomes one set under one slot, the way the Recorder does. Each file is read once
        for its digest; the new files are never written.
      </p>
      <div className="code-block">
        <div className="code-block-header"><span>Shell</span><CopyCode /></div>
        <pre className="text-xs font-mono leading-relaxed text-[#1f2937] overflow-x-auto">{`claude mcp add bitgraph -- npx -y @mikeargento/bitgraph-mcp`}</pre>
      </div>

      <h2 className="text-xl font-semibold mt-12 mb-4">Notes</h2>
      <ul className="space-y-2 text-sm text-[#1f2937]">
        <li>• <strong className="text-text">Files are never uploaded.</strong> Only SHA-256 digests, byte sizes, a file&apos;s first bytes, signed slot records and recipe bytes cross the network, to either endpoint.</li>
        <li>• <strong className="text-text">Positions are permanent.</strong> A consumed slot is never reused, and the anchors that floor it stay published for ten years. The proof itself comes back to the agent, which keeps it. Agents are instructed to make BitGraphs only of files you asked for.</li>
        <li>• <strong className="text-text">One way.</strong> A BitGraph is new bytes built from the original under a slot that existed first, so those bytes could not have been finalized before the slot: that is what open and commit make, one file on its own or a batch as one set. The endpoint offers no digest-only recording.</li>
        <li>• <strong className="text-text">One sequence.</strong> Whatever MCP makes takes its position in the same sequence as everything else, floored by the same anchors. The proof is returned to the agent, not kept by BitGraph.</li>
      </ul>
    </article>
  );
}
