import type { Metadata } from "next";
import { FolderProcess } from "@/components/folder-process";

export const metadata: Metadata = {
  title: "BitGraph Folder",
  description: "A folder on your Desktop that records whatever you put in it. macOS, nothing else to install.",
};

const DOWNLOAD = "https://github.com/mikeargento/bitgraph/releases/latest/download/BitGraphFolder.pkg";
const SOURCE = "https://github.com/mikeargento/bitgraph/tree/main/packages/folder";

/** Actions are blue arrow links, never buttons. `.bg-arrow-link` plus the arrow
 *  in its own span is what gives the trailing → the site's hover nudge. */
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
      <h1 className="text-3xl sm:text-4xl font-semibold tracking-[-0.03em] mb-5">BitGraph Folder</h1>
      {/* One line at every width: 219px at 18px semibold, against a 338px
          column on a 375px phone and 288px on a 320px one. The longer lede it
          replaced needed 415px and had to be broken by hand. "A folder on your
          Desktop" is cut rather than shrunk, since the h1 and the folder in the
          diagram both already say it. */}
      <p className="text-lg font-semibold text-[#1f2937] mb-8" style={{ lineHeight: 1.45 }}>
        Drop a file. Get a BitGraph.
      </p>

      <p className="mb-2 text-lg">
        <Action href={DOWNLOAD}>Download for macOS</Action>
      </p>
      {/* A stamp, not a sentence. "Signed and" went because the signature is
          ours and only the notarization is Apple's. "so it just opens" went
          because it promises a contrast the page cannot supply: naming the
          alternative plants the Gatekeeper doubt the line exists to remove, so
          the credential is better left inert for readers who do not need it.
          "Nothing else to install" is in the README and the release notes. */}
      <p className="text-sm text-[#4b5563] mb-14">
        Notarized by Apple.
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
