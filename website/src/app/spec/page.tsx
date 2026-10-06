import type { Metadata } from "next";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import Link from "next/link";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

export const metadata: Metadata = {
  title: "Specification",
  description:
    "The BitGraph specification, SPEC.md, rendered. Its SHA-256 is pinned by every tree/1 proof; the bytes are served unchanged at /spec/SPEC.md.",
};

/* The spec, rendered (Mike, 2026-10-04: the raw Markdown "is funny lookin" in a text viewer).
   The file itself cannot change: its SHA-256 is signed into every tree/1 proof as
   attribution.message, so this page reads public/spec/SPEC.md at build time, hashes it, and
   shows the hash beside the text. A reader matches the hash to a proof and then reads here
   instead of in a text editor. The raw bytes stay at /spec/SPEC.md, where the drop box, the SDK
   and the hosted MCP fetch them to put beside every export. Markdown rendering only; nothing is
   reworded, reordered or hidden. Version 1 was frozen on 2026-10-04 (spec/FROZEN.json); a
   later specification is a new file beside this one, never an edit of it. */

const SPEC_PATH = join(process.cwd(), "public", "spec", "SPEC.md");
const FROZEN_ON = "2026-10-04";

export default function SpecPage() {
  const bytes = readFileSync(SPEC_PATH);
  const sha256B64 = createHash("sha256").update(bytes).digest("base64");
  const text = bytes.toString("utf8");
  /* The file's own title leads the page (Mike, 10-05: the page opened on the intro paragraph and
     looked broken). Only where the first line is drawn changes; the Markdown below is the rest of
     the file, in order, and the bytes served at /spec/SPEC.md are untouched. */
  const firstBreak = text.indexOf("\n");
  const hasTitle = text.startsWith("# ") && firstBreak > 0;
  const title = hasTitle ? text.slice(2, firstBreak).trim() : "BitGraph Specification";
  const body = hasTitle ? text.slice(firstBreak + 1) : text;
  return (
    <div className="frame" style={{ padding: "56px 0 96px" }}>
      <article className="prose spec-doc">
        <h1>{title}</h1>
        <p className="lede">
          This is SPEC.md, rendered. Every tree/1 proof pins the SHA-256 of that file as its signed <code>attribution.message</code>; a verifier that does not know the hash answers &ldquo;undetermined&rdquo;, never true. The file itself is plain text: <a href="/spec/SPEC.md" download="SPEC.md">download the bytes</a> to check the hash, or fetch <code>/spec/SPEC.md</code>. That copy is what the drop box, the SDK and the hosted MCP put beside every export.
        </p>
        <div className="table-scroll">
          <table className="table-k">
            <tbody>
              <tr><td>Version</td><td>1, frozen {FROZEN_ON}. A later specification is a new file beside this one, never a change to it.</td></tr>
              <tr><td>SHA-256, base64</td><td><code className="break">{sha256B64}</code></td></tr>
              <tr><td>Size</td><td>{bytes.length.toLocaleString("en-US")} bytes</td></tr>
              <tr><td>Reading it</td><td><Link href="/docs/proof-format">Proof format</Link> explains the fields; <Link href="/docs/verification">Verification</Link> what a verifier checks, in order.</td></tr>
            </tbody>
          </table>
        </div>
        <ReactMarkdown remarkPlugins={[remarkGfm]}>{body}</ReactMarkdown>
      </article>
    </div>
  );
}
