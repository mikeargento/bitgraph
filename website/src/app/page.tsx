import type { Metadata } from "next";
import { CopiesTiles } from "@/components/demo-row";
import { TechnologyBody } from "@/components/technology-body";

/**
 * The home page: what BitGraph is as the headline, one paragraph that says what it does, and three files recorded back
 * to back (a picture, its video and its copy), each with its proof link on it. The headline is one sentence, one line on wide
 * screens and one word to a line on narrow ones; each word is in its own span so the stylesheet can break the lines. Under them, the mechanism in full, with its own contents list: the page that was
 * Technology until 2026-11-12 (components/technology-body.tsx).
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
          <h1 id="home-h"><span className="home-h-line is-1"><span className="home-h-w">Blockchain</span> <span className="home-h-ink">order</span></span>{" "}<span className="home-h-line is-2"><span className="home-h-w">without</span> <span className="home-h-w">blockchain.</span></span></h1>
          {/* The one paragraph at the top: what BitGraph does, by the comparison with a roll of film. */}
          <p className="home-note">
            Just as a roll of film captures light one frame at a time inside a black box, BitGraph captures a
            fingerprint of any digital file&rsquo;s exact bits, one frame at a time, without uploading the file.
          </p>
          {/* A picture, its video and its copy, each with its own place in line: the headline, shown. */}
          <CopiesTiles />
        </section>
      </div>
      <div className="frame home home-typing prose home-scroll docs-page tools-page sx-page home-tech">
        <TechnologyBody />
      </div>
    </>
  );
}
