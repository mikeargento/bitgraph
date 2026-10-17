import type { Metadata } from "next";
import Link from "next/link";
import { PrimitiveFigure, SandwichFigure } from "@/components/primitive-figures";
import { PUBLISHED_PCR0 } from "@/lib/enclave-measurements";

/**
 * The one documentation page (Mike, 2026-10-17): one enclave, two steps, one
 * atomic action, and nothing that buries it ("all other cool fun things that
 * have already been invented are like ornaments on the christmas tree and the
 * christmas tree is bitgraph"). The docs pages' own look: an article, a lede,
 * sections. Every old docs address redirects here (next.config.ts).
 *
 * ⚠️ Claim discipline: bound AFTER a moment, never "at" it. The time a proof
 * shows is the enclave's own signed time.
 */

export const metadata: Metadata = {
  title: "How it works",
  description: "One enclave, two steps, one atomic action: a nonce nobody can see, then your file's fingerprint, signed together with the enclave's time.",
};

export default function HowItWorksPage() {
  return (
    <div style={{ width: "90%", maxWidth: "var(--frame)", margin: "0 auto", padding: "56px 0 96px" }}>
      <article className="prose">
        <h1>How it works</h1>
        <p className="lede">One enclave, two steps, one atomic action.</p>

        <h2>The two steps</h2>
        <p>
          Inside a hardware enclave (AWS Nitro), one atomic action uses two counts of a counter. Step 1 is a fresh random value from the
          enclave&rsquo;s hardware: nobody outside sees it, not the world and not the operator, and it is used once. Step 2 binds your
          file&rsquo;s SHA-256 at the very next count; nothing can come between them. The enclave signs both, with its own time, and
          releases them together. If any step fails, nothing is released and the counter does not&nbsp;move.
        </p>
        <div style={{ margin: "32px 0" }}><PrimitiveFigure /></div>

        <h2>What it proves</h2>
        <p>
          These bits were bound <em>after</em> a moment nobody could predict, and could not have been bound before it. It needs no clock
          you have to trust, no blockchain and no outside party. It says when the bits were bound, not how old the content is: the
          content could be a second old or ten years&nbsp;old.
        </p>
        <p>
          Your file never leaves your machine. Only its SHA-256 goes into the enclave, so the same action works for a photo, a dataset, a
          model&rsquo;s answer, or a million files under one Merkle&nbsp;root.
        </p>

        <h2>Two BitGraphs make an interval</h2>
        <p>
          BitGraph A at the start, BitGraph B at the end. Everything bound between them falls inside that interval, and both ends are
          moments nobody could predict. Every BitGraph takes exactly two counts, so the counter runs straight through: nothing can be
          slipped in or held back&nbsp;afterward.
        </p>
        <div style={{ margin: "32px 0" }}><SandwichFigure /></div>
        <p>
          The same shape covers challenge and response. A&rsquo;s random value is revealed in A&rsquo;s proof; a question generated from
          it could not have existed before A. Bind the answer in B, and it depends on a value nobody had before&nbsp;A.
        </p>

        <h2>Make one, fetch one</h2>
        <p>Send a SHA-256; get the signed proof back. Or use the drop box on the <Link href="/#make">home page</Link>.</p>
        <pre className="hiw-code">{`curl -X POST https://bitgraph.ing/api/commit \\
  -H 'content-type: application/json' \\
  -d '{"digests":[{"digestB64":"<sha-256, base64>","hashAlg":"sha256"}]}'`}</pre>
        <p>Every BitGraph is kept. Fetch a proof by its hash, here or on the <Link href="/ledger">ledger</Link>:</p>
        <pre className="hiw-code">{`curl https://bitgraph.ing/api/proofs/<sha-256, base64url>`}</pre>
        <p>For an AI agent, the MCP server:</p>
        <pre className="hiw-code">{`claude mcp add bitgraph -- npx -y @mikeargento/bitgraph-mcp`}</pre>

        <h2>Check a proof</h2>
        <p>
          A proof verifies offline with <code>@mikeargento/bitgraph-verify</code>: the enclave&rsquo;s signature, the hardware attestation
          with its time, and the two counts. Pin the enclave&rsquo;s measurement, reproducible from the published&nbsp;source:
        </p>
        <pre className="hiw-code">{PUBLISHED_PCR0}</pre>

        <h2>Everything else is yours to add</h2>
        <p>
          Writing a proof to a blockchain, a timestamp service, a file that carries its own proof: all of these already exist, and any
          of them can be hung on a BitGraph by whoever wants it. BitGraph does the one thing they cannot: the two&nbsp;steps.
        </p>
      </article>
    </div>
  );
}
