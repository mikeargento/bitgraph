import type { Metadata } from "next";
import { FolderTree } from "@/components/folder-tree";

export const metadata: Metadata = {
  title: "BitGraph Folder",
  description: "A folder on your Desktop that records whatever you put in it. macOS, nothing else to install.",
};

const DOWNLOAD = "https://github.com/mikeargento/bitgraph/releases/latest/download/BitGraphFolder.pkg";
const SOURCE = "https://github.com/mikeargento/bitgraph/tree/main/packages/folder";

/** Actions are blue arrow links, never buttons, the download included.
 *  `.bg-arrow-link` plus the arrow in its own span is what gives the trailing →
 *  the site's hover nudge. */
function Action({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <a href={href} className="bg-arrow-link text-[#0065A4] font-semibold no-underline">
      {children} <span className="arrow" aria-hidden="true">&rarr;</span>
    </a>
  );
}

/* ── The page follows one file: what happens to it, where it lands, what
      leaves the machine, and what you can hand to someone else. ONE exhibit
      carries it, the tree, and the prose around it is four claims, each an h2
      that states it and two sentences that earn it.

   ⚠️ CSS RULE FOR THIS WHOLE FILE: every selector below is written as
      `.prose-doc <sel>`. `.prose-doc`'s p rules in globals.css are NOT inside
      @layer base, so they beat every Tailwind margin utility on this page.
      Anything set loosely, or with a Tailwind margin class, silently loses. Fixing
      that properly would reflow all thirteen docs pages, so this page works
      around it instead. ── */
