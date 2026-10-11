import type { Metadata } from "next";
import { ArtMaker } from "@/components/art-maker";

export const metadata: Metadata = {
  title: "Bridge",
  description: "One click builds a bridge that never existed, and BitGraph proves it.",
  // Hidden (2026-10-10): never indexed, not in the menu or the sitemap; it opens for anyone with the link.
  robots: { index: false, follow: false },
};

/* Bridge (2026-10-10): /generate's page, shape for shape, for bitgraph-art/18, a suspension bridge built from packed flat
   rectangles whose every placement comes from the click's position commitment. The recorded file is a PNG that carries
   its print SVG. ArtMaker's "bridge" mode: the same flow, the same ending (the piece, the two-part explanation, "Make
   another" and "See the full proof"), and it reopens a piece from ?p=<digest>. STAGED for Mike: the new words in red. */
export default function BridgePage() {
  return (
    <div className="frame prose art-page">
      <ArtMaker mode="bridge">
        <h1 className="jev-title"><span style={{ color: "#d93025" }}>Bridge</span></h1>
        <p className="lede jev-lede"><span style={{ color: "#d93025" }}>One click builds a bridge that never existed, and BitGraph proves&nbsp;it.</span></p>
      </ArtMaker>
    </div>
  );
}
