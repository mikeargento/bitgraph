// Copyright (c) 2024-2026 Mike Argento. All rights reserved.

/**
 * Archive algebra tests. Run with `npm run test:roll` from website/.
 *
 * Node 24 strips the types itself, so this needs no build step and no test
 * dependency. Everything under test is pure, which is the point of keeping the
 * arithmetic out of the S3 layer: the invariants that matter are checkable
 * without a bucket.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  PAGE_ROWS, pageKey, dayIndexKey, paginate, isSealedDay,
  coverageOf, findPageGaps, mergeRows, endOfRollClaim, type DayIndex, type RollRow,
} from "../roll-archive.ts";

const row = (c: number, t: RollRow["t"] = "p", ep?: string): RollRow => ({ c, t, d: `d${c}`, h: `h${c}`, ...(ep ? { ep } : {}) });
const index = (over: Partial<DayIndex> = {}): DayIndex => ({
  day: "2026-08-05", pages: { f: 3, a: 5 }, rows: { f: 250, a: 500 }, epochs: ["E"], v: 1, ...over,
});

// ── sealing: only the past is archivable ───────────────────────────────────

test("today is never archivable; yesterday always is", () => {
  assert.equal(isSealedDay("2026-08-09", "2026-08-09"), false, "today is still gaining entries");
  assert.equal(isSealedDay("2026-08-08", "2026-08-09"), true);
  assert.equal(isSealedDay("2026-08-10", "2026-08-09"), false, "the future is not history");
});

// ── pagination: count-uniform by construction ──────────────────────────────

test("every page but the last holds exactly PAGE_ROWS", () => {
  const pages = paginate(Array.from({ length: 250 }, (_, i) => row(250 - i)));
  assert.equal(pages.length, 3);
  assert.equal(pages[0].length, PAGE_ROWS);
  assert.equal(pages[1].length, PAGE_ROWS);
  assert.equal(pages[2].length, 50, "only the last page may be short");
});

test("pagination preserves newest-first order across the boundary", () => {
  const pages = paginate(Array.from({ length: 150 }, (_, i) => row(150 - i)));
  assert.equal(pages[0][0].c, 150, "page 0 starts at the newest row");
  assert.equal(pages[0][PAGE_ROWS - 1].c, 51);
  assert.equal(pages[1][0].c, 50, "page 1 continues exactly where page 0 stopped");
});

test("an empty day yields one empty page, not zero pages", () => {
  // Zero pages and "the archive was never built" would be indistinguishable.
  const pages = paginate([]);
  assert.equal(pages.length, 1);
  assert.deepEqual(pages[0], []);
});

test("page keys are deterministic and sort in page order", () => {
  assert.equal(pageKey("2026-08-05", "f", 0), "roll/v1/day/2026-08-05/f/0000.json");
  assert.ok(pageKey("2026-08-05", "f", 2) < pageKey("2026-08-05", "f", 10), "zero-padding keeps lexical order numeric");
  assert.notEqual(pageKey("2026-08-05", "f", 0), pageKey("2026-08-05", "a", 0), "filters do not collide");
  assert.equal(dayIndexKey("2026-08-05"), "roll/v1/day/2026-08-05/index.json");
});

// ── false absence: a short list is never complete ──────────────────────────

test("holding every page with the declared row count is complete", () => {
  const cov = coverageOf([0, 1, 2], index(), "f", 250);
  assert.equal(cov.complete, true);
  assert.equal(cov.behind, false);
});

test("a missing page is behind, never complete", () => {
  const cov = coverageOf([0, 1], index(), "f", 200);
  assert.equal(cov.behind, true);
  assert.equal(cov.complete, false, "two of three pages must not read as the whole day");
  assert.deepEqual(cov.missing, [2]);
});

test("holding every page but SHORT on rows is not complete", () => {
  // The subtle one: all pages fetched, but a page came back truncated. Page
  // count alone would call this complete, so the row total is checked too.
  const cov = coverageOf([0, 1, 2], index(), "f", 249);
  assert.equal(cov.complete, false, "one row short is not the whole day");
});

test("holding nothing is behind, not an empty day", () => {
  const cov = coverageOf([], index(), "f", 0);
  assert.equal(cov.behind, true);
  assert.equal(cov.complete, false, "an unloaded client must never claim an empty ledger");
});

test("a genuinely empty day is complete only when the manifest says it is empty", () => {
  const empty = index({ pages: { f: 1, a: 1 }, rows: { f: 0, a: 0 } });
  assert.equal(coverageOf([0], empty, "f", 0).complete, true, "declared empty and loaded: complete");
  assert.equal(coverageOf([], empty, "f", 0).complete, false, "not loaded: still not a claim we can make");
});

test("the two filters are accounted separately", () => {
  const cov = coverageOf([0, 1, 2], index(), "a", 250);
  assert.equal(cov.complete, false, "3 of the 5 pages the all-entries view declares");
  assert.deepEqual(cov.missing, [3, 4]);
});

// ── page gaps ──────────────────────────────────────────────────────────────

test("contiguous pages report no gap", () => {
  assert.deepEqual(findPageGaps([0, 1, 2], 3), []);
});

test("a hole below the highest held page is reported", () => {
  assert.deepEqual(findPageGaps([0, 2], 3), [1]);
});

test("pages not yet reached are not gaps", () => {
  // Having 0 and 1 of 5 is behind, not holed; only a skipped page is a gap.
  assert.deepEqual(findPageGaps([0, 1], 5), []);
});

// ── rows ───────────────────────────────────────────────────────────────────

test("merge is newest-first and the first write wins on a duplicate", () => {
  const out = mergeRows([{ ...row(10), d: "first" }], [{ ...row(10), d: "retry" }, row(20)]);
  assert.deepEqual(out.map((r) => r.c), [20, 10]);
  assert.equal(out.find((r) => r.c === 10)!.d, "first");
});

test("the same counter in two epochs is two rows, not a duplicate", () => {
  // A day spanning a TEE restart legitimately holds counter 5 twice: counters
  // restart with each epoch, so identity is (epoch, counter).
  const out = mergeRows([row(5, "p", "EPOCH_A")], [row(5, "p", "EPOCH_B")]);
  assert.equal(out.length, 2, "deduping on counter alone would erase a real recording");
});

// ── what the end of the list may say ───────────────────────────────────────
// The rendered half of coverageOf. Only "complete" licenses the word "all", and
// every case that cannot prove completeness has to land somewhere else.

test("a matched declaration is the only way to claim completeness", () => {
  assert.equal(endOfRollClaim(250, 250, false), "complete");
});

test("paging stopped short of the declaration reports the shortfall", () => {
  // The archive declined a page and the derivation ended early. The list is
  // short, and short must be visible rather than plausible.
  assert.equal(endOfRollClaim(200, 250, false), "short");
});

test("one missing row is still short", () => {
  assert.equal(endOfRollClaim(249, 250, false), "short");
});

test("mid-scroll is progress, never an end", () => {
  assert.equal(endOfRollClaim(100, 250, true), "paging");
});

test("holding every declared row while more is promised is still paging", () => {
  // hasMore outranks the count: the server says the walk is unfinished, and a
  // count that happens to line up is not permission to stop believing it.
  assert.equal(endOfRollClaim(250, 250, true), "paging");
});

test("no declaration claims nothing, however the paging ended", () => {
  // The live feed and any day not yet archived. There is no manifest to check
  // against, so completeness is not a statement this client gets to make.
  assert.equal(endOfRollClaim(25, null, false), "undeclared");
  assert.equal(endOfRollClaim(0, null, true), "undeclared");
});
