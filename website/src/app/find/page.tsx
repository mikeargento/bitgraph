import type { Metadata } from "next";
import { FindBox } from "@/components/find-box";

/**
 * Find (2026-10-29): the picture is the pointer. A copy with everything stripped is matched to the original's BitGraph
 * by what it looks like, against the fingerprint record the original's own tree binds. Laid out as Check is.
 */
export const metadata: Metadata = {
  title: "Find",
  description: "Drop a screenshot or a stripped copy of a photo to find the original's BitGraph by what it looks like. Nothing is made, and only a 64-bit fingerprint is sent.",
};

export default function FindPage() {
  return (
    <div className="frame home home-typing prose home-scroll docs-page tools-page sx-page">
      <div className="home-hero"><h1 className="sr-only">Find.</h1></div>

      <section className="home-section" aria-labelledby="f-intro">
        <p className="home-kicker">Find</p>
        <h2 id="f-intro">The picture is the pointer.</h2>
        <p>
          Drop a copy of a photo: a screenshot, a repost, a re-save, a file with its metadata stripped. If its original was recorded on Make,
          this finds the original&rsquo;s BitGraph by what the picture looks like. No watermark, nothing hidden in the pixels: a photo already
          carries its own appearance, and the original&rsquo;s tree binds a record of it.
        </p>
        <div className="page-box"><FindBox /></div>
      </section>

      <section className="home-section" aria-labelledby="f-how">
        <p className="home-kicker">How</p>
        <h2 id="f-how">Matched against what the original&rsquo;s proof signed.</h2>
        <p>
          Every photo bound on Make goes into its tree beside a fingerprint record: a 64-bit perceptual hash and a 32&nbsp;&times;&nbsp;32
          grid of brightness, about 500 bytes, too coarse to show detail and enough to recognise the picture. The record&rsquo;s hash is a
          leaf of the same tree as the photo, so the original&rsquo;s own proof says what the original looks like.
        </p>
        <p>
          The dropped picture is read the same way in your browser. Its 64-bit hash goes to the server, which returns the records nearest
          it; the picture&rsquo;s pixels are then compared with each record&rsquo;s grid here, and the best match above the threshold opens
          the original&rsquo;s proof. A file whose exact bytes are bound opens its proof directly.
        </p>
        <p>
          A find is a find, not a proof. The match says this picture resembles the original recorded at that position; the proof says when
          the original&rsquo;s exact bytes were bound. Whoever holds the original can prove it; a copy can only point.
        </p>
      </section>
    </div>
  );
}
