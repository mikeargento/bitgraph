import type { Metadata } from "next";
import { FolderProcess } from "@/components/folder-process";
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
      leaves the machine, and what you can hand to someone else. Two exhibits
      carry it — the equation and the tree — and the prose between them is
      four claims, each an h2 that states it and two sentences that earn it.

   ⚠️ CSS RULE FOR THIS WHOLE FILE: every selector below is written as
      `.prose-doc <sel>`. `.prose-doc`'s p rules in globals.css are NOT inside
      @layer base, so they beat every Tailwind margin utility on this page.
      Anything set loosely, or with a Tailwind margin class, silently loses. Fixing
      that properly would reflow all thirteen docs pages, so this page works
      around it instead. ── */
export default function FolderPage() {
  return (
    <article className="prose-doc">
      {/* One left rail for the page's TYPE, every element, every width.
          Centring the hero on phones was tried on 2026-08-03 and reverted:
          the page has one axis and the diagram was moved onto it rather than
          the type off it. The exhibits centre their own contents INSIDE their
          panels, which is a different thing and is not a re-pitch of this. */}
      <h1 className="mb-5">BitGraph Folder</h1>

      {/* ── Promise and action share a line: two halves of one sentence,
          "here is what it does" and "here it is". Stacked, they spent two of
          the hero's beats saying that plus a 52px gap between them.

          ⚠️ The promise deliberately does NOT restate the equation below it.
          "Drop a file. Get a BitGraph." was the old line and it said exactly
          what the diagram says three inches lower, in words — and it would
          have read the same on the home page, which is the tell that it was
          not about the Folder. What the diagram cannot show is that there is
          nothing to open, ever, which is the entire reason to install a
          folder rather than visit a site. ── */}
      <div className="bg-hero-row">
        <p className="bg-hero-promise text-lg font-semibold text-[#1f2937]" style={{ lineHeight: 1.45 }}>
          Drop files in. Never open anything.
        </p>
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

            ⚠️ 22px, not 26px, and the difference is not size but COLOUR. This
            is saturated blue and semibold against an h1 that is near-black, and
            a saturated 26px out-weighed a near-black 32px: the eye reached the
            action before the title, which inverts what the page is for. */}
        <p className="text-lg bg-dl-line">
          <span className="bg-dl-mac" style={{ fontSize: "clamp(19px, 4.2vw, 22px)", letterSpacing: "-0.015em" }}>
            <Action href={DOWNLOAD}>Download for macOS</Action>
          </span>
          <span className="bg-dl-touch text-base text-[#1f2937]">
            Mac laptops and desktops only.
          </span>
        </p>
      </div>

      {/* ── Exhibit one: the equation. The caption used to sit outside the old
          card, orphaned from the thing it describes. ── */}
      <section className="bg-panel bg-panel-lead">
        <FolderProcess />
        {/* "its own folder" is load-bearing: the diagram's middle panel is THE
            FOLDER you installed, and this is the export written for each
            recording. Without the possessive a reader takes them for one
            object, which makes the "=" look like it points at the same thing
            twice. Two lines on a phone, which is why "wrapped in … containing"
            became "in … with": two verbs doing one job cost a third line. */}
        <p className="bg-panel-caption text-[#1f2937]">
          Your file is now BitGraphed, in its own folder with everything needed to verify it.
        </p>
      </section>

      {/* Four claims, in the order the questions arrive: what the thing is and
          where my file went, what it does not send, what that means for me,
          and what a recording is finally for. */}
      <h2 className="text-xl font-semibold">A folder, not an app</h2>
      {/* "settles into Recordings" is load-bearing: drops MOVE (1.8.0, drops
          absorb, the export holds the only copy). The batch line lives here
          rather than in the promise, because pluralising the promise would
          contradict the diagram's singular equation — and taking more than one
          file at a time is the whole advantage over the home page's flow. A
          500-file drop is tested. */}
      <p className="text-[#1f2937]">
        The installer puts a BitGraph folder on your Desktop and watches it. Drop files in
        one at a time or in batches; each one settles into Recordings, in a folder named
        after it, next to its BitGraph.
      </p>

      {/* ── Exhibit two: the receipt. Placed under the claim it proves rather
          than in a section of its own, so the tree reads as the evidence for
          "a folder, not an app" instead of as a second topic. ── */}
      <FolderTree />
      <p className="bg-panel-caption bg-panel-caption-under text-[#1f2937]">
        The top level stays empty. It is the drop zone; Recordings is the archive.
      </p>

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
        /* ── The hero row ── */
        .prose-doc .bg-hero-row {
          display: flex; flex-wrap: wrap; align-items: baseline;
          justify-content: space-between; gap: 4px 28px;
          margin: 0 0 2.25rem;
        }
        .prose-doc .bg-hero-row p { margin: 0; }
        /* The download keeps its size rank but not the 52px of air it used to
           need: inside the row, adjacency does that work. */
        .prose-doc .bg-hero-row p.bg-dl-line { margin: 0; }
        .bg-dl-touch { display: none; }
        @media (hover: none) and (pointer: coarse) {
          .bg-dl-mac { display: none; }
          .bg-dl-touch { display: block; }
        }

        /* ── Exhibit panels ──
           Vertically SYMMETRIC padding, deliberately: a panel hugs its
           content, so equal padding is what centres the exhibit inside it.
           Any uneven pad, or a stray margin on a child, shows up directly as
           the block sitting off the middle. */
        .prose-doc .bg-panel {
          background: #fff; border: 1px solid #d0d5dd; border-radius: 0;
          padding: 28px; margin: 0 0 1rem;
        }
        .prose-doc .bg-panel-lead { margin-bottom: 3.5rem; }
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
          text-align: left; margin: 0 0 3.5rem;
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
          .prose-doc .bg-hero-row { gap: 10px 20px; margin-bottom: 1.75rem; }
          .prose-doc .bg-panel { padding: 22px 14px; }
          .prose-doc .bg-panel-lead { margin-bottom: 3rem; }
          .prose-doc .bg-panel-caption-under { margin-bottom: 3rem; }
          .prose-doc h2 { margin-top: 2.5rem; }
          .prose-doc h2 + p { margin-bottom: 3rem; }
        }
      `}</style>
    </article>
  );
}
