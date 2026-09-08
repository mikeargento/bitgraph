/* The anchors export: the second, deliberate half of making a BitGraph.
 *
 * Making is instant and needs no network beyond the TEE — the floor is
 * already in the signed body. The upper bound is DEFERRED, never lost: the
 * counter is in the signed body and anchors are permanent, so a proof made
 * today completes in a year, and anyone holding the proof can complete it.
 * This module is that completion. You drop the folder back in and take only
 * the anchors it does not have.
 *
 * Four rules decide whether it is right, and each one is a bug that has
 * already happened somewhere in this product:
 *
 *   1. FOLDER, never a loose file. A fused file's commitment is
 *      SHA256(domain || slotRecordHash || nonce) — one-way, and container/2
 *      carries only original + commitment + origin digest. No epoch, no
 *      counter, nothing to look an anchor up by. The proof carries
 *      commit.epochId and commit.counter and is the only way in.
 *
 *   2. DEDUP BY POSITION, NEVER BY FILE. A set is ONE position: the 48,000
 *      file folder is three sets, so 48,000 files need three anchor pairs.
 *      Asking per proof would be 48,000 identical requests — precisely the
 *      mistake undone on 2026-09-07, when a set stopped being asked about
 *      once per member.
 *
 *   3. ONLY WHAT IS MISSING. Re-dropping an anchored folder must say nothing
 *      to fetch, not download it all again.
 *
 *   4. AN ABSENCE MUST SAY WHY. See ANCHOR_STATUS_VERSION below: this is the
 *      whole point of the phase.
 */

/* ── Where a position's anchors go on disk ───────────────────────────────────
 *
 * Mirroring the paths that already exist is what lets the download merge into
 * the folder with no instructions, so the layout is not a free choice:
 *
 *   ONE export dir holds the position  ->  that dir's own ethereum-anchors/.
 *     The convention every existing export already uses, and the only one the
 *     site's own check reads, so a folder anchored this way reports "nothing
 *     to fetch" on the next drop instead of fetching forever.
 *
 *   MANY dirs hold it (a set)          ->  ONE copy, position-keyed, at the
 *     top of the drop. Not a preference: a position's four anchor files are
 *     ~18.5 KB, so writing them beside all 48,000 members of one set would be
 *     887 MB of the same four files. Once per position is 18.5 KB. The
 *     arithmetic rules the alternative out before taste gets a say.
 *
 * ⚠️ A set's members are SIBLINGS, with no per-position folder to hold their
 * shared evidence, which is why the many-dir case is keyed by counter rather
 * than dropped in the bare root: a drop of three sets would otherwise write
 * three different positions' anchors over each other at one path.
 */
export const ANCHOR_DIR = "ethereum-anchors";

/** A position's anchor directory, as path segments from the top of the drop.
 *
 *  ⚠️ THE DROPPED FOLDER'S OWN NAME STAYS AT THE FRONT IN BOTH CASES. The
 *  many-dir path is relative to that folder, not to the zip, and returning
 *  `ethereum-anchors/1546` on its own would put a set's anchors BESIDE the
 *  folder they belong to rather than inside it — a download that merges into
 *  nothing. Every dir in a need shares a root, since they all came out of one
 *  drop; a drop of several folders at once keeps each position under whichever
 *  one holds it. */
export function anchorDirFor(need: PositionNeed): string[] {
  if (need.dirs.length === 1) return [...need.dirs[0], ANCHOR_DIR];
  const root = need.dirs[0].slice(0, 1); // [] for a bare proof.json with no folder
  return [...root, ANCHOR_DIR, need.counter];
}

/* ── The honesty file ────────────────────────────────────────────────────────
 *
 * ⚠️ THE ABSENCE OF anchor-after.json USED TO READ AS TWO OPPOSITE THINGS: no
 * upper bound was FETCHED, and no upper bound EXISTS. The export omitted the
 * file when the ledger said "not yet", when it said "never", when it could not
 * be reached, and when the request simply threw — addAnchorsFor swallowed all
 * four in a catch commented "non-critical" — so a package's own evidence could
 * not tell a reader which had happened. Three of the four bugs found on
 * 2026-09-07 were this same family: an absent answer shipping as a complete
 * one.
 *
 * So an absence now travels with its reason and the moment it was asked. A
 * reader can act on it: `pending` completes if you ask again, `closed` and
 * `none` never will, `unavailable` and `undetermined` say the gap is ours and
 * not the ledger's.
 *
 * It is written ONLY when a side is missing. A fully anchored position gets no
 * status file, so the file's presence is itself the signal that something is
 * unfinished, and 2,566 existing recordings do not all sprout one saying
 * "fine".
 */
