import type { Metadata } from "next";

/**
 * The home page: the claim and its answer as one headline, the three buttons, then a short overview of what a
 * BitGraph proves, what it does not, how it is made, and the line. Technology is the full reference.
 *
 * Claim discipline, unchanged: a BitGraph is a place in line, bound by a time and after an unpredictable value. It
 * says when bits were bound, not how old they are or who made them.
 */

const TITLE = "Everything digital is already a copy";
const DESCRIPTION =
  "Everything digital is already a copy. BitGraph just puts things in order: any file or record gets a numbered place in line, with a proof anyone can check offline, in seconds.";

export const metadata: Metadata = {
  title: { absolute: `BitGraph: ${TITLE}` },
  description: DESCRIPTION,
  openGraph: { title: TITLE, description: DESCRIPTION },
  twitter: { title: TITLE, description: DESCRIPTION },
};

export default function HomePage() {
  return (
    <div className="frame home home-typing prose home-scroll docs-page tools-page sx-page home-ov">
      <section className="home-section home-ov-hero" aria-labelledby="home-h">
        <h1 id="home-h">Everything digital{" "}<br className="home-ov-br" />is already a copy. <span className="home-ov-order">BitGraph just puts{" "}<br className="home-ov-br" />things in order.</span></h1>
        {/* Where to go next: make one, see how it works, try the demos. The same button row as the other pages. */}
        <div className="sx-cta">
          <a className="bg-action-link is-make" href="/demos">Make a BitGraph</a>
          <a className="bg-action-link" href="/technology">How it works</a>
          <a className="bg-action-link" href="/examples">Try a demo</a>
        </div>
      </section>

      <section className="home-section" aria-labelledby="ov-proves">
        <p className="home-kicker">What it proves</p>
        <h2 id="ov-proves">A place in line, checkable by anyone.</h2>
        <p>
          Each BitGraph binds a file&rsquo;s SHA-256 fingerprint to a numbered place in one counted line, right after a fresh
          value drawn by the hardware. The proof says these exact bytes took this place, after that moment, and nothing was
          counted between them. Anyone can check it offline, with no account and nothing to look up.
        </p>
      </section>

      <section className="home-section" aria-labelledby="ov-not">
        <p className="home-kicker">What it does not prove</p>
        <h2 id="ov-not">Order, not origin.</h2>
        <ul className="docs-list">
          <li><strong>When the file was made.</strong> An old file can be bound today; the proof dates the binding.</li>
          <li><strong>Who made it, or whether it is true.</strong> It binds bytes, not authorship or meaning.</li>
          <li><strong>That no other copy exists.</strong> It proves a record was made, not that no other was.</li>
        </ul>
      </section>

      <section className="home-section" aria-labelledby="ov-how">
        <p className="home-kicker">How it works</p>
        <h2 id="ov-how">One sealed step.</h2>
        <p>
          The step runs inside an AWS Nitro enclave whose code is published and measured. In one indivisible action it draws a
          fresh value nobody has seen, binds your fingerprint at the next count, and signs both into one proof that the hardware
          attests. Your file stays on your machine; only its 32-byte fingerprint reaches BitGraph.
        </p>
      </section>

      <section className="home-section" aria-labelledby="ov-line">
        <p className="home-kicker">The line</p>
        <h2 id="ov-line">Counted and chained.</h2>
        <p>
          Each proof carries the hash of the one before it, linking the records into a counted sequence. The chain makes gaps
          and changes detectable when the records are checked together, preserving the order in which they were bound.
        </p>
        <div className="sx-cta">
          <a className="bg-action-link" href="/technology">Read the full technology</a>
        </div>
      </section>
    </div>
  );
}
