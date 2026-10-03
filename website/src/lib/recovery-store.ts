/**
 * The server's half of bitgraph-recovery/1 (see recovery.ts for the formats):
 * a store of opaque envelopes under object keys, the request checks, and the
 * two handlers the routes wrap. Pure on purpose: nothing here imports Next or
 * the AWS SDK, so node's test runner drives the same handlers the routes do,
 * against MemoryRecoveryStore. The S3 store is recovery-store-s3.ts.
 *
 * The server never sees a digest or a plaintext. What it can check, it
 * checks strictly: the key's exact shape, the envelope's base64, its size and
 * its version byte, the batch's size, and that no key appears twice. What it
 * cannot check (whether an envelope opens, whose member it holds) is the
 * client's job, which is why a write that finds its key taken answers with
 * the envelope already there instead of an opinion about it.
 *
 *   POST /api/recovery          { entries: [{ key, envelope (base64) }] }   1 to 500 entries
 *     200 { results: [ { key, status: "created" }
 *                    | { key, status: "exists", envelope }   the stored envelope, for the client to open
 *                    | { key, status: "conflict" }            S3 409 after retries: try again later
 *                    | { key, status: "error" } ] }           this entry could not be written: try again later
 *     400 { error, code: "bad-request", index? }   413 { error, code: "too-large" }
 *     429 { error, code: "rate-limited" }          503 { error, code: "recovery-writes-off" }
 *
 *   GET /api/recovery/<address>?after=<entryId>&limit=<1..100>
 *     200 { address, entries: [{ key, envelope }], next: entryId | null }   ascending by entry id
 *     400 { error, code: "bad-request" }   503 { error, code: "recovery-unavailable" }
 *
 * Results come back in request order, one per entry, each naming its key.
 */

import { base64ToBytes, bytesToBase64 } from "@mikeargento/bitgraph-verify";
import {
  ADDRESS_PATTERN,
  ENTRY_ID_PATTERN,
  ENVELOPE_VERSION,
  MAX_BATCH_ENTRIES,
  MAX_BODY_BYTES,
  MAX_ENVELOPE_BYTES,
  MAX_LIST_LIMIT,
  MIN_ENVELOPE_BYTES,
  OBJECT_KEY_PATTERN,
  RECOVERY_PREFIX,
} from "./recovery.ts";

/**
 * Writes are OFF unless RECOVERY_WRITES=on. Every entry lands under Object
 * Lock COMPLIANCE for ten years, written by anyone who can reach the route,
 * so the switch is off until the bucket policy (recovery-store-s3.ts) and a
 * WAF rate rule on POST /api/recovery are in place. Reads are never switched
 * off. Like LEDGER_WRITES, it is flipped from Vercel's env panel without a
 * deploy; unlike it, the default is the safe side.
 */
export const recoveryWritesOn = (): boolean => process.env.RECOVERY_WRITES === "on";

// ---------------------------------------------------------------------------
// The store
// ---------------------------------------------------------------------------

export type PutOutcome = { status: "created" } | { status: "exists"; envelope: Uint8Array } | { status: "conflict" };

export interface StoredEntry {
  key: string;
  envelope: Uint8Array;
}

export interface ListPage {
  entries: StoredEntry[];
  /** The last entry id this page covered when more follow, else null. */
  next: string | null;
}

export interface RecoveryStore {
  /**
   * Create `key` holding `envelope` only when nothing is there. "exists"
   * carries the envelope that IS there, unchanged. "conflict" is a
   * concurrent write the caller may retry. Any other failure throws.
   */
  putIfAbsent(key: string, envelope: Uint8Array): Promise<PutOutcome>;
  /** The entries under one address in ascending key order, strictly after `after` (an entry id), at most `limit`. Throws when it cannot read. */
  list(address: string, after: string | null, limit: number): Promise<ListPage>;
}

/**
 * The same contract in memory, for tests. Hooks: `conflicts` makes a key
 * answer "conflict" that many times before it behaves; `failing` makes every
 * call throw (a store that cannot be reached); `puts` counts calls.
 */
export class MemoryRecoveryStore implements RecoveryStore {
  readonly objects = new Map<string, Uint8Array>();
  readonly conflicts = new Map<string, number>();
  failing = false;
  puts = 0;

  async putIfAbsent(key: string, envelope: Uint8Array): Promise<PutOutcome> {
    this.puts++;
    if (this.failing) throw new Error("store unavailable");
    const pending = this.conflicts.get(key) ?? 0;
    if (pending > 0) {
      this.conflicts.set(key, pending - 1);
      return { status: "conflict" };
    }
    const there = this.objects.get(key);
    if (there !== undefined) return { status: "exists", envelope: there.slice() };
    this.objects.set(key, envelope.slice());
    return { status: "created" };
  }

