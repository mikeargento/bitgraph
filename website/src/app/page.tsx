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
        minHeight: "calc(100vh - 142px)",
        /* The frame ships 56px top and 96px bottom padding; that 40px asymmetry was pushing the
           centred block upward by exactly 40px. Equalised here rather than in globals. */
        paddingTop: "56px",
        paddingBottom: "56px",
        display: "flex",
        flexDirection: "column",
        justifyContent: "center",
      }}
    >
      {/* The scene, in the order the scene runs (Mike, 2026-09-20). Brad does not open with
          "supply and demand", he asks for a signature, watches the reach fail, and says the
          lesson last. So: the demand is the headline, the maxim is the close. Nothing here
          explains the protocol; the docs do that. */}
      <h1>
        Prove this AI log wasn&rsquo;t rewritten after the&nbsp;incident.
        {/* Same weight as the demand, because it is the answer to it, not a comment on it.
            One h1 element holding both keeps a single page title in the outline. */}
        <span style={{ display: "block", marginTop: "0.55em" }}>BitGraph does&nbsp;that.</span>
      </h1>

      <p className="lede" style={{ fontStyle: "italic" }}>
        The most trusted AI systems will be the ones whose records don&rsquo;t have to be&nbsp;trusted.
      </p>

      {/* The last child keeps its own bottom margin, which pushes the centred block upward. */}
      <div className="actions" style={{ marginBottom: 0 }}>
        <Link className="bg-action-link is-make" href="/docs/try">Make a BitGraph</Link>
        <Link className="bg-action-link" href="/proof/YVf5bpwcpBg4SsTh6XXBqBoYpYS68s1Tjog1u_cvRQ4">See a real proof</Link>
      </div>

    </div>
  );
}
