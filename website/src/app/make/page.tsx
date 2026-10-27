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
    </div>
  );
}
