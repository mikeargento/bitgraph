import type { Metadata } from "next";
import { DropBox } from "@/components/drop-box";

/**
 * Checking a copy: a screenshot, a repost or a re-saved photo is read for the hidden pointer its BitGraphed file
 * carries, and a pointer that checks out leads to the original's proof page. Nothing is made here; Make makes.
 * Laid out as Tools is.
 */

export const metadata: Metadata = {
  title: "Watermarks",
  description: "Drop a copy of a photo, a screenshot or a repost, to find the original BitGraph its hidden pointer leads to.",
};

export default function WatermarksPage() {
  return (
    <div className="frame home home-typing prose home-scroll docs-page tools-page">
      <div className="home-hero">
        <h1 className="sr-only">Watermarks.</h1>
      </div>

      <section className="home-section" aria-labelledby="w-intro">
        <p className="home-kicker">Watermarks</p>
        <h2 id="w-intro">Find a copy&rsquo;s original.</h2>
        <p>
          Every BitGraphed photo carries an invisible watermark that points back to its BitGraph. It survives screenshots, reposts and
          re-saves. Drop a copy here and it leads you to the original&rsquo;s proof. The watermark is read in your browser, and nothing is
          recorded. The watermark is Meta&rsquo;s{" "}
          <a href="https://github.com/facebookresearch/videoseal" target="_blank" rel="noopener">Pixel Seal</a>, open source.
        </p>
        <div className="page-box"><DropBox mode="check" /></div>
      </section>
    </div>
  );
}
