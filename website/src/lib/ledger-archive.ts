// Copyright (c) 2024-2026 Mike Argento. All rights reserved.

/**
 * The ledger archive's algebra. Pure: no S3, no fetch, no clock.
 *
 * A sealed UTC day is written history. It cannot gain, lose or reorder a single
 * entry, so it is materialised ONCE into display pages and served immutable
 * from then on. Only the live epoch is live, and the live epoch reads the
 * ledger directly (see day-index.ts) — it gets no archive, which is what keeps
 * the one place drift is possible free of a second source of truth.
 *
 * WHY PAGES AND NOT COUNTER RANGES
 *
 * This started as fixed-width counter chunks and that was the wrong partition.
 * Counters are dense, but the ROWS a reader wants are not: files arrive in
 * bursts, and the baseline caught a 4000-counter stretch containing none. A
 * 2048-counter chunk built from live measurement held 1024 rows and zero files,
 * so the default view would have walked several 119KB chunks to fill one
 * screen — the multi-round-trip problem it was meant to remove.
 *
 * A page holds PAGE_ROWS rows because it IS a page. Count-uniformity is not
 * arranged, it is definitional, and it holds for whichever filter built it.
 *
 * FILTERS
 *
 * Two streams per day, because the ledger has two views and neither should pay
 * for the other: "f" is recordings only (the default) and "a" is everything,
 * anchors and interval recurrences included. Duplication is the point — a page
 * is ~9KB, and the alternative is the reader filtering a mixed page and finding
 * it short, which is the burstiness problem again one level up.
 */

/** Rows per archived page. 100 rather than the UI's 25: the client renders 25
 *  at a time but scrolls faster than it fetches, and four screens per request
 *  is the ratio that stops the scroll ever waiting. At ~90 bytes a row that is
 *  ~9KB, small enough that over-fetching three screens costs nothing. */
export const PAGE_ROWS = 100;

/** Bumped only when the on-disk shape changes, so old objects are orphaned
 *  rather than misread. Archived pages are immutable and never rewritten.
 *
 *  ⚠️ The word "roll" survives here alone, and deliberately. This is an S3 key
 *  prefix, not vocabulary: every archived day already written lives under it.
 *  The Roll was renamed to the Ledger everywhere a person can see it on
 *  2026-09-03; renaming this string would orphan the archive instead. */
export const ARCHIVE_PREFIX = "roll/v1/day";

export type LedgerFilter = "f" | "a";

/** One row of the ledger, as stored. The display record and nothing else: the
 *  Ledger is not a trust surface, and a proof verifies offline against the
 *  hardware signature and the anchors, never against this. */
export type LedgerRow = {
  /** Commit counter. Unique within an epoch, and the sort key. */
  c: number;
  /** proof | anchor | interval. */
  t: "p" | "a" | "i";
  /** URL-safe artifact digest. */
  d: string;
  /** First 10 chars of the URL-safe proof hash. */
  h: string;
  /** Ethereum block, anchors and intervals only. */
  b?: number;
  /** Write time, epoch ms. */
  at?: number;
  /** URL-safe epochId. A day can span epochs (a mid-day restart), and counters
   *  restart with each, so row identity needs it. */
  ep?: string;
};

/** The per-day manifest. Fetched once, then every page is addressable by name.
 *
 *  `pages` is what makes a short list detectably short: without a declared
 *  total, a client that has loaded 3 pages cannot tell "that is the whole day"
 *  from "the fourth request failed", and those two must never look alike. */
export type DayIndex = {
  day: string;
  /** Page counts per filter. */
  pages: { f: number; a: number };
  /** Row totals per filter, for the same reason. */
  rows: { f: number; a: number };
  /** Epoch ids the day covers, in order. Days may span a restart. */
  epochs: string[];
  /** Schema marker, so a reader can refuse an archive it does not understand. */
  v: 1;
};

export type DayPage = {
  day: string;
  filter: LedgerFilter;
  /** Zero-based page number, newest rows first (page 0 is the end of the day). */
  n: number;
  rows: LedgerRow[];
};

const pad4 = (n: number) => String(n).padStart(4, "0");

/** Deterministic name. The client derives it from the manifest's page count and
 *  fetches it directly, so the read path never LISTs the bucket. */
export function pageKey(day: string, filter: LedgerFilter, n: number): string {
  return `${ARCHIVE_PREFIX}/${day}/${filter}/${pad4(n)}.json`;
}

export function dayIndexKey(day: string): string {
  return `${ARCHIVE_PREFIX}/${day}/index.json`;
}

