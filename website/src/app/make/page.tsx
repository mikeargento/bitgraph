import type { Metadata } from "next";
import { DropBox } from "@/components/drop-box";

/**
 * Making: a drop is bound at once, one file or many, as one tree and one BitGraph. Nothing is looked up first; the
 * same bytes bound again get a BitGraph of their own, listed in order on the file's proof page. Laid out as Tools is.
 */

export const metadata: Metadata = {
  title: "Make",
  description: "Drop files to make their BitGraph. Each file is hashed in your browser; only its SHA-256 is sent.",
};

export default function MakePage() {
  return (
    <div className="frame home home-typing prose home-scroll docs-page tools-page">
      <div className="home-hero">
        <h1 className="sr-only">Make.</h1>
      </div>

      <section className="home-section" aria-labelledby="m-intro">
        <p className="home-kicker">Make</p>
        <h2 id="m-intro">Record a BitGraph of your files.</h2>
        <p>
          A BitGraph fixes where these exact bits were bound in a counted sequence, right after a value nobody could predict. Many files
          at once become one tree and one BitGraph, and each file in it can be checked on its own. A photo&rsquo;s fingerprint is bound
          with it in the same tree, so a later BitGraph of the same picture names this one. BitGraphs are permanent, and a file
          dropped again opens its BitGraph.
        </p>
        <div className="page-box"><DropBox mode="make" /></div>
      </section>
    </div>
  );
}
