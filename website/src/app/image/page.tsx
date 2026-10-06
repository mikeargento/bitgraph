import type { Metadata } from "next";
import { ArtMaker } from "@/components/art-maker";

export const metadata: Metadata = {
  title: "BitGraph image",
  description:
    "One click opens a BitGraph position, draws an image from its commitment, and records the image in that position. Nobody could have drawn it before the position opened.",
};

/* The image generator (Mike, 2026-10-05). The page says what happens and gives one button; the
   order, the drawing rules and the checks live in lib/art-position.ts and lib/commitment-art.ts. */
export default function ImagePage() {
  return (
    <div className="frame prose" style={{ padding: "56px 0 96px" }}>
      <h1>An image that could not exist before you click.</h1>
      <p className="lede">
        BitGraph opens a position first. The image is drawn from that position&rsquo;s commitment, then recorded in the same position.
      </p>
      <ArtMaker />
    </div>
  );
}
