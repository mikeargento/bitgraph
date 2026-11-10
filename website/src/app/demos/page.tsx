import type { Metadata } from "next";
import { DropBox } from "@/components/drop-box";

/** Make / Verify: one drop box and nothing else. A new file gets its BitGraph; a file that has one opens its proof. The demos have their own page, /examples. */
export const metadata: Metadata = {
  title: "Make / Verify",
  description: "A new file gets its BitGraph, a proof of its place in line. A file that has one opens its proof.",
};


export default function DemosPage() {
  return (
    <div className="frame home home-typing prose home-scroll docs-page tools-page sx-page">
      <div className="home-hero"><h1 className="sr-only">Make / Verify.</h1></div>
      <section className="home-section" aria-labelledby="try-h">
        <p className="home-kicker">Make / Verify</p>
        <h2 id="try-h">Make or Verify a BitGraph.</h2>
        {/* The drop box itself, no door to click. */}
        <div className="page-box"><DropBox mode="make" /></div>
      </section>
    </div>
  );
}
