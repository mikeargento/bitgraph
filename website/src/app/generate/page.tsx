import type { Metadata } from "next";
import { ArtTwo } from "@/components/art-two";

/** The image generator, on two BitGraphs (Mike, 2026-10-17: "fire the image generator back up using this same method"; unlinked). */
export const metadata: Metadata = {
  title: "Generate image",
  description: "One click makes BitGraph A; its nonce draws a picture, and the picture is bound as BitGraph B.",
};

export default function GeneratePage() {
  return (
    <div className="frame home home-typing prose home-scroll jev-page">
      <div className="home-hero">
        <h1 className="sr-only">Generate image.</h1>
      </div>
      <ArtTwo />
    </div>
  );
}
