import type { Metadata } from "next";
import { DemoCards } from "@/components/demo-cards";

/** The four demos, two to a row (components/demo-cards.tsx). */
export const metadata: Metadata = {
  title: "Demos",
  description: "Demos: work made between two BitGraphs, and one picture in three files.",
};

export default function ExamplesPage() {
  return (
    <div className="frame home home-typing prose home-scroll docs-page tools-page sx-page">
      <div className="home-hero"><h1 className="sr-only">Demos.</h1></div>
      <section className="home-section" aria-labelledby="demos-h">
        <p className="home-kicker">Demos</p>
        <h2 id="demos-h">Made between two BitGraphs</h2>
        <DemoCards />
      </section>
    </div>
  );
}
