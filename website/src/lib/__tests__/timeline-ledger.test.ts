/**
 * The ledger's reads rows: every count between file rows accounted for from the timeline's batch keys alone.
 *
 *   cd website && node --test src/lib/__tests__/timeline-ledger.test.ts
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { interleaveEpoch, parseBatchKey, spanState, type TimelineBatchKey } from "../timeline-ledger-core.ts";

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