export const ANCHOR_STATUS_VERSION = "bitgraph-anchor-status/1";
export const ANCHOR_STATUS_FILE = "anchors-status.json";

/** What the ledger said about one side. Mirrors /api/proofs/anchors `bound`,
 *  plus `unavailable` for the answer a client never receives: the read failed
 *  or the request never landed. */
export type BoundState =
  | "anchored"
  | "pending"
  | "closed"
  | "none"
  | "unknown-epoch"
  | "undetermined"
  | "unavailable";

/** True when asking again later can still change the answer. The asymmetry
 *  between the two sides lives here: an upper bound arrives late by design,
 *  a lower bound never arrives at all once it is absent. */
export const isResolvable = (s: BoundState): boolean =>
  s === "pending" || s === "unavailable" || s === "undetermined";

export interface BoundReport {
  state: BoundState;
  note: string;
  /** The Ethereum block, when there is one. */
  block?: number;
  /** False when the anchor came without a block-header witness, so its time
   *  claim cannot be recomputed offline. */
  witness?: boolean;
}

export interface AnchorStatusDoc {
  version: typeof ANCHOR_STATUS_VERSION;
  position: { epochId: string; counter: string };
  askedAt: string;
  /** Only for a package-level bracket, where the two sides were sought for
   *  DIFFERENT counters: the upper follows the package's highest position and
   *  the lower precedes its lowest. Without this the doc names one counter and
   *  a reader takes both reports to be about it — which would make the file
   *  meant to end a misreading the source of a new one. */
  range?: { fromCounter: string; toCounter: string };
  upper: BoundReport;
  lower: BoundReport;
  /** Present only while something is still resolvable, so a reader is told
   *  what to do rather than left to infer it from two state strings. */
  advice?: string;
}

const ADVICE =
  "Drop this folder in at bitgraph.ing again to complete it. Nothing expires: " +
  "the position is in the signed proof and anchors are permanent, so this can " +
  "be finished at any time, by anyone holding the folder.";

export function anchorStatusDoc(
  position: { epochId: string; counter: string },
  upper: BoundReport,
  lower: BoundReport,
  askedAt: Date = new Date(),
  /** The lower side's counter, when it is not the same as `position.counter`
   *  (a package-level bracket over several positions). */
  lowerCounter?: string,
): AnchorStatusDoc {
  const doc: AnchorStatusDoc = {
    version: ANCHOR_STATUS_VERSION,
    position,
    askedAt: askedAt.toISOString(),
    upper,
    lower,
  };
  if (lowerCounter && lowerCounter !== position.counter) {
    doc.range = { fromCounter: lowerCounter, toCounter: position.counter };
  }
  if (isResolvable(upper.state) || isResolvable(lower.state)) doc.advice = ADVICE;
  return doc;
}

/** Whether a position's evidence is complete, so no status file is written. */
export const isSettled = (upper: BoundState, lower: BoundState): boolean =>
  upper === "anchored" && lower === "anchored";

/* ── What the drop is missing ───────────────────────────────────────────── */

/** One export directory in the drop, reduced to what this module needs.
 *
 *  Built from the drop's WALKED FILES rather than from discoverDrop's
 *  ExportCandidate, deliberately: a multi-file export writes ONE batch-level
 *  ethereum-anchors/ at the top of the drop, and discoverDrop only claims
 *  ethereum-anchors/ found INSIDE an export dir, so those files are invisible
 *  to it (measured: a 3-file site export shows 3 exports, 0 of which see
 *  anchors). Reading the walk directly means this converges on every folder
 *  the product has ever produced, and needs no change to the check. */
export interface ExportSite {
  /** Path segments of the export dir, relative to the drop and including the
   *  dropped item's own name at [0]. Empty when a bare proof.json was
   *  dropped with no folder around it. */
  dirPath: string[];
  epochId: string | null;
  counter: string | null;
  hasUpper: boolean;
  hasLower: boolean;
}

export interface PositionNeed {
  epochId: string;
  counter: string;
  /** Every export dir in the drop holding this position, in walk order. One
   *  for an ordinary recording; 48,000 for a set. */
  dirs: string[][];
  needUpper: boolean;
  needLower: boolean;
}

