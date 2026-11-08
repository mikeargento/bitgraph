/**
 * The outside check of the enclave host: what counts as down, and when an email goes out.
 *
 *   cd website && node --test src/lib/__tests__/timeline-watch.test.ts
 */

import { test } from "node:test";
import { strict as assert } from "node:assert";
import { decideWatch, judgeHealth, INITIAL_WATCH_STATE } from "../timeline-watch.ts";

const T = 1_793_404_750_000;
const healthy = { status: 200, body: { ok: true, epochId: "e", timeline: { problems: [], journal: { uploading: true } }, alerts: [] } };

test("down: no answer, an error status, not ok, or no timeline; problems are reported but not down", () => {
  assert.deepEqual(judgeHealth(healthy, T), { down: false, reason: "up" });
  assert.match(judgeHealth(new Error("fetch failed"), T).reason, /did not answer \/health: fetch failed/);
  assert.match(judgeHealth({ status: 502, body: null }, T).reason, /HTTP 502/);
  assert.match(judgeHealth({ status: 200, body: { ok: false } }, T).reason, /not ok/);
  assert.match(judgeHealth({ status: 200, body: { ok: true } }, T).reason, /not running/);
  const degraded = { status: 200, body: { ok: true, timeline: { problems: ["journal: no LEDGER_BUCKET, so batches stay on disk"], journal: {} } } };
  assert.deepEqual(judgeHealth(degraded, T), { down: false, reason: "up, running without: journal: no LEDGER_BUCKET, so batches stay on disk" });
});

test("one email when it goes down, one an hour while it stays down, one when it is back", () => {
  const down = { down: true, reason: "x" };
  const a = decideWatch(INITIAL_WATCH_STATE, down, T);
  assert.equal(a.email?.subject, "[BitGraph timeline] OUTSIDE CHECK: down");
  const b = decideWatch(a.next, down, T + 5 * 60_000);
  assert.equal(b.email, null);
  assert.equal(b.next, a.next, "nothing to write while nothing changes");
  const c = decideWatch(b.next, down, T + 61 * 60_000);
  assert.equal(c.email?.subject, "[BitGraph timeline] OUTSIDE CHECK: still down");
  const d = decideWatch(c.next, { down: false, reason: "ok" }, T + 70 * 60_000);
  assert.equal(d.email?.subject, "[BitGraph timeline] OUTSIDE CHECK: back");
  assert.match(d.email!.body, /back after 70 min/);
  assert.deepEqual(d.next, INITIAL_WATCH_STATE);
  assert.equal(decideWatch(INITIAL_WATCH_STATE, { down: false, reason: "ok" }, T).email, null);
});
