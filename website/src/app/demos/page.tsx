import type { Metadata } from "next";
import { DropBox } from "@/components/drop-box";

/** Try it opens this page: Make a BitGraph, one drop box and nothing else. The three demos have their own page, /examples. */
export const metadata: Metadata = {
  title: "Make a BitGraph",
  description: "Drop any file and get its BitGraph, a proof of its place in line.",
};


export default function DemosPage() {
  return (
    <div className="frame home home-typing prose home-scroll docs-page tools-page sx-page">
      <div className="home-hero"><h1 className="sr-only">Make a BitGraph.</h1></div>
      <section className="home-section" aria-labelledby="try-h">
        <h2 id="try-h">Make a BitGraph.</h2>
        <p>Drop any file. Get its proof.</p>
        {/* The drop box itself, no door to click (2026-10-30). The Ledger is in the menu. */}
        <div className="page-box"><DropBox mode="make" /></div>
      </section>
    </div>
  );
}
