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

      <h1>
        {/* The category, named (Mike, 2026-09-26). A frontier model asked how to create a
            position for records before they exist could not name one, and every scheme it
            offered let the producer draw its own randomness, so the producer kept the option.
            The page has to name the thing and say why giving up the option is the point.
            "AI records", not "digital records": a category is named for its first market
            (Certificate Transparency for TLS certificates), and everyone BitGraph is pitching
            this month holds AI records; the mechanism stays universal in the docs. */}
        <span style={{ whiteSpace: "nowrap" }}>Position commitment</span><br />
        <span style={{ whiteSpace: "nowrap" }}>for AI&nbsp;records.</span>
      </h1>

      {/* Why it matters, in Schelling's terms: a commitment is credible because it gives up
          options. The term in game theory is "commitment" ("credible commitment", Schelling
          1960); "position commitment" is BitGraph's application of it. Credibility attaches to
          the POSITION, never the content (canon non-claims). */}
      <p className="lede">
        In game theory, a commitment is an irrevocable move that gives up future options.
        BitGraph brings commitment to records: whoever or whatever produces a record can no
        longer choose its position. That is what makes its position&nbsp;credible.
      </p>

      {/* The last child keeps its own bottom margin, which pushes the centred block upward. */}
      <div className="actions" style={{ marginBottom: 0 }}>
        {/* The evidence is the primary action, not the make: the nav already carries a blue
            "Make a BitGraph" permanently, so spending the page's one primary slot on it would
            ask twice. After "BitGraph does that" the next thought is show me, not explain it. */}
        <Link className="bg-action-link is-make" href="/proof/YYJh9nWOYBQUNvVmzy0kXvYTrAqLgmL9veqLHP7x-WU">See a real proof</Link>
        <Link className="bg-action-link" href="/docs/overview">How it works</Link>
      </div>

    </div>
  );
}