/** Split rows (already newest-first) into fixed pages. The last page is short,
 *  which is the ONLY page allowed to be, and the manifest's count is what says
 *  so rather than the reader inferring it from a short response. */
export function paginate(rows: LedgerRow[], size = PAGE_ROWS): LedgerRow[][] {
  const out: LedgerRow[][] = [];
  for (let i = 0; i < rows.length; i += size) out.push(rows.slice(i, i + size));
  return out.length ? out : [[]];
}

/** A day is archivable only once it is entirely in the past. `today` is the
 *  caller's UTC date string; equality is deliberately excluded, since today is
 *  still gaining entries and is served by the live path. */
export function isSealedDay(day: string, todayUTC: string): boolean {
  return day < todayUTC;
}

export type Coverage = {
  /** Pages the client holds. */
  loaded: number;
  /** Pages the manifest says exist. */
  total: number;
  rowsLoaded: number;
  rowsTotal: number;
  /** Missing pages the manifest declares. */
  missing: number[];
  behind: boolean;
  /** Safe to present as a complete account of the day. */
  complete: boolean;
};

/**
 * What the client is allowed to claim.
 *
 * FALSE ABSENCE IS THE FAILURE MODE THAT MATTERS. A Ledger that under-reports is
 * indistinguishable from a ledger that never recorded the thing you are looking
 * for, and this page's whole job is being the second thing rather than looking
 * like it.
 *
 * So completeness is asserted against the manifest, never inferred from a short
 * response: it requires every declared page to be held AND the row count to
 * match what was declared. Every uncertain case resolves to incomplete.
 */
export function coverageOf(heldPages: number[], index: DayIndex, filter: LedgerFilter, rowsLoaded: number): Coverage {
  const total = index.pages[filter];
  const rowsTotal = index.rows[filter];
  const held = new Set(heldPages);
  const missing: number[] = [];
  for (let n = 0; n < total; n++) if (!held.has(n)) missing.push(n);
  const complete = missing.length === 0 && rowsLoaded === rowsTotal;
  return { loaded: held.size, total, rowsLoaded, rowsTotal, missing, behind: missing.length > 0, complete };
}

/** What the end of a day is allowed to say about itself. */
export type DayClaim =
  /** More pages to fetch. Report progress against the declaration, not an end. */
  | "paging"
  /** Every declared row is on screen. The only state that may say "all". */
  | "complete"
  /** Paging has stopped and the day declares more rows than are held. */
  | "short"
  /** No declaration exists. Nothing may be claimed about completeness. */
  | "undeclared";

/**
 * The render-time half of coverageOf, for a reader that pages strictly in order.
 *
 * coverageOf answers for a client that can hold arbitrary pages and therefore
 * arbitrary holes. The ledger is not that client: it fetches page n+1 only after
 * page n has landed and stops at the first failure, so a hole cannot form and
 * the row count carries the whole answer. This is the same rule reduced to the
 * two numbers that reader actually has.
 *
 * The asymmetry is deliberate. "complete" requires a declaration to match;
 * everything else, including every uncertain case, resolves to a state that
 * claims nothing. A day that under-reports is indistinguishable from a ledger
 * that never recorded the thing you came to look for, so a short list has to be
 * detectably short rather than quietly plausible.
 */
export function endOfDayClaim(shown: number, declared: number | null, hasMore: boolean): DayClaim {
  if (declared == null) return "undeclared";
  if (hasMore) return "paging";
  return shown < declared ? "short" : "complete";
}

/**
 * Contiguity, at the level this archive actually has one: page numbers must run
 * 0..total-1 with nothing skipped. A hole is surfaced rather than rendered
 * through, because closing it silently is the same lie as under-reporting.
 */
export function findPageGaps(heldPages: number[], total: number): number[] {
  const held = new Set(heldPages);
  const gaps: number[] = [];
  const max = heldPages.length ? Math.max(...heldPages) : -1;
  for (let n = 0; n <= Math.min(max, total - 1); n++) if (!held.has(n)) gaps.push(n);
  return gaps;
}

/** Newest-first, deduped by (epoch, counter). Counters restart across epochs,
 *  so a day spanning a restart can legitimately hold the same counter twice. */
export function mergeRows(...lists: LedgerRow[][]): LedgerRow[] {
  const seen = new Map<string, LedgerRow>();
  for (const list of lists) for (const r of list) {
    const k = `${r.ep ?? ""}:${r.c}`;
    if (!seen.has(k)) seen.set(k, r);
  }
  return [...seen.values()].sort((a, b) => b.c - a.c);
}
