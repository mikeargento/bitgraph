import type { Metadata } from "next";
import { RecordTiles } from "@/components/demo-row";
import { TechnologyBody } from "@/components/technology-body";

/**
 * The home page: what BitGraph is as the headline, one paragraph that says what it does, and three versions of one
 * synthetic patient record (components/demo-row.tsx, RecordTiles), each with its place and what changed in it. The headline is one sentence, one line on wide
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
          {/* The one paragraph at the top: why order matters for records, and what BitGraph does about it. */}
          <p className="home-note">
            As AI writes and changes more of our records, it matters which version came first. BitGraph gives each file a
            numbered place in line, without uploading it, and a proof anyone can check offline.
          </p>
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
