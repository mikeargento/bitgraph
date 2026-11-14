import type { Metadata } from "next";
import { DemoCards } from "@/components/demo-cards";
import { RecordTiles } from "@/components/demo-row";

/** One record in three versions (RecordTiles) at the top, then the four demos, two to a row (components/demo-cards.tsx). */
export const metadata: Metadata = {
  title: "Demos",
  description: "Working examples, each on real BitGraphs you can check: two live demos and two recorded ones.",
};

export default function ExamplesPage() {
  return (
    <div className="frame home home-typing prose home-scroll docs-page tools-page sx-page">
      <div className="home-hero"><h1 className="sr-only">Demos.</h1></div>
      {/* The page's heading, then the first example right under it: one synthetic patient record in three versions,
          each with its own place in line. */}
      <section className="home-section demos-records" aria-labelledby="demos-h">
        <p className="home-kicker">Demos</p>
        <h2 id="demos-h">Working examples, each on real BitGraphs.</h2>
        <h3 className="tl-h3" id="records-h">One record. Three versions. Three places in line.</h3>
        <p className="copies-note">
          A patient&rsquo;s record was changed twice. Each version got its own BitGraph when it was saved, so anyone can
          see which came first. The record is invented for this page; the proofs are real.
        </p>
        <RecordTiles />
      </section>
      {/* The four demos with pages of their own, two to a row. */}
      <section className="home-section" aria-labelledby="more-h">
        <p className="home-kicker" id="more-h">More demos</p>
        <DemoCards />
      </section>
    </div>
  );
}
