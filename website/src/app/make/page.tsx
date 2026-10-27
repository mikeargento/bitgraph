import type { Metadata } from "next";
import { DropBox } from "@/components/drop-box";

/**
 * Making: a drop is bound at once, one file or many, as one tree and one BitGraph. Nothing is looked up first; the
 * same bytes bound again get a BitGraph of their own, listed in order on the file's proof page.
 */

export const metadata: Metadata = {
  title: "Make",
  description: "Drop files to make their BitGraph. Each file is hashed in your browser; only its SHA-256 is sent.",
};

export default function MakePage() {
  return (
    <div className="frame" style={{ padding: "56px 0 96px", maxWidth: "var(--measure)" }}>
      <h1 className="sr-only">Make.</h1>
      <DropBox mode="make" />
      <div className="page-about">
        <p>Drop files to bind them in a BitGraph: proof that these exact bits existed by now, and could not have been bound before. Many files at once become one tree and one BitGraph, and each file in it can be checked on its own.</p>
        <p>A photo also gets its BitGraphed file: the photo with its proof inside and an invisible watermark that leads copies back here. BitGraphs are permanent, and the same file dropped again gets a BitGraph of its own.</p>
      </div>
    </div>
  );
}
