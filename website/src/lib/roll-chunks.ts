// Copyright (c) 2024-2026 Mike Argento. All rights reserved.

/**
 * The Roll's chunk algebra. Pure: no S3, no fetch, no clock.
 *
 * Everything here is arithmetic on counter ranges, which is what lets the
 * invariants be tested without touching the ledger. The I/O lives in
 * `roll-index.ts` and the rendering in the Explorer; both defer to this for
 * what a chunk is called, whether it is sealed, and whether a set of chunks
 * actually covers what it claims to.
 *
 * WHY COUNTERS AND NOT TIME
 *
 * The Roll is append-only and counters are dense and monotonic within an epoch
 * (measured: exactly 2.00 counters per stored object, a slot and its commit).
 * So immutability is not a property of the epoch boundary, it is a property of
 * a counter range being complete: every range below the head is frozen the
 * moment the head passes its ceiling, even if it was written seconds ago. Only
 * the last partial range is ever live. Chunking by wall-clock time would give
 * up that guarantee for nothing, since a time range can still gain entries.
 *
 * WIDTH
 *
 * 2048 counters, chosen from the measured ledger rather than picked: at ~2.00
 * counters per object that is ~1024 rows per chunk, ~17 chunks per day, and
 * roughly 40KB gzipped. The tempting 1024 was rejected because files arrive in
 * bursts: a quiet stretch of 1024 counters can hold no recordings at all (the
 * baseline caught a 4000-counter stretch with none), and a client filtering for
 * the files view would then have to walk several chunks to fill one screen,
 * which is the multi-round-trip problem this replaces.
 *
 * Changing the width changes every chunk name, so it is versioned in the key
 * prefix (see CHUNK_PREFIX). Old chunks stay valid at their old width; they are
 * simply no longer named.
 */

/** Counters per chunk. See the note above before changing this. */
export const CHUNK_WIDTH = 2048;

/** Bumped only when the on-disk shape changes, so old objects are orphaned
 *  rather than misread. Sealed chunks are immutable and cannot be rewritten. */
export const CHUNK_PREFIX = "roll/v1";

/** One row of the Roll, as stored. Deliberately the display record and nothing
 *  else: the Roll is not a trust surface, and a proof verifies offline against
 *  the hardware signature and the anchors, never against this. */
export type RollRow = {
  /** Commit counter. Unique within an epoch, and the sort key. */
  c: number;
  /** proof | anchor | interval. One index serves both feeds; the files view
   *  filters on this rather than fetching a second index. */
  t: "p" | "a" | "i";
  /** URL-safe artifact digest. */
  d: string;
  /** First 10 chars of the URL-safe proof hash. */
  h: string;
  /** Ethereum block, anchors and intervals only. */
  b?: number;
  /** Write time, epoch ms. */
  at?: number;
};

export type Chunk = {
  epoch: string;
  /** Inclusive counter floor. */
  from: number;
  /** Inclusive counter ceiling. A chunk covers exactly [from, to]. */
  to: number;
  rows: RollRow[];
};

/** The chunk index a counter belongs to. Chunk 0 is [1, WIDTH]. */
export function chunkIndexOf(counter: number, width = CHUNK_WIDTH): number {
  return Math.floor((counter - 1) / width);
}

/** Exact inclusive range of chunk `i`. Ranges tile the counter line with no
 *  gaps and no overlap, which is what `assertContiguous` later relies on. */
export function chunkRange(i: number, width = CHUNK_WIDTH): { from: number; to: number } {
  return { from: i * width + 1, to: (i + 1) * width };
}

/** Deterministic name. The client derives this from the head and the width and
 *  fetches it directly, so no manifest is needed for the live epoch and the
 *  read path never LISTs the bucket. */
export function chunkKey(epoch: string, i: number, width = CHUNK_WIDTH): string {
  const { from, to } = chunkRange(i, width);
  const pad = (n: number) => String(n).padStart(12, "0");
  return `${CHUNK_PREFIX}/${epoch}/c/${pad(from)}-${pad(to)}.json`;
}

/**
 * Sealed means complete, and complete means the head has moved past the
 * ceiling. Not `>=`: a head sitting exactly on the ceiling is the counter that
 * was just written, and the next one may still land inside this range.
 *
 * This is the whole immutability argument. A sealed chunk can be served
 * `immutable` for a year because no future commit can fall inside it: counters
 * only go up.
 */
export function isSealed(i: number, head: number, width = CHUNK_WIDTH): boolean {
  return head > chunkRange(i, width).to;
}

