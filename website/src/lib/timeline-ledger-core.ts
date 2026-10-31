// Copyright (c) Argento Computing Inc. All rights reserved. See LICENSE.

/** The pure part of lib/timeline-ledger.ts (see there): batch keys, what accounts for a span of counts, and the
 *  ledger's rows with a reads row in every gap. No I/O, so it is tested on its own. */

export interface TimelineBatchKey { key: string; first: number; last: number; records: number }

export interface ReadsRow {
  kind: "reads";
  /** reads:<epoch>:<from>-<to>, unique among the ledger's rows. */
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
    if (b.first > cursor) return "missing"; // counts no batch holds, below one that does
    if (!complete(b)) return "missing";
    cursor = b.last + 2;
    if (cursor > to) return "recorded";
  }
  return cursor > newest ? "uploading" : "missing";
}

function span(epoch: string, from: number, to: number, batches: readonly TimelineBatchKey[]): ReadsRow | null {
  if (to < from) return null;
  return { kind: "reads", key: `reads:${epoch}:${from}-${to}`, epoch, from, to, count: (to - from) / 2 + 1, state: spanState(from, to, batches) };
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
