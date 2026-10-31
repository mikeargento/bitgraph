// Copyright (c) Argento Computing Inc. All rights reserved. See LICENSE.

/**
 * The daily Base audit: does a UTC day's timeline hold every Base block of that day, one to one, in order, with no
 * gaps, each one the block the real chain has at that height?
 *
 * The day's blocks follow from Base's schedule (block n is stamped genesis + 2n s), so the range is computed, and the
 * chain's own timestamps are checked against it. The reads are the day's bitgraph-block-read/1 records for Base, from
 * every epoch that ran that day. This module judges; the caller fetches (scripts/timeline-audit.ts).
 *
 *   one to one   every canonical block of the day has a read whose hash is the chain's; a block read twice with the
 *                same hash is a repeat (a restart re-reads the block it was binding), reported, not a failure
 *   reorgs       a read whose hash is not the chain's at its height is orphaned. It is allowed when a later read of
 *                the same epoch binds the canonical block at that height (the poller re-reads replacements)
 *   in order     within an epoch, each read is of the block after the one before, except right after an orphan (the
 *                walk back) or a repeat
 *   no gaps      no block of the day without a canonical read
 *   labels       a read's block file must give the chain's number and timestamp for its hash
 */

export interface AuditRead {
  epochId: string;
  /** The read's payload count in its epoch. */
  counter: number;
  number: number;
  hash: string;
  timestamp: number;
}

export interface CanonicalBlock { number: number; hash: string; timestamp: number }

export interface BaseDayReport {
  day: string;
  ok: boolean;
  blocks: { first: number; last: number; expected: number };
  reads: number;
  /** Blocks of the day with no canonical read, as ranges. */
  missing: Array<{ from: number; to: number }>;
  /** Reads off the canonical chain with no canonical re-read after them in their epoch. */
  orphansUnreplaced: AuditRead[];
  /** Reads off the canonical chain that were re-read (reorgs handled as designed). */
  orphansReplaced: number;
  /** Same block, same hash, read more than once. */
  repeats: number;
  /** Reads whose block file names a number or time the chain does not have for that hash. */
  mislabelled: AuditRead[];
  /** Places an epoch skipped ahead or went back without a reason. */
  outOfOrder: Array<{ epochId: string; counter: number; after: number; read: number }>;
  /** Blocks whose chain timestamp is not on Base's schedule (a node answering for another chain, or a schedule change). */
  offSchedule: number[];
  /** Blocks the chain could not be asked about. */
  unchecked: number;
}

import { BASE_MAINNET_GENESIS_TIME as BASE_GENESIS_TIME, BASE_BLOCK_TIME_SECONDS as BASE_BLOCK_SECONDS } from "@mikeargento/bitgraph-verify";

/** The Base blocks stamped within the UTC day. */
export function baseBlocksOfDay(day: string, genesis = BASE_GENESIS_TIME): { first: number; last: number } {
  const start = Date.parse(`${day}T00:00:00Z`) / 1000;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day) || !Number.isFinite(start)) throw new Error(`not a day: ${day}`);
  const first = Math.ceil((start - genesis) / BASE_BLOCK_SECONDS);
  const last = Math.ceil((start + 86_400 - genesis) / BASE_BLOCK_SECONDS) - 1;
  return { first, last };
}

