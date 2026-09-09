"use client";

import { BitGraphCamera } from "@/components/bitgraph-camera";
import { LedgerLight } from "@/components/ledger-light";
import { anonymous } from "@/lib/commit-strategy";

/**
 * /make: the camera, with the plain commit.
 *
 * ⚠️ THIS WAS HOME until 2026-09-08. It moved because the site is becoming
 * documentation plus a verifier and making is moving to a desktop app — but
 * the app does not exist yet, so this route IS the only way to make a
 * BitGraph and must keep working exactly as it did on home. Nothing here
 * changed but the function name.
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
export default function MakePage() {
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
        /* ⚠️ NO HEADLINE. The page is the instrument, and now only the
           instrument (Mike, 2026-09-08). It had carried one line over the
           frame since the evening it was cut back from a hero, a mechanism, a
           guarantee, verification, integration, a trust model and a licence
           ("just return the homepage to what it was this afternoon when it was
           just a dropbox but this headline"); this takes the last of that
           away, and the dashed frame IS the page.

           A line here has to name the whole product in one clause, and every
           candidate traded one fault for another: "gives bits a place" said
           nothing happened, "prove you were first" claims first-existence we
           do not prove, and a precise one ("a cryptographic logical clock")
           gates everyone who does not already know the term. The frame asks
           the only question this page needs to ask.

           useCameraFit takes the title selector and null-checks it, so the
           viewport fit is unaffected: there is simply less chrome to subtract.
           /docs/overview keeps its own path from the nav and from the link
           below the frame. */
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
            {/* ❄️ "How BitGraph works →" IS GONE from under the box, replaced by
                the folder's status (Mike, 2026-09-08). It was home's one
                in-page exit to the overview, and the h1 that was also a link
                went on 2026-09-04 — so the overview is now reached only from
                the Docs menu. That is the right trade once the site is
                documentation plus a verifier: the one line under the box
                should say whether this browser can answer for your files, not
                offer reading material.

                It sits here rather than in the nav because whether YOUR folder
                is connected is a fact about this box, and the header belongs
                to the site. The space above the frame stays empty — that is
                where the headline was removed from. */}
            {/* Centred under the frame, where the link it replaced sat. The
                light is a flex row itself, so it needs a centring parent or it
                hangs off the left edge of the column. */}
            <div style={{ display: "flex", justifyContent: "center" }}>
              <LedgerLight />
            </div>
          </>
        }
      />
    </>
  );
}
