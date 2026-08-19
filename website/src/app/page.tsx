"use client";

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
        /* ❄️ No link on home (Mike, 2026-08-19: "remove link"). "What is a
           BitGraph →" lived under the box, then on the title's right, then as
           "Info →" on phones, and went the same day the title became the
           claim itself. The title is still a quiet link to the overview, and
           Overview is the first item under Docs. The class is the camera's
           slot name; home passes nothing into it. */
        .hero-more { }
      `}</style>
      <BitGraphCamera
        id="home"
        strategy={anonymous}
        acceptsPendingDrop
        /* The claim, not the metaphor (Mike, 2026-08-19: "change home to A
           BitGraph gives bits a place"): the overview's h1 and the README's
           first line, so home, the overview and the README open on one
           sentence. "A camera for bits" was the title from 2026-07 to today;
           it survives in the tab, OpenGraph and Twitter titles until those
           are decided. No terminal period: this is the app surface. The h1
           stays a quiet link to the overview (colour inherit, hover only),
           the one path there from this page besides Docs. */
        title={<a href="/docs/overview">A BitGraph gives bits a place</a>}
        belowClassName="hero-more"
      />
    </>
  );
}
