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
    "The BitGraph specification, rendered. Its SHA-256 is pinned by every tree/1 proof; the bytes are served unchanged at /spec/SPEC-v2.md (version 2, the Base floor) and /spec/SPEC.md (version 1, the Ethereum floor).",
};

/* The spec, rendered (Mike, 2026-10-04: the raw Markdown "is funny lookin" in a text viewer).
   The file itself cannot change: its SHA-256 is signed into every tree/1 proof as
   attribution.message, so this page reads public/spec/SPEC.md at build time, hashes it, and
   shows the hash beside the text. A reader matches the hash to a proof and then reads here
   instead of in a text editor. The raw bytes stay at /spec/SPEC.md, where the drop box, the SDK
   and the hosted MCP fetch them to put beside every export. Markdown rendering only; nothing is
   reworded, reordered or hidden. Version 1 was frozen on 2026-10-04 (spec/FROZEN.json); a
   later specification is a new file beside this one, never an edit of it. */

/* Version 2 (2026-10-06, the Base floor) is rendered; version 1 (the Ethereum floor) is still
   served byte for byte at /spec/SPEC.md for the proofs that pin it. */
const SPEC_PATH = join(process.cwd(), "public", "spec", "SPEC-v2.md");
const V1_PATH = join(process.cwd(), "public", "spec", "SPEC.md");

/* Phones (Mike, 10-05: "fixes for mobile"): a three-column table of sentences squeezed to one word
   per line (the time-claims table ran 1,600px tall). Tables with three or more columns and long text
   outside the last column get class "stack", and every cell gets its column's header as data-label,
   so the CSS can lay each row out as a block with the header above each value. Short tables (byte
   offsets, placement codes) keep their grid. Rendering only: no cell is reworded or reordered. */
type HastNode = { type: string; tagName?: string; value?: string; properties?: Record<string, unknown>; children?: HastNode[] };
const textOf = (n: HastNode): string => n.type === "text" ? n.value ?? "" : (n.children ?? []).map(textOf).join("");
const kids = (n: HastNode, tag: string): HastNode[] => (n.children ?? []).filter((c) => c.type === "element" && c.tagName === tag);
function stackTables() {
  const visit = (n: HastNode) => {
    if (n.type === "element" && n.tagName === "table") {
      const rows = [...kids(n, "thead"), ...kids(n, "tbody")].flatMap((g) => kids(g, "tr"));
      const head = rows[0] ? [...kids(rows[0], "th"), ...kids(rows[0], "td")].map(textOf) : [];
      const body = rows.slice(1);
      const longOutsideLast = body.some((r) => kids(r, "td").slice(0, -1).some((c) => textOf(c).length > 14));
      if (head.length >= 3 && longOutsideLast) {
        n.properties = { ...n.properties, className: ["stack"] };
        for (const r of body) kids(r, "td").forEach((c, i) => { c.properties = { ...c.properties, dataLabel: head[i] ?? "" }; });
      }
    }
    (n.children ?? []).forEach(visit);
  };
  return (tree: HastNode) => visit(tree);
}
const V1_FROZEN_ON = "2026-10-04";

export default function SpecPage() {
  const bytes = readFileSync(SPEC_PATH);
  const sha256B64 = createHash("sha256").update(bytes).digest("base64");
  const v1Hash = createHash("sha256").update(readFileSync(V1_PATH)).digest("base64");
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
          This is the specification, rendered. Every tree/1 proof pins the SHA-256 of the version it follows as its signed <code>attribution.message</code>; a verifier that does not know the hash answers &ldquo;undetermined&rdquo;, never true. The file itself is plain text: <a href="/spec/SPEC-v2.md" download="SPEC-v2.md">download the bytes</a> to check the hash, or fetch <code>/spec/SPEC-v2.md</code>. That copy, or version 1 for a proof that pins it, is what the drop box, the SDK and the hosted MCP put beside every export.
        </p>
        <div className="table-scroll">
          <table className="table-k">
            <tbody>
              <tr><td>Version</td><td>2: the floor is a Base block (enclave v10). A later specification is a new file beside this one, never a change to it.</td></tr>
              <tr><td>SHA-256, base64</td><td><code className="break">{sha256B64}</code></td></tr>
              <tr><td>Size</td><td>{bytes.length.toLocaleString("en-US")} bytes</td></tr>
              <tr><td>Version 1</td><td>The Ethereum floor, frozen {V1_FROZEN_ON}, pinned by every earlier tree/1 proof: <a href="/spec/SPEC.md" download="SPEC.md">SPEC.md</a>, SHA-256 <code className="break">{v1Hash}</code></td></tr>
              <tr><td>Reading it</td><td><Link href="/docs/proof-format">Proof format</Link> explains the fields; <Link href="/docs/verification">Verification</Link> what a verifier checks, in order.</td></tr>
            </tbody>
          </table>
        </div>
        <ReactMarkdown remarkPlugins={[remarkGfm]} rehypePlugins={[stackTables]}>{body}</ReactMarkdown>
      </article>
    </div>
  );
}
