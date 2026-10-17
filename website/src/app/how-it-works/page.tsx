import type { Metadata } from "next";
import Link from "next/link";
import { PrimitiveFigure, SandwichFigure } from "@/components/primitive-figures";

/**
 * The one documentation page (Mike, 2026-10-17): the primitive, what the
 * payload decides, intervals, time as the side note it is, and how to make,
 * fetch and check a BitGraph. It replaced about thirty docs pages; every old
 * docs address redirects here (next.config.ts).
 *
 * ⚠️ Claim discipline: bound AFTER a moment, never "at" it. A floor comes from
 * reading a block in; a ceiling only from writing out (the Base write), and
 * records made before 2026-09-29 22:43 UTC have none.
 */

export const metadata: Metadata = {
  title: "How it works",
  description: "One atomic action inside a hardware enclave counts twice: a nonce nobody can see, then the payload. What the payload is decides what is proven. Two BitGraphs make an interval.",
};

const PCR0 = "d9128d67c406a30f988f74ece8b5cced5c9a96491289037f50bddb5f10aac2bc9d1d315dd7bf65428899ccde72b95b86";

const h2: React.CSSProperties = { fontSize: "clamp(24px, 2.8vw, 32px)", fontWeight: 700, letterSpacing: "-0.01em", margin: "72px 0 0" };
const p: React.CSSProperties = { fontSize: 18, lineHeight: 1.6, margin: "16px 0 0", maxWidth: 760 };
const pre: React.CSSProperties = { fontFamily: "var(--font-mono)", fontSize: 14, lineHeight: 1.6, background: "var(--code-bg, #f6f6f4)", border: "1px solid var(--line)", borderRadius: 10, padding: "14px 16px", overflowX: "auto", margin: "16px 0 0", maxWidth: 860 };

export default function HowItWorksPage() {
  return (
    <div className="frame" style={{ paddingTop: 56, paddingBottom: 104 }}>
      <h1 style={{ fontSize: "clamp(32px, 4.6vw, 52px)", fontWeight: 700, lineHeight: 1.1, letterSpacing: "-0.02em", margin: 0 }}>How it works</h1>

      <h2 style={{ ...h2, marginTop: 40 }}>One action, two counts</h2>
      <p style={p}>
        Inside a hardware enclave (AWS Nitro), one atomic action uses two counts of a counter. Count 1 is a fresh random value from the
        enclave&rsquo;s hardware: nobody outside sees it, not the world and not the operator, and it is used once. Count 2 is the
        payload, bound at the very next count; nothing can come between them. The enclave signs both and releases them together. If
        any step fails, nothing is released and the counter does not&nbsp;move.
      </p>
      <p style={p}>
        What that proves: these bits were bound <em>after</em> a moment nobody could predict, and could not have been bound before it.
        It needs no clock, no blockchain and no outside party. It says when the bits were bound, not how old the content is: the
        content could be a second old or ten years&nbsp;old.
      </p>
      <div style={{ marginTop: 36 }}><PrimitiveFigure /></div>

      <h2 style={h2}>The payload decides what is proven</h2>
      <p style={p}>The action never changes; only what goes into count 2 does. It is always a 32-byte hash, and the enclave never sees the content behind it.</p>
      <ul style={{ ...p, paddingLeft: 22 }}>
        <li><strong>A block hash</strong> ties the moment to world time: after this&nbsp;block.</li>
        <li><strong>A Merkle root</strong> binds any amount of data after one moment, and each item keeps its own path, so any one of them proves its place on its&nbsp;own.</li>
        <li><strong>An action, a decision or a record</strong> proves it was bound after the&nbsp;moment.</li>
        <li><strong>A prior BitGraph</strong> links moments into chains and&nbsp;intervals.</li>
      </ul>

      <h2 style={h2}>Two BitGraphs make an interval</h2>
      <p style={p}>
        BitGraph A at the start, BitGraph B at the end. Everything bound between them falls inside that interval in the sequence, and both
        ends are moments nobody could predict. Every BitGraph takes exactly two counts, so the counter runs straight through: a stretch from
        A to B accounts for every count, and nothing can be slipped in or held back&nbsp;afterward.
      </p>
      <div style={{ marginTop: 36 }}><SandwichFigure /></div>
      <p style={p}>
        The same shape covers challenge and response. A&rsquo;s random value is revealed in A&rsquo;s proof; a challenge generated from it
        could not have existed before A. Bind the answers in B, and the answers depend on a value nobody had before A, and are bound
        before&nbsp;B.
      </p>

      <h2 style={h2}>Time</h2>
      <p style={p}>
        Reading a block hash in gives a floor: after that block. A ceiling, &ldquo;by when&rdquo;, can only come from writing out to something
        public the operator does not control, so after a commit BitGraph writes a Merkle root over new records to Base. That write is the only
        part that costs anything; a BitGraph itself has no fee. Records made before the first Base write (2026-09-29 22:43 UTC) have no ceiling
        in&nbsp;time.
      </p>

      <h2 style={h2}>Make one, fetch one</h2>
      <p style={p}>Send a SHA-256; get the signed proof back. Your bytes never leave your machine.</p>
      <pre style={pre}>{`curl -X POST https://bitgraph.ing/api/commit \\
  -H 'content-type: application/json' \\
  -d '{"digests":[{"digestB64":"<sha-256, base64>","hashAlg":"sha256"}]}'`}</pre>
      <p style={p}>Every BitGraph is kept. Fetch a proof by its hash, here or on the <Link href="/ledger">ledger</Link>:</p>
      <pre style={pre}>{`curl https://bitgraph.ing/api/proofs/<sha-256, base64url>`}</pre>
      <p style={p}>For an AI agent, the MCP server:</p>
      <pre style={pre}>{`claude mcp add bitgraph -- npx -y @mikeargento/bitgraph-mcp`}</pre>

      <h2 style={h2}>Check a proof</h2>
      <p style={p}>
        A proof verifies offline with <code>@mikeargento/bitgraph-verify</code>: the enclave&rsquo;s signature, the hardware attestation, and the two
        counts. Pin the enclave&rsquo;s measurement; it is reproducible from the tagged source (<code>enclave-v11</code>):
      </p>
      <pre style={pre}>{PCR0}</pre>
    </div>
  );
}
