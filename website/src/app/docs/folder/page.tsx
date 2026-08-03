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
      {/* Two beats on two lines. Shrinking this to fit one line put it at
          ~10.7px on a 320px phone; breaking it at the sentence keeps it at full
          size and reads as a deliberate pair rather than an accidental wrap. */}
      <p className="text-lg text-[#1f2937] mb-8" style={{ lineHeight: 1.45 }}>
        A folder on your Desktop.
        <br />
        Drop a file, get a BitGraph.
      </p>

      <p className="mb-2 text-lg">
        <Action href={DOWNLOAD}>Download for macOS</Action>
      </p>
      <p className="text-sm text-[#4b5563] mb-14">
        Signed and notarized by Apple, so it just opens. Nothing else to install.
      </p>

      {/* Three beats, no lesson. Anyone who wants the protocol can follow a
          link at the bottom; this page only has to show how little there is
          to do. */}
      <FolderProcess />
      <p className="text-[#1f2937] mb-14">
        That is the entire interaction. Your file is now BitGraphed, wrapped in a folder with
        everything that proves it.
      </p>

      <h2 className="text-xl font-semibold mt-12 mb-4">Nothing leaves your Mac</h2>
      <p className="text-[#1f2937] mb-14">
        The file is hashed where it sits, and only that hash is sent.
      </p>

      <h2 className="text-xl font-semibold mt-12 mb-4">Your file is the key</h2>
      <p className="text-[#1f2937] mb-14">
        To retrieve a proof you must already have the file. If the file stays private the
        proof stays private.
      </p>

      <h2 className="text-xl font-semibold mt-12 mb-4">More</h2>
      <p className="mb-2"><Action href={SOURCE}>Read the source</Action></p>
      <p className="mb-2"><Action href="/docs/overview">How BitGraph works</Action></p>
      <p className="mb-2"><Action href="/docs/mcp">Connect an AI agent instead</Action></p>
      <p className="mb-2"><Action href="/">Record one file without installing anything</Action></p>
    </article>
  );
}
