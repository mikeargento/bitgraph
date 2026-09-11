import type { Metadata } from "next";
import Overview from "@/app/docs/overview/page";
import { DocsPageNav } from "@/components/docs-page-nav";

/**
 * Home is the documentation now (Mike, 2026-09-08: "so yes homepage will get
 * demoted and docs page will now live home").
 *
 * The site is A SPEC AND A SOFTWARE DOWNLOAD (Mike, 2026-09-08). Making and
 * checking both move to a desktop app, because every wall this product hit in
 * the browser — no folder, no path, no writing beside a file, no durable store
 * — is one wall, and checking in a browser is trusting the same server you are
 * checking. What the web keeps is EXPLAINING, which wants a page, not a box.
 *
 * ⚠️ /make AND /verify ARE BOTH GONE. Removing the camera did not remove the
 * ability to record: the published MCP, the hosted /mcp and the two-call API
 * all make BitGraphs, which is what made it safe to cut today rather than
 * after the app ships. Do not restore either route.
 *
 * The overview's own component is rendered rather than copied, so there is one
 * source for it and /docs/overview keeps working for every link that already
 * points there. ⚠️ Mike is replacing this page's body with a diagram; two
 * candidates already sit in public/ (how-a-bitgraph-is-made.svg,
 * position-first.svg).
 */
export const metadata: Metadata = {
  title: "BitGraph",
  // 2026-09-10: the same sentence as the site-wide description in layout.tsx,
  // from the overview opener this page renders.
  description:
    "BitGraph gives AI agent records a verifiable order. The proof travels with the record, verifies without contacting anyone, and is detectably invalid if the record is altered.",
};

export default function HomePage() {
  /* ⚠️ THE COLUMN COMES FROM THE DOCS LAYOUT, AND HOME IS NOT UNDER IT.
   *
   * app/docs/layout.tsx is what gives every docs page its reading column and
   * its 40px under the nav; the pages themselves declare `maxWidth: "none"`
   * and lean on it entirely. Rendering the overview at / without that wrapper
   * put the text full-bleed against the left edge of the viewport with no top
   * padding — the same words, unreadable (Mike: "you fucked up spacing on
   * homepage").
   *
   * Same numbers, deliberately, not approximately: 90% to 800px, 40 above and
   * 80 below, matching /subjects and every docs route. If the docs column ever
   * changes, this changes with it. */
  return (
    <div style={{ width: "90%", maxWidth: 800, margin: "0 auto", padding: "40px 0 80px" }}>
      <Overview />
      {/* The overview's own previous/next pair, which the docs layout gives it
          at /docs/overview and this wrapper has to give it here. */}
      <DocsPageNav current="/docs/overview" />
    </div>
  );
}
