// Copyright (c) 2024-2026 Argento Computing Inc. Licensed under the MIT License. See LICENSE.

/**
 * Writing a tree's recovery entries from outside the browser (2026-10-03).
 *
 * The drop box keeps its trees recoverable through a persistent queue
 * (website/src/lib/recovery-queue.ts). The CLI, SDK and MCP make trees too,
 * and a file they made should be found again the same way when someone drops
 * it on bitgraph.ing. This posts the same sealed entries (recovery.ts, the
 * Node twin of the site's module) to POST /api/recovery, after the proof is
 * already in hand: it never stands between anyone and a proof.
 *
 * Every write is create-only. "created" counts as kept; "exists" counts
 * only after the stored envelope is opened and holds this same member.
 * A key that holds ANOTHER member's entry (SPEC section 13, squatting) is
 * not the end of it: the same entry is written again under its salted name,
 * with a fresh 32-byte salt sealed inside, and only a salted name that is
 * held too leaves the side blocked. "conflict" and "error" are retried. A
 * site that does not take recovery writes yet (503, or no route at all)
 * leaves the entries pending, and the caller says so: the tree is exactly as
 * made, it is just not recoverable from the file until its entries are
 * written.
 *
 * STATE, FOR A WRITER THAT RESUMES. Progress is one byte per member
 * (recovery.ts, RECOVERY_SIDE_BITS) plus the salts chosen so far, the same
 * shape the browser's queue saves. A caller passes the state of an earlier
 * run to pick up where it stopped, and `onState` hears every change worth
 * keeping: a salt the moment it is chosen (BEFORE its write, so a retry lands
 * on the same name) and progress after every batch. Entries are sealed a
 * batch at a time, never all at once: a 100,000-file tree is 200,000
 * envelopes, and they need not all be in memory together.
 */

import { base64ToBytes, bytesToBase64 } from "@mikeargento/bitgraph-verify";
import {
  MAX_BATCH_ENTRIES,
  RECOVERY_SIDE_BITS,
  existingEntryHoldsMember,
  findOwnRecoveryEntry,
  newRecoverySalt,
  recoverySaltKey,
  recoverySaltsFor,
  recoverySideResolved,
  recoverySideState,
  recoverySidesOf,
  recoveryTreeFrom,
  sealRecoveryMember,
  type FetchLike,
  type RecoveryTreeInput,
  type RecoveryWrite,
} from "./recovery.js";

export interface RecoveryWriteInput extends RecoveryTreeInput {
  /** A file name per leaf, tree order. Advisory, sealed with each entry. */
  names?: ReadonlyArray<string | null | undefined>;
}

/**
 * What a writer keeps between runs: one progress byte per member
 * (RECOVERY_SIDE_BITS) and the salts chosen for entries whose deterministic
 * key was held, base64 by recoverySaltKey. The same shape the browser's
 * queue saves for its jobs.
 */
export interface RecoveryWriteState {
  progress: Uint8Array;
  salts: Record<string, string>;
}

export interface RecoveryWriteOptions {
  /** Default https://bitgraph.ing. */
  baseUrl?: string;
  fetch?: FetchLike;
  /** Rounds of retry for conflicts, errors and transient failures. Default 3. */
  retries?: number;
  /** Milliseconds before the first retry; doubles each round. Default 500. */
  backoffMs?: number;
  /** Milliseconds one request may take. Default 60,000. */
  timeoutMs?: number;
  /** Milliseconds the whole call may take; what is not written by then is reported pending. Default: no budget. */
  budgetMs?: number;
  /** An earlier run's state to resume from. */
  state?: RecoveryWriteState;
  /** Hears the state whenever it is worth keeping: a salt before its write, progress after every batch. */
  onState?: (state: RecoveryWriteState) => void | Promise<void>;
  /** False: a held deterministic key leaves the side blocked instead of trying its salted name. Default true. */
  saltedFallback?: boolean;
}

export interface RecoveryWriteResult {
  /** Entries this tree needs: two per placed member, one per as-is member. */
  entries: number;
  /** Kept when this call ended: created now, or already stored as this member, in this run or one before it. */
  kept: number;
  /** Created in this call. */
  written: number;
  /** Already stored, and opened to hold this same member, in this call. */
  alreadyThere: number;
  /** Of `kept`, those under a salted name: their deterministic key was held by another member's entry. */
  salted: number;
  /** Both names held by other entries (see SPEC section 13, squatting). */
  blocked: number;
  /** Not written: the site refused writes, the attempts or the budget ran out. */
  pending: number;
  /** Why entries are pending, in words, when any are. */
  reason: string | null;
  /** The state to resume from when `pending` is not zero. */
  state: RecoveryWriteState;
  /** Every entry is kept or blocked: nothing left to write. */
  done: boolean;
}

