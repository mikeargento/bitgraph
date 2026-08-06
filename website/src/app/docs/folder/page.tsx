import type { Metadata } from "next";
import { FolderProcess } from "@/components/folder-process";

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

export default function FolderPage() {
  return (
    <article className="prose-doc">
      {/* One left rail, every element, every width. Centring the hero on
          phones was tried on 2026-08-03 and reverted: the page has exactly one
          axis and the diagram was moved onto it rather than the type off it.
          Do not re-pitch a centred hero. */}
      <h1 className="text-3xl sm:text-4xl font-semibold tracking-[-0.03em] mb-5">BitGraph Folder</h1>
      {/* One line at every width: 219px at 18px semibold, against a 338px
          column on a 375px phone and 288px on a 320px one. The longer lede it
          replaced needed 415px and had to be broken by hand. "A folder on your
          Desktop" is cut rather than shrunk, since the h1 and the folder in the
          diagram both already say it. */}
      <p className="text-lg font-semibold text-[#1f2937] mb-8" style={{ lineHeight: 1.45 }}>
        Drop a file. Get a BitGraph.
      </p>

      {/* A filled button was tried here on 2026-08-03 and taken back out: the
          site's actions are arrow links, and the slab read as someone else's
          site. Do not re-pitch it. The download is the same `Label →` as
          everything else, marked as primary by position and size, not weight.

          On touch the download is replaced by the reason it is missing, and by
          nothing else. The sentence stays because a phone visitor otherwise
          never learns this is Mac software; its companion link was removed
          because the More list at the foot of the page already carries the one
          thing a phone can do, and two actions competing is worse than one.

          Keyed to POINTER, not width: a Mac in a narrow window is still a Mac
          and must keep its download, and a phone in wide landscape still cannot
          install a .pkg. `(hover: none) and (pointer: coarse)` asks the question
          we actually mean, and the site already leans on pointer queries for the
          arrow nudge.

          The sentence names the form factor AND the platform, because either
          alone misleads: "Mac" by itself leaves an iPhone owner wondering why
          their Apple device does not count, and "laptop / desktop only" by
          itself sends a Windows owner to a machine that cannot open a .pkg.
          Plain weight, body colour, and NEVER red: red is `--color-error` here
          and every use of it means a proof did not verify, so the failure
          colour must not be spent on a platform fact. */}
      <style>{`
        .bg-dl-touch { display: none; }
        /* The space above is sized for whatever is actually there. On a Mac
           that is a 26px action and it wants room; on touch it is one small
           sentence, and the same gap left it stranded in the middle of
           nowhere. Specificity beats .prose-doc p, which is why this is a
           rule rather than an inline style or an mt-* utility. */
        .prose-doc p.bg-dl-line { margin-top: 52px; margin-bottom: 8px; }
        @media (hover: none) and (pointer: coarse) {
          .bg-dl-mac { display: none; }
          .bg-dl-touch { display: block; }
          .prose-doc p.bg-dl-line { margin-top: 22px; margin-bottom: 0; }
        }
      `}</style>
      {/* The margin is inline, not `mt-*`. `.prose-doc p` in globals.css sets
          margin-bottom: 1.25rem and is NOT inside @layer base, so it beats
          every Tailwind margin utility on this page: the whole top of the page
          was locked to a flat 20px rhythm and the download read as the third
          line of a paragraph rather than the page's one action. Same bug family
          as the `.prose-doc a` layering fixed in `eaeab8a0`. Fixing the rule
          properly would reflow all thirteen docs pages, so this is surgical. */}
      {/* ⚠️ Size is what makes this the primary action, since a filled button
          is out (see above). It was text-lg, the SAME size as the subtitle a
          line above it, so it had no rank at all: brand blue on a page whose
          other actions are also brand blue links, at body size. It now sits
          between the h1 and the subtitle in the type scale, which is where
          the page's one job belongs, and the air around it does the rest.

          ⚠️ 22px, not 26px, and the difference is not size but COLOUR. This
          is saturated blue and semibold against an h1 that is near-black, and
          a saturated 26px out-weighed a near-black 32px: the eye reached the
          action before the title, which inverts what the page is for. At 22
          it still clears the 18px subtitle by a full step and reads second,
          which is the job. Do not push it back up without accounting for the
          fact that blue is already spending weight that black is not. */}
      <p className="text-lg bg-dl-line">
        <span className="bg-dl-mac" style={{ fontSize: "clamp(19px, 4.2vw, 22px)", letterSpacing: "-0.015em" }}>
          <Action href={DOWNLOAD}>Download for macOS</Action>
        </span>
        <span className="bg-dl-touch text-base text-[#1f2937]">
          Mac laptops and desktops only.
        </span>
      </p>

      {/* Three beats, no lesson. Anyone who wants the protocol can follow a
          link at the bottom; this page only has to show how little there is
          to do. */}
      <FolderProcess />
      {/* "its own folder", because the word is doing two jobs within a few
          inches: the diagram's middle panel is THE FOLDER you installed, and
          this is the export it writes for each recording. Without the
          possessive a reader can take them for the same object, which makes
          the diagram's "=" look like it points at the same thing twice. */}
      <p className="text-[#1f2937] mb-14">
        Your file is now BitGraphed, wrapped in its own folder containing everything needed to
        verify it.
      </p>

      {/* Three claims, in the order the questions arrive: what the thing is,
          then what it does not send, then who can read the result. */}
      <h2 className="text-xl font-semibold mt-12 mb-4">A folder, not an app</h2>
      {/* The batch line lives here rather than in the lede. Pluralising the
          lede would have contradicted the diagram below it, which states the
          singular equation, but the page never said anywhere that the folder
          takes more than one file at a time. That is the whole advantage over
          the one-file flow on the home page, and a 500-file drop is tested. */}
      <p className="text-[#1f2937] mb-14">
        The installer puts a BitGraph folder on your Desktop and watches it. You never
        open anything. Drop files in one at a time or in batches.
      </p>

      <h2 className="text-xl font-semibold mt-12 mb-4">Nothing leaves your Mac</h2>
      <p className="text-[#1f2937] mb-14">
        Your file is hashed where it sits. Only the hash is sent.
      </p>

      <h2 className="text-xl font-semibold mt-12 mb-4">Your file is the key</h2>
      <p className="text-[#1f2937] mb-14">
        You can only retrieve a proof if you already have the file. If the file remains
        private, the proof remains private.
      </p>

      <h2 className="text-xl font-semibold mt-12 mb-4">More</h2>
      <p className="mb-2"><Action href={SOURCE}>Read the source</Action></p>
      <p className="mb-2"><Action href="/docs/overview">How BitGraph works</Action></p>
      <p className="mb-2"><Action href="/docs/mcp">Connect an AI agent instead</Action></p>
      {/* Shown everywhere. On touch this is the only action on the page, since
          the download slot at the top is hidden there. */}
      <p className="mb-2"><Action href="/">Record one file without installing anything</Action></p>
    </article>
  );
}
