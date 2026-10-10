import type { Metadata } from "next";
import Link from "next/link";
import { ArtMaker } from "@/components/art-maker";

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
        justifyContent: "center",
      }}
    >

      {/* The demo runs here (Mike, 2026-10-10: the home page runs the Three generator inline). ArtMaker's "home" mode:
          the headline and the line under it, then two buttons, "Make a BitGraph" (blue: opens a position, draws a 16:9
          Three, bitgraph-art/17, from its commitment and records it in that position) and "How it works". On the click
          the headline folds away and the spinner shows, as on /painting; then the piece at the column's width, one
          paragraph and two buttons, "Make another" and "See the full proof". The sample proof link ("See a real
          BitGraph") left the button; its page and EXAMPLE_FILES / HOME_EXAMPLE_DIGEST are unchanged, and WarmExample,
          which warmed that link's page, is no longer rendered here. */}
      <ArtMaker
        mode="home"
        secondary={<Link className="bg-action-link" href="/docs/overview">How it works</Link>}
      >
        {/* The hero (Mike, 2026-10-05): the typing line of 2026-09-30 and the game theory paragraph of
            2026-09-26, left aligned, after a day of trying shorter heroes ("GPS for files.", "The
            position comes first.", "First the position. Then the file."; all in the git history).
            Claim discipline holds: a position is what is verified, never the content, never "when". */}
        {/* "all of computing" (Mike, 2026-10-09: reads as the whole field) was "all computing" (Mike, 2026-10-08: a friend seeing "AI automation" would ask "is this ai?"; computing, not computation, per 09-14) replaced "AI automation" (2026-10-07), which replaced "AI records" (10-05): the larger market by name. The lede says "the bits" (Mike, 2026-10-07, over "the record"): any bits, the brand's reach. */}
        {/* Static (Mike, 10-05): one "for", the first market. The typing version cycled AI records → AI agent
            actions → AI evaluations → predictions → sealed bids → chain of custody → any file → any bytes →
            any bits (components/home-headline.tsx, 694a5646). */}
        <h1>Position commitment<br />for all of&nbsp;computing.</h1>

        {/* Mike's line (2026-10-05), replacing the Schelling paragraph and then the six-item list; "Other proofs", not "Every other proof" (no absolute: Chainpoint rule, 09-21)
            ("Signatures, timestamps, append-only logs, write-once storage, notarizations, and
            blockchain hashes all come after the record...", 8d4968ff). "Arrives", never "exists":
            first existence is not claimed (an old file can take a new position). Then "Other proofs
            come after the record. BitGraph begins before it arrives. The proof travels with the
            record, and nobody has to host it." (2048aed6, 0f1cac1c), distilled to one sentence
            (Mike, 10-05). */}
        <p className="lede">
          BitGraph begins the proof before the bits arrive,<br className="br-desk" /> so their position cannot be chosen&nbsp;afterward.
        </p>
      </ArtMaker>

    </div>
  );
}
