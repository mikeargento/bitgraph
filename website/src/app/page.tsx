import type { Metadata } from "next";
import { FlowFigure, SequenceFigure } from "@/components/primitive-figures";

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
  // The tab and the search result carry the headline (2026-10-22: a search for the h1 alone landed on "pseudorandom
  // binary sequence"; the page must own its phrase). "records" is not a verb here (Mike, 2026-10-21).
  title: { absolute: "Verifiable sequence for bits. | BitGraph" },
  description:
    "Verifiable sequence for bits. BitGraph binds a file's fingerprint, never the file, at a position in a signed sequence that nothing can reorder. One BitGraph fixes a position; any two bracket everything made between them. Checks offline, by anyone.",
  openGraph: { title: "Verifiable sequence for bits.", description: "Verifiable sequence for bits. BitGraph binds a file's fingerprint, never the file, at a position in a signed sequence that nothing can reorder. One BitGraph fixes a position; any two bracket everything made between them. Checks offline, by anyone." },
  twitter: { title: "Verifiable sequence for bits.", description: "Verifiable sequence for bits. BitGraph binds a file's fingerprint, never the file, at a position in a signed sequence that nothing can reorder. One BitGraph fixes a position; any two bracket everything made between them. Checks offline, by anyone." },
};

export default function HomePage() {
  return (
    <div className="frame home home-typing prose home-scroll">
      <div className="home-hero">
        {/* The home's h1 is visible again (Mike, 2026-10-17, with the new headline: "dont hide it"). */}
        {/* One centred first section (Mike, 2026-10-17): the headline, its sub-headline (which replaced the How BitGraph
            works heading), the drawing, and two ways to try it. */}
        {/* Mike, 2026-10-18: the h1 alone, no sub-header ("bedrock for bits" before it, the same day). */}
        {/* Mike, 2026-10-19: what BitGraph is, for the partner who already proves origin (Apple Reference Image's clock, for everyone). */}
        {/* Mike, 2026-10-20: "A recorder for computation." (record/stop is the home's own picture), alone: no sub-line
            ("drop sub"). */}
        {/* Mike, 2026-10-21 late: "verifiable sequence for bits" (new that night; recorder "records nothing"). */}
        <h1 className="home-title">Verifiable sequence for&nbsp;bits.</h1>
        <div className="home-hero-figure"><FlowFigure /></div>
        <div className="home-hero-actions">
          <a className="bg-action-link is-make" href="/make">Make a BitGraph</a>
          <a className="bg-action-link" href="/demos">Try a demo</a>
        </div>
      </div>

      {/* What it proves and how it works, standing alone in one card (Mike, 2026-10-19: his copy, "in a cell of its own"):
          two cards side by side on desks with a gap between them, stacked on phones. */}
      <section className="home-section" aria-labelledby="home-proves">
        <div className="proves-card">
          <div className="proves-half">
            <p className="home-kicker">What it proves</p>
            <h2 id="home-proves">Proof of exact bits, and their place in the&nbsp;sequence.</h2>
            <p>BitGraph gives each file a unique numbered place and a proof you can save, share, and verify offline.</p>
            <p>
              The proof connects that place to your file&rsquo;s exact contents through a digital fingerprint. If the file changes, the
              fingerprint no longer matches.
            </p>
            <p>
              It proves where the file sits in the sequence. An old file can take a place today; the proof does not establish
              when it was&nbsp;created.
            </p>
            <p className="proves-actions">
              <a className="bg-action-link" href="/ledger">See every proof</a>
            </p>
          </div>
          <div className="proves-half">
            <p className="home-kicker">How it works</p>
            <h2 id="home-how">Inside secure hardware, BitGraph takes two consecutive&nbsp;counts.</h2>
            <ol className="proves-steps">
              <li>A newly generated, unpredictable value takes the first count.</li>
              <li>Your file&rsquo;s fingerprint is bound at the very next count.</li>
            </ol>
            <p>
              Both counts are signed together. This proves the fingerprint was bound after that unpredictable value, with nothing
              counted between&nbsp;them.
            </p>
            <p>
              The unpredictable value is generated only after your fingerprint arrives, so a position cannot be reserved and filled
              later. Each position can be used only&nbsp;once.
            </p>
            <p>You can check the proof offline. No blockchain or external clock is required.</p>
          </div>
        </div>
      </section>

      {/* Its own cell (Mike, 2026-10-19), the same card as What it proves / How it works. */}
      <section className="home-section" aria-labelledby="home-work">
        <div className="proves-half">
        <p className="home-kicker">Work between two</p>
        {/* Record and stop (Mike, 2026-10-20). Nothing to plan (Mike, 2026-10-21: "you dont have to choose. you can just
            bitgraph the shit out of everything and check later"): any two bracket what lies between them. */}
        <h2 id="home-work">Any two BitGraphs bracket the work between&nbsp;them.</h2>
        <p>
          Nothing has to be planned. Make BitGraphs as often as you like; later, any earlier one and any later one bracket
          everything between them, in&nbsp;order.
        </p>
        <p>
          The demos go one step further: the work is made from A&rsquo;s value, which nobody could know beforehand, so the work
          could not exist before&nbsp;A.
        </p>
        <div style={{ marginTop: 32 }}><SequenceFigure /></div>
        <div style={{ marginTop: 32 }}><a className="bg-action-link" style={{ margin: 0 }} href="/demos">See it working</a></div>
        </div>
      </section>

      {/* The limits and the trust, short, on the explanation page; in full on Tools (2026-10-18). */}
      <section className="home-section home-why" aria-labelledby="home-limits">
        {/* The kicker is the heading; the line under it was cut (Mike, 2026-10-21: "cut that"). */}
        <h2 id="home-limits" className="home-kicker">What it does not prove</h2>
        <ul className="docs-list">
          <li><strong>Truth.</strong> The proof binds bytes, not their meaning.</li>
          <li><strong>Authorship or ownership.</strong> It names the enclave that bound the digest, not who made the file or holds its rights.</li>
          <li><strong>When the content was created.</strong> An old file can be bound today. What is fixed is its place.</li>
          <li><strong>Completeness.</strong> A record that was never made leaves no trace.</li>
        </ul>
        <p className="home-why-body">
          A record changed after it was bound is caught: its hash no longer matches. A record that was false when it was bound is&nbsp;not.
        </p>
      </section>

      <section className="home-section home-why" aria-labelledby="home-trust">
        <p className="home-kicker">What you trust</p>
        {/* Mike, 2026-10-19: "shouldnt this be more generic ... its similar to the sha256". Kept honest: the hardware root is
            the one thing relied on, and it is checked, not asked. The specifics (AWS Nitro, PCR0, rebuilding) stay on Tools. */}
        <h2 id="home-trust">The math, and the measured&nbsp;enclave.</h2>
        <p className="home-why-body">
          Like SHA-256, a BitGraph is something you check, not someone you ask. The hashes and signatures are standard
          cryptography. The enclave&rsquo;s exact build is published, and the hardware attests that this build made the proof, so
          a proof checks on your own machine without asking BitGraph or anyone&nbsp;else.
        </p>
        <div style={{ marginTop: 24 }}><a className="bg-action-link" style={{ margin: 0 }} href="/tools">Tools and the full&nbsp;check</a></div>
      </section>

    </div>
  );
}
