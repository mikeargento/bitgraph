// Copyright (c) Mike Argento. All rights reserved. See LICENSE.

/**
 * POST /allocate-slot is metered in slots, sized to the enclave's slot TTL.
 *
 * The case these tests exist for: one address firing a thousand bare
 * allocations fills the enclave's single pending-slot map (MAX_PENDING_SLOTS
 * = 1000, shared by every chain and by the anchor service) and every commit
 * then fails with "Too many pending slots" until the entries expire, up to
 * SLOT_TTL_MS = 120 s. The digest limiter never saw those calls, because an
 * allocation mints no digest.
 */

import { test } from "node:test";
// Named import rather than default: this package builds without
// esModuleInterop, so `import assert from "node:assert/strict"` will not compile.
import { strict as assert } from "node:assert";
import { createAllocationLimiter } from "../rate-limit.js";

const T0 = 1_700_000_000_000;

test("defaults: 20 per address refilling 10 per minute, 250 per 120 s window", () => {
  const l = createAllocationLimiter({});
  assert.deepEqual(l.config(), { perIpCapacity: 20, perIpRefillPerMin: 10, globalPerWindow: 250, windowMs: 120_000 });
});

test("one address gets its burst, then is refused with a Retry-After; another address is untouched", () => {
  const l = createAllocationLimiter({});
  for (let i = 0; i < 20; i++) {
    assert.deepEqual(l.tryConsume("203.0.113.1", T0), { ok: true }, `allocation ${i + 1} of 20 must pass`);
  }
  const refused = l.tryConsume("203.0.113.1", T0);
  assert.equal(refused.ok, false);
  if (!refused.ok) {
    assert.match(refused.reason, /per-client slot allocation/);
    assert.ok(refused.retryAfterSec >= 1, "a refused allocation carries a usable Retry-After");
    assert.ok(refused.retryAfterSec <= 6, `one token refills in 6 s at 10/min, got ${refused.retryAfterSec}`);
  }
  assert.deepEqual(l.tryConsume("203.0.113.2", T0), { ok: true }, "a second address has its own bucket");
});

test("the bucket refills to full across one slot TTL", () => {
  const l = createAllocationLimiter({});
  for (let i = 0; i < 20; i++) l.tryConsume("a", T0);
  assert.equal(l.tryConsume("a", T0).ok, false);
  // 60 s later: 10 tokens back.
  for (let i = 0; i < 10; i++) assert.equal(l.tryConsume("a", T0 + 60_000).ok, true, `refilled token ${i + 1}`);
  assert.equal(l.tryConsume("a", T0 + 60_000).ok, false);
  // A full TTL after the burst: full again.
  for (let i = 0; i < 20; i++) assert.equal(l.tryConsume("a", T0 + 60_000 + 120_000).ok, true, `full refill token ${i + 1}`);
});

test("the global window caps all addresses together and restarts after the window", () => {
  const l = createAllocationLimiter({ RL_ALLOC_GLOBAL_PER_WINDOW: "5", RL_ALLOC_PER_IP_CAPACITY: "100" });
  for (let i = 0; i < 5; i++) assert.equal(l.tryConsume(`ip-${i}`, T0).ok, true);
  const refused = l.tryConsume("ip-new", T0 + 1000);
  assert.equal(refused.ok, false);
  if (!refused.ok) {
    assert.match(refused.reason, /global slot allocation budget/);
    assert.equal(refused.retryAfterSec, 119, "Retry-After points at the end of the 120 s window");
  }
  assert.equal(l.tryConsume("ip-new", T0 + 120_000).ok, true, "a new window opens after 120 s");
});

test("a refused allocation consumes nothing", () => {
  const l = createAllocationLimiter({ RL_ALLOC_GLOBAL_PER_WINDOW: "10", RL_ALLOC_PER_IP_CAPACITY: "1" });
  assert.equal(l.tryConsume("a", T0).ok, true);
  for (let i = 0; i < 5; i++) assert.equal(l.tryConsume("a", T0).ok, false, "per-address refusals");
  // Nine global tokens must remain: the five refusals above did not spend any.
  for (let i = 0; i < 9; i++) assert.equal(l.tryConsume(`b-${i}`, T0).ok, true, `global token ${i + 1} of 9`);
  assert.equal(l.tryConsume("c", T0).ok, false);
});

test("the defaults keep bare allocations under a quarter of the enclave pool", () => {
  // MAX_PENDING_SLOTS is 1000 in the enclave (server/commit-service/src/enclave/app.ts).
  const cfg = createAllocationLimiter({}).config();
  assert.ok(cfg.globalPerWindow * 1 <= 1000 / 4);
  assert.ok(cfg.windowMs <= 120_000, "the window must not exceed the slot TTL, or a window could hold expired slots against the budget");
});

test("env overrides are read; garbage, zero and negatives fall back to defaults", () => {
  const custom = createAllocationLimiter({
    RL_ALLOC_PER_IP_CAPACITY: "3",
    RL_ALLOC_PER_IP_REFILL_PER_MIN: "30",
    RL_ALLOC_GLOBAL_PER_WINDOW: "7",
    RL_ALLOC_WINDOW_MS: "60000",
  }).config();
  assert.deepEqual(custom, { perIpCapacity: 3, perIpRefillPerMin: 30, globalPerWindow: 7, windowMs: 60_000 });

  const junk = createAllocationLimiter({
    RL_ALLOC_PER_IP_CAPACITY: "lots",
    RL_ALLOC_PER_IP_REFILL_PER_MIN: "0",
    RL_ALLOC_GLOBAL_PER_WINDOW: "-5",
    RL_ALLOC_WINDOW_MS: "",
  }).config();
  assert.deepEqual(junk, { perIpCapacity: 20, perIpRefillPerMin: 10, globalPerWindow: 250, windowMs: 120_000 });
});

test("two limiters do not share state", () => {
  const a = createAllocationLimiter({ RL_ALLOC_PER_IP_CAPACITY: "1" });
  const b = createAllocationLimiter({ RL_ALLOC_PER_IP_CAPACITY: "1" });
  assert.equal(a.tryConsume("x", T0).ok, true);
  assert.equal(a.tryConsume("x", T0).ok, false);
  assert.equal(b.tryConsume("x", T0).ok, true, "the second limiter has its own buckets");
});
