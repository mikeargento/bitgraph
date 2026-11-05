import type { Metadata } from "next";
import { ExamContent } from "@/components/exam-content";

export const metadata: Metadata = {
  title: "The sealed exam",
  description:
    "A benchmark you can prove is fresh: twenty questions derived from BitGraph A's nonce, the answers bound as BitGraph B, and the whole sitting verified offline in three commands.",
  openGraph: {
    title: "A benchmark you can prove is fresh.",
    description:
      "Twenty questions derived from BitGraph A's nonce, the answers bound as BitGraph B, and the whole sitting verified offline in three commands.",
    type: "website",
    siteName: "BitGraph",
  },
};

export default function ExamPage() {
  return (
    <div className="frame home home-typing prose home-scroll jev-page">
      <div className="home-hero">
        <h1 className="sr-only">The sealed exam.</h1>
      </div>
      <ExamContent />
    </div>
  );
}
