"use client";

import Link from "next/link";
import { BitGraphCamera } from "@/components/bitgraph-camera";
import { anonymous } from "@/lib/commit-strategy";

/**
 * Home: the camera, with the plain commit.
 *
 * The implementation is components/bitgraph-camera.tsx, shared with /actor
 * since 2026-08-19 (the seam is lib/commit-strategy.ts). What is left here is
 * what is home's alone: its title, the one link under the frame, and the two
 * style rules those carry.
 *
 * Rules this page must not break:
 *   - the box NEVER prompts. A first-time visitor drops a file and gets a
 *     proof, with no dialog and no decision.
 *   - an undeclared recording is not the degraded one. Order, slot binding and
 *     anchors are identical either way; only the who differs, and here there
 *     is none. An enrolled browser still records anonymously from this page,
 *     and should: the shared chain's anonymity set is every recording.
 */
export default function BitGraphPage() {
  return (
    <>
      <style>{`
        /* The title is a quiet door to the overview: plain at rest, brand blue
           on hover. It is the one h1 on the site that is a link. */
        .bitgraph-tagline a { color: inherit; text-decoration: none; transition: color .15s ease; }
        .bitgraph-tagline a:hover, .bitgraph-tagline a:focus-visible { color: #0065A4; }
        /* Home's one link. It lived under the box (42px off it, 68 for a day)
           until 2026-08-19, when the title row took it: the camera lays it on
           the right of the title, baseline-aligned, the same row as the
           results heading and the Roll's nav line. Nothing to size here; the
           class exists so the camera's fit measurement can observe the row,
           and so /actor's .declare-more is its twin. */
        .hero-more { }
      `}</style>
      <BitGraphCamera
        id="home"
        strategy={anonymous}
        acceptsPendingDrop
        /* No terminal period on the title, matching how it already renders
           in the tab title, the OpenGraph title and the Twitter card
           ("BitGraph | A camera for bits"). */
        title={<a href="/docs/overview">A camera for <span className="accent">bits</span></a>}
        belowClassName="hero-more"
        below={
          /* Home's ONE discoverable exit (the h1 above is a link too, but it
             is colour: inherit with no underline and hover-only, so on a
             phone it does not exist). It pointed at a single example proof
             until 2026-08-18. A stranger's first question is what this is,
             not what the output looks like, and /docs/overview now answers
             that starting from a Polaroid rather than from a TEE. Real
             proofs are still one nav click away under Roll, so the
             no-commitment path to seeing one is not lost.

             The site's standard link type (Mike, 2026-08-19: "What is a
             BitGraph → and rename forget links should be the sites standard
             size links"): the .bg-action-link numbers, 14 / 600 / -0.01em in
             brand blue, on the layout-neutral .bg-arrow-link tap target.
             /actor's Rename · Forget wears the same numbers in the same slot.
             ⚠️ It was 16 for a day (reasoned as level with the box's hints)
             and 19 for one deploy before that (copied from the Folder link
             in 19px prose). One size for every link on the site beats a
             size reasoned per context; 14 is that size. */
          <Link
            href="/docs/overview"
            className="bg-arrow-link"
            style={{ fontSize: 14, fontWeight: 600, letterSpacing: "-0.01em", color: "#0065A4", textDecoration: "none" }}
          >
            What is a BitGraph <span className="arrow" aria-hidden="true">&rarr;</span>
          </Link>
        }
      />
    </>
  );
}
