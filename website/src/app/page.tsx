import type { Metadata } from "next";
import { DemoRow } from "@/components/demo-row";
import { HomeCards } from "@/components/demo-cards";

/**
 * The home page: the claim and its answer as one headline, the three versions of one picture with their proofs, and
 * three cards that lead to making a BitGraph, the ledger, and the demos. The explaining lives on Technology.
 *
 * Claim discipline, unchanged: a BitGraph is a place in line, bound by a time and after an unpredictable value. It
 * says when bits were bound, not how old they are or who made them.
 */

const TITLE = "Everything digital is already a copy";
const DESCRIPTION =
  "Everything digital is already a copy. BitGraph just puts things in order: any file or record gets a numbered place in line, with a proof anyone can check offline, in seconds.";

export const metadata: Metadata = {
  title: { absolute: `BitGraph: ${TITLE}` },
  description: DESCRIPTION,
  openGraph: { title: TITLE, description: DESCRIPTION },
  twitter: { title: TITLE, description: DESCRIPTION },
};

export default function HomePage() {
  return (
    <div className="frame home home-typing prose home-scroll docs-page tools-page sx-page is-landing is-short">
      {/* The whole page: the claim and its answer stacked, over the three versions of one picture, all one block. */}
      <section id="how" className="home-section home-open" aria-labelledby="home-h">
        {/* The headline breaks in two on wide screens and in four on phones; the spaces sit before each break so a
            hidden break leaves a plain space and a shown one leaves no indent. */}
        <h1 id="home-h">Everything{" "}<br className="home-h-ph" />digital{" "}<br className="home-h-dt" />is{" "}<br className="home-h-ph" />already a{" "}<br className="home-h-ph" />copy</h1>
        <p className="home-order">BitGraph just puts things in order</p>
        <DemoRow />
        {/* Where to go next, one card under each picture: make one, see the ledger, try the demos. */}
        <HomeCards />
      </section>
    </div>
  );
}
