// Copyright (c) Mike Argento. All rights reserved. See LICENSE.

/**
 * Digest-denominated rate limiting for POST /commit.
 *
 * Limits are counted in digests (proofs minted), not HTTP requests, because
 * a single /commit request can carry an arbitrarily large digests[] array.
 *
 * Two layers:
 *   - Per-IP token bucket: capacity RL_PER_IP_CAPACITY (default 5000),
 *     refilling RL_PER_IP_REFILL_PER_MIN (default 20) tokens per minute.
 *     Sized so a legitimate bulk drop (1000+ files) passes untouched while a
 *     sustained single-IP drain tops out around 30k proofs/day.
 *   - Global daily budget: RL_GLOBAL_PER_DAY (default 100000) digests per
 *     rolling 24h window across all IPs. Backstop against distributed abuse;
 *     caps worst-case S3 write spend regardless of source count.
 *
 * Requests bearing a valid API key (when API_KEYS is configured) bypass both
 * layers — see hasValidApiKey() in server.ts.
 */

import type { IncomingMessage } from "node:http";

const PER_IP_CAPACITY = Number(process.env["RL_PER_IP_CAPACITY"] ?? 5000);
const PER_IP_REFILL_PER_MIN = Number(process.env["RL_PER_IP_REFILL_PER_MIN"] ?? 20);
const GLOBAL_PER_DAY = Number(process.env["RL_GLOBAL_PER_DAY"] ?? 100000);

const DAY_MS = 24 * 60 * 60 * 1000;
const MAX_TRACKED_IPS = 10_000;

interface Bucket {
  tokens: number;
  lastRefillMs: number;
}

const buckets = new Map<string, Bucket>();

let globalUsed = 0;
let globalWindowStartMs = Date.now();

/**
 * Resolve the client address for rate-limiting purposes.
 *
 * The parent sits behind a cloudflared tunnel running on this host, so
 * tunneled traffic arrives from loopback with the real client address in
 * CF-Connecting-IP. That header is only trusted for loopback connections:
 * a caller that reaches the port directly cannot spoof identities with it.
 */
export function getClientIp(req: IncomingMessage): string {
  const socketIp = req.socket.remoteAddress ?? "unknown";
  const isLoopback =
    socketIp === "127.0.0.1" || socketIp === "::1" || socketIp === "::ffff:127.0.0.1";
  if (isLoopback) {
    const cf = req.headers["cf-connecting-ip"];
    if (typeof cf === "string" && cf.length > 0) return cf;
  }
  return socketIp;
}

export type RateLimitResult =
  | { ok: true }
  | { ok: false; retryAfterSec: number; reason: string };

/**
 * Try to consume `digestCount` tokens for `ip`. Returns { ok: true } and
 * records the spend, or { ok: false } with a Retry-After hint. Never partially
 * consumes: a rejected request leaves both counters untouched.
 */
export function tryConsumeDigests(ip: string, digestCount: number, nowMs = Date.now()): RateLimitResult {
  // A batch larger than the bucket can never succeed — reject with a clear
  // message instead of an unpayable Retry-After.
  if (digestCount > PER_IP_CAPACITY) {
    return {
      ok: false,
      retryAfterSec: 0,
      reason: `batch of ${digestCount} digests exceeds the per-client maximum of ${PER_IP_CAPACITY}; split into smaller batches`,
    };
  }

  // Global daily window (fixed window, resets 24h after first use).
  if (nowMs - globalWindowStartMs >= DAY_MS) {
    globalWindowStartMs = nowMs;
    globalUsed = 0;
  }
  if (globalUsed + digestCount > GLOBAL_PER_DAY) {
    const retryAfterSec = Math.ceil((globalWindowStartMs + DAY_MS - nowMs) / 1000);
    return { ok: false, retryAfterSec, reason: "global daily proof budget exhausted" };
  }

  // Per-IP token bucket.
  let bucket = buckets.get(ip);
  if (!bucket) {
    if (buckets.size >= MAX_TRACKED_IPS) pruneBuckets(nowMs);
    bucket = { tokens: PER_IP_CAPACITY, lastRefillMs: nowMs };
    buckets.set(ip, bucket);
  } else {
    const elapsedMin = (nowMs - bucket.lastRefillMs) / 60_000;
    bucket.tokens = Math.min(PER_IP_CAPACITY, bucket.tokens + elapsedMin * PER_IP_REFILL_PER_MIN);
    bucket.lastRefillMs = nowMs;
  }

  if (bucket.tokens < digestCount) {
    const deficit = digestCount - bucket.tokens;
    const retryAfterSec = Math.ceil((deficit / PER_IP_REFILL_PER_MIN) * 60);
    return { ok: false, retryAfterSec, reason: "per-client proof rate limit exceeded" };
  }

  bucket.tokens -= digestCount;
  globalUsed += digestCount;
  return { ok: true };
}

/** Drop buckets that have fully refilled — they carry no state worth keeping. */
function pruneBuckets(nowMs: number): void {
  for (const [ip, bucket] of buckets) {
    const elapsedMin = (nowMs - bucket.lastRefillMs) / 60_000;
    if (bucket.tokens + elapsedMin * PER_IP_REFILL_PER_MIN >= PER_IP_CAPACITY) {
      buckets.delete(ip);
    }
  }
}

