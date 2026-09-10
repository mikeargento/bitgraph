// Copyright (c) Mike Argento. All rights reserved. See LICENSE.

/**
 * Reading a file once.
 *
 * The browser reads a file into memory to build the fused bytes, which is why
 * it stops fusing at MAX_FUSE_BYTES (256 MB) and silently falls back to a
 * digest-only recording past it. Nothing here holds a file's bytes.
 *
 * The trick is not ours: the placements were built for it. A placement's
 * `frame()` answers the bytes AROUND the original, such that the fused bytes
 * are exactly prefix, original, suffix, and `scanPrefix()` answers the prefix
 * when it depends on the original's size alone and so can be hashed before
 * any slot exists. trailer/1 has no prefix at all. container/2 puts the
 * original FIRST behind a fixed-size tar header, deliberately, and its own
 * comment says why: "so a scanner can hash it once and finish the fused
 * digest later".
 *
 * So one pass over the bytes feeds two hashers, and both are finished later:
 *
 *   origin  = sha256(original)                      known at scan time
 *   fused   = sha256(prefix, original, suffix)      finished once the slot is held
 *
 * ⚠️ These use node:crypto, not the WASM hasher the site uses. On 2026-09-07
 * building a WASM hasher per file cost 85.3 s of pure set-up on a 48,000 file
 * drop. This is the platform's, hardware-accelerated, and constructed per
 * file for the price of an object.
 */

import { createHash, type Hash } from "node:crypto";
import { open, type FileHandle } from "node:fs/promises";
import { placementForBytes } from "@mikeargento/bitgraph";
import { getPlacement, type PlacementId } from "@mikeargento/bitgraph-verify";

/** 1 MiB. Large enough that syscall overhead disappears, small enough to stay out of the way. */
const CHUNK = 1 << 20;

/** How many bytes a placement decision looks at. placementForBytes reads at most 14. */
const SNIFF = 32;

export interface ScannedFile {
  path: string;
  name: string;
  /** Where the file sits inside the folder being watched, POSIX-separated. Decides where its evidence goes. */
  rel: string;
  bytes: number;
  /** Last modified, from the filesystem. A convenience for reading a folder, never evidence. */
  modifiedAt: Date;
  /** Chosen from the bytes, never the name. */
  placement: "trailer/1" | "container/2";
  /** SHA-256 of the original bytes, exactly as they are on disk. */
  originDigest: Uint8Array;
  /**
   * The fused digest, once the slot's commitment is known. Reads nothing: the
   * hash state was saved mid-file and is finished with the placement's suffix.
   */
  fusedDigest(commitment: Uint8Array): Uint8Array;
}

/**
 * Hash a file once and keep enough state to answer its fused digest later.
 *
 * ⚠️ Refuses a file that changed underneath the read. A folder being watched
 * is precisely where a file is still being written, and a digest taken across
 * a half-written file is a permanent position for bytes that never existed.
 */
export async function scanFile(path: string, rel?: string): Promise<ScannedFile> {
  const fh = await open(path, "r");
  try {
    return await scanOpen(fh, path, rel);
  } finally {
    await fh.close();
  }
}

/**
 * ⚠️ ONE OPEN, AND NO STREAM FOR A SMALL FILE.
 *
 * The first version of this opened the file to sniff its placement, opened it
 * again as a ReadableStream to hash it, and stat'd it twice around all that:
 * four round trips and a stream object for a 130 byte note. On 30,000 of them
 * that was ten seconds of pure set-up, which is the same mistake as building a
 * WASM hasher 48,000 times (2026-09-07) wearing different clothes.
 *
 * Now: one handle, one fstat, and for anything that fits in a single chunk one
 * read. A big file still streams from the same handle, because that is what
 * streaming is for.
 */