export default function FolderPage() {
  return (
    <article className="prose-doc">
      {/* One left rail, every element, every width. Centring the hero on
          phones was tried on 2026-08-03 and reverted: the page has one axis
          and everything sits on it. */}
      <h1 className="mb-5">BitGraph Folder</h1>

      {/* ── The download sits BELOW the first section, not in the hero.
          ⚠️ This is placement, not demotion, and it is still the page's one
          action. Read it before moving it back up.

          With the promise line cut, a download directly under the title asked
          a stranger to install something the page had not yet described: the
          first sentence explaining what it is sat below the ask. The fix is
          not a third promise line — two have already been cut for saying what
          the sections say — because the four h2s already cover every angle
          one could take, which is exactly why both predecessors were
          redundant. So the explanation goes first and the offer follows it:
          the sharpest sentence on the page, the paragraph that earns it, and
          then the installer.

          The cost is a call to action that is no longer above the fold. It is
          cheap here: this page is reached from the nav or from the home
          page's own download link, so most arrivals already intend to
          install, and it is a screen down rather than buried. ── */}

      {/* Four claims, in the order the questions arrive: what the thing is and
          where my file went, what it does not send, what that means for me,
          and what a recording is finally for. */}
      <h2 className="text-xl font-semibold bg-first-h2">A folder, not an app</h2>
      {/* "settles into Recordings" is load-bearing: drops MOVE (1.8.0, drops
          absorb, the export holds the only copy). Taking more than one file at
          a time is the whole advantage over the home page's flow, and a
          500-file drop is tested. */}
      <p className="text-[#1f2937] bg-lede">
        The installer puts a BitGraph folder on your Desktop and watches it. Drop files in
        one at a time or in batches; each one settles into Recordings, in a folder named
        after it, next to its BitGraph.
      </p>


      {/* ❄️ The file/folder/BitGraph equation panel was CUT (Mike: "too
          saasy"). It was a picture of a thing the very next sentence says in
          words, and a decorative panel is what a product page does when it
          does not trust its own copy. The tree below is the exhibit that
          survives, because it shows something no sentence does: what is
          actually on your disk afterwards. */}

      {/* ── The exhibit: what is actually on disk. Placed under the claim it
          proves rather than in a section of its own, so the tree reads as
          evidence for "a folder, not an app", not as a second topic. ── */}
      <FolderTree />
      <p className="bg-panel-caption bg-panel-caption-under text-[#1f2937]">
        The top level stays empty. It is the drop zone; Recordings is the archive.
      </p>

      <div className="bg-hero-row">
        {/* On touch the download is replaced by the reason it is missing, and
            by nothing else. The sentence stays because a phone visitor
            otherwise never learns this is Mac software; its companion link was
            removed because the More list at the foot already carries the one
            thing a phone can do, and two actions competing is worse than one.

            Keyed to POINTER, not width: a Mac in a narrow window is still a
            Mac and must keep its download, and a phone in wide landscape still
            cannot install a .pkg.

            The sentence names the form factor AND the platform, because either
            alone misleads: "Mac" by itself leaves an iPhone owner wondering why
            their Apple device does not count, and "laptop / desktop only" by
            itself sends a Windows owner to a machine that cannot open a .pkg.
            Plain weight, body colour, and NEVER red: red is `--color-error`
            here and every use of it means a proof did not verify, so the
            failure colour must not be spent on a platform fact.

            ⚠️ SIZE IS ABOUT COLOUR HERE, not about rank. Saturated blue and
            semibold weigh more than the same size in near-black, which is why
            26px once out-weighed the 32px h1 and the eye reached the action
            before the title, inverting what the page is for.

            19px, down from 22. The 22 was chosen when a subtitle sat between
            this and the h1 and the brief was to land BETWEEN them in the type
            scale. That subtitle is gone, so the number was describing a rank
            defined by a missing element, and with nothing separating them the
            same argument bites harder: 22px of saturated blue immediately
            under 32px of near-black races the title. 19 still clears body
            text by a full step and is still the only action on the page,
            which is all the rank it needs. */}
        <p className="text-lg bg-dl-line">
          <span className="bg-dl-mac" style={{ fontSize: "clamp(17.5px, 4vw, 19px)", letterSpacing: "-0.015em" }}>
            <Action href={DOWNLOAD}>Download for macOS</Action>
          </span>
          <span className="bg-dl-touch text-base text-[#1f2937]">
            Mac laptops and desktops only.
          </span>
        </p>
      </div>

      <h2 className="text-xl font-semibold">Nothing leaves your Mac</h2>
      {/* One clause teaches what a hash is without a lesson: 64 characters,
          identifies the bytes, reveals nothing. That is the whole privacy
          model, and the reader should not need another page for it. */}
      <p className="text-[#1f2937]">
        Your file is hashed where it sits. Only the hash is sent: 64 characters that
        identify the bytes without revealing them.
      </p>

      <h2 className="text-xl font-semibold">Your file is the key</h2>
      <p className="text-[#1f2937]">
        You can only retrieve a proof if you already have the file. If the file remains
        private, the proof remains private.
      </p>

      {/* ⚠️ This section is not optional colour. The Folder builds NO index
          across recordings by design (1.9.0, Mike: "no index file at all.
          instead, you drag and drop the whole folder into the camera and it
          loads the Roll"), so without this the page never tells anyone how to
          see their own archive. A version of it lived here while /folder
          existed and went out with that page on 2026-08-07; the browser page
          was removed, the capability was not. Do not drop it again.

          Accurate as written: discovery is by content at any depth, so
          Recordings or the whole BitGraph folder both work, and the roll
          renders the moment the local scan finishes with verdicts streaming
          in per row behind it. */}
      <h2 className="text-xl font-semibold">Your whole archive, one drop</h2>
      <p className="text-[#1f2937]">
        The Folder writes no pages to browse. Drag Recordings onto bitgraph.ing and the
        archive opens as a roll, every recording checked against the public ledger as the
        rows fill in.
      </p>

      {/* The payoff, and the reason the export is a folder rather than a
          database row: the skeptic who receives one. */}
      <h2 className="text-xl font-semibold">Made to change hands</h2>
      <p className="text-[#1f2937]">
        A recording is a folder you can send. Hand it to anyone and they can drop it on
        bitgraph.ing: the check runs in their browser, against the public ledger, and they
        see for themselves that the bytes match. Nothing to install, no account.
      </p>

      {/* "Your roll, on the site" lived here while /folder existed; the browser
          page was removed 2026-08-07 and the section went with it. Browsing is
          a drop: Recordings onto the home camera. */}
      <h2 className="text-xl font-semibold">More</h2>
      <ul className="bg-more">
        <li><Action href={SOURCE}>Read the source</Action></li>
        <li><Action href="/docs/overview">How BitGraph works</Action></li>
        <li><Action href="/docs/mcp">Connect an AI agent instead</Action></li>
        {/* Shown everywhere. On touch this is the only action on the page,
            since the download slot at the top is hidden there. */}
        <li><Action href="/">Record one file without installing anything</Action></li>
      </ul>

      <style>{`
        /* ── The download, which no longer lives in the hero.
           It sits after the whole first section: the claim, the paragraph that
           earns it, and the tree that proves it. The explanation comes first
           and the offer follows, so nobody is asked to install a thing the
           page has not described yet.

           It is placed AFTER the exhibit rather than between the paragraph and
           the exhibit, because the tree is the evidence for that paragraph and
           an action wedged between them separates a claim from its proof.

           Top margin groups it with the section it closes; the bottom is the
           full 3rem section gap, so the next h2 starts cleanly. Margins
           collapse against that h2's own top margin, and the larger wins. ── */
        .prose-doc .bg-hero-row { margin: 1.75rem 0 3rem; }
        .prose-doc .bg-hero-row p { margin: 0; }
        .prose-doc .bg-hero-row p.bg-dl-line { margin: 0; }

        /* The opening h2 follows the title directly now, so it does not take
           the 3rem that separates one section from the next: that gap is for
           a section that has ENDED, and nothing has ended above this one. */
        .prose-doc h2.bg-first-h2 { margin-top: 1.75rem; }
        /* The lede keeps its exhibit close; the tree is its evidence. */
        .prose-doc p.bg-lede { margin-bottom: 1.25rem; }

        .bg-dl-touch { display: none; }
        @media (hover: none) and (pointer: coarse) {
          .bg-dl-mac { display: none; }
          .bg-dl-touch { display: block; }
        }

        /* ⚠️ Centred, which is a deliberate exception to this page's
           one-left-rail rule and NOT an oversight. That rule is about the
           page's TYPE having a single axis: the h1, the promise, the download
           and every section below still sit on it. Inside a panel the exhibit
           is its own object and symmetric by nature, so the sentence that
           reads it is centred under it. If this ever looks like drift, the fix
           is text-align: left here, not a re-litigation of the page's axis.

           Fluid, because at a flat 16px the caption wraps to three lines once
           the column drops under ~360px, with a two-word orphan on the third.
           Measured at 320px: 16 and 15 both wrap to three, 14 holds two. */
        .prose-doc .bg-panel-caption {
          margin: 0; font-size: clamp(14px, 4.4vw, 16px);
          text-align: center; text-wrap: balance;
        }
        /* The tree's caption sits OUTSIDE its panel, on the page's rail: it is
           a note about the exhibit rather than a reading of it. */
        .prose-doc .bg-panel-caption-under {
          text-align: left; margin: 0;
          font-size: clamp(13px, 4vw, 14px); color: #4b5563;
        }

        /* ── Section rhythm. One rule instead of a margin utility pair per
           heading, which is what the .prose-doc specificity note above is
           about. ── */
        .prose-doc h2 { margin: 3rem 0 0.75rem; }
        .prose-doc h2 + p { margin: 0 0 3.5rem; }
        /* The claim that the tree proves keeps its exhibit close. */
        .prose-doc h2 + p:has(+ .bgt) { margin-bottom: 1.25rem; }

        /* ── More: a list, not four paragraphs pretending to be one. ── */
        .prose-doc .bg-more { list-style: none; margin: 0; padding: 0; }
        .prose-doc .bg-more li { margin: 0 0 0.6rem; }

        @media (max-width: 640px) {
          /* Same rule on the phone: still clear of the 2.5rem between
             sections there, so the hero still closes. */
          .prose-doc .bg-hero-row { margin: 1.5rem 0 2.5rem; }
          .prose-doc h2 { margin-top: 2.5rem; }
          .prose-doc h2 + p { margin-bottom: 3rem; }
        }
      `}</style>
    </article>
  );
}
