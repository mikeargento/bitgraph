/**
 * The ledger's reads rows: every count between file rows accounted for from the timeline's batch keys alone.
 *
 *   cd website && node --test src/lib/__tests__/timeline-ledger.test.ts
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { interleaveDay, interleaveEpoch, liveBatch, parseBatchKey, spanState, type TimelineBatchKey } from "../timeline-ledger-core.ts";

const E = "KKOixUTETu9LB6jJxX-k-jvLaUZNUSoITPjHfzubqCo";
const P = `timeline/${E}/`;
const pad = (n: number) => String(n).padStart(12, "0");
const batch = (first: number, last: number, records = (last - first) / 2 + 1): TimelineBatchKey => ({ key: `${P}${pad(first)}-${pad(last)}-${records}.jsonl.gz`, first, last, records });
const row = (counter: number) => ({ counter: String(counter), key: `proofs/${E}/${pad(counter)}-x.json` });

test("batch keys parse, and others do not", () => {
  assert.deepEqual(parseBatchKey(P, `${P}000000000004-000000000010-4.jsonl.gz`), { key: `${P}000000000004-000000000010-4.jsonl.gz`, first: 4, last: 10, records: 4 });
  assert.equal(parseBatchKey(P, `${P}000000000004-000000000010.jsonl.gz`), null);
  assert.equal(parseBatchKey(P, `timeline/other/000000000004-000000000010-4.jsonl.gz`), null);
});

test("a span is recorded, uploading, missing or unlisted", () => {
  const bs = [batch(2, 40), batch(42, 80)];
  assert.equal(spanState(10, 60, bs), "recorded");
  assert.equal(spanState(70, 90, bs), "uploading", "past the newest uploaded count");
  assert.equal(spanState(10, 60, [batch(2, 20), batch(30, 80)]), "missing", "counts 22..28 are in no batch");
  assert.equal(spanState(10, 30, [batch(2, 40, 18)]), "missing", "a batch with fewer records than its span lost one");
  assert.equal(spanState(10, 30, []), "unlisted");
});

test("file rows with a reads row in every gap, newest first", () => {
  const items = interleaveEpoch(E, [row(40), row(20), row(14)], [batch(2, 30), batch(32, 50)], { above: "uploaded", below: 0 });
  assert.deepEqual(items.map((x) => ("kind" in x ? `reads ${x.from}-${x.to} (${x.count}, ${x.state})` : `file ${x.counter}`)), [
    "reads 42-50 (5, recorded)",
    "file 40",
    "reads 22-38 (9, recorded)",
    "file 20",
    "reads 16-18 (2, recorded)",
    "file 14",
    "reads 2-12 (6, recorded)",
  ]);
  const covered = items.reduce((n, x) => n + ("kind" in x ? x.count : 1), 0);
  assert.equal(covered, 25, "every record from count 2 to 50 is one row or inside one");
});

test("adjacent file rows leave no gap; pages and the live poll bound the ends", () => {
  assert.deepEqual(interleaveEpoch(E, [row(8), row(6)], [batch(2, 8)], { above: null, below: null }).map((x) => x.key), [row(8).key, row(6).key]);
  const older = interleaveEpoch(E, [row(20)], [batch(2, 40)], { above: 30, below: null });
  assert.deepEqual(older.map((x) => ("kind" in x ? `${x.from}-${x.to}` : x.counter)), ["22-28", "20"], "up to just below the row the newer page shows");
  const poll = interleaveEpoch(E, [], [batch(2, 40)], { above: "uploaded", below: 30 });
  assert.deepEqual(poll.map((x) => ("kind" in x ? `${x.from}-${x.to}` : x.counter)), ["32-40"], "no new file: the reads since the last one");
});

test("a day with two epochs: an epoch with reads but no file row still shows, in its place", () => {
  const A = "A".repeat(43), B = "B".repeat(43), C = "C".repeat(43);
  const rowIn = (e: string, counter: number) => ({ counter: String(counter), key: `proofs/${e}/${pad(counter)}-x.json` });
  const at = (e: string) => (b: TimelineBatchKey) => ({ ...b, key: b.key.replace(E, e) });
  const batches = { [A]: [batch(2, 20)].map(at(A)), [B]: [batch(2, 30)].map(at(B)), [C]: [batch(2, 8)].map(at(C)) };
  const epochOf = (k: string) => k.split("/")[1]!;
  // Newest first: C (a file at 6), B (reads only), A (a file at 10).
  const items = interleaveDay([rowIn(C, 6), rowIn(A, 10)], [C, B, A], batches, { above: "uploaded", below: 0 }, {}, epochOf);
  assert.deepEqual(items.map((x) => ("kind" in x ? `${x.epoch[0]} reads ${x.from}-${x.to}` : `${x.key.split("/")[1]![0]} file ${x.counter}`)), [
    "C reads 8-8", "C file 6", "C reads 2-4",
    "B reads 2-30",
    "A reads 12-20", "A file 10", "A reads 2-8",
  ]);
  // The live poll: below the row the page has in its epoch, whole in a newer one.
  const poll = interleaveDay([], [C, A], batches, { above: "uploaded", below: 0 }, { [A]: 10 }, epochOf);
  assert.deepEqual(poll.map((x) => ("kind" in x ? `${x.epoch[0]} ${x.from}-${x.to}` : "")), ["C 2-8", "A 12-20"]);
});

test("live records: the newest run counts them as they are made; a hole just below them is uploading, not missing", () => {
  const uploaded = [batch(2, 40)];
  const live = liveBatch(E, [42, 44, 46, 48])!;
  assert.deepEqual([live.first, live.last, live.records, live.live], [42, 48, 4, true]);
  const items = interleaveEpoch(E, [row(30)], [...uploaded, live], { above: "uploaded", below: 0 });
  const top = items[0]!;
  assert.ok("kind" in top);
  assert.deepEqual([top.from, top.to, top.state], [32, 48, "recorded"]);
  // A batch uploaded between the listing and the live fetch: counts 42..44 in neither.
  const hole = interleaveEpoch(E, [row(30)], [...uploaded, liveBatch(E, [46, 48])!], { above: "uploaded", below: 0 })[0]!;
  assert.ok("kind" in hole);
  assert.equal(hole.state, "uploading");
  assert.equal(liveBatch(E, []), null);
  assert.equal(hole.key, `reads:${E}:32`, "the newest run keeps its key while it grows");
});

test("a hole in the host's live records is uploading, never missing: a count can be bound a moment before it is written", () => {
  const live = liveBatch(E, [42, 46, 48])!;
  assert.equal(spanState(32, 48, [batch(2, 40), live]), "uploading");
  assert.equal(spanState(32, 48, [batch(2, 40, 19), live]), "missing", "an uploaded batch short of its span is still missing");
});
