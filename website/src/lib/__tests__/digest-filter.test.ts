import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash, randomBytes } from "node:crypto";
import { DigestFilter, bloomParamsFor } from "../digest-filter.ts";

const digest = (s: string) => createHash("sha256").update(s).digest("base64url");

test("what the filter rejects is certainly absent: no false negatives, ever", () => {
  const added = Array.from({ length: 20000 }, (_, i) => digest(`in-${i}`));
  const f = new DigestFilter(bloomParamsFor(added.length, 0.001));
  for (const d of added) f.add(d);
  for (const d of added) assert.equal(f.has(d), true, "a digest that was added must never be rejected");
  assert.equal(f.size, added.length);
});

test("false positives stay near the rate it was sized for", () => {
  const n = 20000;
  const f = new DigestFilter(bloomParamsFor(n, 0.001));
  for (let i = 0; i < n; i++) f.add(digest(`member-${i}`));
  let hits = 0;
  const trials = 20000;
  for (let i = 0; i < trials; i++) if (f.has(digest(`stranger-${i}`))) hits++;
  const rate = hits / trials;
  assert.ok(rate < 0.005, `false-positive rate ${rate} should be near 0.001, not five times it`);
});

test("an empty filter rejects everything, which is what makes it safe to fail closed", () => {
  const f = new DigestFilter(bloomParamsFor(1000, 0.001));
  for (let i = 0; i < 100; i++) assert.equal(f.has(digest(`x-${i}`)), false);
});

test("it survives a round trip through bytes", () => {
  const f = new DigestFilter(bloomParamsFor(5000, 0.001));
  const keys = Array.from({ length: 5000 }, (_, i) => digest(`rt-${i}`));
  for (const d of keys) f.add(d);
  const back = DigestFilter.parse(f.serialize());
  assert.ok(back, "a serialized filter parses");
  assert.equal(back!.m, f.m);
  assert.equal(back!.k, f.k);
  assert.equal(back!.size, f.size);
  for (const d of keys) assert.equal(back!.has(d), true);
  assert.equal(back!.has(digest("never-added")), false);
});

test("garbage does not parse into a filter that would answer questions", () => {
  assert.equal(DigestFilter.parse(new Uint8Array(8)), null, "too short");
  assert.equal(DigestFilter.parse(randomBytes(2048)), null, "wrong magic");
  const f = new DigestFilter(bloomParamsFor(100, 0.01));
  const truncated = f.serialize().subarray(0, 40);
  assert.equal(DigestFilter.parse(truncated), null, "a short body is refused rather than half-read");
});

test("sizing matches the standard formula, so the artifact's size is predictable", () => {
  const { m, k } = bloomParamsFor(1_487_443, 0.001);
  assert.equal(k, 10);
  const mb = m / 8 / 1024 / 1024;
  assert.ok(mb > 2 && mb < 3, `1.49M digests at 0.1% should be about 2.6 MB, got ${mb.toFixed(2)}`);
});
