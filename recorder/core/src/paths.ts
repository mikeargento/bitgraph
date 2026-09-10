// Copyright (c) Mike Argento. All rights reserved. See LICENSE.

/**
 * Where the app writes, under a folder it is watching.
 *
 *   Photos 2024/
 *     IMG_4021.CR3                                  never touched, never moved
 *     BitGraphs/
 *       IMG_4021.CR3.bitgraph                       this file's evidence
 *       positions/<epoch>/<counter>/proof.json      the signed proof, ONCE
 *       positions/<epoch>/<counter>/manifest.json   the committed set manifest
 *       positions/<epoch>/<counter>/ethereum-anchors/
 *       positions/<epoch>/<counter>/anchors-status.json
 *       index.json                                  an index, never the authority
 *
 * ⚠️ A POSITION IS (epochId, counter), NEVER THE COUNTER ALONE. The enclave
 * restarts at ~23:59 UTC with a new keypair AND a counter reset, so a folder
 * that accumulates for two days holds two different position 1546s. Every
 * existing anchor path in this codebase is counter-keyed because it was
 * written for a single drop, where one epoch is a safe assumption. A watched
 * folder runs for months and it is not.
 *
 * ⚠️ NOT a dot-folder. Hidden folders defeat backing up and syncing, which is
 * the entire durability story: this exists because the browser's storage is
 * evictable and ordinary files are not.
 */

import { join } from "node:path";

/** The folder evidence accumulates in, beside the files it is about. */
export const BITGRAPHS_DIR = "BitGraphs";

/** Per-position storage: one proof, one manifest, one set of anchors, however many files share them. */
export const POSITIONS_DIR = "positions";

/** The name every existing BitGraph export already uses for a position's anchors. Kept. */
export const ANCHOR_DIR = "ethereum-anchors";

/**
 * The index. Deleting it must cost a rescan and nothing else.
 *
 * ⚠️ Append-only, one JSON object per line. A watched folder records for
 * months: rewriting a whole index file on every make is O(n) per file and
 * O(n^2) over a folder, and a rewrite is also the window in which a crash
 * loses every earlier row. Appending a line costs the same at row 10 and row
 * 100,000, and a torn final line is discarded on read without touching
 * anything before it.
 */
/**
 * ⚠️ A DOTFILE. The index is the app's own bookkeeping, a convenience and
 * never the authority (the day folders are), and it has no business sitting
 * beside somebody's recordings as a mystery document: Mike, 2026-09-09, on
 * the "?" icon Finder gave it. A library made before this is renamed on
 * first open.
 */
export const INDEX_FILE = ".index.jsonl";
/** What the index was called before it was hidden. */
export const FORMER_INDEX_FILE = "index.jsonl";

/** What a file's evidence is called: the whole filename, extension included, plus .bitgraph.
 *
 *  Keeping the extension is deliberate. `IMG_4021.bitgraph` for `IMG_4021.CR3`
 *  would collide with `IMG_4021.JPG`'s evidence the moment anyone exports both,
 *  which is the ordinary case for a photographer. */
export function evidenceNameFor(fileName: string): string {
  return `${fileName}.bitgraph`;
}

/**
 * The BitGraphs folder MIRRORS the folder it watches, so `raw/IMG_4021.CR3`
 * gets `BitGraphs/raw/IMG_4021.CR3.bitgraph`. A flat BitGraphs folder would
 * put `raw/IMG_4021.CR3` and `jpg/IMG_4021.CR3` at the same path and one
 * would overwrite the other.
 *
 * The mirror is a CONVENIENCE, never the binding: evidence is reunited with
 * its file by content, by re-hashing, so renaming a subfolder costs a lookup
 * through the index and nothing more.
 */
export function relativeEvidencePath(relPath: string, carries: EvidenceKind = "inline"): string {
  const parts = relPath.split(/[/\\]/).filter((p) => p !== "" && p !== ".");
  if (parts.length === 0 || parts.includes("..")) throw new Error(`not a path inside the folder: ${JSON.stringify(relPath)}`);
  parts[parts.length - 1] = carries === "inline" ? evidenceNameFor(parts[parts.length - 1]!) : positionNameFor(parts[parts.length - 1]!);
  return parts.join("/");
}

/**
 * What the file beside a photo is, and therefore what it is called.
 *
 * ⚠️ THE NAME SAYS WHAT IS IN IT. Mike opened an `IMG_4007.png.bitgraph`
 * expecting the BitGraph and found a pointer, which is a name doing a bad job.
 *
 *   "inline"  the file IS the BitGraph: a whole signed bitgraph/1 proof, on
 *             its own, because a solo make has nothing to share it with.
 *             Called `.bitgraph`.
 *   "beside"  the proof is SHARED. Every file in a set holds the same one, so
 *             it is stored once under its position and this file names it,
 *             carrying only what is this file's own: its digests, its row, and
 *             for a set/2 the inclusion path that is the ONLY thing putting it
 *             in that set. Called `.position.json`, because that is what it
 *             tells you.
 */
export type EvidenceKind = "inline" | "beside";

export function positionNameFor(fileName: string): string {
  return `${fileName}.position.json`;
}

/**
 * A position as a path segment pair. The epoch id is 32 bytes of standard
 * base64, which carries `+`, `/` and `=`: `/` would silently create a
 * directory level and `=` is awkward in a shell, so it is written base64url
 * without padding. It is a name, not a value anything parses back.
 */
export function positionSegments(epochId: string, counter: string): [string, string] {
  return [toUrlSafe(epochId), sanitizeCounter(counter)];
}

export function toUrlSafe(b64: string): string {
  return b64.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/** A counter is decimal digits. Anything else is refused rather than normalized: it would be a path. */
function sanitizeCounter(counter: string): string {
  if (!/^(0|[1-9][0-9]*)$/.test(counter)) throw new Error(`a counter is decimal digits, got ${JSON.stringify(counter)}`);
  return counter;
}

export interface FolderPaths {
  /** The folder being watched. */
  root: string;
  /** <root>/BitGraphs */
  bitgraphs: string;
  /** <root>/BitGraphs/index.jsonl */
  index: string;
  /** <root>/BitGraphs/<relative path> plus .bitgraph or .position.json */
  evidence(relPath: string, carries?: EvidenceKind): string;
  /** <root>/BitGraphs/positions/<epoch>/<counter> */
  position(epochId: string, counter: string): string;
  /** The position directory as a path relative to the BitGraphs dir, for a reference inside an evidence file. */
  positionRef(epochId: string, counter: string): string;
}

export function pathsFor(root: string): FolderPaths {
  const bitgraphs = join(root, BITGRAPHS_DIR);
  return {
    root,
    bitgraphs,
    index: join(bitgraphs, INDEX_FILE),
    evidence: (relPath, carries) => join(bitgraphs, ...relativeEvidencePath(relPath, carries).split("/")),
    position: (epochId, counter) => join(bitgraphs, POSITIONS_DIR, ...positionSegments(epochId, counter)),
    /* Always POSIX separators: this string is read by whatever opens the
     * evidence file, which may not be this machine. */
    positionRef: (epochId, counter) => [POSITIONS_DIR, ...positionSegments(epochId, counter)].join("/"),
  };
}
