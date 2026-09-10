// Copyright (c) Mike Argento. All rights reserved. See LICENSE.

/**
 * The index: what this folder has already recorded.
 *
 * ⚠️ AN INDEX, NEVER THE AUTHORITY. The .bitgraph files are. Deleting this
 * costs a rescan and nothing else, and every answer it gives can be rebuilt
 * from the folder. Nothing here is ever shown to anyone as evidence.
 *
 * ⚠️ IT EXISTS SO A WATCHER DOES NOT RE-MINT, NOT TO STOP ANYONE MAKING A
 * SECOND BITGRAPH. Mike, 2026-09-08: losing dedup is a correction, because a
 * clock that ticks when you ask should tick every time you ask. A filesystem
 * fires several events for one saved file and each of them would otherwise
 * consume a position. An explicit "again" ignores this file entirely.
 */

import { appendFile, mkdir, open, readFile, rename, stat } from "node:fs/promises";
import { dirname, join, basename } from "node:path";
import { INDEX_FILE, FORMER_INDEX_FILE } from "./paths.js";

export const INDEX_ROW_VERSION = "bitgraph-index/1";

export interface IndexRow {
  v: typeof INDEX_ROW_VERSION;
  /** SHA-256 of the original bytes. The key: matching is by content. */
  originDigestB64: string;
  artifactDigestB64: string;
  /** Advisory. The name it had when it was recorded; it may have been renamed since. */
  name: string;
  /** Advisory. Where it sat in the folder when it was recorded, POSIX-separated. */
  rel: string;
  bytes: number;
  /**
   * The file's modification time when it was recorded.
   *
   * ⚠️ A CACHE KEY, NEVER EVIDENCE. It exists so a sweep over a folder of
   * 48,000 recorded files does not re-hash all 48,000 to learn there is
   * nothing to do. A file whose size and mtime both match a row is left alone;
   * anything else is hashed and decided on its bytes. Every filesystem write
   * moves mtime, so the only way past this filter is to restore an old
   * timestamp deliberately, and the periodic check reads bytes regardless.
   */
  mtimeMs: number;
  placement: string;
  epochId: string;
  counter: string;
  /** The evidence file, POSIX-relative to the BitGraphs folder. */
  evidence: string;
  set: "set/1" | "set/2" | null;
  /** This member's row in the committed manifest, when it is a member. */
  manifestIndex?: number;
  /** The recording folder this file went into, relative to the library. */
  bundle?: string;
  /**
   * The folder it was dropped or synced from.
   *
   * ⚠️ Advisory, and the only reason it exists is the panel: with one library
   * there is no such thing as a folder's own count any more, so a synced
   * folder can only say what came out of IT by the library remembering where
   * each recording came from. Never used to find anything.
   */
  from?: string;
  /** This machine's clock. Not evidence. */
  recordedAt: string;
}

export class FolderIndex {
  readonly path: string;
  private readonly byOrigin = new Map<string, IndexRow[]>();
  private readonly byPath = new Map<string, IndexRow>();
  private readonly positionKeys = new Set<string>();
  /** Lines that did not parse. Reported, never silently dropped: a count the reader can act on. */
  readonly damagedLines: number;

  private constructor(path: string, rows: IndexRow[], damagedLines: number) {
    this.path = path;
    this.damagedLines = damagedLines;
    for (const r of rows) this.remember(r);
  }

  static async open(path: string): Promise<FolderIndex> {
    let text = "";
    try {
      text = await readFile(path, "utf8");
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw err;
      /* A library from before the index was a dotfile: carried over, once. */
      const former = join(dirname(path), FORMER_INDEX_FILE);
      if (basename(path) === INDEX_FILE && await stat(former).then(() => true).catch(() => false)) {
        await rename(former, path);
        text = await readFile(path, "utf8").catch(() => "");
      }
    }
    const rows: IndexRow[] = [];
    let damaged = 0;
    for (const line of text.split("\n")) {
      if (line.trim() === "") continue;
      const row = parseRow(line);
      /* ⚠️ A torn final line is the ordinary consequence of a crash mid-append,
       * not corruption to panic about. It is counted, and the rows before it
       * stand. */
      if (row === null) damaged++;
      else rows.push(row);
    }
    return new FolderIndex(path, rows, damaged);
  }

