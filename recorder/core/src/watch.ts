// Copyright (c) Mike Argento. All rights reserved. See LICENSE.

/**
 * Watching a folder, so making stops being something you remember.
 *
 * Point it at a Lightroom export folder and the product is done: the export
 * finishes, a recording of it appears in the library. That was Mike's framing
 * and it is the whole of step 2.
 *
 * Three things make this harder than it looks, and each one is a bug if it is
 * got wrong:
 *
 * ⚠️ A FILE THAT APPEARS IS STILL BEING WRITTEN. An export folder is exactly
 * where a file exists at zero bytes, then half, then whole. A digest taken
 * across a half-written file is a permanent position for bytes that never
 * existed anywhere. So a file is left alone until its size and mtime have
 * stopped moving, and the hasher refuses anything that changes underneath it.
 *
 * ⚠️ FILES THAT ARRIVE TOGETHER ARE ONE SET. An export of 400 photos is one
 * drop and belongs at one position, not 400. A window of quiet decides
 * "together"; the window restarts whenever anything else lands.
 *
 * ⚠️ THE QUEUE IS NOT A FILE. What is left to do is "every file in the folder
 * that the index has not recorded", which is recomputed by looking, so it
 * cannot go stale, cannot be corrupted, and survives a reboot without being
 * written down. The one thing that genuinely cannot be recomputed is a proof
 * that was minted and could not be written, and that goes to the rescue
 * journal the moment it happens.
 */

import { watch, type FSWatcher } from "node:fs";
import { stat } from "node:fs/promises";
import { join, relative, sep } from "node:path";
import type { FuseTransport } from "@mikeargento/bitgraph";
import { makeFiles, type MakeResult, type SkippedFile, type MakeProgress } from "./make.js";
import { EvidenceWriteError } from "./evidence.js";
import { INDEX_FILE } from "./paths.js";
import { FolderIndex } from "./index-store.js";
import { walk } from "./check.js";
import { rescue } from "./rescue.js";
import { BITGRAPHS_DIR } from "./paths.js";

/** How long a folder must be quiet before what landed in it counts as one drop. */
export const QUIET_MS = 2_000;

/** How long a file's size and mtime must hold still before it is read. */
export const STABLE_MS = 1_500;

/**
 * The most files in one set.
 *
 * Not a protocol limit: set/2 takes a million. It bounds the hash states held
 * at once, since every file in a batch keeps its mid-file hasher alive from
 * the scan until the slot is held. A bigger drop becomes several sets, which
 * is what the site already did with 48,000 files.
 */
export const MAX_BATCH = 20_000;

export type WatchEvent =
  | { kind: "watching"; root: string }
  | { kind: "settling"; root: string; files: number }
  | { kind: "making"; root: string; files: number; progress?: MakeProgress }
  | { kind: "made"; root: string; result: MakeResult }
  | { kind: "skipped"; root: string; files: SkippedFile[] }
  | { kind: "idle"; root: string }
  | { kind: "trouble"; root: string; reason: string; recoverable: boolean; severity: TroubleSeverity };

/**
 * ⚠️ A GAP IS NOT A FAULT, AND THE SURFACE MUST BE ABLE TO TELL THEM APART.
 *
 * `fault`  something is wrong and somebody has to act. A position was consumed
 *          and its evidence did not land; the folder stopped being watched.
 * `gap`    something could not be done and nothing is wrong. The ledger could
 *          not be reached; a make could not finish. Nothing was lost and the
 *          next attempt may simply work.
 *
 * Painting a gap the same colour as a fault is the same overstatement as
 * calling a failed read an absence: it says a thing happened that did not.
 */
export type TroubleSeverity = "fault" | "gap";

