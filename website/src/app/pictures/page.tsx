import type { Metadata } from "next";
import { CopiesTiles, DemoRow } from "@/components/demo-row";

/**
 * The fourth demo: one source in three files, twice (components/demo-row.tsx). The first row, in black and white, is a
 * picture, a copy of it and a video of it. The second row, in color, is one photograph saved three times. Each row
 * runs in the order its files were recorded.
 */
export const metadata: Metadata = {
  title: "Copies",
  description: "A picture, a copy of it, and a video of it: three files that look alike, each with its own BitGraph.",
};

export default function PicturesPage() {
  return (
    <div className="frame home home-typing prose home-scroll docs-page tools-page sx-page">
      <div className="home-hero"><h1 className="sr-only">Copies.</h1></div>
      <section className="home-section" aria-labelledby="pictures-h">
        <p className="home-kicker">Copies</p>
        <h2 id="pictures-h">One source, three files</h2>
        <p className="demo-intro">
          A picture made with ChatGPT, a copy of it made by Google, and a video of it made by Grok. They look alike and
          are different files, so each has its own place in line.
        </p>
        <DemoRow />
        <p className="demo-intro">
          One photograph saved three times. The pictures are the same and the files are not, so each has its own place
          in line.
        </p>
        <CopiesTiles />
      </section>
    </div>
  );
}
