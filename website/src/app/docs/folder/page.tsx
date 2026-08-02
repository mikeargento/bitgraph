import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "BitGraph Folder",
  description: "A folder on your Desktop that records what you put in it. Drop a file, get back its proof and the Ethereum anchors that bracket it.",
};

const DOWNLOAD = "https://github.com/mikeargento/bitgraph/releases/latest/download/BitGraphFolder.pkg";
const SOURCE = "https://github.com/mikeargento/bitgraph/tree/main/packages/folder";

/** Actions are blue arrow links, never buttons. */
function Action({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <a href={href} className="text-[#0065A4] font-semibold no-underline">
      {children} →
    </a>
  );
}

export default function FolderPage() {
  return (
    <article className="prose-doc">
      <h1 className="text-3xl sm:text-4xl font-semibold tracking-[-0.03em] mb-6">BitGraph Folder</h1>
      <p className="text-[#1f2937] mb-8">
        A folder on your Desktop that records what you put in it. Drop a file in and it comes
        back wrapped in its proof: the causal position it occupies, and the Ethereum anchors
        that bracket it.
      </p>

      <p className="mb-2">
        <Action href={DOWNLOAD}>Download for macOS</Action>
      </p>
      <p className="text-sm text-[#4b5563] mb-10">
        Signed and notarized by Apple, so it opens without a warning. Needs macOS and{" "}
        <a href="https://nodejs.org" className="text-[#0065A4] font-medium no-underline">node</a>{" "}
        18 or newer. <Action href={SOURCE}>Read the source</Action>
      </p>

      <h2 className="text-xl font-semibold mt-12 mb-4">What happens when you drop a file</h2>
      <p className="text-[#1f2937] mb-4">
        The file is hashed on your machine. If those exact bytes are already on record you get
        the existing proof back. If not, they are recorded at a new causal position. Either
        way the file is then moved into an export folder beside it:
      </p>
      <div className="code-block">
        <div className="code-block-header"><span>BitGraph</span></div>
        <pre className="text-xs font-mono leading-relaxed text-[#1f2937] overflow-x-auto">{`bitgraph-proof-1858/
    proof.json
    sunset.jpg
    ethereum-anchors/
        anchor-before.json    anchor-before-witness.json
        anchor-after.json     anchor-after-witness.json`}</pre>
      </div>
      <p className="text-[#1f2937] mb-10">
        That is the same export you would get by recording the file here and downloading it
        from its proof page. Identical layout, so the two are interchangeable.
      </p>

      <h2 className="text-xl font-semibold mt-12 mb-4">Your files never leave your machine</h2>
      <p className="text-[#1f2937] mb-10">
        Only the SHA-256 digest is sent. Not the file, not its contents, not its name. A
        digest is 32 bytes and says nothing about what it came from. The tool talks to one
        host, bitgraph.ing, and every request it makes is either a lookup or a recording of
        something you put in the folder deliberately.
      </p>

      <h2 className="text-xl font-semibold mt-12 mb-4">Before you install it</h2>
      <ul className="space-y-2 text-sm text-[#1f2937] mb-10">
        <li>• <strong className="text-text">Recordings are permanent and public.</strong> The ledger has ten-year retention and no deletes. Anyone holding the same bytes can look them up. Put files in this folder only when you mean to record them.</li>
        <li>• <strong className="text-text">It runs in the background.</strong> A launchd agent watches the folder and wakes only when it changes. There is no polling and nothing resident in memory.</li>
        <li>• <strong className="text-text">Dropping the same bytes twice does nothing new.</strong> The second drop returns the existing proof. Recording the same file at a second position is a deliberate act, not something a folder does to you by accident.</li>
      </ul>

      <h2 className="text-xl font-semibold mt-12 mb-4">Checking an export</h2>
      <p className="text-[#1f2937] mb-4">
        Every export folder audits offline, with no network and no account:
      </p>
      <div className="code-block">
        <div className="code-block-header"><span>Shell</span></div>
        <pre className="text-xs font-mono leading-relaxed text-[#1f2937] overflow-x-auto">npx @mikeargento/bitgraph-audit bitgraph-proof-1858</pre>
      </div>
      <p className="text-[#1f2937] mb-4">
        Expect exit code 2, and expect that to be fine. An export holds one proof and its two
        bracketing anchors, lifted out of a chain thousands of proofs long, so the tool
        reports the positions it cannot see. It is built to audit whole epochs. What should
        come back clean is <code>failed: 0</code>, <code>fullyVerified: 1</code>, every
        attestation validated and bound, and both block hashes recomputed from their headers.
      </p>
      <p className="text-[#1f2937] mb-10">
        To check only the bytes, skip the tool: <code>shasum -a 256 sunset.jpg</code> and
        compare against <code>artifact.digestB64</code> in the proof.
      </p>

      <h2 className="text-xl font-semibold mt-12 mb-4">Why the Desktop item is a link</h2>
      <p className="text-[#1f2937] mb-10">
        The real folder lives at <code>~/BitGraph</code> and the Desktop item points to it.
        That is load-bearing rather than cosmetic. macOS denies background agents access to
        the Desktop, Documents, and Downloads folders, and a watcher aimed straight at the
        Desktop runs, exits successfully, and silently sees nothing at all. Keeping the real
        folder outside those directories means your drops land somewhere the agent can read,
        and no permission prompt is ever needed.
      </p>

      <h2 className="text-xl font-semibold mt-12 mb-4">Updating</h2>
      <p className="text-[#1f2937] mb-10">
        There is no auto-update, on purpose. A tool that watches a folder should not also run
        a background process that phones home on its own schedule. To update, download the
        current version and install it over the top; your folder, your exports, and the record
        of what has already been recorded are all preserved.
      </p>

      <h2 className="text-xl font-semibold mt-12 mb-4">Other ways to record</h2>
      <p className="mb-2"><Action href="/">Drop a file on the home page</Action></p>
      <p className="mb-4"><Action href="/docs/mcp">Connect an AI agent over MCP</Action></p>
      <p className="text-sm text-[#4b5563]">
        All three write to the same ledger and produce the same proofs. A recording made in
        the folder is indistinguishable from one made here, and shows up on the same Roll.
      </p>
    </article>
  );
}
