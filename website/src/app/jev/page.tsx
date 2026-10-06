import type { Metadata } from "next";
import { JevAsker } from "@/components/jev-asker";

export const metadata: Metadata = {
  title: "Ask Jev",
  description: "One click asks the AI Jev two questions that never existed before, and BitGraph proves it: the questions are made from a new position's code, and the answers are recorded in that same position.",
};

/* Ask Jev (Mike, 2026-10-06), laid out exactly like /image: the headline and one button; the steps in
   the middle of the screen while it runs; then the result. The work is live.bitgraph.ing's. */
export default function JevPage() {
  return (
    <div className="frame prose art-page">
      <JevAsker>
        {/* Mike, 10-06: "this should be 'ask Jev' h1 and logo to jev and then a smaller description and no win count".
            Jev's mark as BitGraph Predictions used it: plain, beside the name. */}
        <h1 className="jev-title"><img src="/jev-mark.png" alt="" className="jev-mark" width={52} height={52} />Ask Jev</h1>
        <p className="lede jev-lede">One click asks the AI Jev two questions that never existed before, and BitGraph proves&nbsp;it.</p>
      </JevAsker>
    </div>
  );
}