interface Planned {
  index: number;
  w: RecoveryWrite;
}

type Answer = { status: string; envelope?: string };

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function hostOf(base: string): string {
  try {
    return new URL(base).host;
  } catch {
    return base;
  }
}

/** Base64 salts by recoverySaltKey, with the progress, as a fresh copy for a caller to keep. */
const snapshot = (progress: Uint8Array, salts: Record<string, string>): RecoveryWriteState => ({ progress: progress.slice(), salts: { ...salts } });

export async function writeRecoveryEntries(input: RecoveryWriteInput, opts: RecoveryWriteOptions = {}): Promise<RecoveryWriteResult> {
  const tree = recoveryTreeFrom(input);
  const f: FetchLike = opts.fetch ?? ((url, init) => fetch(url, init));
  const base = opts.baseUrl ?? "https://bitgraph.ing";
  const retries = opts.retries ?? 3;
  const timeoutMs = opts.timeoutMs ?? 60_000;
  const deadline = opts.budgetMs !== undefined ? Date.now() + opts.budgetMs : Infinity;
  let waitMs = opts.backoffMs ?? 500;
  const names = input.names;

  const progress = new Uint8Array(tree.count);
  if (opts.state?.progress !== undefined) progress.set(opts.state.progress.subarray(0, tree.count));
  const salts: Record<string, string> = { ...(opts.state?.salts ?? {}) };
  let written = 0;
  let alreadyThere = 0;
  let reason: string | null = null;
  // The site takes no writes, or the budget ran out: no more requests this call.
  let stopped = false;

  const keep = async (): Promise<void> => {
    if (opts.onState !== undefined) await opts.onState(snapshot(progress, salts));
  };

  /** The pending sides of the members from `cursor.at` on, sealed, up to MAX_BATCH_ENTRIES entries. */
  async function nextBatch(cursor: { at: number }): Promise<Planned[]> {
    const out: Planned[] = [];
    while (cursor.at < tree.count) {
      const i = cursor.at;
      const sides = recoverySidesOf(tree, i).filter((s) => !recoverySideResolved(progress[i]!, s));
      if (sides.length > 0) {
        if (out.length + sides.length > MAX_BATCH_ENTRIES) break;
        const { writes } = await sealRecoveryMember(tree, i, names?.[i] ?? null, sides, recoverySaltsFor(salts, i));
        for (const w of writes) out.push({ index: i, w });
      }
      cursor.at++;
    }
    return out;
  }

  /** What one operation may still take: its own limit, or what is left of the budget, whichever is less. Zero or less: the budget is spent. */
  const remaining = (): number => Math.min(timeoutMs, deadline - Date.now());

  /** POST one batch. The answers by key, or null when the request failed as a whole (the reason says how). */
  async function post(batch: Planned[]): Promise<Map<string, Answer> | null> {
    const allowed = remaining();
    if (allowed <= 0) {
      reason = "the time budget ran out";
      stopped = true;
      return null;
    }
    let res: Response;
    try {
      res = await f(`${base}/api/recovery`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ entries: batch.map((p) => ({ key: p.w.objectKey, envelope: bytesToBase64(p.w.envelope) })) }),
        signal: AbortSignal.timeout(allowed),
      });
    } catch (e) {
      reason = `the site could not be reached (${(e as Error).message})`;
      return null;
    }
    if (res.status === 503 || res.status === 404 || res.status === 405 || res.status === 501) {
      // Writes off on the site (503), or a site without the route at all:
      // nothing will land this run. Stop asking.
      stopped = true;
      reason = `${hostOf(base)} is not taking recovery writes yet; the tree is made, but these files cannot be found from the file alone until their entries are written`;
      return null;
    }
    if (!res.ok) {
      reason = `POST /api/recovery answered ${res.status}`;
      return null;
    }
    let body: unknown;
    try {
      body = await res.json();
    } catch {
      reason = "the site's answer was not JSON";
      return null;
    }
    const answers = new Map<string, Answer>();
    const list = (body as { results?: unknown }).results;
    if (Array.isArray(list)) {
      for (const r of list as Array<{ key?: unknown; status?: unknown; envelope?: unknown }>) {
        if (typeof r.key === "string" && typeof r.status === "string") answers.set(r.key, { status: r.status, ...(typeof r.envelope === "string" ? { envelope: r.envelope } : {}) });
      }
    }
    return answers;
  }

  /**
   * Apply one request's answers. A deterministic key held by another member
   * gets a salt, kept first, and its salted write goes out at once; a salted
   * name that is held too is blocked, so this recurses at most once.
   */
  async function apply(batch: Planned[], answers: Map<string, Answer>): Promise<void> {
    const fallbacks: Planned[] = [];
    for (const p of batch) {
      const a = answers.get(p.w.objectKey);
      const bits = RECOVERY_SIDE_BITS[p.w.side];
      if (a?.status === "created") {
        progress[p.index]! |= bits.kept;
        written++;
      } else if (a?.status === "exists" && a.envelope !== undefined) {
        const stored = base64ToBytes(a.envelope);
        if (stored !== null && (await existingEntryHoldsMember(p.w.digest, p.w.objectKey, stored, p.w.plaintext))) {
          progress[p.index]! |= bits.kept;
          alreadyThere++;
        } else if (p.w.salted || opts.saltedFallback === false) {
          progress[p.index]! |= bits.blocked;
        } else {
          fallbacks.push(p);
        }
      }
      // "conflict", "error", or no answer: pending for the next round.
    }
    if (fallbacks.length === 0 || stopped) return;
    // Another member holds these keys. Before a fresh salt, the address is
    // read: an entry of this member may already sit there under a salted name
    // from an earlier run whose salt was not kept. Found, it counts and its
    // salt is kept now; an address that cannot be read leaves the side
    // pending (nothing is guessed, no second copy is written).
    const fresh: Planned[] = [];
    for (const p of fallbacks) {
      const allowed = remaining();
      if (allowed <= 0) {
        reason = "the time budget ran out";
        stopped = true;
        return;
      }
      let own: Awaited<ReturnType<typeof findOwnRecoveryEntry>>;
      try {
        own = await findOwnRecoveryEntry(p.w.digest, p.w.plaintext, f, { baseUrl: base, timeoutMs: allowed });
      } catch (e) {
        reason = `the address could not be read before a salted write (${(e as Error).message})`;
        continue;
      }
      if (own !== null) {
        progress[p.index]! |= RECOVERY_SIDE_BITS[p.w.side].kept;
        alreadyThere++;
        if (own.salt !== null) salts[recoverySaltKey(p.index, p.w.side)] = bytesToBase64(own.salt);
        continue;
      }
      fresh.push(p);
    }
    if (fresh.length === 0) return;
    for (const p of fresh) salts[recoverySaltKey(p.index, p.w.side)] ??= bytesToBase64(newRecoverySalt());
    await keep();
    const resealed: Planned[] = [];
    for (const p of fresh) {
      const { writes } = await sealRecoveryMember(tree, p.index, names?.[p.index] ?? null, [p.w.side], recoverySaltsFor(salts, p.index));
      for (const w of writes) resealed.push({ index: p.index, w });
    }
    const again = await post(resealed);
    if (again !== null) await apply(resealed, again);
  }

  for (let round = 0; round <= retries && !stopped; round++) {
    if (round > 0) {
      if (Date.now() + waitMs > deadline) {
        reason = "the time budget ran out";
        break;
      }
      await sleep(waitMs);
      waitMs *= 2;
    }
    const cursor = { at: 0 };
    let sentAny = false;
    while (!stopped) {
      if (Date.now() > deadline) {
        reason = "the time budget ran out";
        stopped = true;
        break;
      }
      const batch = await nextBatch(cursor);
      if (batch.length === 0) break;
      sentAny = true;
      const answers = await post(batch);
      if (answers !== null) await apply(batch, answers);
      await keep();
    }
    if (!sentAny) break;
  }

  let entries = 0;
  let kept = 0;
  let salted = 0;
  let blocked = 0;
  let pending = 0;
  for (let i = 0; i < tree.count; i++) {
    for (const side of recoverySidesOf(tree, i)) {
      entries++;
      const state = recoverySideState(progress[i]!, side);
      if (state === "kept") {
        kept++;
        if (salts[recoverySaltKey(i, side)] !== undefined) salted++;
      } else if (state === "blocked") blocked++;
      else pending++;
    }
  }
  if (pending > 0 && reason === null) reason = "some entries were not written after every retry";
  return { entries, kept, written, alreadyThere, salted, blocked, pending, reason: pending > 0 ? reason : null, state: snapshot(progress, salts), done: pending === 0 };
}
