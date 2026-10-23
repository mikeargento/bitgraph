// Copyright (c) Argento Computing Inc. All rights reserved. See LICENSE.

/**
 * A JSON-RPC client over a list of endpoints, for the output-root settlement
 * (output-root-settler.ts), which leans on public RPCs that Base and the
 * node operators describe as rate-limited and not for production.
 *
 * What each failure means decides what happens next, so every failure is
 * classified (measured against the live endpoints on 2026-10-03):
 *
 *   rate       HTTP 429, or JSON-RPC -32016 "over rate limit" (mainnet.base.org
 *              answers that after three calls inside a fraction of a second).
 *              The endpoint cools down, doubling per strike, and the next one
 *              is asked.
 *   state      the node answered but does not hold the state or block asked
 *              for: "no state found for block number N" (mainnet.base.org,
 *              -32603), "Archive requests require a personal token"
 *              (publicnode, HTTP 403), "missing trie node", "header not
 *              found". The next endpoint is asked without a cooldown; when
 *              every endpoint said so, the call fails as `state`, which the
 *              settler reads as "this summary block is gone" once it is old
 *              enough to be (a just-produced block a lagging node lacks is
 *              retried, not given up).
 *   transient  network errors, timeouts, 5xx, a non-JSON body (a Cloudflare
 *              challenge page), anything unrecognised. Cooldown, next endpoint.
 *   rpc        a deterministic answer from the node: a revert, invalid
 *              params. Returned at once; another endpoint would say the same.
 *
 * Calls to one endpoint are spaced by `minIntervalMs`, and all waiting inside
 * one call is capped by `maxWaitMs`, so a pool that cannot answer fails fast
 * and the writer's loop moves on; the settler asks again on its next pass.
 * URLs may carry API keys, so only an endpoint's origin is ever logged.
 */

import type { Rpc } from "./block.js";
import type { FetchLike } from "./settlement.js";

export type RpcErrorKind = "state" | "rate" | "transient" | "rpc";

export class RpcError extends Error {
  readonly kind: RpcErrorKind;
  constructor(message: string, kind: RpcErrorKind) {
    super(message);
    this.name = "RpcError";
    this.kind = kind;
  }
}

const RATE = /rate limit|over rate|too many requests|limit exceeded|request limit|exceeds? .*limit|throttl|capacity/i;
const STATE = /no state found|missing trie node|state (?:is )?(?:not available|unavailable)|historical state|pruned|archive|header not found|unknown block|block not found|not available for block|method not found|does not exist\/is not available/i;

/** The kind of one failed request, from its HTTP status, JSON-RPC error code and message. */
export function classifyRpcError(status: number | null, code: number | null, message: string): RpcErrorKind {
  if (status === 429 || code === -32016 || code === -32005 || RATE.test(message)) return "rate";
  if (STATE.test(message) || code === -32601) return "state";
  if (status !== null && (status < 200 || status >= 300)) return "transient";
  if (code === 3 || /revert/i.test(message)) return "rpc";
  if (code === -32602 || code === -32600) return "rpc";
  return "transient";
}

/** The kind of an error thrown by any Rpc: its own `kind` when it has one, else read from its message. */
export function rpcErrorKind(e: unknown): RpcErrorKind {
  const k = (e as { kind?: unknown } | null)?.kind;
  if (k === "state" || k === "rate" || k === "transient" || k === "rpc") return k;
  return classifyRpcError(null, null, String((e as Error | null)?.message ?? e));
}

export interface RpcPoolOptions {
  /** Minimum time between two requests to one endpoint, in ms (default 250). */
  minIntervalMs?: number;
  /** Rounds over the endpoint list before a call fails (default 2). */
  rounds?: number;
  /** Wait before the next round, doubling each round (default 1000 ms). */
  backoffMs?: number;
  /** All waiting inside one call, throttle and backoff together, stays under this (default 6000 ms). */
  maxWaitMs?: number;
  /** Cooldown after a rate-limit answer, doubling per strike up to `maxCooldownMs` (default 5000 ms). */
  rateCooldownMs?: number;
  /** Cooldown after a transient failure, doubling per strike up to `maxCooldownMs` (default 2000 ms). */
  transientCooldownMs?: number;
  maxCooldownMs?: number;
  /** Per request (default 30 000 ms; a full Ethereum block is about 700 KB). */
  timeoutMs?: number;
  fetch?: FetchLike;
  sleep?: (ms: number) => Promise<void>;
  /** Milliseconds, for throttle and cooldown bookkeeping (default Date.now). */
  clock?: () => number;
  log?: (event: Record<string, unknown>) => void;
}

/** scheme://host[:port] of an endpoint: what may be logged of it. */
export function endpointOrigin(url: string): string {
  try { return new URL(url).origin; } catch { return "(unparseable url)"; }
}

