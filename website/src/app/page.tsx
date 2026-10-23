import type { Metadata } from "next";
import { FlowFigure, SandwichFigure } from "@/components/primitive-figures";

/**
 * The site is this one page, plus the ledger and the proof pages (Mike, 2026-10-17:
 * "this can literally be one page if you dont count ledger"). The How it works page
 * folded in here; every old docs address redirects to it (next.config.ts).
 *
 * Order: the line, the two steps (the drawing), what it proves, two BitGraphs make an
 * interval (Mike, 2026-10-17: the drawing before the paragraph). Making and checking one (the drop box, the API, everything else) is /make
 * (Mike, 2026-10-17: "everything from Try it down can be its own page").
 *
 * ⚠️ Claim discipline: bound AFTER a moment, never "at" it; the claim is about when the
 * bits were bound, never how old the content is. The time shown is the enclave's own.
 */

export const metadata: Metadata = {
  title: "BitGraph",
  description:
    "Position commitments for computing. BitGraph gives files, records, and computations verifiable positions in a cryptographically linked sequence, each one inside a fixed interval.",
};

export default function HomePage() {
  return (
    <div className="frame home home-typing prose home-scroll">
      <div className="home-hero">
        {/* The home's h1 is visible again (Mike, 2026-10-17, with the new headline: "dont hide it"). */}
        {/* One centred first section (Mike, 2026-10-17): the headline, its sub-headline (which replaced the How BitGraph
            works heading), the drawing, and two ways to try it. */}
        {/* Mike, 2026-10-18: the h1 alone, no sub-header ("bedrock for bits" before it, the same day). */}
        <h1 className="home-title">Position commitments for&nbsp;computing.</h1>
        <div className="home-hero-figure"><FlowFigure /></div>
        <div className="home-hero-actions">
          <a className="bg-action-link is-make" href="/make">Make a BitGraph</a>
          <a className="bg-action-link" href="/demos">Try a demo</a>
        </div>
      </div>

      <section className="home-section home-why" aria-label="What it proves">
        <p className="home-kicker">What it proves</p>
        <h2 id="home-proves">BitGraph gives every computation a unique position with a portable proof that verifies&nbsp;offline.</h2>
        {/* Mike, 2026-10-17. */}
        <p className="home-why-body">
          Inside a hardware enclave, one atomic action counts twice. First, a fresh, unpredictable value takes one position. At the
          very next count, your content&rsquo;s digest is bound to the sequence. Both counts are signed together.
        </p>
        <p className="home-why-body">
          The proof establishes that your bits were bound after a value nobody could predict, with nothing counted in between.
        </p>
        {/* The home is the explanation, so what a position is lives here (Mike, 2026-10-18: Docs became Tools). */}
        <p className="home-why-body">
          A position is a count and a nonce. The count is predictable, like any counter&rsquo;s. The nonce is not: it is drawn only after
          your file&rsquo;s hash reaches the enclave, so there are no spare positions to reserve, hold back, or fill&nbsp;later.
        </p>
        <p className="home-why-body">
          Every BitGraph occupies a unique position that can never be reused. It proves where your bits were bound in the sequence,
          not when the content was created.
        </p>
        <p className="home-why-body">No blockchain or external clock is required. Anyone can verify the proof offline.</p>
      </section>

      <section className="home-section" aria-labelledby="home-between">
        <p className="home-kicker">Between two</p>
        <h2 id="home-between">Two BitGraphs make an&nbsp;interval.</h2>
        <div style={{ marginTop: 32 }}><SandwichFigure /></div>
        <p style={{ marginTop: 48 }}>
          The sequence is cryptographically linked. Positions cannot be inserted or rearranged without breaking verification.
          Missing intermediate positions can be&nbsp;detected.
        </p>
        {/* Mike, 2026-10-18: "every bitgraph is already an interval"; "you dont have to choose intervals". */}
        <p style={{ marginTop: 16 }}>
          Every BitGraph is recorded inside a fixed interval: after the BitGraph before it and before the one after it. Nobody chooses
          it, and nothing can move&nbsp;it.
        </p>
      </section>

      <section className="home-section home-why" aria-labelledby="home-work">
        <p className="home-kicker">Work between two</p>
        <h2 id="home-work">BitGraph A makes the work possible. BitGraph B records the&nbsp;result.</h2>
        <p className="home-why-body">
          BitGraph A creates an unpredictable value. That value can be the input to the work: it can generate a question,
          seed an image, or choose what an AI must process.
        </p>
        <p className="home-why-body">
          Work made from that value could not have been determined before A. When the result is ready, BitGraph B binds it
          at a later position.
        </p>
        <div style={{ marginTop: 24 }}><a className="bg-action-link" style={{ margin: 0 }} href="/demos">See it working</a></div>
      </section>

      {/* The limits and the trust, short, on the explanation page; in full on Tools (2026-10-18). */}
      <section className="home-section home-why" aria-labelledby="home-limits">
        <p className="home-kicker">What it does not prove</p>
        <h2 id="home-limits">Where exact bits were bound. Nothing&nbsp;else.</h2>
        <ul className="docs-list">
          <li><strong>Truth.</strong> The proof binds bytes, not their meaning.</li>
          <li><strong>Authorship or ownership.</strong> It names the enclave that bound the digest, not who made the file or holds its rights.</li>
          <li><strong>When the content was created.</strong> An old file can be bound today. What is fixed is when it was recorded.</li>
          <li><strong>Completeness.</strong> A record that was never made leaves no trace.</li>
          <li><strong>Legal effect.</strong> Admissibility and weight are not something the protocol establishes.</li>
        </ul>
        <p className="home-why-body">
          A record changed after it was bound is caught: its hash no longer matches. A record that was false when it was bound is&nbsp;not.
        </p>
      </section>

      <section className="home-section home-why" aria-labelledby="home-trust">
        <p className="home-kicker">What you trust</p>
        <h2 id="home-trust">One vendor, one&nbsp;build.</h2>
        <p className="home-why-body">
          The AWS Nitro hardware, and the enclave build BitGraph publishes, which anyone can rebuild from source and compare. Not this
          website, BitGraph&rsquo;s servers, or Argento Computing Inc.: a proof checks on your own machine, without asking&nbsp;anyone.
        </p>
        <div style={{ marginTop: 24 }}><a className="bg-action-link" style={{ margin: 0 }} href="/tools">Tools and the full&nbsp;check</a></div>
      </section>

    </div>
  );
}
