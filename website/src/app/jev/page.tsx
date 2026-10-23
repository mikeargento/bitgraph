import type { Metadata } from "next";
import { JevAsker } from "@/components/jev-asker";

/** Ask Jev, rebuilt on two BitGraphs, the current architecture (2026-10-17; unlinked). */
export const metadata: Metadata = {
  title: "Ask AI",
  description: "One click makes BitGraph A; two questions are made from its nonce, the AI Jev answers them, and the record is bound as BitGraph B.",
};

export default function JevPage() {
  return (
    <div className="frame home home-typing prose home-scroll jev-page">
      <div className="home-hero">
        <h1 className="sr-only">Ask AI.</h1>
      </div>
      <JevAsker />
    </div>
  );
}
