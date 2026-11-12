import type { Metadata } from "next";
import { CopiesTiles } from "@/components/demo-row";

/**
 * The home page: what BitGraph is as the headline, three files recorded back to back (a picture, its video and its
 * copy), each with its proof link on it, and the three buttons under them. The headline is two short sentences,
 * one to a line on wide screens and one word to a line on narrow ones, with "order." in the accent color; each word
 * is in its own span so the stylesheet can break the lines. One paragraph under the headline says what BitGraph does;
 * Technology is the full reference.
 *
 * Claim discipline, unchanged: a BitGraph is a place in line, bound by a time and after an unpredictable value. It
 * says when bits were bound, not how old they are or who made them.
 */

const TITLE = "BitGraph";
const DESCRIPTION =
  "Any file or record gets a numbered place in line, with a proof anyone can check offline, in seconds.";

export const metadata: Metadata = {
  title: { absolute: TITLE },
  description: DESCRIPTION,
  openGraph: { title: TITLE, description: DESCRIPTION },
  twitter: { title: TITLE, description: DESCRIPTION },
};

/** The arrow at the right of each bar: a drawn line with an open head, in the bar's own text color. */
function GoArrow() {
  return (
    <svg className="home-go" viewBox="0 0 30 14" width="30" height="14" aria-hidden="true" focusable="false">
      <path d="M1 7h27M22 1l6 6-6 6" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="square" strokeLinejoin="miter" />
    </svg>
  );
}

export default function HomePage() {
  return (
    <div className="frame home home-typing prose home-scroll docs-page tools-page sx-page home-ov">
      <section className="home-section home-ov-hero" aria-labelledby="home-h">
        <h1 id="home-h"><span className="home-h-line is-1"><span className="home-h-w">Blockchain</span> <span className="home-h-ink">order.</span></span>{" "}<span className="home-h-line is-2"><span className="home-h-w">Without</span> <span className="home-h-w">blockchain.</span></span></h1>
        {/* The one paragraph on the page: what BitGraph does, by the comparison with a roll of film. */}
        <p className="home-note">
          Just as a roll of film captures light one frame at a time inside a black box, BitGraph captures a
          fingerprint of any digital file&rsquo;s exact bits, one frame at a time, without uploading the file. Each
          frame has a unique position, secured by a precise sequence enforced inside a black box using an AWS Nitro
          enclave. Proofs verify offline, without trusting anyone.
        </p>
        {/* A picture, its video and its copy, each with its own place in line: the headline, shown. */}
        <CopiesTiles />
        {/* Where to go next: make one, see how it works, try the demos. One bar under each picture: the label at its
            left and an arrow at its right. */}
        <div className="sx-cta">
          <a className="bg-action-link is-make" href="/demos">Drop a file<GoArrow /></a>
          <a className="bg-action-link" href="/technology">How it works<GoArrow /></a>
          <a className="bg-action-link" href="/examples">Try a demo<GoArrow /></a>
        </div>
      </section>
    </div>
  );
}
