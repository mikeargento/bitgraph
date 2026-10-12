import type { Metadata } from "next";
import { JevAsker } from "@/components/jev-asker";
import { DemoSteps } from "@/components/demo-steps";

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
        {/* Mike, 10-06: "this should be 'ask Jev' h1 ... a smaller description and no win count". No Jev mark
            (10-06: "take it out"): it is TypeSafe's icon, and "Create an image" has none. */}
        <h1 className="jev-title">Ask Jev</h1>
        <p className="lede jev-lede">One click asks the AI Jev two questions that never existed before,<br className="br-desk" /> and BitGraph proves&nbsp;it.</p>
        {/* The why-paragraph moved under the result (Mike, 2026-10-10), as on /generate: the landing is the title, one sentence, the button. */}
      </JevAsker>
      <DemoSteps
        steps={[
          { title: "A position opens", text: "BitGraph opens a fresh position. Its commitment is unpredictable, so nobody could know it in advance." },
          { title: "Jev\u2019s questions are made from it", text: "The two questions are built from that commitment, so they could not have existed before the position opened." },
          { title: "The answers are recorded in it", text: "Jev\u2019s answers go into that same position, between a Base block before and a Base block after." },
        ]}
      />
    </div>
  );
}