export function auditBaseDay(args: { day: string; reads: readonly AuditRead[]; canonical: ReadonlyMap<number, CanonicalBlock>; genesis?: number }): BaseDayReport {
  const { first, last } = baseBlocksOfDay(args.day, args.genesis);
  const genesis = args.genesis ?? BASE_GENESIS_TIME;
  const inDay = args.reads.filter((r) => r.number >= first && r.number <= last);
  const report: BaseDayReport = {
    day: args.day, ok: false, blocks: { first, last, expected: last - first + 1 }, reads: inDay.length,
    missing: [], orphansUnreplaced: [], orphansReplaced: 0, repeats: 0, mislabelled: [], outOfOrder: [], offSchedule: [], unchecked: 0,
  };

  const canonicalRead = new Set<number>();
  const seen = new Set<string>();
  const isCanonical = (r: AuditRead) => args.canonical.get(r.number)?.hash === r.hash;
  for (const r of inDay) {
    const c = args.canonical.get(r.number);
    if (!c) continue;
    const id = `${r.number}:${r.hash}`;
    if (seen.has(id)) report.repeats++;
    seen.add(id);
    if (c.hash === r.hash) {
      canonicalRead.add(r.number);
      if (c.timestamp !== r.timestamp) report.mislabelled.push(r);
    }
  }
  for (let n = first; n <= last; n++) {
    const c = args.canonical.get(n);
    if (!c) { report.unchecked++; continue; }
    if (c.timestamp !== genesis + BASE_BLOCK_SECONDS * n) report.offSchedule.push(n);
    if (!canonicalRead.has(n)) {
      const prev = report.missing[report.missing.length - 1];
      if (prev && prev.to === n - 1) prev.to = n; else report.missing.push({ from: n, to: n });
    }
  }

  // Per epoch, in counter order: orphans must be re-read; each read follows the one before.
  const byEpoch = new Map<string, AuditRead[]>();
  for (const r of args.reads) {
    const list = byEpoch.get(r.epochId);
    if (list) list.push(r); else byEpoch.set(r.epochId, [r]);
  }
  for (const [epochId, list] of byEpoch) {
    list.sort((a, b) => a.counter - b.counter);
    list.forEach((r, i) => {
      if (r.number < first || r.number > last || !args.canonical.has(r.number)) return;
      if (!isCanonical(r)) {
        const replaced = list.slice(i + 1).some((x) => x.number === r.number && isCanonical(x));
        if (replaced) report.orphansReplaced++; else report.orphansUnreplaced.push(r);
      }
      const prev = list[i - 1];
      if (!prev) return;
      const repeat = prev.number === r.number && prev.hash === r.hash;
      const afterOrphan = args.canonical.has(prev.number) && !isCanonical(prev);
      if (r.number !== prev.number + 1 && !repeat && !(afterOrphan && r.number <= prev.number)) {
        report.outOfOrder.push({ epochId, counter: r.counter, after: prev.number, read: r.number });
      }
    });
  }

  report.ok = report.missing.length === 0 && report.orphansUnreplaced.length === 0 && report.mislabelled.length === 0
    && report.outOfOrder.length === 0 && report.offSchedule.length === 0 && report.unchecked === 0;
  return report;
}

/** The report in a few lines. */
export function formatBaseDayReport(r: BaseDayReport): string {
  const lines = [
    `${r.ok ? "PASS" : "FAIL"}  Base, ${r.day}: blocks ${r.blocks.first}..${r.blocks.last} (${r.blocks.expected}), ${r.reads} reads`,
  ];
  const missingBlocks = r.missing.reduce((n, m) => n + m.to - m.from + 1, 0);
  if (missingBlocks) lines.push(`  missing: ${missingBlocks} blocks in ${r.missing.length} gap(s): ${r.missing.slice(0, 10).map((m) => (m.from === m.to ? `${m.from}` : `${m.from}-${m.to}`)).join(", ")}${r.missing.length > 10 ? ", ..." : ""}`);
  if (r.orphansUnreplaced.length) lines.push(`  orphaned reads never re-read: ${r.orphansUnreplaced.length} (first: block ${r.orphansUnreplaced[0]!.number}, count ${r.orphansUnreplaced[0]!.counter})`);
  if (r.mislabelled.length) lines.push(`  block files the chain contradicts: ${r.mislabelled.length} (first: block ${r.mislabelled[0]!.number})`);
  if (r.outOfOrder.length) lines.push(`  out of order: ${r.outOfOrder.length} (first: count ${r.outOfOrder[0]!.counter} read block ${r.outOfOrder[0]!.read} after ${r.outOfOrder[0]!.after})`);
  if (r.offSchedule.length) lines.push(`  blocks off Base's 2-second schedule: ${r.offSchedule.length}`);
  if (r.unchecked) lines.push(`  blocks the chain could not be asked about: ${r.unchecked}`);
  lines.push(`  reorgs handled (orphan re-read): ${r.orphansReplaced}; repeats after a restart: ${r.repeats}`);
  return lines.join("\n");
}
