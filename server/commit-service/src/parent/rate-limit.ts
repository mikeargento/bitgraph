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
