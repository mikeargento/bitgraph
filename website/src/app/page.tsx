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

/* The tab and link-preview title is the name alone. */
const TITLE = "BitGraph";
const DESCRIPTION =
  "BitGraph instantly makes any digital file a one-of-a-kind record. No NFTs, wallets, or blockchain required.";

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
        {/* The hero: the page's headline (two lines on wide screens, three on phones), one sentence on what
            BitGraph makes of a file and, on a line of its own, one on what it does not need; then two buttons. */}
        {/* On phones the hero's paragraph is narrowed until its lines are about the same length. */}
        <BalanceLines selector=".home-ov-hero .home-ov-sub" />
        <section className="home-section home-ov-hero" aria-labelledby="home-h">
          <h1 id="home-h"><span className="home-h-m">Non-Fungible <br className="home-br-m" />Records <br className="home-br-d" />for the <br className="home-br-m" />artificial&nbsp;era.</span></h1>
          <p className="home-ov-sub">
            BitGraph instantly makes any digital&nbsp;file&nbsp;a&nbsp;<span style={{ whiteSpace: "nowrap" }}>one-of-a-kind</span>&nbsp;record.<br />No&nbsp;NFTs, wallets, or blockchain&nbsp;required.
          </p>
          {/* The two things to do from here: make one, or see ones already made. Developers is in the bar. */}
          <div className="home-ov-actions">
            <Link className="bg-action-link is-make" href="/demos">Make a BitGraph</Link>
            <Link className="bg-action-link is-plain" href="/examples">See the demos</Link>
          </div>
        </section>
      </div>
      <div className="frame home home-typing prose home-scroll docs-page tools-page sx-page home-tech">
        <TechnologyBody />
      </div>
    </>
  );
}
