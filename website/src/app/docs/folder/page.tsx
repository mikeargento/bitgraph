import type { Metadata } from "next";
import { FolderProcess } from "@/components/folder-process";

export const metadata: Metadata = {
  title: "BitGraph Folder",
  description: "A folder on your Desktop that records whatever you put in it. macOS, nothing else to install.",
};

const DOWNLOAD = "https://github.com/mikeargento/bitgraph/releases/latest/download/BitGraphFolder.pkg";
const SOURCE = "https://github.com/mikeargento/bitgraph/tree/main/packages/folder";

/** Actions are blue arrow links. The download below is the site's one exception
 *  and the only button on it. `.bg-arrow-link` plus the arrow in its own span is
 *  what gives the trailing → the site's hover nudge, filled or not. */
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
      {/* Centred on phones, left rail from `sm` up. The breakpoint is the
          diagram's own: it stacks below 640px and centres itself, so title,
          lede, button and diagram all sit on one axis there instead of the
          text hugging the left and the picture jumping to the middle. The rail
          comes back at the first h2, where the page stops selling and starts
          being read. */}
      <h1 className="text-3xl sm:text-4xl font-semibold tracking-[-0.03em] mb-5 text-center sm:text-left">BitGraph Folder</h1>
      {/* One line at every width: 219px at 18px semibold, against a 338px
          column on a 375px phone and 288px on a 320px one. The longer lede it
          replaced needed 415px and had to be broken by hand. "A folder on your
          Desktop" is cut rather than shrunk, since the h1 and the folder in the
          diagram both already say it. */}
      <p className="text-lg font-semibold text-[#1f2937] mb-8 text-center sm:text-left" style={{ lineHeight: 1.45 }}>
        Drop a file. Get a BitGraph.
      </p>

      {/* THE button. The site has none anywhere else: every action is a
          `Label →` arrow link, so a filled slab spends its whole effect in one
          place, and this is the only place the site asks you to take something
          rather than read something. Square corners and brand blue like the
          rest of the system, and it keeps the arrow and its hover nudge so it
          still reads as the same family of action, only louder. If a second
          button ever appears, this one stops working. */}
      <p className="mb-14 text-center sm:text-left">
        <a
          href={DOWNLOAD}
          className="bg-arrow-link inline-block rounded-none bg-[#0065A4] font-semibold text-white no-underline transition-colors hover:bg-[#005089]"
          style={{ padding: "15px 28px", fontSize: 16, letterSpacing: "-0.01em" }}
        >
          Download for macOS <span className="arrow" aria-hidden="true">&rarr;</span>
        </a>
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
      <p className="mb-2"><Action href="/">Record one file without installing anything</Action></p>
    </article>
  );
}
