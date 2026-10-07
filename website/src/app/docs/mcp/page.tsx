import type { Metadata } from "next";
import Link from "next/link";
import { CopyCode } from "@/components/copy-code";
import { Code } from "@/components/code";

export const metadata: Metadata = {
  title: "MCP server",
  description:
    "Connect an AI agent to BitGraph over the Model Context Protocol: the hosted endpoint and the stdio package, setup per client, what each tool sends, and the task pattern.",
};

const MCP_URL = "https://bitgraph.ing/mcp";

/**
 * The practical entry point for an agent. The client step lists were checked
 * against the clients themselves; the tool facts are read from
 * app/mcp/route.ts (hosted) and packages/mcp (stdio). Every figure here is a
 * limit the code enforces: 40 files per open, 500 digests per check, a
 * 120-second slot, a restart at 23:59 UTC.
 */
export default function McpPage() {
  return (
    <article className="prose">
      <h1>MCP server</h1>
      <p className="lede">
        Connect an AI agent to BitGraph and let it make proofs of the files it works on. For anyone setting up Claude, Claude Code, ChatGPT, Cursor or VS Code, and for the engineer deciding what an agent is allowed to send.
      </p>

      <h2 id="servers">Two servers</h2>
      <p>
        BitGraph speaks the Model Context Protocol in two forms. Both make the same BitGraph on the same sequence; they differ in where the files are.
      </p>
      <dl className="terms">
        <dt>Hosted endpoint</dt>
        <dd>
          <code>{MCP_URL}</code>, Streamable HTTP, nothing to install and no key. Four tools: <code>bitgraph_open</code>, <code>bitgraph_commit</code>, <code>bitgraph_check</code>, <code>bitgraph_get_proof</code>. The agent hashes each file where it is and builds the new file itself from a recipe; a commit returns one export (bitgraph-export/1) per tree. Up to 40 files per call.
        </dd>
        <dt>stdio package</dt>
        <dd>
          <code>npx -y @mikeargento/bitgraph-mcp</code> (0.9.1, MIT), for clients that run on the machine that holds the files. Five tools: <code>bitgraph_record</code>, <code>bitgraph_open</code>, <code>bitgraph_commit</code>, <code>bitgraph_check</code>, <code>bitgraph_get_proof</code>. It reads files locally, folders of any size; one call makes one BitGraph of everything in it, a tree/1, and writes its export/1 beside the files with <Link href="/spec">SPEC.md</Link>.
        </dd>
      </dl>
      <div className="code-block">
        <div className="code-block-header"><span>MCP endpoint</span><CopyCode /></div>
        <Code lang="text">{MCP_URL}</Code>
      </div>
      <p className="note">
        The same URL serves both audiences: an MCP client gets the protocol, a browser gets this page.
      </p>

      <h2 id="connect">Connect</h2>
      <p>
        Every client wants the same thing: the URL, pasted where it keeps remote MCP servers, or the package command where it keeps local ones. Find yours and follow the steps.
      </p>

      <h3>Claude</h3>
      <p className="note">claude.ai, Claude Desktop, and the mobile apps.</p>
      <ol className="steps">
        <li>Open <strong>Customize</strong>, then <strong>Connectors</strong>.</li>
        <li>Click <strong>+</strong>, then <strong>Add custom connector</strong>.</li>
        <li>Paste the URL and click <strong>Add</strong>. Leave Advanced settings alone, there is no OAuth to configure.</li>
        <li>In a conversation, open the <strong>+</strong> menu at the lower left, choose <strong>Connectors</strong>, and switch BitGraph on.</li>
      </ol>
      <p>
        Step 4 is the one people miss: adding a connector does not turn it on, each conversation opts in. Free accounts can hold one custom connector. On Team and Enterprise an Owner adds it once under <strong>Organization settings</strong>, then <strong>Connectors</strong>, and everyone else clicks <strong>Connect</strong>.
      </p>

      <h3>Claude Code</h3>
      <p>One command, no menus. The hosted endpoint:</p>
      <div className="code-block">
        <div className="code-block-header"><span>Shell</span><CopyCode /></div>
        <Code lang="bash">{`claude mcp add --transport http bitgraph ${MCP_URL}`}</Code>
      </div>
      <p>Or the stdio package, for files and folders on this machine:</p>
      <div className="code-block">
        <div className="code-block-header"><span>Shell</span><CopyCode /></div>
        <Code lang="bash">{`claude mcp add bitgraph -- npx -y @mikeargento/bitgraph-mcp`}</Code>
      </div>
      <p>
        Run <code>claude mcp list</code> to confirm, or <code>/mcp</code> inside a session. BitGraph should read Connected.
      </p>

      <h3>ChatGPT</h3>
      <p className="note">
        Needs developer mode, which is a beta feature on Plus, Pro, Business, Enterprise, and Education accounts, on the web.
      </p>
      <ol className="steps">
        <li>Open <strong>Settings</strong>, then <strong>Security and login</strong>, and turn on <strong>Developer mode</strong>.</li>
        <li>Go to <strong>chatgpt.com/plugins</strong> and click <strong>+</strong>.</li>
        <li>Name it BitGraph, paste the URL, and choose <strong>No authentication</strong>. The URL already ends in <code>/mcp</code>, so paste it exactly as it is.</li>
        <li>Create the connection. ChatGPT lists the four tools it found, which is your confirmation that it worked.</li>
        <li>In a new chat, open the <strong>+</strong> menu, choose <strong>Developer mode</strong>, and select BitGraph.</li>
      </ol>
      <p>
        ChatGPT treats opening and committing as write actions and asks you to confirm each one, showing what it is about to send. Every new conversation starts from the same cautious default.
      </p>

      <h3>Cursor, VS Code, and everything else</h3>
      <p>
        Add the URL as a remote MCP server. Some clients label the transport <code>streamable-http</code> and some label it <code>http</code>; they are the same thing, and BitGraph speaks it. No key, no configuration. Clients that run local servers can use the package command above instead.
      </p>
      <p className="note">
        Client menus get renamed and moved. If a label above does not match what is in front of you, the URL is the part that matters: find wherever your client keeps remote MCP servers and paste it there.
      </p>

      <h2 id="done">You are done when</h2>
      <ol className="steps">
        <li>
          <strong>The client lists the tools.</strong> Four from the hosted endpoint, five from the package. Ask your agent:
          <div className="code-block">
            <div className="code-block-header"><span>Ask your agent</span><CopyCode /></div>
            <Code lang="text">Which tools does BitGraph offer?</Code>
          </div>
          That answer means the connection is live. Asking costs nothing and writes nothing.
        </li>
        <li>
          <strong>A proof of a file you named comes back and is saved beside it.</strong> Name a file, ask for a BitGraph of it. The agent hashes it, opens a position, builds the new file, commits, and saves the export next to the original: one bitgraph-export/1 per tree, named from the file, with <Link href="/spec">SPEC.md</Link> beside it. The export is saved whole and unedited, every field, including the proof&rsquo;s <code>environment.attestation.reportB64</code>: a proof missing <code>slotAllocation</code>, <code>environment</code> or the attestation cannot be verified. Earlier recordings saved a proof as <code>&lt;name&gt;.bitgraph-fuse.json</code> or one set proof; those still verify.
        </li>
      </ol>

      <h2 id="tools">What each tool sends</h2>
      <div className="table-scroll">
        <table className="table-k">
          <thead><tr><th>Tool</th><th>Sends</th><th>Returns</th><th>Writes</th></tr></thead>
          <tbody>
            <tr>
              <td>bitgraph_open</td>
              <td>Per file: its name, exact byte size, fingerprint (SHA-256 digest), and its first 16 bytes (up to 64), which decide the placement. Or no files at all: the task form below.</td>
              <td>Per file: a <code>fuse_token</code>, the placement, the recipe (bytes to append after the original, or a prefix and suffix around it), the position&rsquo;s counter and epoch, and the names for the new file and its export. Files opened together share one position and become one tree. A file BitGraph&rsquo;s copy already indexes, or one found in an earlier tree through its sealed recovery entry, comes back &ldquo;on record&rdquo; and is not opened unless <code>again</code> is true; a file whose lookup did not complete is not opened either, with the reason, because unknown is not new.</td>
              <td>Allocates a position, held 120 seconds.</td>
            </tr>
            <tr>
              <td>bitgraph_commit</td>
              <td>Per entry: the <code>fuse_token</code> and the digest of the new file built from its recipe. For a task token, the digest of the task bytes, with <code>carry: "base64url"</code>.</td>
              <td>One export (bitgraph-export/1) per tree in <code>exports[]</code>: the proof, the root document, and one file&rsquo;s leaf and path, or every leaf and name for several; plus every position the original&rsquo;s bytes now hold. Nothing is labelled fused unless the proof came back under the named position and verified.</td>
              <td>Commits: binds the tree&rsquo;s root and consumes the position. After it answers, keeps a sealed recovery entry per file.</td>
            </tr>
            <tr>
              <td>bitgraph_check</td>
              <td>Up to 500 digests.</td>
              <td>Per digest: <code>on_record</code>, every indexed position (with a set member&rsquo;s row), and a proof URL. A tree&rsquo;s files are not indexed by their own hash, so the digest lookup alone does not see them; since 0.9.2 the tool also asks each file&rsquo;s sealed recovery entry (for a path it verifies the file as that member; for a bare digest it reads the entry alone), so a tree member comes back on record with its leaf and the tree&rsquo;s proof page. A lookup that did not complete is said as unknown, never as not on record.</td>
              <td>Nothing. Read-only.</td>
            </tr>
            <tr>
              <td>bitgraph_get_proof</td>
              <td>A digest, or a BitGraph number in the current epoch; optionally a counter and epoch to select one position.</td>
              <td>The proof, every indexed position the same bytes hold, and its window: a floor in time (placed no earlier than a named Base block, or an Ethereum block on earlier proofs) and the ceiling in time once it exists (the Base block carrying a Merkle root over the proof&rsquo;s hash). An earlier proof also states its closing anchor, a bound in position, never a clock time.</td>
              <td>Nothing. Read-only.</td>
            </tr>
            <tr>
              <td>bitgraph_record<br /><span className="dim">package only</span></td>
              <td>File and folder paths, with <code>export_dir</code>, <code>exports</code> (owner, members, both, none), <code>again</code>, <code>as_is</code> and <code>recovery</code>. The package reads them on this machine; only digests, the root document, position records and each file&rsquo;s sealed recovery entry leave it.</td>
              <td>One BitGraph of everything in the call, a tree/1, each file with its leaf (one of N), the tree&rsquo;s position and proof page, and the export&rsquo;s path: the owner&rsquo;s export (every leaf and name) by default, one per member with <code>exports</code>, written into <code>export_dir</code> (default: beside the first path given, never inside a folder) with <Link href="/spec">SPEC.md</Link> beside it. Files already on record, including a file found in an earlier tree through its recovery entry, are returned as they are unless <code>again</code> is true.</td>
              <td>Allocates and commits in one call; writes export/1 beside the files and keeps a sealed recovery entry per file (<code>recovery: false</code> keeps none but still checks them).</td>
            </tr>
          </tbody>
        </table>
      </div>
      <p>
        Nothing else travels: only digests, sizes, a file&rsquo;s first bytes, position records, recipe bytes and the sealed recovery entries (which reveal nothing without the file), to either server. File contents never do, and originals are never modified.
      </p>
      <p>
        BitGraph keeps a copy of each proof the service makes, indexed by digest, so a check finds what was made through it; a tree&rsquo;s files are found through their sealed recovery entries instead, which open, record and check all ask. A miss is not a finding: the bytes may hold a BitGraph their holder keeps, so the agent is told to ask for that export before making another.
      </p>

      <h2 id="how">How the hosted endpoint makes a BitGraph</h2>
      <p>
        The endpoint never receives a file. If an agent can hash a file it can build the virtual new file and hash that, so the two steps are all it takes: hash the originals, open a position, build each new file exactly as its recipe says, hash it, commit them together. A batch is one position and one tree however many files it holds, and the commit returns one export per tree; the agent saves it beside the files with <Link href="/spec">SPEC.md</Link>. Only digests, byte sizes, a file&rsquo;s first bytes, the signed position record and the recipes cross the network. Agents with code execution, ChatGPT and Claude among them, do this on any files you give them.
      </p>
      <p>
        For clients that run on your machine, the stdio package does the same in one call from plain file paths, and makes one BitGraph of everything in the call: a folder of any size becomes one tree under one position, and its export is written beside the folder, never inside it. Each file is read once for its digest; the new files are never written.
      </p>

      <h2 id="task">The task pattern</h2>
      <p>
        An agent can take a position before it starts a task, so that the task&rsquo;s record could not have existed before that position&rsquo;s floor, and its outputs sit after it.
      </p>
      <ol className="steps">
        <li><strong>Before the task, call <code>bitgraph_open</code> with no files.</strong> It returns a position (its counter and epoch), its position commitment string, a <code>fuse_token</code>, and the floor block when the allocation returns one.</li>
        <li><strong>Put the commitment into the task&rsquo;s record.</strong> Inside the output itself when its format can hold text (a comment, a field, a line that stays in the file), otherwise inside the task: the exact prompt or request.</li>
        <li><strong>Within 120 seconds, call <code>bitgraph_commit</code></strong> with the <code>fuse_token</code>, the digest of those exact bytes, and <code>carry: "base64url"</code>. The bytes are sealed under the position. Keep them unchanged: a verifier recomputes the commitment from the proof and looks for the string inside them.</li>
        <li><strong>When the outputs exist, record them.</strong> Open a second position with the files and commit them. The task is sealed before the output existed, and the output is recorded after.</li>
      </ol>
      <p className="note">
        The proof establishes placement in the sequence. It does not establish that the task was carried out well, who ran it, or that the output is true.
      </p>

      <h2 id="notes">Notes</h2>
      <ul>
        <li><strong>Files are never uploaded.</strong> Only digests, byte sizes, a file&rsquo;s first bytes, signed position records, recipe bytes and the sealed recovery entries cross the network, to either server.</li>
        <li><strong>Positions are permanent.</strong> A consumed position is never reused, and the floor block it stands on stays in BitGraph&rsquo;s public copy under the ten-year lock. The export comes back to the agent, which keeps it beside the files with <Link href="/spec">SPEC.md</Link>; the proof alone commits only the tree&rsquo;s root. Agents are instructed to make BitGraphs only of files you asked for, and never to generate content just to record it.</li>
        <li><strong>Keep the export.</strong> It holds the proof, the root document and each file&rsquo;s leaf and name, no file copies and no anchors; with the file it checks offline with nothing of BitGraph&rsquo;s. <code>bitgraph export complete</code> from the <Link href="/docs/sdk">SDK</Link> adds the floor header, the Base ceiling and the Ethereum settlement once they exist.</li>
        <li><strong>Recovery entries.</strong> After each answer, the server keeps a sealed recovery entry per file, stored under a name derived from the file&rsquo;s hash and encrypted with a key derived from it: anyone holding the file can find and open it, nobody else. It is how a file finds its proof again when the export is lost, and how a file already in a tree is recognised before a new BitGraph is made.</li>
        <li><strong>One way.</strong> A BitGraph is a tree of new bytes built from the originals under a position that existed first, so those bytes could not have been finished before the position: that is what open and commit make, one file as a tree of one or a batch as one tree. Neither server offers digest-only recording; that compatibility operation stays on the HTTP API as <code>POST /api/commit</code>.</li>
        <li><strong>One tree per call.</strong> Everything opened together shares one position, becomes one tree and is committed in one call. A member left out cannot be added afterwards, because the position is consumed; it needs a new open. Earlier forms (sets, the Frame file) still verify; new recordings are tree/1.</li>
        <li><strong>One sequence.</strong> Whatever MCP makes takes its position in the same sequence as everything else, floored the same way, by the Base block the enclave binds when the position opens.</li>
        <li><strong>Limits and errors.</strong> 40 files per open on the hosted endpoint, 500 digests per check, a 120-second position, and a restart at 23:59 UTC every day that voids open positions. <code>no-anchor-before-slot</code> came only from earlier positions floored by an Ethereum anchor: nothing was committed and the position was still held. <code>slot-unavailable</code> means the position was consumed, expired or lost to a restart: open again and rebuild the new file from the new recipe.</li>
      </ul>

      <h2 id="next">Where next</h2>
      <ul className="doors">
        <li><Link href="/docs/integration">Integration guide</Link><span>The same operation from the CLI, the SDK, or two HTTP calls.</span></li>
        <li><Link href="/api-reference">API reference</Link><span>The routes the MCP servers call, with every status code.</span></li>
        <li><Link href="/docs/verification">Verification</Link><span>How to check the proof an agent saved, offline.</span></li>
        <li><Link href="/contact">Contact</Link><span>Licensing, evaluation and questions.</span></li>
      </ul>
    </article>
  );
}
