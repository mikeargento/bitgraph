import type { Metadata } from "next";
import { FlowFigure, SandwichFigure } from "@/components/primitive-figures";
import { TerminalLine } from "@/components/terminal-line";

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
    "Position commitment for all of computing: inside a hardware enclave, one atomic action takes a fresh, unused value nobody can see or predict, then your content, signed together.",
};

export default function HomePage() {
  return (
    <div className="frame home home-typing prose home-scroll">
      <div className="home-hero">
        {/* Mike, 2026-10-17: "position commitment for all of computing ... it shouldnt be written as a headline". */}
        <TerminalLine text="Position commitment for all of computing." />
        {/* Single use, in plain words, under the line (Mike, 2026-10-17). */}
        <p className="hero-sub">Every BitGraph occupies a position that can never be occupied again.</p>
      </div>

      <section className="home-section" aria-labelledby="home-how">
        <p className="home-kicker">How it works</p>
        <h2 id="home-how">Two steps, one&nbsp;action.</h2>
        <div style={{ marginTop: 32 }}><FlowFigure /></div>
        <p style={{ marginTop: 48 }}>If any step fails, nothing is released and the counter does not&nbsp;move.</p>
      </section>

      <section className="home-section home-why" aria-label="What it proves">
        <p className="home-kicker">What it proves</p>
        <p className="home-why-body">
          Inside a hardware enclave, one atomic action counts twice: a fresh, unused value nobody can see takes one count, and your content
          takes the next. Both are signed together. So your bits were bound after a value nobody
          could predict, and could not have been bound before it. The value is used once and never again, so every BitGraph is one of a kind. It fixes where the bits sit in the sequence, not how old
          the content is. No blockchain or outside clock is needed, and anyone can check the proof&nbsp;offline.
        </p>
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
