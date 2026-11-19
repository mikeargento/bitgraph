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
const TITLE = "BitGraph: Proof that stands on its own";
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
        {/* The hero: the page's headline, one line on wide screens and two on phones (one span each), three sentences
            on what BitGraph makes, the records it is built for, and two buttons. The last two words of the
            paragraph are tied and the no-orphans pass adds the word before them, so the last line holds at least
            three words. */}
        {/* On phones the hero's paragraph is narrowed until its lines are about the same length. */}
        <BalanceLines selector=".home-ov-hero .home-ov-sub" />
        <section className="home-section home-ov-hero" aria-labelledby="home-h">
          <h1 id="home-h"><span className="home-h-m home-h-it">Trust is costly.</span>{" "}<span className="home-h-m">Proof isn&rsquo;t.</span></h1>
          <p className="home-ov-sub">
            BitGraph gives any digital record a proof that stands on its own. Anyone can confirm the record
            hasn&rsquo;t changed and where it stands in order, with no database to consult. Each proof is made inside
            a trusted execution environment (TEE), without exposing your&nbsp;data.
          </p>
          <div className="home-for">
            <p className="home-for-label">Built for</p>
            <ul>
              <li>Medical records</li>
              <li>Clinical trials</li>
              <li>AI agent activity</li>
              <li>Financial transactions</li>
              <li>Court evidence</li>
              <li>Chain of custody</li>
            </ul>
          </div>
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
