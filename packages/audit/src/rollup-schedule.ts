/**
 * When a rollup's blocks are stamped.
 *
 * Base made one block every two seconds through block 53,556,126, so a
 * block's time was genesis + 2 * number and a timestamp named one block.
 * From block 53,556,127 (stamped 1,793,901,601, 2026-11-05 18:00:01 UTC) it
 * makes five blocks a second. A block's timestamp is still whole seconds, so
 * five consecutive blocks share each one: a timestamp names a second, and a
 * block is one of the five in it.
 *
 * Both facts were read from Base itself: blocks 53,556,127 to 53,556,131 are
 * stamped 1,793,901,601 and block 53,556,132 is stamped 1,793,901,602.
 *
 * Nothing here is trusted for what a record proves. The schedule only says
 * when to look and where a batch sits among its neighbours; what is found is
 * then checked by hash.
 */

export interface RollupSchedule {
  l2GenesisTime: number;
  /** Seconds per block before `subSecond` starts, and always for a rollup that has none. */
  blockTime: number;
  /** From `fromBlock`, stamped `fromTime`, each whole second holds `blocksPerSecond` blocks. */
  subSecond?: { fromBlock: number; fromTime: number; blocksPerSecond: number };
}

export const BASE_MAINNET_ROLLUP: RollupSchedule = Object.freeze({
  l2GenesisTime: 1686789347,
  blockTime: 2,
  subSecond: Object.freeze({ fromBlock: 53_556_127, fromTime: 1_793_901_601, blocksPerSecond: 5 }),
});

/** The timestamp the schedule gives block `blockNumber`, in seconds. */
export function timeOfBlock(blockNumber: number, s: RollupSchedule): number {
  const sub = s.subSecond;
  if (sub && blockNumber >= sub.fromBlock) return sub.fromTime + Math.floor((blockNumber - sub.fromBlock) / sub.blocksPerSecond);
  return s.l2GenesisTime + blockNumber * s.blockTime;
}

/** The blocks stamped `timestamp`: the first one and how many. Null when the schedule stamps no block with it. */
export function blocksAt(timestamp: number, s: RollupSchedule): { first: number; count: number } | null {
  const sub = s.subSecond;
  if (sub && timestamp >= sub.fromTime) {
    if (!Number.isInteger(timestamp)) return null;
    return { first: sub.fromBlock + (timestamp - sub.fromTime) * sub.blocksPerSecond, count: sub.blocksPerSecond };
  }
  const n = (timestamp - s.l2GenesisTime) / s.blockTime;
  if (!Number.isInteger(n) || n < 0) return null;
  return { first: n, count: 1 };
}

/** The newest block the schedule has stamped by `timestamp` (the head, by the clock alone). */
export function headAt(timestamp: number, s: RollupSchedule): number {
  const sub = s.subSecond;
  if (sub && timestamp >= sub.fromTime) return sub.fromBlock + (Math.floor(timestamp) - sub.fromTime + 1) * sub.blocksPerSecond - 1;
  return Math.max(0, Math.floor((timestamp - s.l2GenesisTime) / s.blockTime));
}

/**
 * Block numbers for the singular batches of one channel, in the channel's
 * order. A singular batch carries its block's timestamp and its parent's
 * hash, never its number. Where a timestamp names one block the number is
 * read from it. Where it names several, the batches sharing it are counted
 * off in order: a channel holds consecutive blocks, so a second in the
 * middle holds all of its blocks, the channel's last second holds the first
 * of its blocks, and the channel's first second holds the last of its
 * blocks.
 *
 * One case has no answer from the channel alone: every batch shares one
 * second and there are fewer than the second holds. `pin` then places them:
 * the index of a batch already identified by hash, and its block's number.
 * Without it they are counted from the second's first block.
 */
export function numberSingularBatches(timestamps: readonly number[], s: RollupSchedule, pin?: { index: number; number: number }): number[] {
  const out: number[] = [];
  let i = 0;
  while (i < timestamps.length) {
    const t = timestamps[i]!;
    const at = blocksAt(t, s);
    if (!at) throw new TypeError(`batch timestamp ${t} is not on the rollup's schedule`);
    let j = i;
    while (j < timestamps.length && timestamps[j] === t) j++;
    const run = j - i;
    if (run > at.count) throw new TypeError(`${run} batches are stamped ${t}, which holds ${at.count} block${at.count === 1 ? "" : "s"}`);
    const opens = i === 0;
    const closes = j === timestamps.length;
    let offset = 0;
    if (run < at.count) {
      if (!opens && !closes) throw new TypeError(`${run} batches are stamped ${t} in the middle of a channel, which holds ${at.count} blocks`);
      if (opens && !closes) offset = at.count - run;
      else if (opens && closes && pin && pin.index >= i && pin.index < j) {
        offset = pin.number - pin.index - at.first;
        if (offset < 0 || offset + run > at.count) throw new TypeError(`block ${pin.number} is not stamped ${t} on the rollup's schedule`);
      }
    }
    for (let k = 0; k < run; k++) out.push(at.first + offset + k);
    i = j;
  }
  // Counting off is only right for consecutive blocks, so a gap where seconds are shared is refused.
  const shared = s.subSecond?.fromTime ?? Number.POSITIVE_INFINITY;
  for (let k = 1; k < out.length; k++) {
    if (timestamps[k]! >= shared && out[k] !== out[k - 1]! + 1) throw new TypeError(`the batches stamped ${timestamps[k - 1]} and ${timestamps[k]} are not consecutive blocks`);
  }
  return out;
}
