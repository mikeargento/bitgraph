import type { Metadata } from "next";
import { CopiesTiles, HarborRow, RecordTiles } from "@/components/demo-row";

/**
 * The fourth demo, three examples of three files in the order they were recorded (components/demo-row.tsx): one
 * photograph saved three times; a picture, a video made from it and a copy of it; and one patient record in three
 * versions.
 */
export const metadata: Metadata = {
  title: "Copies",
  description: "Three files in three places in line: a photograph saved three times, a picture with its video and copy, and a patient record in three versions.",
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
      <section className="home-section" aria-labelledby="records-h">
        <h2 id="records-h" className="copies-h"><span className="copies-h-a">One record, three versions.</span>{" "}<span className="copies-h-b">Three places in line.</span></h2>
        {/* The same claim as above: the order the versions were recorded in. The dates are typed in the records; the
            patient is invented. */}
        <p className="copies-note">
          A patient&rsquo;s record saved three times as it changed: a first visit, an allergy added, a dose changed. Each
          version got its own BitGraph, one right after another. The proofs show the order the three were recorded in.
          The dates come from the records themselves, not from the proofs, and the patient is invented for this page.
        </p>
        <RecordTiles />
      </section>
    </div>
  );
}
