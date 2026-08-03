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

          The touch swap below stays, and is keyed to POINTER, not width. A Mac
          in a narrow window is still a Mac and must keep its download; a phone
          with a wide landscape viewport still cannot install a .pkg. `(hover:
          none) and (pointer: coarse)` asks the question we actually mean, and
          the site already leans on pointer queries for the arrow nudge. A touch
          device that is not a Mac cannot run this either way, so the message is
          right for it. */}
      <style>{`
        .bg-dl-touch { display: none; }
        @media (hover: none) and (pointer: coarse) {
          .bg-dl-mac { display: none; }
          .bg-dl-touch { display: block; }
        }
      `}</style>
      <p className="mb-14 text-lg">
        <span className="bg-dl-mac">
          <Action href={DOWNLOAD}>Download for macOS</Action>
        </span>
        {/* Not a refusal. State the platform, then hand over the thing that
            does work on the device in hand, which is the same one-file flow
            the More list points at from a desktop. */}
        <span className="bg-dl-touch">
          {/* A fragment, like "Notarized by Apple." was, and deliberately not
              the lede's weight: two semibold lines in a row read as two
              competing headlines, the second one contradicting the first. It
              also drops the subject, since the h1 is two lines above it and
              "BitGraph Folder installs on a Mac" says the name three times in
              four lines. The link, not the sentence, is the anchor here. */}
          {/* Dark and semibold, NOT red. Red is spoken for on this site: it is
              `--color-error`, and every use of it means a proof did not verify
              ("These bytes don't match this BitGraph"). Spending the failure
              colour on a platform fact would blunt the one signal that has to
              stay unambiguous. Dark + semibold is this system's loud register
              and needs no new colour.

              Names the form factor AND the platform, because either alone
              misleads. "Mac" by itself leaves an iPhone owner wondering why
              their Apple device does not count; "laptop / desktop only" by
              itself sends a Windows owner to a machine that cannot open a
              .pkg. 229px, so it holds one line down to a 320px phone. */}
          <span className="block text-base font-semibold text-[#111827]">
            Mac laptops and desktops only.
          </span>
          <a href="/" className="bg-arrow-link mt-3 inline-block text-lg font-semibold text-[#0065A4] no-underline">
            Record a file from your phone <span className="arrow" aria-hidden="true">&rarr;</span>
          </a>
        </span>
      </p>

      {/* Three beats, no lesson. Anyone who wants the protocol can follow a
          link at the bottom; this page only has to show how little there is
          to do. */}
      <FolderProcess />
      <p className="text-[#1f2937] mb-14">
        Your file is now BitGraphed, wrapped in a folder containing everything needed to
        verify it.
      </p>

      {/* Three claims, in the order the questions arrive: what the thing is,
          then what it does not send, then who can read the result. */}
      <h2 className="text-xl font-semibold mt-12 mb-4">A folder, not an app</h2>
      <p className="text-[#1f2937] mb-14">
        The installer puts a BitGraph folder on your Desktop and watches it. You never
        open anything.
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
      {/* Hidden on touch: the block above already offers "/" up there, and two
          links to one destination under two different names read as two
          different offers. */}
      <p className="mb-2 bg-dl-mac"><Action href="/">Record one file without installing anything</Action></p>
    </article>
  );
}