/** A comma-separated endpoint list (an environment variable), blanks dropped; `fallback` when empty. */
export function endpointList(value: string | undefined, fallback: string[]): string[] {
  const list = (value ?? "").split(",").map((s) => s.trim()).filter(Boolean);
  return list.length > 0 ? list : fallback;
}

interface Endpoint { url: string; origin: string; nextAt: number; coolUntil: number; strikes: number }
interface RpcBody { result?: unknown; error?: { code?: unknown; message?: unknown } }

/** An Rpc that asks `urls` in turn (the last one that answered first), throttled, with cooldowns and bounded retries. */
export function rpcPool(urls: string[], opts: RpcPoolOptions = {}): Rpc {
  if (urls.length === 0) throw new TypeError("rpcPool: no endpoints");
  const fetchImpl: FetchLike = opts.fetch ?? ((url, init) => fetch(url, init));
  const sleep = opts.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const clock = opts.clock ?? Date.now;
  const log = opts.log ?? (() => {});
  const minInterval = opts.minIntervalMs ?? 250;
  const rounds = Math.max(1, opts.rounds ?? 2);
  const backoff = opts.backoffMs ?? 1000;
  const maxWait = opts.maxWaitMs ?? 6000;
  const rateCool = opts.rateCooldownMs ?? 5000;
  const transientCool = opts.transientCooldownMs ?? 2000;
  const maxCool = opts.maxCooldownMs ?? 300_000;
  const timeoutMs = opts.timeoutMs ?? 30_000;
  const eps: Endpoint[] = urls.map((url) => ({ url, origin: endpointOrigin(url), nextAt: 0, coolUntil: 0, strikes: 0 }));
  let preferred = 0;
  let id = 0;

  const attempt = async (ep: Endpoint, method: string, params: unknown[]): Promise<unknown> => {
    let res: Awaited<ReturnType<FetchLike>>;
    try {
      res = await fetchImpl(ep.url, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ jsonrpc: "2.0", id: ++id, method, params }),
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch (e) {
      throw new RpcError(`${method}: ${(e as Error).message}`, "transient");
    }
    let body: RpcBody | null;
    try { body = (await res.json()) as RpcBody | null; } catch { body = null; }
    const err = body && typeof body === "object" ? body.error : undefined;
    const code = typeof err?.code === "number" ? err.code : null;
    const message = typeof err?.message === "string" ? err.message : null;
    if (!res.ok || err) {
      const text = message ?? `HTTP ${res.status}`;
      throw new RpcError(`${method}: ${text}`, classifyRpcError(res.ok ? 200 : res.status, code, text));
    }
    if (!body || typeof body !== "object" || !("result" in body)) throw new RpcError(`${method}: malformed response`, "transient");
    return body.result;
  };

  return async (method, params) => {
    let waited = 0;
    let last: RpcError | null = null;
    const saidState = new Set<number>();
    for (let round = 0; round < rounds; round++) {
      for (let k = 0; k < eps.length; k++) {
        const i = (preferred + k) % eps.length;
        const ep = eps[i]!;
        if (saidState.has(i)) continue;
        let t = clock();
        if (ep.coolUntil > t) continue;
        if (ep.nextAt > t) {
          const w = ep.nextAt - t;
          if (waited + w > maxWait) continue;
          await sleep(w);
          waited += w;
          t = clock();
        }
        ep.nextAt = t + minInterval;
        try {
          const result = await attempt(ep, method, params);
          ep.strikes = 0;
          preferred = i;
          return result;
        } catch (e) {
          const err = e instanceof RpcError ? e : new RpcError(`${method}: ${(e as Error).message}`, "transient");
          last = err;
          if (err.kind === "rpc") throw err;
          if (err.kind === "state") { saidState.add(i); continue; }
          ep.strikes++;
          const cool = Math.min(maxCool, (err.kind === "rate" ? rateCool : transientCool) * 2 ** (ep.strikes - 1));
          ep.coolUntil = clock() + cool;
          log({ type: "rpc-endpoint-cooling", endpoint: ep.origin, method, kind: err.kind, cooldownMs: cool, error: err.message.slice(0, 200) });
        }
      }
      if (saidState.size === eps.length) break;
      if (round < rounds - 1) {
        const w = Math.min(backoff * 2 ** round, maxWait - waited);
        if (w <= 0) break;
        await sleep(w);
        waited += w;
      }
    }
    if (saidState.size === eps.length) {
      throw new RpcError(`${method}: no endpoint holds it (${last?.message ?? "state not served"})`, "state");
    }
    if (last) throw new RpcError(last.message, last.kind === "state" ? "transient" : last.kind);
    throw new RpcError(`${method}: every endpoint is cooling down after rate limits or failures`, "rate");
  };
}
