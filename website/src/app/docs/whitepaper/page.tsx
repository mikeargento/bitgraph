import type { Metadata } from "next";
import Sections1Through3 from "./sections-1-3";
import Sections4Through6 from "./sections-4-6";
import Sections7Through9 from "./sections-7-9";
import Sections10Through19 from "./sections-10-19";
import TocDropdown from "./toc-dropdown";

export const metadata: Metadata = {
  title: "Whitepaper",
  description:
    "BitGraph whitepaper: Proof as a Reachability Property. Formal model, security game, and architecture for authenticated digital state creation.",
};

export default function WhitepaperPage() {
  return (
    <article className="prose-doc">
      <div className="mb-2">
        <h1 className="text-3xl sm:text-4xl font-semibold tracking-[-0.03em] mb-3">
          BitGraph
        </h1>
        <p className="text-lg text-[#1f2937] mb-1">
          Proof as a Reachability Property
        </p>
        <p className="text-xs text-[#636a78] mb-8">
          Michael James Argento &middot; Patent Pending
        </p>
      </div>

      <TocDropdown />

      <Sections1Through3 />
      <Sections4Through6 />
      <Sections7Through9 />
      <Sections10Through19 />
    </article>
  );
}
