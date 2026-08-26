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
        /* Home's one link, under the box, centred like the title above it:
           the same slot, margin and type as /actor's "Forget this device", so
           the two pages are one composition (Mike, 2026-08-19, evening: "once
           again add what is a bitgraph link to homepage and make the two
           pages home and actor match"). 42px off the box: the box is one big
           click target and a stray hit opens a file dialog, so the buffer
           clears adjacent-tap distance. ⚠️ 42 is also /actor's .declare-more;
           the two move together, or the titles part. The link spent the day
           elsewhere (the title's right; "Info →" on phones; removed); this is
           where it started. */
        .hero-more { margin-top: 42px; text-align: center; }
        @media (max-height: 520px) { .hero-more { margin-top: 14px; } }
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
        below={
          /* Home's ONE discoverable exit (the h1 is a link too, but it is
             colour: inherit with no underline and hover-only, so on a phone it
             does not exist). "How BitGraph works" (Mike, 2026-08-19 evening;
             it was "What is a BitGraph" from the morning): the title above
             already says what one is, so the link asks the next question, and
             /docs/overview answers it starting from a Polaroid. Real proofs
             are still one nav click away under Roll. The site's standard link
             type (14 / 600 / -0.01em, brand blue), on the layout-neutral
             .bg-arrow-link tap target. */
          <>
            {/* Kept 2026-08-26 ("push"). The load-bearing word is "required"
                (Mike: "ethereum is the chosen method"): the protocol requires
                an anchor into a public timeline, Ethereum is the method chosen
                for it, and the player verifies air-gapped with no chain access
                (unreachable anchor = UNDETERMINED, never FALSE). The
                overview's wall-clock section opens on the same point. Body 16
                on the ladder, regular weight: bold read as a second headline
                against the frame's ("no bold"). */}
            <div style={{ fontSize: 16, color: "#111827", marginBottom: 14 }}>
              No token. No wallet. No blockchain required.
            </div>
            <Link
              href="/docs/overview"
              className="bg-arrow-link"
              style={{ fontSize: 14, fontWeight: 600, letterSpacing: "-0.01em", color: "#0065A4", textDecoration: "none" }}
            >
              How BitGraph works <span className="arrow" aria-hidden="true">&rarr;</span>
            </Link>
          </>
        }
      />
    </>
  );
}
