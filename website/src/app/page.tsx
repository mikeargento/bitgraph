import type { Metadata } from "next";
import Link from "next/link";

/**
 * Home, written as the scene (Mike, 2026-09-20: "sell me this pen"). The order is
 * the order the scene runs in: the demand first, the reach that fails, the turn,
 * then the object. The lesson is the last line, not the first, because in the
 * scene the lesson is the payoff.
 *
 * Everything that explains the protocol moved into the docs on 2026-09-20, so this
 * page does not teach. Two links carry the reader onward, and the nav carries the
 * third.
 *
 * ⚠️ Claim discipline, unchanged:
 * - The proof shows what was committed and where it sat, never that the record is
 *   true. Do not let "prove" widen on this page.
 * - Floor in time, ceiling in position. Never "proves when".
 * - It sits beside the audit system the reader already runs; it replaces nothing.
 */
export const metadata: Metadata = {
  title: "BitGraph",
  description:
    "BitGraph gives an AI audit record a position its producer could not choose: a portable BitGraph that commits the exact record, sits after a public Base block, and verifies offline. It works beside the audit system you already run.",
};

export default function HomePage() {
  return (
    <div
      className="frame home home-typing prose"
      style={{
        /* Vertically centred in what is left after the bar and the footer. A min-height, not a
           fixed one, so a phone can still scroll if the headline wraps further than expected.
           142px is the measured bar (65) plus footer (77), not a guess. */
        /* svh, not vh (Mike, 2026-10-04, iPhone: "why does this happen when I pull up"): on a phone
           100vh is the screen with the browser's toolbars hidden, so the frame overshot the visible
           screen by the toolbar height and the page scrolled by that much, headline under the bar,
           appendix and footer coming up from below. 100svh is the screen with the toolbars showing,
           the one the visitor actually has on arrival. Desktops measure the two the same. */
        minHeight: "calc(100svh - 142px)",
        /* The frame ships 56px top and 96px bottom padding; that 40px asymmetry was pushing the
           centred block upward by exactly 40px. Equalised here rather than in globals. */
        paddingTop: "56px",
        paddingBottom: "56px",
        display: "flex",
        flexDirection: "column",
        /* The headline and the three cards centred together (Mike, 2026-10-12: "should this whole block of content be
           centered up vertically?"); on a phone the block is taller than the screen and starts at the top. */
        justifyContent: "center",
      }}
    >
      {/* The demo is Ask Jev (Mike, 2026-10-11: ChatGPT's "See it work" leads to the Jev demo, "hes right"): a computation
          done inside a BitGraph, the position opened before it ran, which is what the line under the headline says. The
          bridge maker (ArtMaker "home") ran here from 2026-10-10; /generate still makes bridges. Same hero markup. */}
      <div className="art art-home">
        <div className="art-hero">
          <div className="art-hero-inner">
        {/* The hero (Mike, 2026-10-05): the typing line of 2026-09-30 and the game theory paragraph of
            2026-09-26, left aligned, after a day of trying shorter heroes ("GPS for files.", "The
            position comes first.", "First the position. Then the file."; all in the git history).
            Claim discipline holds: a position is what is verified, never the content, never "when". */}
        {/* "all of computing" (Mike, 2026-10-09: reads as the whole field) was "all computing" (Mike, 2026-10-08: a friend seeing "AI automation" would ask "is this ai?"; computing, not computation, per 09-14) replaced "AI automation" (2026-10-07), which replaced "AI records" (10-05): the larger market by name. The lede says "the bits" (Mike, 2026-10-07, over "the record"): any bits, the brand's reach. */}
        {/* Static (Mike, 10-05): one "for", the first market. The typing version cycled AI records → AI agent
            actions → AI evaluations → predictions → sealed bids → chain of custody → any file → any bytes →
            any bits (components/home-headline.tsx, 694a5646). */}
        <h1>Position commitment<br />for&nbsp;automated computing.</h1>

        {/* Mike's line (2026-10-05), replacing the Schelling paragraph and then the six-item list; "Other proofs", not "Every other proof" (no absolute: Chainpoint rule, 09-21)
            ("Signatures, timestamps, append-only logs, write-once storage, notarizations, and
            blockchain hashes all come after the record...", 8d4968ff). "Arrives", never "exists":
            first existence is not claimed (an old file can take a new position). Then "Other proofs
            come after the record. BitGraph begins before it arrives. The proof travels with the
            record, and nobody has to host it." (2048aed6, 0f1cac1c), distilled to one sentence
            (Mike, 10-05). */}
        {/* Mike, 2026-10-11 (what a BitGraph gives, then the spec-style example; counts in the fine print; two balanced paragraphs, no "Example:", Mike: the single run sat off to one side on phones): the stat replaces "BitGraph begins the proof before the bits arrive, so their position cannot be
            chosen afterward." as the line under the headline; its footnote sits under it. */}
        <p className="lede home-lede-stat">The computation uses a position that opens first, so its result can&rsquo;t be&nbsp;backdated.</p>
        {/* The footnote right under the claim it qualifies, before the buttons (Mike, 2026-10-11). Basis: the benchmark on
            branch bench (bench/RESULTS.md): 5 billion photos / 1,000,000 per BitGraph = 5,000 BitGraphs x $0.00036 (one Base
            ceiling write, 24,000 gas at 0.006 gwei, ETH $2,499.85, 2026-10-11 13:52 UTC) = $1.80. */}
          </div>
        </div>
        <div className="art-hero art-go-wrap">
          <div className="art-hero-inner">
            <div className="actions art-home-actions">
              <Link className="bg-action-link is-make art-go" href="/jev">See it work</Link>
              <Link className="bg-action-link" href="/docs/overview">How it works</Link>
            </div>
          </div>
        </div>
      </div>

      {/* Three cards (Mike, 2026-10-11): what a visitor like Steven Mih would use it for, each claim one the mechanism
          delivers. Training data: recorded as is, its Base ceiling. Model outputs: the position opened first (the Jev demo).
          Volume: tree/1, up to 1,000,000 leaves per position, one Base write each. */}
      <div className="home-cards">
        <Link className="home-card" href="/docs/overview">
          <h2>Training data</h2>
          <p>BitGraph a dataset before training begins. The proof shows exactly which bytes existed, by a public&nbsp;block.</p>
          <span className="home-card-link">How the proof works</span>
        </Link>
        <Link className="home-card" href="/jev">
          <h2>Model outputs</h2>
          <p>Put the position&rsquo;s commitment into the prompt. The answer provably came after it and can&rsquo;t be&nbsp;backdated.</p>
          <span className="home-card-link">Ask Jev</span>
        </Link>
        <Link className="home-card" href="/benchmark">
          <h2>High volume</h2>
          <p>Benchmarked at a million files per position, each individually verifiable. Projected: every photo taken on Earth in a day for about $2 in&nbsp;fees.</p>
          <span className="home-card-link">See the benchmark</span>
        </Link>
      </div>

    </div>
  );
}
