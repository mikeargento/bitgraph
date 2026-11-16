import type { Metadata } from "next";
import Link from "next/link";
import { GoArrow } from "@/components/go-arrow";
import { TechnologyBody } from "@/components/technology-body";
import { USE_CASE_ROWS } from "@/lib/use-case-links";

/**
 * The home page: a small label over the headline says what kind of thing BitGraph is; the headline says what it does,
 * in two lines on wide screens (each phone line is a span, and an empty span marks the wide-screen break); one short
 * sentence under it says what sets a receipt apart; then the names of where it applies as a small label. Then two
 * buttons, one to make a BitGraph and one that slides to the chart of how it differs from what people use today, and
 * the mechanism in full with its contents list (components/technology-body.tsx). The
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
          {/* The label over the headline, as every other page has one: what kind of thing this is. */}
          <p className="home-kicker home-ov-kicker">A new kind of proof</p>
          <h1 id="home-h"><span className="home-h-m">BitGraph creates</span>{" "}<span className="home-h-m">a receipt<span className="home-h-br" aria-hidden="true" /> for</span>{" "}<span className="home-h-m">every file in</span>{" "}<span className="home-h-m">your care.</span></h1>
          {/* What sets a receipt apart, in ink, in two short sentences. */}
          <p className="home-ov-sub">
            Each receipt has a verifiable place in line. Anyone can check it offline, with no server and without BitGraph.
          </p>
          {/* Where it applies, by name: plain text. Each row is one line on a phone; on wider screens the rows run on. */}
          <p className="home-ov-fields">
            {USE_CASE_ROWS.map((row, r) => (
              <span className="home-ov-row" key={row[0]}>
                {row.map((n, i) => <span key={n}><span className="home-ov-keep">{n}</span>{r < USE_CASE_ROWS.length - 1 || i < row.length - 1 ? "," : ""}{i < row.length - 1 ? " " : ""}</span>)}
                {r < USE_CASE_ROWS.length - 1 ? " " : ""}
              </span>
            ))}
          </p>
          {/* The two things to do from here: make one, or see how it differs from what people use today (that link slides
              down to the chart). */}
          <div className="home-ov-actions">
            <Link className="bg-action-link is-make" href="/demos">Make a BitGraph<GoArrow /></Link>
            <a className="bg-action-link is-plain" href="#t-compare">How it&rsquo;s different</a>
          </div>
        </section>
      </div>
      <div className="frame home home-typing prose home-scroll docs-page tools-page sx-page home-tech">
        <TechnologyBody />
      </div>
    </>
  );
}
