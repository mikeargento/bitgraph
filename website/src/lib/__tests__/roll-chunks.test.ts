// Copyright (c) 2024-2026 Mike Argento. All rights reserved.

/**
 * Chunk algebra tests. Run with the repo's runner:
 *
 *   npm run test:roll     (from website/)
 *
 * Node 24 strips the types itself, so this needs no build step and no test
 * dependency. Everything under test is pure, which is the point of keeping the
 * arithmetic out of the S3 layer: the invariants that matter are checkable
 * without a bucket.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  CHUNK_WIDTH, chunkIndexOf, chunkRange, chunkKey, isSealed, tailChunkIndex,
  chunksCovering, findGaps, coverageOf, rowsInRange, mergeRows, type Chunk,
} from "../roll-chunks.ts";

// ── ranges tile the counter line ───────────────────────────────────────────

test("chunk ranges tile the counter line with no gaps or overlap", () => {
  let prev = chunkRange(0);
  assert.equal(prev.from, 1, "counters start at 1, so chunk 0 must start at 1");
  for (let i = 1; i < 200; i++) {
    const r = chunkRange(i);
    assert.equal(r.from, prev.to + 1, `chunk ${i} must start where ${i - 1} ended`);
    assert.equal(r.to - r.from + 1, CHUNK_WIDTH, "every chunk is exactly one width");
    prev = r;
  }
});

test("every counter maps into the chunk that claims it", () => {
  for (const c of [1, 2, CHUNK_WIDTH - 1, CHUNK_WIDTH, CHUNK_WIDTH + 1, 33824, 999_999]) {
    const r = chunkRange(chunkIndexOf(c));
    assert.ok(c >= r.from && c <= r.to, `counter ${c} fell outside its own chunk`);
  }
});

test("chunk keys are deterministic and sort lexicographically by counter", () => {
  const a = chunkKey("EPOCH", 0);
  const b = chunkKey("EPOCH", 1);
  assert.equal(a, chunkKey("EPOCH", 0), "same input must give the same name");
  assert.ok(a < b, "zero-padding must make lexicographic order counter order");
  assert.match(a, /roll\/v1\/EPOCH\/c\/000000000001-000000002048\.json/);
});

// ── sealed-chunk immutability ──────────────────────────────────────────────

test("a chunk seals only once the head is PAST its ceiling", () => {
  const { to } = chunkRange(3);
  assert.equal(isSealed(3, to - 1), false, "head inside the range: still live");
  assert.equal(isSealed(3, to), false,
    "head exactly on the ceiling is the counter just written; the next may still land inside");
  assert.equal(isSealed(3, to + 1), true, "head past the ceiling: frozen");
});

test("sealing is monotonic: a sealed chunk never unseals as the head grows", () => {
  const i = 5;
  const { to } = chunkRange(i);
  let everSealed = false;
  for (let head = 1; head < to + 500; head += 7) {
    const sealed = isSealed(i, head);
    if (sealed) everSealed = true;
    assert.ok(!(everSealed && !sealed), `chunk ${i} unsealed at head ${head}`);
  }
});

test("only the tail chunk is ever live", () => {
  const head = 33824;
  const tail = tailChunkIndex(head);
  for (let i = 0; i < tail; i++) assert.ok(isSealed(i, head), `chunk ${i} below the tail must be sealed`);
  assert.equal(isSealed(tail, head), false, "the tail chunk is the one partial chunk");
});

// ── gap detection ──────────────────────────────────────────────────────────

test("contiguous ranges report no gaps", () => {
  assert.deepEqual(findGaps([{ from: 1, to: 2048 }, { from: 2049, to: 4096 }]), []);
});

test("a missing chunk is reported, not silently closed", () => {
  const gaps = findGaps([{ from: 1, to: 2048 }, { from: 4097, to: 6144 }]);
  assert.deepEqual(gaps, [{ after: 2048, before: 4097 }]);
});

test("an off-by-one boundary is a gap", () => {
  // The failure this guards against is a chunk built with an exclusive ceiling.
  assert.deepEqual(findGaps([{ from: 1, to: 2047 }, { from: 2049, to: 4096 }]), [{ after: 2047, before: 2049 }]);
});

test("gaps are found regardless of the order chunks arrive in", () => {
  const out = findGaps([{ from: 4097, to: 6144 }, { from: 1, to: 2048 }]);
  assert.deepEqual(out, [{ after: 2048, before: 4097 }]);
});

// ── behind the head ────────────────────────────────────────────────────────

test("a short list is never reported complete", () => {
  // The named case: head says N, client holds through N-13.
  const head = 33824;
  const cov = coverageOf([{ from: 1, to: head - 13 }], head);
  assert.equal(cov.behind, true);
  assert.equal(cov.behindBy, 13);
  assert.equal(cov.complete, false, "13 rows short must not read as the whole roll");
});

test("holding nothing while the head is non-zero is behind, not empty", () => {
  const cov = coverageOf([], 33824);
  assert.equal(cov.behind, true);
  assert.equal(cov.complete, false, "an empty client must never claim an empty ledger");
  assert.equal(cov.behindBy, 33824);
});

test("reaching the head with no gaps is complete", () => {
  const cov = coverageOf([{ from: 1, to: 2048 }, { from: 2049, to: 4096 }], 4096);
  assert.equal(cov.behind, false);
  assert.equal(cov.complete, true);
});

test("reaching the head with an internal gap is NOT complete", () => {
  const cov = coverageOf([{ from: 1, to: 2048 }, { from: 4097, to: 6144 }], 6144);
  assert.equal(cov.behind, false, "the top is loaded");
  assert.equal(cov.complete, false, "but a hole in the middle still forbids claiming completeness");
  assert.equal(cov.gaps.length, 1);
});

test("loading past the head is not behind (the tail chunk overshoots by design)", () => {
  // A tail chunk is named for its full range but holds rows only up to the head.
  const cov = coverageOf([{ from: 1, to: 34816 }], 33824);
  assert.equal(cov.behind, false);
  assert.equal(cov.behindBy, 0);
});

// ── rows ───────────────────────────────────────────────────────────────────

test("rows outside a chunk's claimed range are dropped, not shown", () => {
  const chunk: Chunk = {
    epoch: "E", from: 2049, to: 4096,
    rows: [{ c: 2048, t: "p", d: "d", h: "h" }, { c: 3000, t: "p", d: "d", h: "h" }, { c: 4097, t: "a", d: "d", h: "h" }],
  };
  assert.deepEqual(rowsInRange(chunk).map((r) => r.c), [3000]);
});

test("merge is newest-first and drops a duplicate counter", () => {
  const a = [{ c: 10, t: "p" as const, d: "first", h: "h" }];
  const b = [{ c: 10, t: "p" as const, d: "retry", h: "h" }, { c: 20, t: "a" as const, d: "x", h: "h" }];
  const out = mergeRows(a, b);
  assert.deepEqual(out.map((r) => r.c), [20, 10], "newest first");
  assert.equal(out.find((r) => r.c === 10)!.d, "first", "first write wins over a retry");
});

test("chunksCovering returns newest-first and includes both ends", () => {
  assert.deepEqual(chunksCovering(1, CHUNK_WIDTH * 3), [2, 1, 0]);
  assert.deepEqual(chunksCovering(CHUNK_WIDTH + 1, CHUNK_WIDTH + 2), [1]);
});
