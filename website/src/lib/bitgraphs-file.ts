/* The file a make ends in.
 *
 * ⚠️ THIS IS NOT THE PACKAGE, AND THE DIFFERENCE IS THE WHOLE POINT.
 *
 * "Export BitGraph package" builds a zip carrying the original bytes, the new
 * fused file, the proofs and the anchors — everything a stranger needs who has
 * none of it. That is a SHARING artifact and it is the right shape for
 * sharing.
 *
 * It is the wrong shape for the thing a make leaves behind on your own
 * machine, for one reason that settles it: it contains your files. Auto-saving
 * a 48,000 photo drop that way would rebuild the entire folder in memory and
 * hand you back gigabytes you already have. (I built exactly that first. It
 * works fine on one small file and would hang the tab on a real drop.)
 *
 * What you actually need kept is the part you cannot reconstruct: the signed
 * proofs. Everything else is already on your disk. And a set is ONE position
 * sharing ONE proof whose committed digest IS the manifest of every member, so
 * the 48,000 file folder is three proofs — about 23 KB. Nothing to zip, and
 * the download is instant at any drop size.
 *
 * Nothing lists the files, deliberately. The site is a BINDER: it reunites a
 * proof with its file by CONTENT, by re-hashing what you drop, so a name or a
 * path in here would be a second source of truth that goes stale the moment
 * anyone renames anything. See findMatchInDrop and dropDigestsFor.
 */

import type { BitGraphProof } from "./bitgraph";

export const BITGRAPHS_VERSION = "bitgraph-bitgraphs/1";

/** The folder these accumulate in. Mike's call, 2026-09-08: the product's own
 *  plural, and the word the UI already uses ("BitGraphs in this folder"), so
 *  nothing needs explaining. NOT a dot-folder — hidden folders defeat backing
 *  up and syncing, which is the entire durability story. */
export const BITGRAPHS_DIR = "BitGraphs";

export interface BitGraphsFile {
  version: typeof BITGRAPHS_VERSION;
  savedAt: string;
  /** What was dropped, for a human reading the file alone in Downloads weeks
   *  later. Never used to match anything — matching is by content. */
  source: string | null;
  /** One entry per POSITION, not per file. A set of 48,000 files is one. */
  proofs: BitGraphProof[];
}

const positionOf = (p: BitGraphProof) =>
  `${p.commit?.epochId ?? ""} ${p.commit?.counter ?? ""}`;

/**
 * Every distinct position in these rows, each proof carried once.
 *
 * ⚠️ DEDUPED BY POSITION. The same mistake as asking the ledger 48,000 times
 * for one set: every member of a set holds the same proof object, and writing
 * it per member turns 23 KB into 365 MB of the same bytes repeated.
 */
export function buildBitGraphsFile(
  rows: Array<{ proof: BitGraphProof | null; proofs: BitGraphProof[] }>,
  source: string | null,
  savedAt: Date = new Date(),
): BitGraphsFile {
  const seen = new Map<string, BitGraphProof>();
  for (const r of rows) {
    for (const p of (r.proofs.length ? r.proofs : r.proof ? [r.proof] : [])) {
      const key = positionOf(p);
      if (!seen.has(key)) seen.set(key, p);
    }
  }
  return {
    version: BITGRAPHS_VERSION,
    savedAt: savedAt.toISOString(),
    source,
    proofs: [...seen.values()],
  };
}

/**
 * What the download is called.
 *
 * ⚠️ THE NAME CARRIES THE FOLDER, and the redundancy with the BitGraphs
 * directory it will live in is deliberate: the name has to survive the moment
 * it is most ambiguous, which is sitting alone in Downloads for weeks before
 * anyone moves it anywhere.
 *
 * A drop of loose files has no folder name to borrow, which is the weakest
 * point in the scheme and is still open. The fallback leans on the browser's
 * own de-duplication rather than inventing a name that claims more than it
 * knows.
 */
export function bitgraphsFileName(source: string | null): string {
  const safe = (source ?? "").replace(/[\x00-\x1f\x7f/\\:*?"<>|]/g, " ").trim();
  return safe ? `${safe}-bitgraphs.json` : "bitgraphs.json";
}

/** Read a BitGraphs file back, or null if this is not one. Tolerant on
 *  purpose: a file that half-parses is a file someone still holds evidence in,
 *  so anything with a usable proof list is accepted. */
export function readBitGraphsFile(text: string): BitGraphsFile | null {
  try {
    const d = JSON.parse(text) as Partial<BitGraphsFile>;
    if (!d || typeof d !== "object" || !Array.isArray(d.proofs)) return null;
    return {
      version: BITGRAPHS_VERSION,
      savedAt: typeof d.savedAt === "string" ? d.savedAt : "",
      source: typeof d.source === "string" ? d.source : null,
      proofs: d.proofs.filter((p): p is BitGraphProof => !!p && typeof p === "object"),
    };
  } catch {
    return null;
  }
}
