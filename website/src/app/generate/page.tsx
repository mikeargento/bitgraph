import type { Metadata } from "next";
import { ArtMaker } from "@/components/art-maker";

export const metadata: Metadata = {
  title: "Generate an image",
  description: "One click makes an image that never existed, and BitGraph proves it.",
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
        {/* Redone 2026-10-10 (Mike: "we have to redo this landing page"): the menu's name, one sentence, the button. The long
            why-paragraph is gone from here: the same explanation appears under the image once it is made. */}
        <h1 className="jev-title"><span>Generate an image</span></h1>
        <p className="lede jev-lede"><span>One click makes an image that never existed, and BitGraph proves&nbsp;it.</span></p>
      </ArtMaker>
    </div>
  );
}
