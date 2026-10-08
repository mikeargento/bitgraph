import type { Metadata } from "next";
import { ArtMaker } from "@/components/art-maker";

export const metadata: Metadata = {
  title: "Draw a person",
  description:
    "One click draws a person who never existed, and BitGraph proves it: it opens a position, draws the portrait from its position commitment, and records it in that same position.",
};

/* The portrait generator (Mike, 2026-10-08: "portrait page is replacing images"; /image redirects here), before that the image generator (Mike, 2026-10-05), laid out like the home page (Mike, 10-06: "design it like
   the homepage"): one centred column, the headline and one button; the image appears below, with its
   code as the caption. Headline: Mike's words (10-06), "clicking that button will create an image
   that never existed before and the proof to back that claim up", then "and bitgraph proves it".
   True here without a caveat: the image is a function of a code that did not exist before the click
   (unlike an uploaded file). The headline is handed to ArtMaker so it can fold away on the click. The
   order, the drawing rules and the checks live in lib/art-position.ts and lib/commitment-art.ts. */
export default function PortraitPage() {
  return (
    <div className="frame prose art-page">
      <ArtMaker>
        {/* Mike, 10-06: "create an image h1 small h2", the same shape as /jev's "Ask Jev". */}
        <h1 className="jev-title">Draw a person</h1>
        <p className="lede jev-lede">One click draws a person who never existed, and BitGraph proves&nbsp;it.</p>
                <p className="lede jev-lede art-why">BitGraph begins the proof before the bits exist. Here you watch it happen: the click opens a position, and the position&rsquo;s commitment becomes part of the computation: it is the only input the portrait is drawn from. The portrait is then recorded in that same position, so it could not have existed before its BitGraph began. The portrait can be drawn again from the commitment, and the proof checks without contacting anyone. Every record gets the same guarantee; a portrait just makes it&nbsp;visible.</p>
      </ArtMaker>
    </div>
  );
}