  async list(address: string, after: string | null, limit: number): Promise<ListPage> {
    if (this.failing) throw new Error("store unavailable");
    const prefix = `${RECOVERY_PREFIX}${address}/`;
    const keys = [...this.objects.keys()].filter((k) => k.startsWith(prefix) && (after === null || k > prefix + after)).sort();
    const page = keys.slice(0, limit);
    return {
      entries: page.map((key) => ({ key, envelope: this.objects.get(key)!.slice() })),
      next: keys.length > limit ? page[page.length - 1]!.slice(prefix.length) : null,
    };
  }
}

// ---------------------------------------------------------------------------
// Rate limit (per instance)
// ---------------------------------------------------------------------------

/**
 * Requests per caller per window, in this instance's memory: the contact
 * route's pattern. It resets on a cold start and every instance keeps its
 * own, so it is a speed bump for one noisy caller, not the control; the
 * control is a WAF rule on POST /api/recovery, as /api/fuse/* has. A real
 * client sends one batch at a time and does not come near it.
 */
export class RateLimiter {
  private readonly hits = new Map<string, number[]>();
  // Plain fields, not constructor parameter properties: node's test runner
  // strips types and refuses the TypeScript-only syntax.
  private readonly max: number;
  private readonly windowMs: number;
  private readonly now: () => number;

  constructor(max: number, windowMs: number, now: () => number = Date.now) {
    this.max = max;
    this.windowMs = windowMs;
    this.now = now;
  }

  /** True when this call is over the limit (and is not counted). */
  limited(caller: string): boolean {
    const t = this.now();
    const recent = (this.hits.get(caller) ?? []).filter((x) => t - x < this.windowMs);
    if (recent.length >= this.max) {
      this.hits.set(caller, recent);
      return true;
    }
    recent.push(t);
    this.hits.set(caller, recent);
    if (this.hits.size > 10_000) {
      for (const [k, v] of this.hits) if (v.every((x) => t - x >= this.windowMs)) this.hits.delete(k);
    }
    return false;
  }
}

export const RECOVERY_POST_LIMIT = { max: 120, windowMs: 60_000 } as const;

// ---------------------------------------------------------------------------
// The handlers
// ---------------------------------------------------------------------------

export interface HandlerResult {
  status: number;
  body: Record<string, unknown>;
}

export type PostResult =
  | { key: string; status: "created" }
  | { key: string; status: "exists"; envelope: string }
  | { key: string; status: "conflict" }
  | { key: string; status: "error" };

export interface PostOptions {
  /** How many times a 409 is retried before the entry is answered "conflict". Default 3. */
  conflictRetries?: number;
  /** First wait after a 409, doubled each time. Default 50 ms. */
  conflictDelayMs?: number;
  /** Puts in flight. Default 32. */
  concurrency?: number;
  sleep?: (ms: number) => Promise<void>;
  log?: (line: string) => void;
}

const bad = (error: string, index?: number): HandlerResult => ({ status: 400, body: { error, code: "bad-request", ...(index !== undefined ? { index } : {}) } });
const defaultSleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/** One entry of a POST body, checked; the error names what is wrong with it. */
function checkEntry(e: unknown): { key: string; envelope: Uint8Array } | string {
  if (e === null || typeof e !== "object" || Array.isArray(e)) return "an entry is an object { key, envelope }";
  const o = e as Record<string, unknown>;
  if (Object.keys(o).sort().join(",") !== "envelope,key") return "an entry has exactly the fields key and envelope";
  if (typeof o["key"] !== "string" || !OBJECT_KEY_PATTERN.test(o["key"])) return "key must be recovery/v1/<64 hex>/<64 hex>, lowercase";
  if (typeof o["envelope"] !== "string") return "envelope must be standard base64";
  // A cheap size bound before decoding: base64 of MAX_ENVELOPE_BYTES is at most this long.
  if (o["envelope"].length > Math.ceil(MAX_ENVELOPE_BYTES / 3) * 4) return `envelope is over ${MAX_ENVELOPE_BYTES} bytes`;
  const envelope = base64ToBytes(o["envelope"]);
  if (envelope === null) return "envelope must be canonical standard base64";
  if (envelope.length < MIN_ENVELOPE_BYTES) return `envelope is under ${MIN_ENVELOPE_BYTES} bytes`;
  if (envelope.length > MAX_ENVELOPE_BYTES) return `envelope is over ${MAX_ENVELOPE_BYTES} bytes`;
  if (envelope[0] !== ENVELOPE_VERSION) return `envelope version must be ${ENVELOPE_VERSION}`;
  return { key: o["key"], envelope };
}

