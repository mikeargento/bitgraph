import type { Metadata } from "next";
import { CopyCode } from "@/components/copy-code";
import { DropBox } from "@/components/drop-box";
import { TerminalLine } from "@/components/terminal-line";
import { PUBLISHED_PCR0 } from "@/lib/enclave-measurements";

/**
 * Make or check a BitGraph: the drop box, the same for software, and one sentence on everything else.
 * Split off the home page (Mike, 2026-10-17: "everything from Try it down can be its own page").
 */

export const metadata: Metadata = {
  title: "Make a BitGraph",
  description:
    "Make or check a BitGraph: drop a file (it is hashed in your browser; only its SHA-256 is sent), or send a SHA-256 from software and get the proof.",
};

export default function MakePage() {
  return (
    <div className="frame home home-typing prose home-scroll">
      <div className="home-hero">
        <TerminalLine text="Make or check a BitGraph." />
        <div style={{ marginTop: 32 }}>
          <DropBox />
        </div>
      </div>

      <section className="home-section" aria-labelledby="home-software">
        <p className="home-kicker">For software</p>
        <h2 id="home-software">Send a SHA-256, get the&nbsp;proof.</h2>
        <div className="code-block mk-code"><pre className="hiw-code">{`curl -X POST https://bitgraph.ing/api/commit \\
  -H 'content-type: application/json' \\
  -d '{"digests":[{"digestB64":"<sha-256, base64>","hashAlg":"sha256"}]}'`}</pre><CopyCode /></div>
        <p style={{ marginTop: 20 }}>Every BitGraph is kept. Fetch one by its hash, here or on the <a href="/ledger">ledger</a>:</p>
        <div className="code-block mk-code"><pre className="hiw-code">{`curl https://bitgraph.ing/api/proofs/<sha-256, base64url>`}</pre><CopyCode /></div>
        <p style={{ marginTop: 20 }}>For an AI agent:</p>
        <div className="code-block mk-code"><pre className="hiw-code">{`claude mcp add bitgraph -- npx -y @mikeargento/bitgraph-mcp`}</pre><CopyCode /></div>
        <p style={{ marginTop: 20 }}>
          A proof checks offline with <code>@mikeargento/bitgraph-verify</code>. Pin the enclave&rsquo;s measurement, reproducible from the
          published&nbsp;source:
        </p>
        <div className="code-block mk-code"><pre className="hiw-code">{PUBLISHED_PCR0}</pre><CopyCode /></div>
      </section>

      <section className="home-section" aria-label="Everything else">
        <p>
          Anyone can put a recent block hash in a file or write a file&rsquo;s hash to a blockchain. Neither requires BitGraph, and
          neither gives the file a position of its own.
        </p>
        <p style={{ marginTop: 16 }}>
          BitGraph does. It binds the file to a fresh, unpredictable value used exactly once, at a unique position in an unbroken
          sequence. That position can never be reused, reassigned, or occupied by anything&nbsp;else.
        </p>
      </section>
    </div>
  );
}
