import type { Metadata } from "next";
import { DropBox } from "@/components/drop-box";

/** Drop a file: the page's headline, then one plain drop box under it. A new file gets its BitGraph; a file that has one opens its proof. The demos have their own page, /examples. */
export const metadata: Metadata = {
  title: "Drop a file",
  description: "A new file gets its BitGraph, a proof of its place in line. A file that has one opens its proof.",
};


export default function DemosPage() {
  return (
    <div className="frame home home-typing prose home-scroll docs-page tools-page sx-page drop-page">
      <div className="home-hero"><h1 className="sr-only">Drop a file.</h1></div>
      <section className="home-section" aria-labelledby="try-h">
        <p className="home-kicker">Drop a file</p>
        <h2 id="try-h">Make or check a BitGraph.</h2>
        {/* The drop box: one plain target under the headline. */}
        <div className="page-box"><DropBox mode="make" hero /></div>
      </section>
    </div>
  );
}
