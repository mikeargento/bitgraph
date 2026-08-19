"use client";

import { BitGraphCamera } from "@/components/bitgraph-camera";
import { InfoLink } from "@/components/info-link";
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
          /* Home's ONE discoverable exit (the h1 beside it is a link too, but
             it is colour: inherit with no underline and hover-only, so on a
             phone it does not exist). It pointed at a single example proof
             until 2026-08-18. A stranger's first question is what this is,
             not what the output looks like, and /docs/overview now answers
             that starting from a Polaroid rather than from a TEE. Real
             proofs are still one nav click away under Roll, so the
             no-commitment path to seeing one is not lost.

             The words, at the site's standard link type, with "Info →" as the
             phone form (Mike, 2026-08-19: "what about info ->"), since on a
             phone the full words wrap under a 34px title. It was a circled i
             for an afternoon, which never wrapped but was the site's one
             icon-only control and read as a line at that size. The sizes
             before that: 19, 16, then the standard 14 (Mike: "the sites
             standard size links"). */
          <InfoLink href="/docs/overview" label="What is a BitGraph" />
        }
      />
    </>
  );
}
