import type { Metadata } from "next";
import Overview from "@/app/docs/overview/page";

/**
 * Home is the documentation now (Mike, 2026-09-08: "so yes homepage will get
 * demoted and docs page will now live home").
 *
 * The site is becoming documentation plus a verifier: making moves to a
 * desktop app, because every wall this product hit in the browser — no folder,
 * no path, no writing beside a file, no durable store — is one wall. What the
 * web keeps is explaining and verifying, and both of those want a page, not a
 * box.
 *
 * ⚠️ THE CAMERA IS NOT GONE, IT IS AT /make, and it must stay until the app
 * ships: right now it is the only way to make a BitGraph in the world.
 *
 * The overview's own component is rendered rather than copied, so there is one
 * source for it and /docs/overview keeps working for every link that already
 * points there. ⚠️ Mike is replacing this page's body with a diagram; two
 * candidates already sit in public/ (how-a-bitgraph-is-made.svg,
 * position-first.svg).
 */
export const metadata: Metadata = {
  title: "BitGraph",
  description:
    "How a BitGraph is made: the position is reserved before your file's fingerprint arrives, and consumed once. Why that is different from signing something afterward.",
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
    </div>
  );
}
