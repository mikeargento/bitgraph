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
    "Give every computation a position. Inside a hardware enclave, one atomic action takes a fresh, unused value nobody can see or predict, then your content, signed together.",
};

export default function HomePage() {
  return (
    <div className="frame home home-typing prose home-scroll">
      <div className="home-hero">
        {/* No visible h1 on any page (Mike, 2026-10-17: "drop the h1's ... on home too"); the tagline stays for screen readers, search and link previews. */}
        <h1 className="sr-only">Give every computation a position.</h1>
      </div>

      <section className="home-section" aria-labelledby="home-how">
        <p className="home-kicker">How BitGraph works</p>
        <h2 id="home-how">Two steps, one&nbsp;action.</h2>
        <div style={{ marginTop: 32 }}><FlowFigure /></div>
        <p style={{ marginTop: 48 }}>If any step fails, nothing is released and the counter does not&nbsp;move.</p>
      </section>

      <section className="home-section home-why" aria-label="What it proves">
        <p className="home-kicker">What it proves</p>
        {/* Mike, 2026-10-17. */}
        <p className="home-why-body">
          Inside a hardware enclave, one atomic action counts twice. First, a fresh, unpredictable value takes one position. At the
          very next count, your content&rsquo;s digest is bound to the sequence. Both counts are signed together.
        </p>
        <p className="home-why-body">
          The proof establishes that your bits were bound after a value nobody could predict, with nothing counted in between.
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
          Every BitGraph takes exactly two counts, so the count runs straight through. Nothing can be slipped in afterward,
          and anything missing shows as a&nbsp;gap.
        </p>
        <p>
          A question generated from A&rsquo;s revealed value could not have existed before A. Bind the answer in&nbsp;B.
        </p>
      </section>

    </div>
  );
}
