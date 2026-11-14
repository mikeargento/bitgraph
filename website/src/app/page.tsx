import type { Metadata } from "next";
import Link from "next/link";
import { GoArrow } from "@/components/go-arrow";
import { TechnologyBody } from "@/components/technology-body";
import { USE_CASES } from "@/lib/use-case-links";

/**
 * The home page: what BitGraph is as the headline, at the top left, with the names of where it applies right under it
 * as plain text, then one line of features and two buttons, then the mechanism in full with its contents list
 * (components/technology-body.tsx). The headline is one sentence, two lines on wide screens and three on narrow ones;
 * each phone line is a span, and an empty span marks the wide-screen break. The
 * example of one record in three versions is on the Demos page.
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

export default function HomePage() {
  return (
    <>
      <div className="frame home home-typing prose home-scroll docs-page tools-page sx-page home-ov">
        <section className="home-section home-ov-hero" aria-labelledby="home-h">
          <h1 id="home-h"><span className="home-h-m">BitGraph creates</span>{" "}<span className="home-h-m">a receipt<span className="home-h-br" aria-hidden="true" /> for</span>{" "}<span className="home-h-m">every file in</span>{" "}<span className="home-h-m">your care.</span></h1>
          {/* Where it applies, by name: plain text, each name kept whole on its line. */}
          <p className="home-ov-fields">
            {USE_CASES.map((n, i) => <span key={n}><span className="home-ov-keep">{n}</span>{i < USE_CASES.length - 1 ? ", " : ""}</span>)}
          </p>
          {/* Each feature stays whole on its line; a phone breaks only between them. */}
          <p className="home-ov-sub"><span className="home-ov-keep">Instant,</span> <span className="home-ov-keep">confidential,</span> <span className="home-ov-keep">verifiable offline,</span> <span className="home-ov-keep">and impossible to backdate.</span></p>
          {/* The two things to do from here: make one, or see the working examples. How it is made starts right under. */}
          <div className="home-ov-actions">
            <Link className="bg-action-link is-make" href="/demos">Make a BitGraph<GoArrow /></Link>
            <Link className="bg-action-link" href="/examples">See the demos<GoArrow /></Link>
          </div>
        </section>
      </div>
      <div className="frame home home-typing prose home-scroll docs-page tools-page sx-page home-tech">
        <TechnologyBody />
      </div>
    </>
  );
}
