/**
 * Timeline alerts: the upload rule, and when emails go out (on start, hourly while it lasts, once when it clears, at
 * most 30 an hour).
 *
 *   cd server/commit-service && node --import tsx/esm --test src/parent/__tests__/timeline-alerts.test.ts
 */

import { test } from "node:test";
import { strict as assert } from "node:assert";
import { DEFAULT_ALERT_SETTINGS, TimelineAlerter, evaluate, type AlertInputs } from "../timeline-alerts.js";
import type { TimelineStatus } from "../timeline.js";

const T = 1_793_404_750_000;
const status = (journalError: string | null = null, uploading = true): TimelineStatus => ({
  problems: [],
  journal: { batches: 0, objects: 0, rawBytes: 0, gzipBytes: 0, ratio: null, lastUploadAtMs: null, lastError: journalError, uploading },
});
const inputs = (t: TimelineStatus): AlertInputs => ({ timeline: t });
const keys = (i: AlertInputs) => evaluate(i).map((c) => c.key).sort();

test("a healthy timeline raises nothing", () => {
  assert.deepEqual(keys(inputs(status())), []);
});

test("a failed S3 upload raises upload, only while the journal uploads", () => {
  assert.deepEqual(keys(inputs(status("AccessDenied"))), ["upload"]);
  assert.deepEqual(keys(inputs(status("AccessDenied", false))), []);
});

test("emails: on start, hourly while it lasts, once when it clears", async () => {
  let now = T;
  let error: string | null = "AccessDenied";
  const sent: string[] = [];
  const a = new TimelineAlerter(async (subject) => { sent.push(subject); }, () => inputs(status(error)), DEFAULT_ALERT_SETTINGS, () => now);
  await a.check();
  now += 30_000; await a.check();
  assert.deepEqual(sent, ["[BitGraph timeline] ALERT upload"]);
  assert.deepEqual(a.activeKeys(), ["upload"]);
  now += 60 * 60_000; await a.check();
  assert.equal(sent[1], "[BitGraph timeline] STILL upload");
  error = null;
  now += 30_000; await a.check();
  assert.equal(sent[2], "[BitGraph timeline] RESOLVED upload");
  assert.deepEqual(a.activeKeys(), []);
});

test("at most 30 emails an hour, and a failed send is logged, not thrown", async () => {
  let now = T;
  let n = 0;
  const logs: string[] = [];
  const a = new TimelineAlerter(async () => { n++; if (n === 2) throw new Error("SNS down"); }, () => inputs(status()), DEFAULT_ALERT_SETTINGS, () => now, (m) => logs.push(m));
  for (let i = 0; i < 40; i++) await a.notice("new epoch", "x");
  assert.equal(n, 30);
  assert.ok(logs.some((l) => l.includes("could not be sent (SNS down)")));
  assert.ok(logs.some((l) => l.includes("hourly cap")));
  now += 3_600_001;
  await a.notice("new epoch", "x");
  assert.equal(n, 31);
});
