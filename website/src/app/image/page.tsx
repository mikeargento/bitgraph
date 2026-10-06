import type { Metadata } from "next";
import { ArtMaker } from "@/components/art-maker";

export const metadata: Metadata = {
  title: "BitGraph image",
  description:
    "One click creates an image that never existed before, and BitGraph proves it: it opens a position, draws the image from its position commitment, and records it in that same position.",
};

/* The image generator (Mike, 2026-10-05), laid out like the home page (Mike, 10-06: "design it like
   the homepage"): one centred column, the headline, one sentence, one button, and the image below.
   The headline and sentence are handed to ArtMaker so they can fold away on the click and make room
   for the image. Headline: Mike's line, "imagine creating an image and having proof that it never
   existed until you clicked the button", in the verb MAKE. The order, the drawing rules and the
   checks live in lib/art-position.ts and lib/commitment-art.ts. */
export default function ImagePage() {
  return (
    <div className="frame prose art-page">
      <ArtMaker>
        <h1 style={{ color: "#d93025" }}>One click creates an image that never existed before, and BitGraph proves&nbsp;it.</h1>
        <p className="lede" style={{ color: "#d93025" }}>
          BitGraph opens a position, draws the image from its position commitment, and records it in that same&nbsp;position.
        </p>
      </ArtMaker>
    </div>
  );
}
