/* Reading the words out of a .docx, in the browser, with no new dependency.
 *
 * A .docx is a zip. The prose lives in word/document.xml as WordprocessingML,
 * and fflate is already here (it builds the export zips), so pulling it out
 * costs nothing at the bundle level and never touches the network.
 *
 * ⚠️ WHAT THIS IS, AND WHAT IT MUST NEVER BE PRESENTED AS.
 *
 * This returns the document's TEXT. It is not the document. There are no
 * fonts, no layout, no page breaks, no images, no table geometry; a heading
 * and a caption come out as the same plain line. On a page whose entire claim
 * is "these exact bytes", showing an approximation as though it were the
 * artifact would be a small lie, which is why the caller labels it and why
 * this file will not grow into a renderer. The precedent is PDF: it gets no
 * inline embed because a broken-looking preview undercuts a trust page. The
 * difference here is that a browser cannot show a .docx faithfully at all, so
 * the honest options were "name and size only" or "the words, said to be the
 * words". This is the second.
 *
 * The digest beside it on the page is what actually identifies the bytes.
 * This only has to answer "is this the file I meant".
 */

import { unzipSync } from "fflate";

/** Above this, the unzip is not worth blocking the main thread for. A .docx
 *  of ordinary prose is a few hundred KB; anything far past that is carrying
 *  images, and their bytes are not what we came for. */
const MAX_BYTES = 40 * 1024 * 1024;

const ENTITIES: Record<string, string> = {
  "&amp;": "&", "&lt;": "<", "&gt;": ">", "&quot;": '"', "&apos;": "'",
};

/**
 * The words in a .docx, as plain text, or null when this is not a readable
 * one. Never throws: every failure is a null, because the caller's fallback
 * (name and size) is a perfectly good answer and a preview is not worth an
 * error boundary.
 */
export function docxText(data: ArrayBuffer): string | null {
  if (data.byteLength > MAX_BYTES) return null;
  const bytes = new Uint8Array(data);
  // Zip magic. A file merely NAMED .docx that is not a zip stops here rather
  // than making fflate throw.
  if (bytes.length < 4 || bytes[0] !== 0x50 || bytes[1] !== 0x4b) return null;

  let xml: string;
  try {
    // The filter matters: without it fflate inflates every embedded image to
    // find one XML file, which on a picture-heavy document is most of the
    // work for none of the result.
    const files = unzipSync(bytes, { filter: (f) => f.name === "word/document.xml" });
    const doc = files["word/document.xml"];
    if (!doc || !doc.length) return null;
    xml = new TextDecoder("utf-8", { fatal: false }).decode(doc);
  } catch {
    return null;
  }

  // Structure first, while the tags are still here to say where it is:
  // paragraphs and explicit breaks become newlines, tabs become tabs. Then
  // every remaining tag goes. Done in the other order, the whole document
  // would collapse into one run-on line.
  const text = xml
    .replace(/<w:tab\b[^>]*\/?>/g, "\t")
    .replace(/<w:br\b[^>]*\/?>/g, "\n")
    .replace(/<\/w:p>/g, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&(amp|lt|gt|quot|apos);/g, (m) => ENTITIES[m] ?? m)
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    // Word writes a lot of empty paragraphs; more than one blank line in a row
    // is spacing, not content, and it would spend the excerpt's line budget.
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();

  return text || null;
}

/** True for the names this module can do anything with. Extension only: the
 *  zip check above is what actually decides, and it runs on the bytes. */
export const isDocx = (name: string) => /\.docx$/i.test(name);
