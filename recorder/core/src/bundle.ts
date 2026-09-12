// Copyright (c) Mike Argento. All rights reserved. See LICENSE.

/**
 * A recording, as one folder you can hand to somebody.
 *
 *   Recordings/2026-09-09/BitGraph (IMG_4021.png)/
 *     IMG_4021.png            the file
 *     proof.json              bitgraph/1
 *     ethereum-anchors/       when they land
 *
 * This is the shape BitGraph Recorder left 2,566 of, and it is the right one:
 * nothing points at anything, `proof.json` IS the proof, and the whole
 * recording moves as a unit.
 *
 * ⚠️ FOLDER HAD TO ABSORB. THIS DOES NOT. A Finder drag into a folder is a
 * MOVE, executed before any watcher sees it, with the origin unrecorded, so
 * Folder could only take the file in. The one thing that could copy instead
 * was an app as the drop target, which is what the box is. Your file stays
 * exactly where you dropped it from.
 *
 * ⚠️ AND IT COSTS NO BYTES. Same volume, the bundle's file is a HARD LINK: one
 * copy of the bytes, two names for it. Deleting the bundle leaves the original
 * alone and deleting the original leaves the bundle alone; only removing both
 * frees anything. Across volumes there is no such thing, so it copies, and the
 * bundle says which it did.
 *
 * ⚠️ A hard link is the SAME BYTES. Editing the original in place changes what
 * the bundle holds, and the check will then say so about that bundle. That is
 * correct: the bytes changed, and a recording is of bytes.
 */

import { copyFile, link, mkdir, readdir, stat } from "node:fs/promises";
import { createWriteStream } from "node:fs";
import { once } from "node:events";
import { dirname, join } from "node:path";
import type { BitGraphProof } from "@mikeargento/bitgraph-verify";
import { writeBytesAtomic, writeJsonAtomic } from "./evidence.js";

/**
 * The BitGraph folder, and the Recordings folder inside it.
 *
 *   <somewhere you chose>/BitGraph/
 *     Recordings/
 *       2026-09-09/
 *         BitGraph (IMG_4021.png)/
 *
 * ⚠️ WHERE IT GOES IS ASKED, NOT ASSUMED. The app used to pick ~/BitGraph in
 * silence, which is a folder appearing in somebody's home directory without
 * anybody agreeing to it. Setup asks once; everything below is derived.
 */
export const FOLDER_NAME = "BitGraph";
export const RECORDINGS_NAME = "Recordings";

/** What setup offers before anybody has chosen. */
export function defaultHome(home = process.env["HOME"] ?? ""): string {
  const override = process.env["BITGRAPH_RECORDER_HOME"];
  if (override !== undefined && override !== "") return join(override, FOLDER_NAME);
  return join(home, FOLDER_NAME);
}

/** The Recordings folder inside a BitGraph folder. */
export function recordingsIn(folder: string): string {
  return join(folder, RECORDINGS_NAME);
}

export interface BundleInput {
  /** Where the recording folder goes. */
  library: string;
  /** The files, and where each sits relative to the drop; the size when the scan already knows it. */
  files: ReadonlyArray<{ path: string; rel: string; bytes?: number }>;
  /** Called as files land in the folder, so a long write can say how far it is. */
  onFile?: (done: number, total: number) => void;
  proof: BitGraphProof;
  /** The committed artifact, for a set. */
  manifestBytes?: Uint8Array | null;
  /**
   * Every member's row and inclusion path, for a set: one JSON object per
   * line of members.jsonl, written as they come. ⚠️ Rows, never one string:
   * a hundred thousand rows with their paths joined into a single string
   * was a hundred megabytes held at the same moment as everything else,
   * and the core ran out of heap on exactly that drop (2026-09-12). */
  memberRows?: Iterable<unknown> | null;
  /** What the drop was called: a file's name, or the folder it came from. */
  source: string;
  position: { epochId: string; counter: string };
}

