import type { Metadata } from "next";
import Link from "next/link";
import { GoArrow } from "@/components/go-arrow";
import { TechnologyBody } from "@/components/technology-body";

/**
 * The home page opens with a hero at the top left: the headline and two sentences on what BitGraph does and where it
 * runs, then two buttons: one to make a BitGraph and one that slides to the section on how it differs from the
 * alternatives. Under it is one run of numbered sections with a contents list (components/technology-body.tsx): the first
 * says what BitGraph is for and which records it is built for, and the mechanism follows from the second.  The example of one record in three versions
 * is on the Demos page.
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
        {/* The hero: the page's headline, one line on wide screens and two on phones (one span each), and two sentences
            under it, then two buttons. */}
        <section className="home-section home-ov-hero" aria-labelledby="home-h">
          <h1 id="home-h"><span className="home-h-m">Public proof.</span>{" "}<span className="home-h-m">Private records.</span></h1>
          <p className="home-ov-sub">
            BitGraph creates receipts inside a trusted execution environment (TEE). Each one is cryptographically
            verifiable evidence of a record&rsquo;s integrity and order, without your records ever leaving your custody.
          </p>
          {/* The two things to do from here: make one, or see how it differs from the alternatives (that link
              slides down to the chart). */}
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
