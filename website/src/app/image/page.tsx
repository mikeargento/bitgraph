import type { Metadata } from "next";
import { ArtMaker } from "@/components/art-maker";

export const metadata: Metadata = {
  title: "BitGraph image",
  description:
    "One click creates an image that never existed before, and BitGraph proves it: it opens a position, draws the image from its position commitment, and records it in that same position.",
};

/* The image generator (Mike, 2026-10-05), laid out like the home page (Mike, 10-06: "design it like
   the homepage"): one centred column, the headline and one button; the image appears below, with its
   code as the caption. Headline: Mike's words (10-06), "clicking that button will create an image
   that never existed before and the proof to back that claim up", then "and bitgraph proves it".
   True here without a caveat: the image is a function of a code that did not exist before the click
   (unlike an uploaded file). The headline is handed to ArtMaker so it can fold away on the click. The
   order, the drawing rules and the checks live in lib/art-position.ts and lib/commitment-art.ts. */
export default function ImagePage() {
  return (
    <div className="frame prose art-page">
      <ArtMaker>
        <h1>One click creates an image that never existed before, and BitGraph proves&nbsp;it.</h1>
      </ArtMaker>
    </div>
  );
}