export interface WatchOptions {
  transport?: FuseTransport;
  /**
   * Where recordings go.
   *
   * ⚠️ A SYNCED FOLDER IS AN AUTOMATIC DROP. What lands in it is recorded into
   * the library exactly as if it had been dragged onto the box: one recording
   * folder, files hard linked, and NOTHING written into the folder itself.
   * There used to be a second shape here, evidence beside each file, and two
   * shapes in one app is two sets of rules, two things to check, and every
   * seam somebody hits. Mike's ruling, 2026-09-09.
   */
  library: string;
  quietMs?: number;
  stableMs?: number;
  onEvent?: (e: WatchEvent) => void;
  /** Where a proof that could not be written is put instead. Defaults to the app's support folder. */
  rescueDir?: string;
  /** Folders never entered, wherever they sit under the root: the BitGraph folder itself. */
  excluding?: readonly string[];
}

export interface FolderWatcher {
  readonly root: string;
  /** Look now, without waiting for an event. Used on start and on demand. */
  sweep(): Promise<void>;
  close(): void;
  /** True while a make is in flight. */
  readonly busy: boolean;
}

export function watchFolder(root: string, options: WatchOptions): FolderWatcher {
  const quietMs = options.quietMs ?? QUIET_MS;
  const stableMs = options.stableMs ?? STABLE_MS;
  const emit = (e: WatchEvent): void => {
    try {
      options.onEvent?.(e);
    } catch {
      /* a listener never changes the outcome */
    }
  };

  let timer: NodeJS.Timeout | null = null;
  let closed = false;
  let busy = false;
  /* Set while a make is running: anything that lands during it is picked up by
   * the sweep that follows, never dropped. */
  let dirtyDuringMake = false;
  let watcher: FSWatcher | null = null;

  const schedule = (): void => {
    if (closed) return;
    if (timer !== null) clearTimeout(timer);
    timer = setTimeout(() => {
      timer = null;
      void sweep();
    }, quietMs);
  };

  const sweep = async (): Promise<void> => {
    if (closed) return;
    if (busy) {
      dirtyDuringMake = true;
      return;
    }
    busy = true;
    try {
      do {
        dirtyDuringMake = false;
        await once();
      } while (dirtyDuringMake && !closed);
    } finally {
      busy = false;
    }
    emit({ kind: "idle", root });
  };

  const once = async (): Promise<void> => {
    /* ⚠️ Asked of the LIBRARY, which is where recordings are remembered. The
     * folder itself holds nothing now, so it has nothing to ask. */
    const index = await FolderIndex.open(join(options.library, INDEX_FILE));
    const all = await walk(root, { excluding: options.excluding ?? [] });
    /* ⚠️ The filter here is by NAME, and it only drops what this app should
     * never touch. Whether a file is already recorded is a question about its
     * BYTES, and it is answered inside makeFiles once they are hashed: a
     * renamed file must not be recorded twice, and a file whose bytes changed
     * must not be skipped because its name is familiar. */
    const named = all.filter((p) => wanted(root, p));
    const candidates: string[] = [];
    for (const p of named) {
      const s = await sig(p);
      const rel = relative(root, p).split(sep).join("/");
      if (s !== null && index.settled(rel, s.bytes, s.mtimeMs)) continue;
      candidates.push(p);
    }
    if (candidates.length === 0) return;

    emit({ kind: "settling", root, files: candidates.length });
    const settled = await settle(candidates, stableMs);
    if (settled.length === 0) {
      /* Everything is still moving. Come back rather than reading a file
       * mid-write. */
      schedule();
      return;
    }

    for (let i = 0; i < settled.length; i += MAX_BATCH) {
      const batch = settled.slice(i, i + MAX_BATCH);
      emit({ kind: "making", root, files: batch.length });
      try {
        const { made, skipped } = await makeFiles(root, batch, {
          ...(options.transport !== undefined ? { transport: options.transport } : {}),
          bundle: { library: options.library, source: sourceOf(root, batch) },
          /* ⚠️ At most a dozen a second. One event per file is one redraw per
           * file, and a 30,000 file batch spends its time drawing a counter. */
          onProgress: gate((progress) => emit({ kind: "making", root, files: batch.length, progress })),
        });
        if (skipped.length > 0) emit({ kind: "skipped", root, files: skipped });
        if (made !== null) emit({ kind: "made", root, result: made });
      } catch (err) {
        if (err instanceof EvidenceWriteError) {
          /* ⚠️ A POSITION WAS CONSUMED AND ITS EVIDENCE DID NOT LAND. This is
           * the one loss that cannot be recomputed by looking again, so it is
           * put somewhere else immediately and said out loud. */
          const where = await rescue(err, options.rescueDir);
          emit({ kind: "trouble", root, reason: `a BitGraph was made and its recording folder could not be written. The proof is kept at ${where}, and moving it into the Recordings folder is the whole repair.`, recoverable: true, severity: "fault" });
        } else {
          /* Nothing was lost: what is left to record is still "the files the
           * index has not recorded", which the next sweep works out by
           * looking. */
          emit({ kind: "trouble", root, reason: `nothing was recorded this time: ${err instanceof Error ? err.message : String(err)}`, recoverable: true, severity: "gap" });
        }
        return;
      }
    }
  };

  try {
    watcher = watch(root, { recursive: true, persistent: true }, (_event, name) => {
      if (name === null) {
        schedule();
        return;
      }
      const rel = String(name).split(sep).join("/");
      if (rel === BITGRAPHS_DIR || rel.startsWith(`${BITGRAPHS_DIR}/`)) return;
      if (rel.split("/").some((p) => p.startsWith("."))) return;
      schedule();
    });
    watcher.on("error", (err) => emit({ kind: "trouble", root, reason: `the folder stopped being watched: ${err.message}`, recoverable: false, severity: "fault" }));
  } catch (err) {
    emit({ kind: "trouble", root, reason: `the folder could not be watched: ${err instanceof Error ? err.message : String(err)}`, recoverable: false, severity: "fault" });
  }

  emit({ kind: "watching", root });

  return {
    root,
    sweep,
    get busy() {
      return busy;
    },
    close() {
      closed = true;
      if (timer !== null) clearTimeout(timer);
      watcher?.close();
    },
  };
}

