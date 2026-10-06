import type { Metadata } from "next";
import { JevAsker } from "@/components/jev-asker";

export const metadata: Metadata = {
  title: "Ask Jev",
  description: "One click asks an AI two questions that never existed before, and BitGraph proves it: the questions are made from a new position's code, and the answers are recorded in that same position.",
};

/* Ask Jev (Mike, 2026-10-06), laid out exactly like /image: the headline and one button; the steps in
   the middle of the screen while it runs; then the result. The work is live.bitgraph.ing's. */
export default function JevPage() {
  return (
    <div className="frame prose art-page">
      <JevAsker>
        <h1 style={{ color: "#d93025" }}>One click asks an AI two questions that never existed before, and BitGraph proves&nbsp;it.</h1>
      </JevAsker>
    </div>
  );
}