/**
 * The positions in a drop that are short an anchor, each named once.
 *
 * A position is short a side when NO dir holding it carries that side, and
 * nothing already at the drop's top level carries it either. Both halves
 * matter: the first is rule 2 (a set asks once, not 48,000 times), the second
 * is rule 3 (a folder a previous run of this export already anchored says
 * nothing to fetch).
 *
 * ⚠️ Positions with no epoch or no counter are dropped, not guessed at. A
 * proof with neither cannot be looked up by anything: the anchor routes are
 * keyed by counter and epoch, and a digest will not do.
 */
export function positionsNeedingAnchors(
  sites: ExportSite[],
  /** Anchor sides already sitting at the top of the drop, keyed by counter —
   *  what a previous anchors export wrote for a set, and what a multi-file
   *  package export wrote for its batch. */
  rootAnchors: Map<string, { upper: boolean; lower: boolean }> = new Map(),
): PositionNeed[] {
  const byPosition = new Map<string, PositionNeed>();
  for (const s of sites) {
    if (!s.epochId || !s.counter) continue;
    const key = `${s.epochId} ${s.counter}`;
    let need = byPosition.get(key);
    if (!need) {
      const root = rootAnchors.get(s.counter);
      need = {
        epochId: s.epochId,
        counter: s.counter,
        dirs: [],
        // Start from what the top of the drop already holds for this
        // position, then let each dir clear what it holds itself.
        needUpper: !root?.upper,
        needLower: !root?.lower,
      };
      byPosition.set(key, need);
    }
    need.dirs.push(s.dirPath);
    if (s.hasUpper) need.needUpper = false;
    if (s.hasLower) need.needLower = false;
  }
  return [...byPosition.values()].filter((n) => n.needUpper || n.needLower);
}

/* ── Reading the drop's shape ─────────────────────────────────────────────── */

/** Structurally what a WalkedFile is, generic over the file handle so this
 *  module stays free of DOM types and testable with plain objects. */
export interface WalkedLike<F> { file: F; path: string[] }

const ANCHOR_FILE_SIDE: Record<string, "upper" | "lower"> = {
  "anchor-after.json": "upper",
  "anchor-before.json": "lower",
};

/**
 * Where each export dir sits, and which positions the TOP of the drop already
 * carries anchors for.
 *
 * The second half is what makes a set converge. A set's anchors are written
 * once, position-keyed, at `<drop>/ethereum-anchors/<counter>/` — and
 * discoverDrop cannot see anything at the top of a drop, so without reading
 * the walk directly the next drop would ask for them again, forever.
 *
 * ⚠️ A BARE `<drop>/ethereum-anchors/anchor-after.json` IS DELIBERATELY NOT
 * COUNTED. That is what a multi-file package export writes: one bracket for
 * the whole batch, before the lowest counter and after the highest. It is a
 * true bound and a uselessly loose one for every position but the extremes,
 * and Mike's ruling (2026-09-08) is that a position needs its OWN anchors. So
 * a folder anchored only that way asks once more, gets tight per-position
 * anchors, and is settled from then on.
 */
export function readDropShape<F>(walked: WalkedLike<F>[]): {
  dirPathOf: Map<F, string[]>;
  rootAnchors: Map<string, { upper: boolean; lower: boolean }>;
} {
  const dirPathOf = new Map<F, string[]>();
  const rootAnchors = new Map<string, { upper: boolean; lower: boolean }>();
  for (const w of walked) {
    const name = w.path[w.path.length - 1];
    if (name === "proof.json") dirPathOf.set(w.file, w.path.slice(0, -1));

    // Position-keyed anchors at the top of the drop: [root?] + anchors/counter/file.
    // k <= 1 keeps this to the TOP of the drop; an export dir's own
    // ethereum-anchors/ sits deeper and is read from the candidate instead.
    const k = w.path.indexOf(ANCHOR_DIR);
    if (k < 0 || k > 1 || w.path.length !== k + 3) continue;
    const counter = w.path[k + 1];
    if (!/^\d+$/.test(counter)) continue;
    const side = ANCHOR_FILE_SIDE[name];
    if (!side) continue;
    const got = rootAnchors.get(counter) ?? { upper: false, lower: false };
    got[side] = true;
    rootAnchors.set(counter, got);
  }
  return { dirPathOf, rootAnchors };
}

/** Positions in the drop, whether or not they need anything — the count the
 *  card states beside "N need anchors". */
export function positionCount(sites: ExportSite[]): number {
  const seen = new Set<string>();
  for (const s of sites) {
    if (s.epochId && s.counter) seen.add(`${s.epochId} ${s.counter}`);
  }
  return seen.size;
}