/** What to call a recording made from a folder somebody is syncing. */
function sourceOf(root: string, batch: readonly string[]): string {
  if (batch.length === 1) return batch[0]!.split("/").pop() ?? "file";
  return root.split("/").filter(Boolean).pop() ?? "drop";
}

/** Lets a progress hook speak at most every 80ms, plus every phase change and the last call. */
function gate(fn: (p: MakeProgress) => void, everyMs = 80): (p: MakeProgress) => void {
  let last = 0;
  let phase = "";
  return (p) => {
    const now = Date.now();
    if (p.phase !== phase || p.done >= p.total || now - last >= everyMs) {
      last = now;
      phase = p.phase;
      fn(p);
    }
  };
}

/** Files whose size and mtime have held still for long enough to read. */
async function settle(paths: readonly string[], stableMs: number): Promise<string[]> {
  const first = new Map<string, string>();
  for (const p of paths) {
    const s = await sig(p);
    if (s !== null) first.set(p, `${s.bytes}:${s.mtimeMs}`);
  }
  await new Promise((r) => setTimeout(r, stableMs));
  const out: string[] = [];
  for (const [p, before] of first) {
    const s = await sig(p);
    if (s !== null && `${s.bytes}:${s.mtimeMs}` === before) out.push(p);
  }
  return out;
}

async function sig(path: string): Promise<{ bytes: number; mtimeMs: number } | null> {
  try {
    const s = await stat(path);
    return s.isFile() ? { bytes: s.size, mtimeMs: s.mtimeMs } : null;
  } catch {
    return null;
  }
}

/** Files this app leaves alone: its own folder, hidden files, and half-written temporaries. */
function wanted(root: string, path: string): boolean {
  const rel = relative(root, path).split(sep).join("/");
  if (rel.startsWith(`${BITGRAPHS_DIR}/`)) return false;
  const name = rel.split("/").pop() ?? "";
  if (name.startsWith(".")) return false;
  if (name.endsWith(".tmp") || name.endsWith(".part") || name.endsWith(".crdownload") || name.endsWith(".download")) return false;
  if (name.startsWith("~$")) return false;
  return true;
}

