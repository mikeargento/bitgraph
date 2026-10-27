import type { Metadata } from "next";
import { BitGraphedView } from "@/components/bitgraphed-view";

export const metadata: Metadata = {
  title: "BitGraphed file",
  description: "A watermarked photo between two BitGraphs: A records the original, a pointer from A's nonce is written into the pixels, and B records the watermarked file.",
};

export default function BitGraphedPage() {
  return (
    <div className="frame home home-typing prose home-scroll jev-page">
      <div className="home-hero">
        <h1 className="sr-only">BitGraphed file.</h1>
      </div>
      <BitGraphedView />
    </div>
  );
}
