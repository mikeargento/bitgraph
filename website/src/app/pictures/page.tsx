import type { Metadata } from "next";
import { CopiesTiles, HarborRow } from "@/components/demo-row";

/**
 * The fourth demo: one photograph saved three times (components/demo-row.tsx), in the order the files were recorded,
 * and under it a second example where the three files differ: a picture, a video made from it and a copy of it.
 */
export const metadata: Metadata = {
  title: "Copies",
  description: "One photograph saved three times: three files that look alike, each with its own BitGraph.",
};

export default function PicturesPage() {
  return (
    <div className="frame home home-typing prose home-scroll docs-page tools-page sx-page copies-page">
      <div className="home-hero"><h1 className="sr-only">Copies.</h1></div>
      <section className="home-section" aria-labelledby="pictures-h">
        <h2 id="pictures-h" className="copies-h"><span className="copies-h-a">Same picture.</span>{" "}<span className="copies-h-b">Three places in line.</span></h2>
        {/* What the three are, in plain words, under the headline and above the pictures. The claim stops at the order
            they were recorded in. */}
        <p className="copies-note">
          These three pictures look exactly alike, but they are three separate files. Each file got its own BitGraph,
          one right after another. You can&rsquo;t tell them apart by looking. Their proofs can: each one shows
          whether its file was recorded 1st, 2nd or 3rd.
        </p>
        <HarborRow />
      </section>
      <section className="home-section" aria-labelledby="made-h">
        <h2 id="made-h" className="copies-h"><span className="copies-h-a">A picture, its video, its copy.</span>{" "}<span className="copies-h-b">Three places in line.</span></h2>
        {/* The claim stops at the order the files were recorded in; who made each is the file's own Content
            Credentials, not the proof. */}
        <p className="copies-note">
          A picture made with ChatGPT, a video Grok made from it and a copy Google made of it. Each file got its own
          BitGraph, one right after another. The proofs show the order the three were recorded in. The makers&rsquo;
          names come from the Content Credentials inside each file, not from the proofs.
        </p>
        <CopiesTiles />
      </section>
    </div>
  );
}
