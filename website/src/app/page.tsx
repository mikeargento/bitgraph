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
        /* The link under the box. The film pair briefly sat here and was cut:
           it was written as the payoff to the overview diagram, and with no
           diagram above it on this page it asked the reader to accept an
           analogy nothing had set up.

           The gap is set here, not inherited. .bg-action-link carries 14px of
           its own padding and .bg-arrow-link carries none, so when this row
           changed from one to the other the spacing silently collapsed to 3px.

           42 because the box directly above is one big click target and a
           stray hit on it opens a file dialog. At 20px the buffer was about
           4mm on a phone, under what adjacent tap targets want; this is
           closer to 7mm.

           ⚠️ 42 is also /actor's .declare-more, and it must stay so: the two
           pages are one composition, and the block under each frame is one
           16px line box at this margin (home's link, /actor's Rename ·
           Forget), which is what keeps the two frames the same size with no
           correction in useCameraFit. It was 68 for a day, when /actor carried
           a second line under its frame; that line now lives inside the box. */
        .hero-more { margin-top: 42px; }
        /* Short viewports tighten with the rest of the composition (the
           camera's own rule does the title and padding). */
        @media (max-height: 520px) {
          .hero-more { margin-top: 14px; }
        }
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
