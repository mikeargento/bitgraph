import type { Metadata } from "next";
import Link from "next/link";
import { BalanceLines } from "@/components/balance-lines";
import { TechnologyBody } from "@/components/technology-body";

/**
 * The home page opens with a hero on a band of the panel color: the headline, three sentences on what BitGraph makes,
 * the six kinds of record it is built for, and two buttons (make a BitGraph; connect a system). Under it is one run of
 * numbered sections with a contents list (components/technology-body.tsx), starting with the technology. The example
 * of one record in three versions is on the Demos page.
 *
 * Claim discipline, unchanged: a BitGraph is a place in line, bound by a time and after an unpredictable value. It
 * says when bits were bound, not how old they are or who made them.
 */

/* The tab and link-preview title carries the tagline after the name. */
const TITLE = "BitGraph: Prove order by ruling out the past";
const DESCRIPTION =
  "BitGraph gives any record a position that could not have existed before. It pairs the record's exact bits with that position, creating verifiable evidence of its place in history. Anyone can check the proof offline, without a database.";

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
        {/* The hero: the page's headline, one line on wide screens and two on phones (one span each), three sentences
            on what BitGraph makes, the records it is built for, and two buttons. The last two words of the
            paragraph are tied and the no-orphans pass adds the word before them, so the last line holds at least
            three words. */}
        {/* On phones the hero's paragraph is narrowed until its lines are about the same length. */}
        <BalanceLines selector=".home-ov-hero .home-ov-sub" />
        <section className="home-section home-ov-hero" aria-labelledby="home-h">
          <h1 id="home-h"><span className="home-h-m">Prove order <br className="home-br-m" />by <br className="home-br-d" />ruling out <br className="home-br-m" />the past.</span></h1>
          <p className="home-ov-sub">
            BitGraph gives any record a position that could not have existed before. It pairs the record&rsquo;s exact bits with that position, creating verifiable evidence of its place in history. Anyone can check the proof offline, without a&nbsp;database.
          </p>
          {/* The two things to do from here: make one, or connect a system through the API and SDK. */}
          <div className="home-ov-actions">
            <Link className="bg-action-link is-make" href="/demos">Make a BitGraph</Link>
            <Link className="bg-action-link is-plain" href="/integrate">Connect your system</Link>
          </div>
        </section>
      </div>
      <div className="frame home home-typing prose home-scroll docs-page tools-page sx-page home-tech">
        <TechnologyBody />
      </div>
    </>
  );
}
