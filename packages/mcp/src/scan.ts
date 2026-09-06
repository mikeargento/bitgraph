// Copyright (c) 2024-2026 Mike Argento. Licensed under the MIT License. See LICENSE.

/**
 * @mikeargento/bitgraph-mcp: the scan.
 *
 * One pass over each file yields its SHA-256 (the member's origin) and a
 * hasher left open after the placement's prefix and the file's last byte, so
 * the member's fused digest can be finished later, for whatever slot the set
 * is made under, without reading the file again. A placement is prefix,
 * original, suffix (its frame): trailer/1 has no prefix and container/2's is
 * the original's tar header, which depends on the size alone; the suffix
 * carries the commitment and is hashed at BitGraph time. Node's SHA-256 is
 * the platform's own, and a Hash can be copied mid-stream, which is the whole
 * trick: the copy takes the suffix, so no file is read twice or held in
 * memory, and the original is never touched.
 */

import { createHash, type Hash } from "node:crypto";
import { createReadStream } from "node:fs";
import { readdir, stat } from "node:fs/promises";
import { basename, join } from "node:path";
import { placementForBytes } from "@mikeargento/bitgraph";
import { getPlacement } from "@mikeargento/bitgraph-verify";

/** The placements the scan makes: chosen from the bytes by the core, never from the name. */
export type ScanPlacement = "trailer/1" | "container/2";

export interface ScannedFile {
  path: string;
  name: string;
  size: number;
  /** SHA-256 of the file, standard base64: the member's origin. */
  digestB64: string;
  originDigest: Uint8Array;
  placement: ScanPlacement;
  /**
   * The hasher after the placement's prefix and the file's bytes, still open.
   * Null when the file's length changed while it was read: its fused digest
   * then needs the bytes again.
   */
  state: Hash | null;
}

/** Bytes the placement decision reads: every magic number sits in the first 16. */
const SNIFF = 64;

/** Hash one file in a single pass. Throws, before any network call, when the path is not a regular file. */
export async function scanFile(path: string): Promise<ScannedFile> {
  const info = await stat(path);
  if (!info.isFile()) throw new Error(`Not a regular file: ${path}`);
  const size = info.size;
  const origin = createHash("sha256");
  // Held in one object: the closures below assign to it.
  const run: { fused: Hash | null; placement: ScanPlacement | null } = { fused: null, placement: null };
  let head: Buffer | null = null;
  let bytes = 0;
  const start = (p: ScanPlacement) => {
    run.placement = p;
    // A second hasher runs over prefix and bytes when the prefix is not
    // empty; with an empty prefix the origin hasher's own state is the fused state.
    const prefix = getPlacement(p)?.scanPrefix?.(size) ?? null;
    if (prefix !== null && prefix.length > 0) run.fused = createHash("sha256").update(prefix);
  };
  const feed = (chunk: Buffer) => {
    origin.update(chunk);
    if (run.fused !== null) run.fused.update(chunk);
  };
  for await (const raw of createReadStream(path)) {
    const chunk = raw as Buffer;
    if (run.placement === null) {
      head = head === null ? chunk : Buffer.concat([head, chunk]);
      if (head.length >= SNIFF) {
        start(placementForBytes(new Uint8Array(head.subarray(0, SNIFF))));
        feed(head);
        head = null;
      }
    } else {
      feed(chunk);
    }
    bytes += chunk.length;
  }
  if (run.placement === null) {
    // A short file: decide from what there is, then hash it.
    start(placementForBytes(new Uint8Array(head ?? Buffer.alloc(0))));
    if (head !== null) feed(head);
  }
  const placement = run.placement as ScanPlacement;
  const state = bytes !== size ? null : (run.fused ?? origin);
  // When the origin hasher is the state its digest is taken from a copy, so it stays open.
  const digest = state === origin ? origin.copy().digest() : origin.digest();
  return {
    path,
    name: basename(path),
    size,
    digestB64: digest.toString("base64"),
    originDigest: Uint8Array.from(digest),
    placement,
    state,
  };
}

/**
 * A member's fused digest for a slot: the open hasher, copied, finished with
 * the placement's suffix for that slot's commitment. The hash of prefix,
 * original, suffix is exactly the hash of the placement's own build, which
 * a test pins.
 */
export function fusedDigestFor(file: ScannedFile, commitment: Uint8Array): Uint8Array {
  if (file.state === null) throw new Error(`${file.path}: the file changed while it was read`);
  const placement = getPlacement(file.placement);
  if (placement?.frame === undefined) throw new Error(`placement ${file.placement} has no frame`);
  const { suffix } = placement.frame({ originalSize: file.size, originDigest: file.originDigest, commitment });
  return Uint8Array.from(file.state.copy().update(suffix).digest());
}

export interface Expansion {
  /** Regular files in the order given; a directory contributes its files sorted by name, depth first. */
  files: string[];
  /** How many of the inputs were directories. */
  directories: number;
}

/**
 * Paths to files: a regular file is itself; a directory is every regular
 * file under it, recursively, with hidden entries (names starting with a
 * dot) and symbolic links left out. The same file twice is one file. A path
 * that is missing or neither kind, or more than `limit` files in all, throws
 * before any network call; the message names every path that failed.
 */
export async function expandPaths(paths: readonly string[], limit: number): Promise<Expansion> {
  const files: string[] = [];
  const seen = new Set<string>();
  const failures: string[] = [];
  let directories = 0;
  const push = (p: string) => {
    if (seen.has(p)) return;
    seen.add(p);
    files.push(p);
    if (files.length > limit) throw new Error(`more than ${limit} files; BitGraph fewer at a time`);
  };
  const walk = async (dir: string): Promise<void> => {
    const entries = (await readdir(dir, { withFileTypes: true }))
      .filter((e) => !e.name.startsWith("."))
      .sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
    for (const e of entries) {
      const full = join(dir, e.name);
      if (e.isSymbolicLink()) continue;
      if (e.isDirectory()) await walk(full);
      else if (e.isFile()) push(full);
    }
  };
  for (const p of paths) {
    try {
      const info = await stat(p);
      if (info.isDirectory()) {
        directories += 1;
        await walk(p);
      } else if (info.isFile()) {
        push(p);
      } else {
        throw new Error("not a regular file or a directory");
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      if (message.startsWith("more than ")) throw err;
      failures.push(`${p}: ${message}`);
    }
  }
  if (failures.length > 0) {
    throw new Error(`Could not read ${failures.length} path(s); nothing was BitGraphed.\n${failures.join("\n")}\nUse absolute paths to existing regular files or directories.`);
  }
  return { files, directories };
}
