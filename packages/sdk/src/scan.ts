// Copyright (c) 2025-2026 Argento Computing Inc. Licensed under the MIT License. See LICENSE.

/**
 * The scan: one streamed pass over each file for its SHA-256 and whether it
 * carries Content Credentials (C2PA). Files are read here and never uploaded.
 */

import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { readdir, stat } from "node:fs/promises";
import { basename, join } from "node:path";
import type { ByteSource } from "@mikeargento/bitgraph-verify";

/** A file on disk as a verifier source: its size now, its bytes streamed from a fresh read each time. */
export async function fileSource(path: string): Promise<ByteSource> {
  const info = await stat(path);
  if (!info.isFile()) throw new TypeError(`${path} is not a regular file`);
  return {
    size: info.size,
    async *stream() {
      for await (const chunk of createReadStream(path)) yield chunk as Uint8Array;
    },
  };
}

export interface ScannedFile {
  path: string;
  name: string;
  size: number;
  /** SHA-256 of the file, standard base64. */
  digestB64: string;
  /** True when the bytes carry what looks like a C2PA manifest (Content Credentials). */
  c2pa: boolean;
}

/**
 * Content Credentials detection, structural and cheap: a C2PA manifest lives
 * in a JUMBF box whose description ("jumd") is followed within a few bytes by
 * the store label "c2pa", in every container (JPEG APP11, PNG caBX, ISO BMFF).
 * Requiring the pair in order and near each other keeps a stray "c2pa" in
 * prose from counting. Detection, not judgment: the proof page parses and
 * displays the manifest itself.
 */
const JUMD = Buffer.from("jumd", "ascii");
const C2PA_LABEL = Buffer.from("c2pa", "ascii");
const C2PA_NEAR = 96;

function windowHasC2pa(buf: Buffer): boolean {
  for (let i = buf.indexOf(JUMD); i !== -1; i = buf.indexOf(JUMD, i + 1)) {
    const from = i + JUMD.length;
    const to = Math.min(buf.length, i + C2PA_NEAR);
    if (buf.subarray(from, to).indexOf(C2PA_LABEL) !== -1) return true;
  }
  return false;
}

class C2paSniffer {
  found = false;
  /** The last C2PA_NEAR + 4 bytes of the previous chunk, so a pair split across chunks is seen whole. */
  private carry: Buffer = Buffer.alloc(0);
  update(chunk: Buffer): void {
    if (this.found) return;
    const buf = this.carry.length > 0 ? Buffer.concat([this.carry, chunk]) : chunk;
    if (windowHasC2pa(buf)) {
      this.found = true;
      return;
    }
    const keep = Math.min(buf.length, C2PA_NEAR + JUMD.length);
    this.carry = Buffer.from(buf.subarray(buf.length - keep));
  }
}

/** One-shot form for bytes already in memory (a carrier's committed bytes). */
export function sniffC2paBytes(bytes: Uint8Array): boolean {
  return windowHasC2pa(Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength));
}

/** Hash one file in a single pass. Throws, before any network call, when the path is not a regular file. */
export async function scanFile(path: string): Promise<ScannedFile> {
  const info = await stat(path);
  if (!info.isFile()) throw new Error(`Not a regular file: ${path}`);
  const hash = createHash("sha256");
  const sniffer = new C2paSniffer();
  for await (const raw of createReadStream(path)) {
    const chunk = raw as Buffer;
    hash.update(chunk);
    sniffer.update(chunk);
  }
  return { path, name: basename(path), size: info.size, digestB64: hash.digest("base64"), c2pa: sniffer.found };
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
    if (files.length > limit) throw new Error(`more than ${limit} files; record fewer at a time`);
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
    throw new Error(`Could not read ${failures.length} path(s); nothing was made.\n${failures.join("\n")}\nUse absolute paths to existing regular files or directories.`);
  }
  return { files, directories };
}
