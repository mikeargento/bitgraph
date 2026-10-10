import type { Metadata } from "next";
import { ArtMaker } from "@/components/art-maker";

export const metadata: Metadata = {
  title: "Make a painting",
  description:
    "One click makes a painting that never existed, and BitGraph proves it: it opens a position, paints from its position commitment, and records the painting in that same position.",
  // Unlisted (Mike, 2026-10-10: "i dont want the slow make a painting"): out of the menu, never indexed; the page still
  // works for old links and shares, and /portrait and /image still redirect here.
  robots: { index: false, follow: false },
};

/* The painting generator (Mike, 2026-10-09: at the v15 launch the page moved to /painting; /portrait and /image redirect here); before that the portrait generator (Mike, 2026-10-08: "portrait page is replacing images"), before that the image generator (Mike, 2026-10-05), laid out like the home page (Mike, 10-06: "design it like
   the homepage"): one centred column, the headline and one button; the image appears below, with its
   code as the caption. Headline: Mike's words (10-06), "clicking that button will create an image
   that never existed before and the proof to back that claim up", then "and bitgraph proves it".
   True here without a caveat: the image is a function of a code that did not exist before the click
   (unlike an uploaded file). The headline is handed to ArtMaker so it can fold away on the click. The
   order, the drawing rules and the checks live in lib/art-position.ts and lib/commitment-art.ts. */
export default function PaintingPage() {
  return (
    <div className="frame prose art-page">
      <ArtMaker>
        {/* Mike, 10-06: "create an image h1 small h2", the same shape as /jev's "Ask Jev". */}
        <h1 className="jev-title">Make a painting</h1>
        <p className="lede jev-lede">One click makes a painting that never existed, and BitGraph proves&nbsp;it.</p>
                <p className="lede jev-lede art-why">BitGraph begins the proof before the bits exist. Here you watch it happen: the click opens a position, and the position&rsquo;s commitment becomes part of the computation: it is the only input the painting is painted from. The painting is then recorded in that same position, so it could not have existed before its BitGraph began. The painting can be painted again from the commitment, and the proof checks without contacting anyone. Every record gets the same guarantee; a painting just makes it&nbsp;visible.</p>
      </ArtMaker>
    </div>
  );
}