/** Run `fn` over `items`, at most `limit` at once, results in item order. `fn` never throws here; it answers. */
async function pool<T, R>(items: readonly T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  await Promise.all(Array.from({ length: Math.max(1, Math.min(limit, items.length)) }, async () => {
    while (next < items.length) {
      const i = next++;
      out[i] = await fn(items[i]!);
    }
  }));
  return out;
}

/**
 * POST /api/recovery. `bodyText` is the raw body: the size is checked before
 * it is parsed. Every entry is checked before any is written, so a bad batch
 * writes nothing. A 409 (a concurrent write or delete on the key) is retried
 * here a few times with a doubling wait, then answered "conflict" for the
 * client to retry; any other store failure answers "error" for that entry
 * alone. Nothing about keys is logged, only counts.
 */
export async function handleRecoveryPost(bodyText: string, store: RecoveryStore, opts: PostOptions = {}): Promise<HandlerResult> {
  if (bodyText.length > MAX_BODY_BYTES) return { status: 413, body: { error: `the body is over ${MAX_BODY_BYTES} bytes`, code: "too-large" } };
  let body: unknown;
  try {
    body = JSON.parse(bodyText);
  } catch {
    return bad("body must be JSON");
  }
  if (body === null || typeof body !== "object" || Array.isArray(body)) return bad("body must be an object { entries }");
  if (Object.keys(body).join(",") !== "entries") return bad("body has exactly one field, entries");
  const entries = (body as { entries: unknown }).entries;
  if (!Array.isArray(entries) || entries.length === 0) return bad("entries must be a non-empty array");
  if (entries.length > MAX_BATCH_ENTRIES) return bad(`at most ${MAX_BATCH_ENTRIES} entries per request`);
  const checked: Array<{ key: string; envelope: Uint8Array }> = [];
  const seen = new Set<string>();
  for (let i = 0; i < entries.length; i++) {
    const c = checkEntry(entries[i]);
    if (typeof c === "string") return bad(`entry ${i}: ${c}`, i);
    if (seen.has(c.key)) return bad(`entry ${i}: key appears twice in one request`, i);
    seen.add(c.key);
    checked.push(c);
  }

  const retries = opts.conflictRetries ?? 3;
  const delay = opts.conflictDelayMs ?? 50;
  const sleep = opts.sleep ?? defaultSleep;
  const results = await pool(checked, opts.concurrency ?? 32, async ({ key, envelope }): Promise<PostResult> => {
    try {
      for (let attempt = 0; ; attempt++) {
        const r = await store.putIfAbsent(key, envelope);
        if (r.status === "created") return { key, status: "created" };
        if (r.status === "exists") return { key, status: "exists", envelope: bytesToBase64(r.envelope) };
        if (attempt >= retries) return { key, status: "conflict" };
        await sleep(delay * 2 ** attempt);
      }
    } catch {
      return { key, status: "error" };
    }
  });
  const count = (s: PostResult["status"]) => results.filter((r) => r.status === s).length;
  (opts.log ?? console.log)(`[api/recovery] entries=${results.length} created=${count("created")} exists=${count("exists")} conflict=${count("conflict")} error=${count("error")}`);
  return { status: 200, body: { results } };
}

/** The query a listing accepts. Unknown parameters are ignored. */
export interface ListQuery {
  get(name: string): string | null;
}

/**
 * GET /api/recovery/<address>. A store that cannot be read is a 503, never an
 * empty page: an empty page says nothing is kept for these bytes, and that is
 * the one thing a failed read must not say.
 */
export async function handleRecoveryList(address: string, query: ListQuery, store: RecoveryStore): Promise<HandlerResult> {
  if (!ADDRESS_PATTERN.test(address)) return bad("the address is 64 lowercase hex characters");
  const after = query.get("after");
  if (after !== null && !ENTRY_ID_PATTERN.test(after)) return bad("after must be an entry id: 64 lowercase hex characters");
  const rawLimit = query.get("limit");
  let limit = MAX_LIST_LIMIT;
  if (rawLimit !== null) {
    if (!/^[0-9]{1,3}$/.test(rawLimit) || Number(rawLimit) < 1 || Number(rawLimit) > MAX_LIST_LIMIT) return bad(`limit must be an integer from 1 to ${MAX_LIST_LIMIT}`);
    limit = Number(rawLimit);
  }
  let page: ListPage;
  try {
    page = await store.list(address, after, limit);
  } catch (e) {
    console.error("[api/recovery] list failed:", e instanceof Error ? e.message : String(e));
    return { status: 503, body: { error: "the recovery entries could not be read", code: "recovery-unavailable" } };
  }
  return {
    status: 200,
    body: {
      address,
      entries: page.entries.map((e) => ({ key: e.key, envelope: bytesToBase64(e.envelope) })),
      next: page.next,
    },
  };
}
