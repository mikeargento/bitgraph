import type { Metadata } from "next";
import { ArtMaker } from "@/components/art-maker";

export const metadata: Metadata = {
  title: "Three",
  description:
    "One click makes a piece that never existed, and BitGraph proves it: it opens a position, draws three shapes from its position commitment, and records the piece in that same position.",
  // Hidden (Mike, 2026-10-09): not in the menu or the sitemap, never indexed, and behind a password (middleware.ts).
  robots: { index: false, follow: false },
};

/* Three (Mike, 2026-10-09: "basically copy the painting page"): /painting's page, word for word in shape, for
   bitgraph-art/16, three flat shapes in red, yellow, blue and green that never touch. The recorded file is a PNG that carries
   its print SVG; ArtMaker's "three" mode makes it, offers both downloads, and reopens it from ?p=<digest>. */
export default function ThreePage() {
  return (
    <div className="frame prose art-page">
      <ArtMaker mode="three">
        <h1 className="jev-title">Three</h1>
        <p className="lede jev-lede">One click makes a piece that never existed, and BitGraph proves&nbsp;it.</p>
                <p className="lede jev-lede art-why">BitGraph begins the proof before the bits exist. Here you watch it happen: the click opens a position, and the position&rsquo;s commitment becomes part of the computation: it is the only input the piece is drawn from, three shapes, their sizes, places and colours. The piece is then recorded in that same position, so it could not have existed before its BitGraph began. The piece can be drawn again from the commitment, and the proof checks without contacting anyone. Every record gets the same guarantee; a piece just makes it&nbsp;visible.</p>
      </ArtMaker>
    </div>
  );
}