  private remember(r: IndexRow): void {
    const existing = this.byOrigin.get(r.originDigestB64);
    if (existing === undefined) this.byOrigin.set(r.originDigestB64, [r]);
    else existing.push(r);
    if (typeof r.rel === "string") this.byPath.set(r.rel, r);
    this.positionKeys.add(`${r.epochId} ${r.counter}`);
  }

  /** Has this folder recorded these exact bytes before? */
  has(originDigestB64: string): boolean {
    return this.byOrigin.has(originDigestB64);
  }

  /** Every time these bytes were recorded, oldest first. A file may hold several positions. */
  rowsFor(originDigestB64: string): readonly IndexRow[] {
    return this.byOrigin.get(originDigestB64) ?? [];
  }

  get fileCount(): number {
    let n = 0;
    for (const rows of this.byOrigin.values()) n += rows.length;
    return n;
  }

  /** Every row, in the order they were written. What the anchor pass walks. */
  get rows(): IndexRow[] {
    return [...this.byOrigin.values()].flat();
  }

  /** What came out of one folder: files, and the recordings they went into. */
  fromFolder(path: string): { files: number; recordings: number } {
    let files = 0;
    const bundles = new Set<string>();
    for (const row of this.rows) {
      if (row.from !== path) continue;
      files++;
      if (row.bundle !== undefined) bundles.add(row.bundle);
    }
    return { files, recordings: bundles.size };
  }

  /** Every distinct position this folder holds, as `${epochId} ${counter}`. What the anchor pass walks. */
  get positions(): ReadonlySet<string> {
    return this.positionKeys;
  }

  /** Every distinct position, split back out. */
  get positionList(): Array<{ epochId: string; counter: string }> {
    return [...this.positionKeys].map((k) => {
      const at = k.lastIndexOf(" ");
      return { epochId: k.slice(0, at), counter: k.slice(at + 1) };
    });
  }

  /**
   * Is this exact path already on record at exactly these bytes?
   *
   * ⚠️ The question a re-drop asks about every single file. Answering it from
   * memory is the difference between doing nothing and doing 30,000 file
   * writes for a folder that is already completely recorded.
   */
  recordedAt(rel: string, originDigestB64: string): boolean {
    return this.byPath.get(rel)?.originDigestB64 === originDigestB64;
  }

  /**
   * Has this exact path, at this exact size and mtime, already been dealt
   * with? A cache question, answered by name; whether the BYTES are recorded
   * is a different question and is answered by hashing them.
   */
  settled(rel: string, bytes: number, mtimeMs: number): boolean {
    const row = this.byPath.get(rel);
    return row !== undefined && row.bytes === bytes && row.mtimeMs === mtimeMs;
  }

  /**
   * Append rows and flush them to the platter before returning.
   *
   * The caller has already written the evidence; this is the cheap
   * reconstruction of what the folder holds. It is still fsynced, because an
   * index that lost its last hour looks exactly like a folder that never
   * recorded that hour, and the watcher would re-mint every one of those files.
   */
  async append(rows: readonly IndexRow[]): Promise<void> {
    if (rows.length === 0) return;
    await mkdir(dirname(this.path), { recursive: true });
    await appendFile(this.path, rows.map((r) => JSON.stringify(r)).join("\n") + "\n", "utf8");
    const fh = await open(this.path, "r");
    try {
      await fh.sync();
    } finally {
      await fh.close();
    }
    for (const r of rows) this.remember(r);
  }
}

function parseRow(line: string): IndexRow | null {
  let v: unknown;
  try {
    v = JSON.parse(line);
  } catch {
    return null;
  }
  if (v === null || typeof v !== "object" || Array.isArray(v)) return null;
  const r = v as Partial<IndexRow>;
  if (r.v !== INDEX_ROW_VERSION) return null;
  if (typeof r.originDigestB64 !== "string" || typeof r.epochId !== "string" || typeof r.counter !== "string") return null;
  return r as IndexRow;
}
