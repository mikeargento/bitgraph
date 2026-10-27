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
      <div className="page-about">
        <p>Every BitGraphed photo carries an invisible watermark that points back to its BitGraph. It survives screenshots, reposts and re-saves. Drop a copy here and it leads you to the original&rsquo;s proof. The watermark is read in your browser, and nothing is recorded.</p>
        <p>The watermark is Meta&rsquo;s <a href="https://github.com/facebookresearch/videoseal" target="_blank" rel="noopener">Pixel Seal</a>, open source. Photos BitGraphed before it used Adobe&rsquo;s <a href="https://github.com/adobe/trustmark" target="_blank" rel="noopener">TrustMark</a>, which is still read.</p>
      </div>
    </div>
  );
}
