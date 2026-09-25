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
      {/* The claim, then the difference (Mike, 2026-09-22). The 2026-09-20 scene (the demand as
          the headline, the maxim as the close) gave way to a headline that names BitGraph and a
          line that answers "we already have that". Nothing here explains the protocol; the docs
          do that. */}
      <h1>
        {/* The absolute passes the mechanism test (canon 3.3: no operation manufactures a
            slot retroactively). Two lines at every width, broken after "position";
            globals.css is re-solved for line one. Replaced "BitGraph makes AI logs
            impossible to backdate." (2026-09-22 to 09-25) in the position-commitment
            refocus; the backdating claim lives on in the docs. */}
        {/* Two lines on desk (break after "position"), three on phones (Mike,
            2026-09-25: "can this be 3 lines and bigger on mobile?"): the same
            words, responsive breaks, and globals.css sizes each layout from
            its own longest line. */}
        <span style={{ whiteSpace: "nowrap" }}>BitGraph gives AI&nbsp;logs</span> <br className="br-mob" />
        <span style={{ whiteSpace: "nowrap" }}>a&nbsp;position</span><br className="br-desk" />{" "}
        <span style={{ whiteSpace: "nowrap" }}>that can&rsquo;t</span> <br className="br-mob" />
        <span style={{ whiteSpace: "nowrap" }}>be chosen&nbsp;afterward.</span>
      </h1>

      {/* What it is not, and the one difference that matters (Mike, 2026-09-22): everything the
          reader already runs is applied after the fact, and a BitGraph's position comes first. It
          replaced the maxim, "The most trusted AI systems will be the ones whose records don't
          have to be trusted." */}
      <p className="lede" style={{ fontStyle: "italic" }}>
        Signatures, timestamps, append-only logs, write-once storage, notarizations, and blockchain
        hashes all come&nbsp;after the record.{" "}
        <strong>
          <span style={{ whiteSpace: "nowrap" }}>BitGraph begins the proof</span>{" "}
          <span style={{ whiteSpace: "nowrap" }}>before the record exists.</span>
        </strong>
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
