import type { Metadata } from "next";
import Link from "next/link";
import { HOME_EXAMPLE_DIGEST } from "@/lib/warm";
import { WarmExample } from "@/components/warm-example";

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
    "BitGraph gives an AI audit record a position its producer could not choose: a portable BitGraph that commits the exact record, sits after a public Ethereum block, and verifies offline. It works beside the audit system you already run.",
};

export default function HomePage() {
  return (
    <div
      className="frame home prose"
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
        justifyContent: "center",
      }}
    >

      {/* The hero, Mike's words (2026-10-03), static: no typing (Mike: "no typing"). GPS is
          the analogy the page rests on: a receiver works out where it is from a public
          broadcast it does not control, and anyone with the same broadcast can check the
          fix. A BitGraph is a position checked against the public chains' blocks the same
          way, and the file itself never travels: the drop box, the SDK and the MCP hash
          locally and send digests. Claim discipline holds: a position is what is verified,
          never the content, never "when". The earlier heroes ("Position commitment for AI
          records." with the Schelling paragraph, 2026-09-26; the typing line, 2026-09-30)
          are in the git history and in the headline file. */}
      <h1>GPS for files.</h1>

      {/* Two sentences. On a desktop they balance into one line each; on a phone each
          sentence is its own balanced block, so no line ends on a stub like "Your". */}
      <p className="lede">
        <span className="lede-sentence">A position, verified against a public broadcast.</span>{" "}
        <span className="lede-sentence">Your files never leave your&nbsp;computer.</span>
      </p>

      <p className="lede home-coordinates">Local files. Global&nbsp;coordinates.</p>

      {/* The last child keeps its own bottom margin, which pushes the centred block upward. */}
      <div className="actions" style={{ marginBottom: 0 }}>
        {/* The evidence is the primary action, not the make: the nav already carries a blue
            "Make a BitGraph" permanently, so spending the page's one primary slot on it would
            ask twice. After "BitGraph does that" the next thought is show me, not explain it. */}
        <Link className="bg-action-link is-make" data-warm-example href={`/proof/${HOME_EXAMPLE_DIGEST}`}>See a real BitGraph</Link>
        <Link className="bg-action-link" href="/docs/overview">How it works</Link>
      </div>

      {/* The live demo, one quiet line with a link (Mike, 2026-09-29): the headline's claim, happening. It
          leaves the site, so it opens in a new tab. Drop "Live now" when the postseason ends. */}
      <div className="home-live">
        <a className="home-live-title" href="https://live.bitgraph.ing" target="_blank" rel="noopener">
          <span className="home-live-pill"><span className="home-live-dot" aria-hidden="true" />Live</span>
          <span className="home-live-name">BitGraph AI Postseason</span><svg className="ext-arrow" width="14" height="14" viewBox="0 0 24 24" aria-hidden="true"><path d="M7 17L17 7M9 7h8v8" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" /></svg><span className="sr-only"> (opens in a new tab)</span>
        </a>
        <p className="home-live-text">Jev, ChatGPT and Claude bet on how every at bat of the 2026 baseball postseason ends. BitGraph proves each bet was recorded before the at-bat started.</p>
      </div>

      {/* Renders nothing. Starts the example proof's fetch while the reader is still
          here, so the click lands on a finished page instead of a skeleton. */}
      <WarmExample />

    </div>
  );
}
