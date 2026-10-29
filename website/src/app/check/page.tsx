import type { Metadata } from "next";
import { DropBox } from "@/components/drop-box";

/**
 * Checking: any file, or many. A file whose exact bytes are bound opens its proof; a photo that is a copy (a
 * screenshot, a repost, a re-save) is matched by what it looks like to the fingerprint record its original's tree
 * binds, which leads to the original's proof (lib/trustmark/check). Nothing is ever made here; Make makes. Laid out
 * as Tools is.
 */

export const metadata: Metadata = {
  title: "Check",
  description: "Drop any file to see whether it is a BitGraph, or a copy of one. Nothing is made, and only SHA-256 hashes and a 64-bit fingerprint are sent.",
};

export default function CheckPage() {
  return (
    <div className="frame home home-typing prose home-scroll docs-page tools-page">
      <div className="home-hero">
        <h1 className="sr-only">Check.</h1>
      </div>

      <section className="home-section" aria-labelledby="c-intro">
        <p className="home-kicker">Check</p>
        <h2 id="c-intro">Check any file.</h2>
        <p>
          Drop files to see whether they have been BitGraphed. A file bound exactly opens its proof. A photo that is a copy, a screenshot,
          a repost or a re-save, is matched by what it looks like to the record its original&rsquo;s tree binds, which leads to the
          original&rsquo;s proof. Everything runs in your browser; only SHA-256 hashes and a 64-bit fingerprint are sent, and nothing is
          ever made here.
        </p>
        <div className="page-box"><DropBox mode="check" /></div>
      </section>
    </div>
  );
}
