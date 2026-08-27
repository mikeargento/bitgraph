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
             /docs/overview answers it. Real proofs
             are still one nav click away under Roll. The site's standard link
             type (14 / 600 / -0.01em, brand blue), on the layout-neutral
             .bg-arrow-link tap target. */
          <>
            {/* The what-happens pair (Mike's wording, devised 2026-08-26).
                Block rule: ALL "what", NO "how"; every how lives behind the
                link below. "Place" is the h1's own noun, so the title's
                promise and these lines close into one loop; "before your
                bits arrive" is the nonce-first fact in lay speech; the italic
                is stress on the one load-bearing word; "permanently" is the
                forever beat (an "address, forever" sentence was cut, then the
                adverb brought it back). One sentence per line by construction
                ("maybe 3 lines"), which is also what lets each line hold 16px
                on phones with no clamp (a min(16px, 3.35vw) clamp lived here
                for an afternoon; remeasure if the wording reflows).
                "instantly, permanently." with a comma (2026-08-27): with
                "and" the line needed 15.99px to fit at 375 and wrapped
                "permanently." onto its own line. */}
            {/* "your file hash arrives", not "your bits arrive" (Mike,
                2026-08-26 evening): the hash is the thing that travels; the
                bits never do, and the old wording brushed against the frame's
                "never uploaded". Line two keeps "bits" on purpose: the hash
                is what arrives, but in the site's ontology it is your BITS
                that take the place (the h1's loop), mechanism then meaning. */}
            <div style={{ fontSize: 16, color: "#111827", marginBottom: 14 }}>
              A place opens <em>before</em> your file hash arrives.
              <br />
              Your bits fill the place instantly, permanently.
            </div>
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
