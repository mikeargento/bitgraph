import type { Metadata } from "next";
import { ArtMaker } from "@/components/art-maker";

export const metadata: Metadata = {
  title: "Three",
  description:
    "One click makes a piece that never existed, and BitGraph proves it: it opens a position, draws three shapes from its position commitment, and records the piece in that same position.",
  // Listed (Mike, 2026-10-10): in the menu in place of /painting, in the sitemap, indexed. It was hidden on 2026-10-09.
};

/* Three (Mike, 2026-10-09: "basically copy the painting page"): /painting's page, word for word in shape, for
   three flat shapes in red, yellow, blue and green that never touch. The recorded file is a PNG that carries its print SVG.
   Since 2026-10-10 it makes bitgraph-art/17, the 16:9 Three (it made version 16, square, before), ends as the home page
   does, and reopens either version from ?p=<digest>; ArtMaker's "three" mode. */
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
