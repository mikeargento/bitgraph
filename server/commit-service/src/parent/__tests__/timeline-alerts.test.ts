/**
 * Timeline alerts: each rule, and when emails go out (on start, hourly while it lasts, once when it clears, at most
 * 30 an hour).
 *
 *   cd server/commit-service && node --import tsx/esm --test src/parent/__tests__/timeline-alerts.test.ts
 */

import { test } from "node:test";
import { strict as assert } from "node:assert";
import { DEFAULT_ALERT_SETTINGS, TimelineAlerter, evaluate, type AlertInputs } from "../timeline-alerts.js";
import type { PollerStatus } from "../timeline-poller.js";
import type { TimelineStatus } from "../timeline.js";

const T = 1_793_404_750_000;
const chain = (c: "base" | "ethereum", over: Partial<PollerStatus> = {}): PollerStatus => ({
  chain: c, last: null, lastReadAtMs: T, lagS: 1, medianLag5mS: 1, outOfRange: 0, outOfRangeStreak: 0, disagreements: 0,
  head: 1, behind: 0, reads: 10, reorgs: 0, lastError: null, ...over,
});
const status = (base: Partial<PollerStatus> = {}, eth: Partial<PollerStatus> = {}, journalError: string | null = null): TimelineStatus => ({
  chains: [chain("base", base), chain("ethereum", eth)], problems: [],
  journal: { batches: 0, objects: 0, rawBytes: 0, gzipBytes: 0, ratio: null, lastUploadAtMs: null, lastError: journalError, uploading: true },
});
const inputs = (t: TimelineStatus, genesisPendingSinceMs: number | null = null): AlertInputs => ({ timeline: t, genesisPendingSinceMs, startedAtMs: T - 60_000 });
const keys = (i: AlertInputs, now = T + 1000, recent = false) => evaluate(i, now, DEFAULT_ALERT_SETTINGS, () => recent).map((c) => c.key).sort();

test("a healthy timeline raises nothing", () => {
  assert.deepEqual(keys(inputs(status())), []);
});

test("reads stopped: 20 s on Base, 60 s on Ethereum", () => {
  assert.deepEqual(keys(inputs(status()), T + 21_000), ["reads-stopped:base"]);
  assert.deepEqual(keys(inputs(status()), T + 61_000), ["reads-stopped:base", "reads-stopped:ethereum"]);
});

test("lag: more than 3 Base reads or 2 Ethereum reads in a row, or a Base 5-minute median above 3 s", () => {
  assert.deepEqual(keys(inputs(status({ outOfRangeStreak: 3 }, { outOfRangeStreak: 2 }))), []);
  assert.deepEqual(keys(inputs(status({ outOfRangeStreak: 4 }, { outOfRangeStreak: 3 }))), ["lag-streak:base", "lag-streak:ethereum"]);
  assert.deepEqual(keys(inputs(status({ medianLag5mS: 3.2 }))), ["lag-median:base"]);
  assert.deepEqual(keys(inputs(status({}, { medianLag5mS: 30 }))), [], "the median rule is Base's only");
});

test("providers disagreeing, S3 failing, genesis stuck, enclave down", () => {
  assert.deepEqual(keys(inputs(status({ disagreements: 1 })), T + 1000, true), ["disagree:base", "disagree:ethereum"]);
  assert.deepEqual(keys(inputs(status({}, {}, "AccessDenied"))), ["upload"]);
  assert.deepEqual(keys(inputs(status(), T - 9 * 60_000)), []);
  assert.deepEqual(keys(inputs(status(), T - 11 * 60_000)), ["genesis-stuck"]);
  const down = "Enclave error: not initialized: the host must call init before the first bind";
  assert.deepEqual(keys(inputs(status({ lastError: down }, { lastError: down }))), ["enclave"], "once, however many chains saw it");
});

test("emails: on start, hourly while it lasts, once when it clears", async () => {
  let now = T;
  let over: Partial<PollerStatus> = { outOfRangeStreak: 5 };
  const sent: string[] = [];
  // Reads keep arriving: the last read is always now.
  const a = new TimelineAlerter(async (subject) => { sent.push(subject); }, () => inputs(status({ ...over, lastReadAtMs: now }, { lastReadAtMs: now })), DEFAULT_ALERT_SETTINGS, () => now);
  await a.check();
  now += 30_000; await a.check();
  assert.deepEqual(sent, ["[BitGraph timeline] ALERT lag-streak:base"]);
  assert.deepEqual(a.activeKeys(), ["lag-streak:base"]);
  now += 60 * 60_000; await a.check();
  assert.equal(sent[1], "[BitGraph timeline] STILL lag-streak:base");
  over = {};
  now += 30_000; await a.check();
  assert.equal(sent[2], "[BitGraph timeline] RESOLVED lag-streak:base");
  assert.deepEqual(a.activeKeys(), []);
});

test("a disagreement stays raised for five minutes after the providers last differed", async () => {
  let now = T;
  let disagreements = 0;
  const sent: string[] = [];
  const a = new TimelineAlerter(async (s) => { sent.push(s); }, () => inputs(status({ disagreements, lastReadAtMs: now }, { lastReadAtMs: now })), DEFAULT_ALERT_SETTINGS, () => now);
  await a.check();
  disagreements = 2;
  now += 30_000; await a.check();
  now += 4 * 60_000; await a.check();
  now += 2 * 60_000; await a.check();
  assert.deepEqual(sent, ["[BitGraph timeline] ALERT disagree:base", "[BitGraph timeline] RESOLVED disagree:base"]);
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