/** The chunk the head currently sits in: the one partial chunk, the only one
 *  that can still change. */
export function tailChunkIndex(head: number, width = CHUNK_WIDTH): number {
  return chunkIndexOf(Math.max(head, 1), width);
}

/** Chunk indices covering [from, to], newest first, which is the Roll's order. */
export function chunksCovering(from: number, to: number, width = CHUNK_WIDTH): number[] {
  const first = chunkIndexOf(Math.max(from, 1), width);
  const last = chunkIndexOf(Math.max(to, 1), width);
  const out: number[] = [];
  for (let i = last; i >= first; i--) out.push(i);
  return out;
}

export type Gap = { after: number; before: number };

/**
 * Contiguity check. Chunk boundaries are exact counter ranges, so chunk k must
 * end exactly where chunk k+1 begins. Anything else is a hole in the ledger's
 * account of itself, and the caller surfaces it rather than rendering through
 * it: a Roll that quietly closes a gap is indistinguishable from a Roll that
 * never had those entries, which is the failure mode that matters most here.
 *
 * Takes ranges rather than chunk indices so it also catches a chunk whose
 * stored `from`/`to` disagree with the name it was fetched under.
 */
export function findGaps(ranges: Array<{ from: number; to: number }>): Gap[] {
  const sorted = [...ranges].sort((a, b) => a.from - b.from);
  const gaps: Gap[] = [];
  for (let i = 1; i < sorted.length; i++) {
    const prev = sorted[i - 1];
    const cur = sorted[i];
    if (cur.from !== prev.to + 1) gaps.push({ after: prev.to, before: cur.from });
  }
  return gaps;
}

export type Coverage = {
  /** Highest counter the client can account for. */
  loadedThrough: number;
  /** Lowest counter the client can account for. */
  loadedFrom: number;
  /** The head says this exists; anything above loadedThrough is not yet held. */
  head: number;
  /** True when the client is missing rows the head says exist. */
  behind: boolean;
  /** How many counters are unaccounted for above what is loaded. */
  behindBy: number;
  gaps: Gap[];
  /** Safe to present as a complete account of [loadedFrom, head]. */
  complete: boolean;
};

/**
 * What the client is allowed to claim.
 *
 * FALSE ABSENCE IS THE FAILURE MODE THAT MATTERS. If the head reports counter N
 * and the client holds only through N-13, the UI must say it is behind. It must
 * never render a short list as though it were the whole story, because a Roll
 * that under-reports looks exactly like a ledger that never recorded the thing
 * you are looking for.
 *
 * So `complete` is deliberately conservative: it requires the loaded range to
 * reach the head AND to have no internal gaps. Every uncertain case resolves to
 * "incomplete", never to "complete".
 */
export function coverageOf(
  ranges: Array<{ from: number; to: number }>,
  head: number,
): Coverage {
  if (ranges.length === 0) {
    return { loadedThrough: 0, loadedFrom: 0, head, behind: head > 0, behindBy: head, gaps: [], complete: false };
  }
  const loadedThrough = Math.max(...ranges.map((r) => r.to));
  const loadedFrom = Math.min(...ranges.map((r) => r.from));
  const gaps = findGaps(ranges);
  // The tail chunk is partial by definition: it is named for its full range but
  // only holds rows up to the head. Reaching the head is what counts, so a tail
  // whose ceiling is above the head is not "behind".
  const behindBy = Math.max(0, head - loadedThrough);
  const behind = behindBy > 0;
  return { loadedThrough, loadedFrom, head, behind, behindBy, gaps, complete: !behind && gaps.length === 0 };
}

/**
 * Rows a chunk is allowed to contain, given the range it claims. A row outside
 * the range means the chunk was built wrong, and it is dropped rather than
 * shown: a sealed chunk is immutable, so a bad one has to be rebuilt from the
 * ledger, not patched at read time.
 */
export function rowsInRange(chunk: Chunk): RollRow[] {
  return chunk.rows.filter((r) => r.c >= chunk.from && r.c <= chunk.to);
}

/** Newest-first, deduped by counter. Counters are unique within an epoch, so a
 *  duplicate means the same commit reached the index twice (a retry); the
 *  first write wins and the second is dropped. */
export function mergeRows(...lists: RollRow[][]): RollRow[] {
  const byCounter = new Map<number, RollRow>();
  for (const list of lists) for (const r of list) if (!byCounter.has(r.c)) byCounter.set(r.c, r);
  return [...byCounter.values()].sort((a, b) => b.c - a.c);
}
