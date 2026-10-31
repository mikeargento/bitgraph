/**
 * The daily Base audit's judgment: one to one, in order, no gaps, reorgs re-read, labels true.
 *
 *   cd server/commit-service && node --import tsx/esm --test src/audit/__tests__/base-day.test.ts
 */

import { test } from "node:test";
import { strict as assert } from "node:assert";
import { auditBaseDay, baseBlocksOfDay, type AuditRead, type CanonicalBlock } from "../base-day.js";
import { canonicalBlocks, type PostJson } from "../canonical-fetch.js";

const DAY = "2026-11-01";
const { first, last } = baseBlocksOfDay(DAY);
const GENESIS = 1686789347;
const hashOf = (n: number, tag = "main") => "0x" + Buffer.from(`${tag}-${n}`).toString("hex").padEnd(64, "0").slice(0, 64);
const canonical = new Map<number, CanonicalBlock>();
for (let n = first; n <= last; n++) canonical.set(n, { number: n, hash: hashOf(n), timestamp: GENESIS + 2 * n });

/** One epoch reading every block of the day, in order. */
function allReads(epochId = "E1"): AuditRead[] {
  const out: AuditRead[] = [];
  for (let n = first, c = 2; n <= last; n++, c += 2) out.push({ epochId, counter: c, number: n, hash: hashOf(n), timestamp: GENESIS + 2 * n });
  return out;
}

test("a UTC day of Base is 43,200 blocks, stamped within the day", () => {
  assert.equal(last - first + 1, 43_200);
  assert.ok(GENESIS + 2 * first >= Date.parse(`${DAY}T00:00:00Z`) / 1000);
  assert.ok(GENESIS + 2 * (first - 1) < Date.parse(`${DAY}T00:00:00Z`) / 1000);
  assert.ok(GENESIS + 2 * last < Date.parse("2026-11-02T00:00:00Z") / 1000);
});

test("every block read once, in order: PASS", () => {
  const r = auditBaseDay({ day: DAY, reads: allReads(), canonical });
  assert.equal(r.ok, true);
  assert.equal(r.reads, 43_200);
});

test("a gap is found and reported as a range", () => {
  const reads = allReads().filter((x) => x.number < first + 100 || x.number > first + 104);
  const r = auditBaseDay({ day: DAY, reads, canonical });
  assert.equal(r.ok, false);
  assert.deepEqual(r.missing, [{ from: first + 100, to: first + 104 }]);
  assert.equal(r.outOfOrder.length, 1, "the epoch skipped ahead there");
});

test("a reorg re-read is allowed; an orphan never re-read is not", () => {
  const reads = allReads();
  // Block first+10 was first read on a side branch, then the poller walked back and re-read it.
  const orphan: AuditRead = { ...reads[10]!, hash: hashOf(first + 10, "side") };
  const withReorg = [...reads.slice(0, 10), orphan, ...reads.slice(10).map((x) => ({ ...x, counter: x.counter + 2 }))];
  const ok = auditBaseDay({ day: DAY, reads: withReorg, canonical });
  assert.equal(ok.ok, true, JSON.stringify(ok.outOfOrder.slice(0, 3)));
  assert.equal(ok.orphansReplaced, 1);
  const lost = reads.map((x, i) => (i === 10 ? orphan : x));
  const bad = auditBaseDay({ day: DAY, reads: lost, canonical });
  assert.equal(bad.ok, false);
  assert.equal(bad.orphansUnreplaced.length, 1);
  assert.deepEqual(bad.missing, [{ from: first + 10, to: first + 10 }]);
});

test("a repeat after a restart is reported, not failed; a lying block file fails", () => {
  const reads = allReads();
  const repeated = [...reads.slice(0, 51), { ...reads[50]!, counter: reads[50]!.counter + 2 }, ...reads.slice(51).map((x) => ({ ...x, counter: x.counter + 2 }))];
  const r = auditBaseDay({ day: DAY, reads: repeated, canonical });
  assert.equal(r.ok, true);
  assert.equal(r.repeats, 1);
  const lying = reads.map((x, i) => (i === 7 ? { ...x, timestamp: x.timestamp - 600 } : x));
  assert.equal(auditBaseDay({ day: DAY, reads: lying, canonical }).mislabelled.length, 1);
});

test("two epochs in a day (a restart) audit together", () => {
  const reads = allReads();
  const half = 20_000;
  const split = [...reads.slice(0, half), ...reads.slice(half).map((x, i) => ({ ...x, epochId: "E2", counter: 2 + 2 * i }))];
  assert.equal(auditBaseDay({ day: DAY, reads: split, canonical }).ok, true);
});

test("blocks the chain did not answer for are unchecked, and fail the day", () => {
  const partial = new Map(canonical);
  partial.delete(first + 3);
  const r = auditBaseDay({ day: DAY, reads: allReads(), canonical: partial });
  assert.equal(r.unchecked, 1);
  assert.equal(r.ok, false);
});

test("canonical fetch: batches from every node, kept only where they agree, retried on rate limits", async () => {
  let calls = 0;
  const node = (tag: string, limitFirst = false): PostJson => async (_url, body) => {
    calls++;
    if (limitFirst && calls === 1) return { status: 429, json: null };
    const reqs = body as Array<{ id: number; params: [string] }>;
    return { status: 200, json: reqs.map((q) => { const n = parseInt(q.params[0], 16); return { id: q.id, result: { number: q.params[0], hash: n === first + 5 && tag === "b" ? "0x" + "ff".repeat(32) : hashOf(n), timestamp: "0x" + (GENESIS + 2 * n).toString(16) } }; }) };
  };
  const post: PostJson = (url, body) => (url.includes("a.example") ? node("a", true) : node("b"))(url, body);
  const { blocks, disagreements } = await canonicalBlocks({ urls: ["https://a.example", "https://b.example"], first, last: first + 119, post, batch: 50 });
  assert.equal(blocks.size, 119);
  assert.deepEqual(disagreements, [first + 5]);
});
