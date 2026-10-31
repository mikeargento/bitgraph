// Copyright (c) Argento Computing Inc. All rights reserved. See LICENSE.

/** The pure part of lib/timeline-ledger.ts (see there): batch keys, what accounts for a span of counts, and the
 *  ledger's rows with a reads row in every gap. No I/O, so it is tested on its own. */

export interface TimelineBatchKey {
  key: string;
  first: number;
  last: number;
  records: number;
  /** The enclave host's records not yet uploaded (GET /timeline/recent), standing in for the batch to come. */
  live?: boolean;
}

export interface ReadsRow {
  kind: "reads";
  /** reads:<epoch>:<from>, unique among the ledger's rows, and the same while the newest run grows live. */
  key: string;
  epoch: string;
  /** The payload counts of the first and last record the row stands for (each record also takes the count before). */
  from: number;
  to: number;
  /** How many records: (to - from) / 2 + 1. */
  count: number;
  state: "recorded" | "uploading" | "missing" | "unlisted";
}

export interface TimelineRead {
  counter: number;
  /** The record's digest, standard base64: its proof page's address (with its count and epoch). */
  digestB64?: string;
  kind: "block" | "file" | "genesis";
  chain?: string;
  number?: number;
  recordedMs: number | null;
}

/** timeline/<epoch>/<first>-<last>-<records>.jsonl.gz, or null. */
export function parseBatchKey(prefix: string, key: string): TimelineBatchKey | null {
  if (!key.startsWith(prefix)) return null;
  const m = /^(\d{12})-(\d{12})-(\d+)\.jsonl\.gz$/.exec(key.slice(prefix.length));
  if (!m) return null;
  const first = Number(m[1]), last = Number(m[2]), records = Number(m[3]);
  return last >= first ? { key, first, last, records } : null;
}

const complete = (b: TimelineBatchKey) => b.records === (b.last - b.first) / 2 + 1;

/**
 * What accounts for the records with payload counts from..to (inclusive, step 2), given the epoch's batches.
 * Batches are created per epoch and per minute, in counter order, so they do not overlap.
 */
export function spanState(from: number, to: number, batches: readonly TimelineBatchKey[]): ReadsRow["state"] {
  if (batches.length === 0) return "unlisted";
  const sorted = [...batches].sort((a, b) => a.first - b.first);
  const newest = sorted[sorted.length - 1]!.last;
  let cursor = from;
  for (const b of sorted) {
    if (b.last < cursor) continue;
    if (b.first > to) break;
    // Counts no batch holds, below one that does. Right below the live records it is a batch uploaded between the
    // listing and the live fetch, so the counts are on their way, not lost.
    if (b.first > cursor) return b.live ? "uploading" : "missing";
    // The host's records are still landing: two chains' reads and file binds are journaled side by side, so a count can
    // be bound a moment before it is written. A hole there is in flux; only an uploaded batch can show a count lost.
    if (!complete(b)) return b.live ? "uploading" : "missing";
    cursor = b.last + 2;
    if (cursor > to) return "recorded";
  }
  return cursor > newest ? "uploading" : "missing";
}

function span(epoch: string, from: number, to: number, batches: readonly TimelineBatchKey[]): ReadsRow | null {
  if (to < from) return null;
  return { kind: "reads", key: `reads:${epoch}:${from}`, epoch, from, to, count: (to - from) / 2 + 1, state: spanState(from, to, batches) };
}

/**
 * One epoch's file rows (newest first) with a reads row in every gap between them, and at the ends:
 *   above   "uploaded": from the newest row up to the newest uploaded count; a count: up to just below it (the row
 *           a newer page or the live poll already shows); null: nothing above.
 *   below   a count: down to just above it (0 = the epoch's start); null: nothing below (an older page follows).
 */
export function interleaveEpoch<R extends { counter: string }>(epoch: string, rows: readonly R[], batches: readonly TimelineBatchKey[], opts: { above: number | "uploaded" | null; below: number | null }): Array<R | ReadsRow> {
  const out: Array<R | ReadsRow> = [];
  const counts = rows.map((r) => Number(r.counter));
  const newestShown = counts.length ? counts[0]! : opts.below;
  if (opts.above !== null && newestShown !== null) {
    const top = opts.above === "uploaded" ? batches.reduce((m, b) => Math.max(m, b.last), 0) : opts.above - 2;
    const s = span(epoch, newestShown + 2, top, batches);
    if (s) out.push(s);
  }
  rows.forEach((r, i) => {
    out.push(r);
    const lower = i + 1 < rows.length ? counts[i + 1]! : opts.below;
    if (lower === null) return;
    const s = span(epoch, lower + 2, counts[i]! - 2, batches);
    if (s) out.push(s);
  });
  return out;
}

/**
 * Rows (newest first) with every count of every epoch the page covers accounted for. `covered` is those epochs,
 * newest first: an epoch with block reads but no file row on the page still shows them, in its place. `above` and
 * `below` bound the newest and the oldest covered epoch (below: null when an older page follows); the epochs in
 * between are shown whole, from their start to their newest upload. `belowByEpoch` sets an epoch's own lower bound
 * (the live poll: the row the page already has).
 */
export function interleaveDay<R extends { counter: string; key: string }>(
  rows: readonly R[], covered: readonly string[], batches: Readonly<Record<string, readonly TimelineBatchKey[]>>,
  ends: { above: number | "uploaded" | null; below: number | null }, belowByEpoch: Readonly<Record<string, number>>, epochOf: (key: string) => string,
): Array<R | ReadsRow> {
  const byEpoch = new Map<string, R[]>();
  for (const r of rows) byEpoch.set(epochOf(r.key), [...(byEpoch.get(epochOf(r.key)) ?? []), r]);
  const order = [...covered];
  for (const e of byEpoch.keys()) if (!order.includes(e)) order.push(e);
  const out: Array<R | ReadsRow> = [];
  order.forEach((e, i) => {
    const below = belowByEpoch[e] ?? (i === order.length - 1 ? ends.below : 0);
    out.push(...interleaveEpoch(e, byEpoch.get(e) ?? [], batches[e] ?? [], { above: i === 0 ? ends.above : "uploaded", below }));
  });
  return out;
}

/** The live records (counts after the newest uploaded batch) as one batch-like span, or null when there are none. */
export function liveBatch(epoch: string, counters: readonly number[]): TimelineBatchKey | null {
  if (counters.length === 0) return null;
  const first = Math.min(...counters), last = Math.max(...counters);
  return { key: `live:${epoch}`, first, last, records: new Set(counters).size, live: true };
}
