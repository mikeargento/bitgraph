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
      {/* No "BitGraph" heading. It sat 40px under a wordmark that says the same
          word, which is the same repetition the docs section bar was deleted for
          in July (a control whose label repeated the h1 beneath it). The
          wordmark is the title.

          The byline stays. It is not a repeat of anything, it is who wrote the
          paper and the patent marking, and a technical paper that people
          download and cite should carry both. */}
      <p className="text-xs text-[#4b5563]" style={{ margin: "0 0 22px" }}>
        Michael James Argento &middot; Patent Pending
      </p>

      <TocDropdown />

      <Sections1Through3 />
      <Sections4Through6 />
      <Sections7Through9 />
      <Sections10Through19 />
    </article>
  );
}