export function rateLimitConfig(): { perIpCapacity: number; perIpRefillPerMin: number; globalPerDay: number } {
  return {
    perIpCapacity: PER_IP_CAPACITY,
    perIpRefillPerMin: PER_IP_REFILL_PER_MIN,
    globalPerDay: GLOBAL_PER_DAY,
  };
}

// ---------------------------------------------------------------------------
// Allocation limiter for POST /allocate-slot (client-held slots)
// ---------------------------------------------------------------------------

/**
 * A bare allocation mints no digest, so the digest limiter above has nothing
 * to count, yet it occupies one entry of the enclave's single pending-slot
 * map (MAX_PENDING_SLOTS = 1000, shared by every chain and by the anchor
 * service's own commits) for up to SLOT_TTL_MS = 120 s. Left unmetered, one
 * client can fill that map and hold every commit at "Too many pending
 * slots" until the entries expire. This limiter is denominated in slots and
 * sized to the TTL:
 *
 *   - Per address: a token bucket of RL_ALLOC_PER_IP_CAPACITY (default 20)
 *     refilling RL_ALLOC_PER_IP_REFILL_PER_MIN (default 10) per minute, so
 *     one address holds at most 20 unexpired slots at once and refills to
 *     full across one TTL.
 *   - Global: RL_ALLOC_GLOBAL_PER_WINDOW (default 250) allocations per
 *     RL_ALLOC_WINDOW_MS (default 120000, the TTL) across all addresses, so
 *     bare allocations together can never take more than a quarter of the
 *     pool and internal allocations (every /commit, anchors included) keep
 *     their room.
 *
 * Requests bearing a valid API key are exempt, exactly as on /commit.
 *
 * Built as a factory over an env-like object with an injectable clock, the
 * same shape as auth.ts, so configurations are tabulated in one test process.
 */

export interface AllocationLimitConfig {
  perIpCapacity: number;
  perIpRefillPerMin: number;
  globalPerWindow: number;
  windowMs: number;
}

export interface AllocationLimiter {
  /** Consume one allocation for `ip`. Never partially consumes. */
  tryConsume(ip: string, nowMs?: number): RateLimitResult;
  config(): AllocationLimitConfig;
}

function positiveNumber(raw: string | undefined, fallback: number): number {
  const n = Number(raw);
  return raw !== undefined && Number.isFinite(n) && n > 0 ? n : fallback;
}

export function createAllocationLimiter(env: Record<string, string | undefined>): AllocationLimiter {
  const cfg: AllocationLimitConfig = {
    perIpCapacity: positiveNumber(env["RL_ALLOC_PER_IP_CAPACITY"], 20),
    perIpRefillPerMin: positiveNumber(env["RL_ALLOC_PER_IP_REFILL_PER_MIN"], 10),
    globalPerWindow: positiveNumber(env["RL_ALLOC_GLOBAL_PER_WINDOW"], 250),
    windowMs: positiveNumber(env["RL_ALLOC_WINDOW_MS"], 120_000),
  };

  const ipBuckets = new Map<string, Bucket>();
  let windowUsed = 0;
  let windowStartMs: number | null = null;

  function prune(nowMs: number): void {
    for (const [ip, b] of ipBuckets) {
      const elapsedMin = (nowMs - b.lastRefillMs) / 60_000;
      if (b.tokens + elapsedMin * cfg.perIpRefillPerMin >= cfg.perIpCapacity) ipBuckets.delete(ip);
    }
  }

  return {
    config: () => ({ ...cfg }),
    tryConsume(ip: string, nowMs = Date.now()): RateLimitResult {
      // Global window (fixed window, restarted when it has fully elapsed).
      if (windowStartMs === null || nowMs - windowStartMs >= cfg.windowMs) {
        windowStartMs = nowMs;
        windowUsed = 0;
      }
      if (windowUsed + 1 > cfg.globalPerWindow) {
        const retryAfterSec = Math.max(1, Math.ceil((windowStartMs + cfg.windowMs - nowMs) / 1000));
        return { ok: false, retryAfterSec, reason: "global slot allocation budget exhausted for this window" };
      }

      // Per-address token bucket.
      let bucket = ipBuckets.get(ip);
      if (!bucket) {
        if (ipBuckets.size >= MAX_TRACKED_IPS) prune(nowMs);
        bucket = { tokens: cfg.perIpCapacity, lastRefillMs: nowMs };
        ipBuckets.set(ip, bucket);
      } else {
        const elapsedMin = (nowMs - bucket.lastRefillMs) / 60_000;
        bucket.tokens = Math.min(cfg.perIpCapacity, bucket.tokens + elapsedMin * cfg.perIpRefillPerMin);
        bucket.lastRefillMs = nowMs;
      }
      if (bucket.tokens < 1) {
        const retryAfterSec = Math.max(1, Math.ceil(((1 - bucket.tokens) / cfg.perIpRefillPerMin) * 60));
        return { ok: false, retryAfterSec, reason: "per-client slot allocation rate limit exceeded" };
      }

      bucket.tokens -= 1;
      windowUsed += 1;
      return { ok: true };
    },
  };
}

/** The limiter the running parent uses; configured from the environment at boot. */
export const allocationLimiter: AllocationLimiter = createAllocationLimiter(process.env);
