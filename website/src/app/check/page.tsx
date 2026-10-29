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
  description: "Drop any file to see whether it is a BitGraph. A screenshot or a stripped copy of a photo finds the original's proof by what it looks like. Nothing is made; only SHA-256 hashes and a 64-bit fingerprint are sent.",
};

export default function CheckPage() {
  return (
    <div className="frame home home-typing prose home-scroll docs-page tools-page sx-page">
      <div className="home-hero">
        <h1 className="sr-only">Check.</h1>
      </div>

      <section className="home-section" aria-labelledby="c-intro">
        <p className="home-kicker">Check</p>
        <h2 id="c-intro">Check any file.</h2>
        <p>
          Drop files to see whether they have been BitGraphed. A file bound exactly opens its proof. A photo that is a copy, a screenshot,
          a repost, a re-save, a file with its metadata stripped, is matched by what it looks like to the record its original&rsquo;s tree
          binds, and opens the original&rsquo;s proof, labelled as a copy. Everything runs in your browser; only SHA-256 hashes and a
          64-bit fingerprint are sent, and nothing is ever made here.
        </p>
        <div className="page-box"><DropBox mode="check" /></div>
      </section>

      <section className="home-section" aria-labelledby="c-looks">
        <p className="home-kicker">Copies</p>
        <h2 id="c-looks">The picture is the pointer.</h2>
        <p>
          Every photo bound on Make goes into its tree beside a fingerprint record: a 64-bit perceptual hash and a 32&nbsp;&times;&nbsp;32
          grid of brightness, about 500 bytes, too coarse to show detail and enough to recognise the picture. The record&rsquo;s hash is a
          leaf of the same tree as the photo, so the original&rsquo;s own proof says what the original looks like. No watermark, nothing
          hidden in the pixels: a photo already carries its own appearance.
        </p>
        <p>
          A dropped picture is read the same way in your browser. Its 64-bit hash goes to the server, which returns the records nearest
          it; the picture&rsquo;s pixels are then compared with each record&rsquo;s grid here, and the best match above the threshold opens
          the original&rsquo;s proof.
        </p>
        <p>
          A find is a find, not a proof. The match says this picture resembles the original recorded at that position; the proof says when
          the original&rsquo;s exact bytes were bound. Whoever holds the original can prove it; a copy can only point.
        </p>
      </section>
    </div>
  );
}