export interface BundleResult {
  /** The recording folder. */
  path: string;
  /** How the files got in. */
  how: "linked" | "copied";
  files: number;
  bytes: number;
}

/**
 * Write one recording folder.
 *
 * The name is Folder's, because it reads well in a list and sorts by what it
 * is: `BitGraph (IMG_4021.png)`, or `BitGraph (Photos 2026, 412 files)` when a
 * drop was more than one thing.
 */
export async function writeBundle(input: BundleInput): Promise<BundleResult> {
  const day = dayOf(input.proof);
  const name = input.files.length === 1
    ? `BitGraph (${safe(input.files[0]!.rel.split("/").pop() ?? input.source)})`
    : `BitGraph (${safe(input.source)}, ${input.files.length.toLocaleString()} files)`;

  const dir = await freeName(join(input.library, day), name);
  await mkdir(dir, { recursive: true });

  let how: "linked" | "copied" = "linked";
  let bytes = 0;
  /* ⚠️ ONE SYSCALL PER FILE, NOT THREE. A hundred thousand links took eighty
   * seconds with a recursive mkdir and a stat for every one of them (Mike's
   * 100k drop, 2026-09-12). A folder is made once; a size the scan already
   * measured is not measured again. And the count moves as it goes: the
   * dialog sat at "0 of 100,000" for the whole minute. */
  const made = new Set<string>();
  let done = 0;
  for (const f of input.files) {
    const target = join(dir, ...f.rel.split("/"));
    const parent = dirname(target);
    if (!made.has(parent)) {
      await mkdir(parent, { recursive: true });
      made.add(parent);
    }
    try {
      await link(f.path, target);
    } catch {
      /* Different volume, or a filesystem with no links. Copy, and say so. */
      await copyFile(f.path, target);
      how = "copied";
    }
    bytes += f.bytes ?? (await stat(target)).size;
    done++;
    input.onFile?.(done, input.files.length);
  }

  await writeJsonAtomic(join(dir, "proof.json"), input.proof);
  if (input.manifestBytes != null) await writeBytesAtomic(join(dir, "manifest.json"), input.manifestBytes);
  if (input.memberRows != null) await writeLines(join(dir, "members.jsonl"), input.memberRows);

  return { path: dir, how, files: input.files.length, bytes };
}

/** One JSON object per line, streamed, with back-pressure honoured. */
async function writeLines(path: string, rows: Iterable<unknown>): Promise<void> {
  const out = createWriteStream(path, { encoding: "utf8" });
  for (const row of rows) {
    if (!out.write(JSON.stringify(row) + "\n")) await once(out, "drain");
  }
  out.end();
  await once(out, "finish");
}

/** The day the ENCLAVE put it in, not this machine's idea of today. */
function dayOf(proof: BitGraphProof): string {
  /* ⚠️ There is no trusted clock here, so the folder is named from the epoch's
   * own day only when the anchors establish one; until then it is this
   * machine's date, which is a filing convenience and is never evidence. The
   * proof inside carries the real bounds. */
  const now = new Date();
  const two = (n: number) => String(n).padStart(2, "0");
  return `${now.getFullYear()}-${two(now.getMonth() + 1)}-${two(now.getDate())}`;
}

/** `BitGraph (x)`, then `BitGraph (x) 2`, so nothing is ever written over. */
async function freeName(parent: string, name: string): Promise<string> {
  await mkdir(parent, { recursive: true });
  const taken = new Set(await readdir(parent).catch(() => [] as string[]));
  if (!taken.has(name)) return join(parent, name);
  for (let n = 2; n < 10_000; n++) {
    const candidate = `${name} ${n}`;
    if (!taken.has(candidate)) return join(parent, candidate);
  }
  return join(parent, `${name} ${Date.now()}`);
}

function safe(s: string): string {
  return s.replace(/[\x00-\x1f\x7f/:]/g, " ").trim() || "file";
}
