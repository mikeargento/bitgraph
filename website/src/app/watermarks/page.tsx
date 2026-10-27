import type { Metadata } from "next";
import { DropBox } from "@/components/drop-box";

/**
 * Checking a copy: a screenshot, a repost or a re-saved photo is read for the hidden pointer its BitGraphed file
 * carries, and a pointer that checks out leads to the original's proof page. Nothing is made here; Proofs makes.
 */

export const metadata: Metadata = {
  title: "Watermarks",
  description: "Drop a copy of a photo, a screenshot or a repost, to find the original BitGraph its hidden pointer leads to.",
};

export default function WatermarksPage() {
  return (
    <div className="frame" style={{ padding: "56px 0 96px", maxWidth: "var(--measure)" }}>
      <h1 className="sr-only">Watermarks.</h1>
      <DropBox mode="check" />
    </div>
  );
}
