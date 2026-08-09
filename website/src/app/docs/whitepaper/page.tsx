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
      {/* "Whitepaper", not "BitGraph". The heading said BitGraph for months, 40px
          under a wordmark that says the same word, which is the repetition the
          docs section bar was deleted for in July. Naming the page instead of
          the product fixes that and puts this page back in line with every other
          one in the docs, where the h1 is the menu label (Mike, 2026-08-09).
          Dropping the h1 altogether was tried first and left the paper with no
          heading element at all.

          The byline stays under it. It is not a repeat of anything: it is who
          wrote the paper and the patent marking, and a technical paper people
          download and cite should carry both. */}
      <h1 style={{ margin: "0 0 6px" }}>Whitepaper</h1>
      <p className="text-xs text-[#4b5563]" style={{ margin: "0 0 26px" }}>
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
