import type { Metadata } from "next";
import Sections1Through3 from "./sections-1-3";
import Sections4Through6 from "./sections-4-6";
import Sections7Through9 from "./sections-7-9";
import Sections10Through19 from "./sections-10-19";
import TocDropdown from "./toc-dropdown";

export const metadata: Metadata = {
  title: "Whitepaper",
  description:
    "BitGraph whitepaper: formal model, security game, and architecture for authenticated digital state creation.",
};

export default function WhitepaperPage() {
  return (
    <article className="prose-doc">
      <div className="mb-2">
        <h1 className="mb-3">
          BitGraph
        </h1>
        <p className="text-xs text-[#4b5563] mb-8">
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
