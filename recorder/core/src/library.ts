// Copyright (c) Mike Argento. All rights reserved. See LICENSE.

/**
 * The ledger: every day that holds recordings, and any one day in full.
 *
 * ⚠️ READ FROM THE FOLDERS, NOT FROM THE INDEX. The recordings are the
 * authority and the index is a convenience; a library restored from a backup,
 * or one whose index was deleted, still lists correctly here because the
 * directory names ARE the listing. The index is only asked for what it alone
 * remembers: which folder a recording came from.
 *
 * ⚠️ TWO READS, because 2,570 recordings is a list nobody scrolls. Mike,
 * 2026-09-09: "lists of days should be expandable ... like drill out from
 * day." The SPINE is every day with how many recordings it holds, one readdir
 * per day and nothing opened. A DAY is read in full, names and stats, only
 * when somebody opens it. Never a proof: a month of recordings is a directory
 * walk, not a thousand JSON parses.
 */

import { readdir, stat } from "node:fs/promises";
import { join } from "node:path";

export interface Recording {
  /** The recording folder. */
  path: string;
  /** `BitGraph (IMG_4021.png)`. */
  name: string;
  /** `2026-09-09`, from the day folder it sits in. */
  day: string;
  /** How many files are in it, proof.json and friends excluded. */
  files: number;
  /**
   * When the recording was written: proof.json's mtime, ISO 8601. This
   * machine's clock, a filing aid, never evidence.
   *
   * ⚠️ THE PROOF'S TIME, NOT THE FOLDER'S. Anchors land in the folder later
   * and move its mtime; the proof is written once.
   */
  writtenAt: string;
  /** True when the recording still has an Ethereum side missing. */
  waitingOnAnchors: boolean;
  /** The folder it was dropped or synced from, when the index remembers. Advisory. */
  from?: string;
}

export interface DayCount {
  /** `2026-09-09`. */
  day: string;
  /** How many recordings the day holds. */
  count: number;
}

/** Files a recording holds that are not the person's own. */
const OURS = new Set(["proof.json", "manifest.json", "members.jsonl", "anchors-status.json", "ethereum-anchors"]);

const DAY = /^\d{4}-\d{2}-\d{2}$/;

/** Every day that holds recordings, newest first, with how many. */
export async function ledger(library: string): Promise<{ days: DayCount[]; total: number }> {
  let dayNames: string[];
  try {
    dayNames = (await readdir(library, { withFileTypes: true }))
      .filter((e) => e.isDirectory() && DAY.test(e.name))
      .map((e) => e.name)
      .sort()
      .reverse();
  } catch {
    return { days: [], total: 0 };
  }
  const days: DayCount[] = [];
  let total = 0;
  for (const day of dayNames) {
    let count = 0;
    try {
      count = (await readdir(join(library, day), { withFileTypes: true })).filter((e) => e.isDirectory()).length;
    } catch {
      continue;
    }
    if (count === 0) continue;
    days.push({ day, count });
    total += count;
  }
  return { days, total };
}

/**
 * One day's recordings, by name.
 *
 * `sources` maps a recording folder (relative to the library, `2026-09-09/
 * BitGraph (x)`) to the folder it came from, which only the index knows.
 */
export async function listDay(library: string, day: string, sources?: Map<string, string>): Promise<Recording[]> {
  if (!DAY.test(day)) return [];
  let names: string[];
  try {
    names = (await readdir(join(library, day), { withFileTypes: true })).filter((e) => e.isDirectory()).map((e) => e.name).sort();
  } catch {
    return [];
  }
  const recordings: Recording[] = [];
  for (const name of names) {
    const path = join(library, day, name);
    const [files, when, waiting] = await Promise.all([
      countFiles(path),
      stat(join(path, "proof.json")).catch(() => stat(path)).then((s) => s.mtime.toISOString()).catch(() => ""),
      stat(join(path, "anchors-status.json")).then(() => true).catch(() => false),
    ]);
    const from = sources?.get(`${day}/${name}`);
    recordings.push({ path, name, day, files, writtenAt: when, waitingOnAnchors: waiting, ...(from !== undefined ? { from } : {}) });
  }
  /* In the order they were made, the way a day reads. */
  recordings.sort((a, b) => a.writtenAt.localeCompare(b.writtenAt) || a.name.localeCompare(b.name));
  return recordings;
}

/** The person's own files inside a recording, at any depth. */
async function countFiles(dir: string, depth = 0): Promise<number> {
  if (depth > 6) return 0;
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return 0;
  }
  let n = 0;
  for (const e of entries) {
    if (depth === 0 && OURS.has(e.name)) continue;
    if (e.isDirectory()) n += await countFiles(join(dir, e.name), depth + 1);
    else n++;
  }
  return n;
}
