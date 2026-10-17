import type { Metadata } from "next";
import Link from "next/link";
import { FlowFigure } from "@/components/primitive-figures";
import { DropBox } from "@/components/drop-box";

/**
 * Home (Mike, 2026-10-17): "one tee, 2 steps, one atomic action". The tree is
 * BitGraph; everything already invented elsewhere (chains, timestamps, files
 * that carry their proof) is an ornament people can hang on it themselves, so
 * none of it is on this page. The site's own look, the old home's structure:
 * hero, labelled sections, the grey band, the drop box.
 *
 * ⚠️ Claim discipline: bound AFTER a moment, never "at" it; the claim is about
 * when the bits were bound, never how old the content is. The time shown is the
 * enclave's own signed time.
 */

export const metadata: Metadata = {
  title: "BitGraph",
  description:
    "One enclave, two steps, one atomic action: a fresh value nobody can see or predict, then your file's fingerprint, signed together. Your bits were bound after a moment nobody could predict.",
};

export default function HomePage() {
  return (
    <div className="frame home home-typing prose home-scroll">
      <div className="home-hero">
        {/* Mike, 2026-10-17: "Position commitments for computing" (after "Bound after a moment nobody could predict." and
            "One enclave. Two steps. One atomic action." were both cut the same night). */}
        <h1>Position commitments for&nbsp;computing.</h1>
        <div className="actions art-home-actions">
          <a className="bg-action-link is-make" href="#make">Make a BitGraph</a>
          <Link className="bg-action-link" href="/how-it-works">How it works</Link>
        </div>
      </div>

      <section className="home-section home-why" aria-label="What it proves">
        <p className="home-kicker">What it proves</p>
        <p className="home-why-body">
          Inside a hardware enclave, a fresh value nobody can see takes one count, and your file&rsquo;s fingerprint takes the next.
          Both are signed together, with the enclave&rsquo;s own time. So your bits were bound after a moment nobody could predict,
          and could not have been bound before&nbsp;it.
        </p>
      </section>

      <section className="home-section section-grey" aria-labelledby="home-how">
        <p className="home-kicker">How it works</p>
        <h2 id="home-how">Two steps, one&nbsp;action.</h2>
        {/* Mike's own picture (2026-10-17: "why not just use the png i gave you"), full width on wide screens. Its text
            is about 7 px at phone width, so phones get the same picture drawn in HTML, stacked. */}
        <div style={{ marginTop: 32 }}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img className="flow-img" src="/figures/bitgraph-flow.webp" width={2000} height={559}
            alt="Any bits are hashed to a SHA-256 digest. Inside the enclave, one atomic action: step 1 draws an unpredictable nonce, step 2 binds the digest and signs it. The result is a proof anyone can check offline." />
          <div className="flow-html"><FlowFigure /></div>
        </div>
      </section>

      {/* The maker and the checker (Mike, 2026-10-17: "wheres the dropbox? there should be a checker and a maker right?"). */}
      <section className="home-section" id="make" aria-labelledby="home-make">
        <p className="home-kicker">Try it</p>
        <h2 id="home-make">Make or check a&nbsp;BitGraph.</h2>
        <div style={{ marginTop: 24 }}>
          <DropBox />
        </div>
      </section>
    </div>
  );
}
