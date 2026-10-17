import type { Metadata } from "next";
import { JevAsker } from "@/components/jev-asker";

/** Ask Jev, on two BitGraphs (Mike, 2026-10-17: "build ask jev demo again with this new architecture"; unlinked). */
export const metadata: Metadata = {
  title: "Ask Jev",
  description: "One click makes BitGraph A; two questions are made from its nonce, the AI Jev answers them, and the record is bound as BitGraph B.",
};

export default function JevPage() {
  return (
    <div className="frame home home-typing prose home-scroll jev-page">
      <div className="home-hero">
        <h1 className="sr-only">Ask Jev.</h1>
      </div>
      <JevAsker />
    </div>
  );
}