async function scanOpen(fh: FileHandle, path: string, rel?: string): Promise<ScannedFile> {
  const before = await fh.stat();
  if (!before.isFile()) throw new Error(`not a file: ${path}`);
  const size = before.size;

  const origin = createHash("sha256");
  let head: Uint8Array;
  let streamed = false;

  if (size <= CHUNK) {
    const buf = Buffer.allocUnsafe(size);
    let read = 0;
    while (read < size) {
      const { bytesRead } = await fh.read(buf, read, size - read, read);
      if (bytesRead === 0) break;
      read += bytesRead;
    }
    if (read !== size) throw new Error(`${path} ended early; nothing was recorded`);
    head = new Uint8Array(buf.subarray(0, Math.min(SNIFF, size)));
    origin.update(buf);
  } else {
    const sniff = Buffer.allocUnsafe(Math.min(SNIFF, size));
    await fh.read(sniff, 0, sniff.length, 0);
    head = new Uint8Array(sniff);
    streamed = true;
  }

  const placement = placementForBytes(head);
  const p = getPlacement(placement);
  if (p === undefined) throw new Error(`placement ${placement} is not registered`);

  /* The fused hasher is the origin hasher itself when the prefix is empty
   * (trailer/1): one pass, one hasher, no second sha256 over the same bytes. */
  const prefix = p.scanPrefix?.(size) ?? null;
  const shared = prefix === null || prefix.length === 0;

  let fused: Hash;
  if (streamed) {
    fused = shared ? origin : createHash("sha256").update(prefix!);
    const buf = Buffer.allocUnsafe(CHUNK);
    let at = 0;
    while (at < size) {
      const { bytesRead } = await fh.read(buf, 0, Math.min(CHUNK, size - at), at);
      if (bytesRead === 0) break;
      const slice = buf.subarray(0, bytesRead);
      origin.update(slice);
      if (!shared) fused.update(slice);
      at += bytesRead;
    }
    if (at !== size) throw new Error(`${path} ended early; nothing was recorded`);
  } else if (shared) {
    fused = origin;
  } else {
    /* A small container/2 file: the prefix goes in front of bytes already in
     * hand, so the second hasher is built once and fed once. */
    const buf = Buffer.allocUnsafe(size);
    let read = 0;
    while (read < size) {
      const { bytesRead } = await fh.read(buf, read, size - read, read);
      if (bytesRead === 0) break;
      read += bytesRead;
    }
    fused = createHash("sha256").update(prefix!).update(buf.subarray(0, read));
  }

  /* ⚠️ Refuses a file that changed underneath the read. A folder being watched
   * is precisely where a file is still being written, and a digest taken
   * across a half-written file is a permanent position for bytes that never
   * existed. */
  const after = await fh.stat();
  if (after.size !== size || after.mtimeMs !== before.mtimeMs) {
    throw new Error(`${path} changed while it was being read; nothing was recorded`);
  }

  const originDigest = digestOf(origin);
  const relPath = (rel ?? basenameOf(path)).split("\\").join("/");
  return {
    path,
    name: basenameOf(relPath),
    rel: relPath,
    bytes: size,
    modifiedAt: before.mtime,
    placement,
    originDigest,
    fusedDigest: (commitment) => {
      if (!(commitment instanceof Uint8Array) || commitment.length !== 32) throw new Error("a slot commitment is 32 bytes");
      if (p.frame === undefined) throw new Error(`placement ${placement} cannot be streamed: it answers no frame`);
      const { prefix: framePrefix, suffix } = p.frame({ originalSize: size, originDigest, commitment });
      /* The prefix the scan hashed and the prefix the frame names must agree,
       * or the digest below is for bytes nobody will ever hold. */
      const scanned = shared ? new Uint8Array(0) : prefix!;
      if (!equal(framePrefix, scanned)) throw new Error(`placement ${placement} framed a prefix the scan did not hash`);
      return digestOf(fused.copy().update(suffix));
    },
  };
}

/**
 * Read many files, a few at a time.
 *
 * ⚠️ HASHING IS WAITING ON A DISK, NOT ON A CPU. One file at a time leaves an
 * SSD idle between every read; a handful in flight keeps it busy. The results
 * come back in the caller's order regardless, because a set's member order is
 * the caller's until the manifest sorts it.
 */
export async function scanAll(
  files: readonly { path: string; rel: string }[],
  onDone?: (done: number, total: number) => void,
  concurrency = 16,
): Promise<ScannedFile[]> {
  const out = new Array<ScannedFile>(files.length);
  let next = 0;
  let done = 0;
  const workers = Array.from({ length: Math.min(concurrency, files.length) }, async () => {
    for (;;) {
      const i = next++;
      if (i >= files.length) return;
      const f = files[i]!;
      out[i] = await scanFile(f.path, f.rel);
      done++;
      onDone?.(done, files.length);
    }
  });
  await Promise.all(workers);
  return out;
}

/** The digest without consuming the hasher: every caller here finishes more than once. */
function digestOf(h: Hash): Uint8Array {
  return new Uint8Array(h.copy().digest());
}

async function readHead(path: string, n: number): Promise<Uint8Array> {
  if (n === 0) return new Uint8Array(0);
  const fh = await open(path, "r");
  try {
    const buf = Buffer.allocUnsafe(n);
    const { bytesRead } = await fh.read(buf, 0, n, 0);
    return new Uint8Array(buf.subarray(0, bytesRead));
  } finally {
    await fh.close();
  }
}

function equal(a: Uint8Array, b: Uint8Array): boolean {
  return a.length === b.length && a.every((v, i) => v === b[i]);
}

function basenameOf(p: string): string {
  const i = Math.max(p.lastIndexOf("/"), p.lastIndexOf("\\"));
  return i === -1 ? p : p.slice(i + 1);
}

export type { PlacementId };
