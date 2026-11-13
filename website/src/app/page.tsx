import type { Metadata } from "next";
import { RecordTiles } from "@/components/demo-row";
import { TechnologyBody } from "@/components/technology-body";

/**
 * The home page: what BitGraph is as the headline, then three versions of one
 * synthetic patient record (components/demo-row.tsx, RecordTiles), each with its place and what changed in it. The headline is one sentence, two lines
 * on wide screens and three on narrow ones; each phone line is a span, and an empty span marks the wide-screen break. Under them, the mechanism in full, with its own contents list: the page that was
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
          <h1 id="home-h"><span className="home-h-m">BitGraph creates</span>{" "}<span className="home-h-m">a receipt<span className="home-h-br" aria-hidden="true" /> for</span>{" "}<span className="home-h-m">every file in</span>{" "}<span className="home-h-m">your care.</span></h1>
          {/* Each feature stays whole on its line; a phone breaks only between them. */}
          <p className="home-ov-sub"><span className="home-ov-keep">Instant,</span> <span className="home-ov-keep">confidential,</span> <span className="home-ov-keep">verifiable offline,</span> <span className="home-ov-keep">and impossible to backdate.</span></p>
          {/* Three versions of one synthetic patient record, each with its own place in line: the headline, shown. */}
          <RecordTiles />
        </section>
      </div>
      <div className="frame home home-typing prose home-scroll docs-page tools-page sx-page home-tech">
        <TechnologyBody />
      </div>
    </>
  );
}
