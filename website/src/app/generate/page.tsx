import type { Metadata } from "next";
import { ArtMaker } from "@/components/art-maker";
import { DemoSteps } from "@/components/demo-steps";

export const metadata: Metadata = {
  title: "Generate an image",
  description: "One click makes an image that never existed, and BitGraph proves it.",
  // Listed (Mike, 2026-10-10): in the menu in place of /painting, in the sitemap, indexed. It was hidden on 2026-10-09.
};

/* Three (Mike, 2026-10-09: "basically copy the painting page"): /painting's page, word for word in shape, for
   three flat shapes in red, yellow, blue and green that never touch. The recorded file is a PNG that carries its print SVG.
   Since 2026-10-10 it makes bitgraph-art/17, the 16:9 Three (it made version 16, square, before), ends as the home page
   does, and reopens either version from ?p=<digest>. Since 2026-10-11 (Mike: "we should make this the demo", then
   "/generate") it makes bitgraph-art/19, the Bridge at 16:9 (/bridge's square version 18, redrawn wide), with the same
   page, the same ending and the "How it was drawn" line, and still reopens every Three and bridge; ArtMaker's "generate"
   mode. The home page still makes the 16:9 Three. */
export default function GeneratePage() {
  return (
    <div className="frame prose art-page">
      <ArtMaker mode="generate">
        {/* Redone 2026-10-10 (Mike: "we have to redo this landing page"): the menu's name, one sentence, the button. The long
            why-paragraph is gone from here: the same explanation appears under the image once it is made. */}
        <h1 className="jev-title"><span>Generate an image</span></h1>
        <p className="lede jev-lede"><span>One click makes an image that never existed, and BitGraph proves&nbsp;it.</span></p>
      </ArtMaker>
      <DemoSteps
        steps={[
          { title: "A position opens", text: "BitGraph opens a fresh position. Its commitment is unpredictable, so nobody could know it in advance." },
          { title: "The image is drawn from it", text: "Every setting of the bridge comes from that commitment, so the image could not have existed before the position opened.", link: { href: "/generate/source", label: "The code that draws it" } },
          { title: "The image is recorded in it", text: "The finished image goes into that same position, between a Base block before and a Base block after." },
        ]}
      />
    </div>
  );
}
