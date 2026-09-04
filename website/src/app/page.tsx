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
        fuseByDefault
        acceptsPendingDrop
        /* The page is the instrument and one line over it, which is what it
           was before an evening of trying to make it explain itself. That
           version grew a hero, a mechanism, a guarantee, verification,
           integration, a trust model and a licence, and Mike put it back:
           "just return the homepage to what it was this afternoon when it was
           just a dropbox but this headline". Everything it grew has a better
           home in the docs, and the docs already had it.

           No terminal period: this is the app surface. The h1 stays a quiet
           link to the overview (colour inherit, hover only), the one path
           there from this page besides Docs. */
        title={<a href="/docs/overview">Give bits a provable place</a>}
        /* The what-happens pair, inside the frame since 2026-08-27; shared
           with /actor. Wording rules live on the component. */
        belowClassName="hero-more"
        below={
          /* Home's ONE discoverable exit (the h1 is a link too, but it is
             colour: inherit with no underline and hover-only, so on a phone it
             does not exist). "How BitGraph works" (Mike, 2026-08-19 evening;
             it was "What is a BitGraph" from the morning): the title above
             already says what one is, so the link asks the next question, and
             /docs/overview answers it. Real proofs
             are still one nav click away under Roll. The site's standard link
             type (14 / 600 / -0.01em, brand blue), on the layout-neutral
             .bg-arrow-link tap target. */
          <>
            {/* The two-line "what happens" pair lived here, then inside the frame,
                until 2026-09-03, when Mike removed it: too basic for the box. */}
            {/* "No token. No wallet. No blockchain required." lived here for
                one day (2026-08-26, b8a25e99, removed the same evening). It
                was the block's only line when it shipped and carried the lite
                message alone; once the pair above existed it answered a
                question the page no longer raises, and three negations under
                two calm statements read as a sticker on a spec. What it
                carried survives elsewhere: "required" because Ethereum is the
                chosen method (the overview's wall-clock section opens on
                exactly that), and "No cost." stays rejected (recording is the
                licensed side of the deck's money line). See memory
                project_home_no_crypto_line before restoring anything here. */}
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
