// Copyright (c) 2024-2026 Mike Argento. Licensed under the MIT License. See LICENSE.

/**
 * Deterministic bundle contents hash, per docs/BUNDLE-FORMAT.md section 8.
 *
 * The hash is a file-level fixity value with no interpretation of any file:
 *
 *   1. Per entry: e = SHA-256(UTF-8(path) || 0x00 || contentBytes).
 *      Paths cannot contain NUL, so the separator is unambiguous.
 *   2. Sort entries by raw UTF-8 path bytes (unsigned byte-wise comparison,
 *      no locale, no Unicode normalization).
 *   3. contentsHashB64 = base64(SHA-256(concatenated 32-byte entry digests)).
 *
 * The hashed set is every bundle entry except the root manifest.json
 * itself (which cannot cover its own hash). That exclusion is applied by
 * callers; this module hashes exactly what it is given.
 */

import { sha256 } from "@noble/hashes/sha256";

const NUL = new Uint8Array([0]);

/** An in-memory bundle entry for one-shot hashing (producers, tests). */
export interface ContentsHashEntry {
  /** Bundle-root-relative path: "/" separators, no leading "/" or "./". */
  path: string;
  /** Raw content bytes exactly as stored. */
  content: Uint8Array;
}

/** A precomputed per-entry digest, for streaming consumers that hashed content incrementally. */
export interface ContentsHashEntryDigest {
  path: string;
  /** SHA-256(UTF-8(path) || 0x00 || content), 32 bytes. */
  entryDigest: Uint8Array;
}

/**
 * Compute the per-entry digest e = SHA-256(UTF-8(path) || 0x00 || content).
 */
export function computeEntryDigest(path: string, content: Uint8Array): Uint8Array {
  const hasher = sha256.create();
  hasher.update(encodePath(path));
  hasher.update(NUL);
  hasher.update(content);
  return hasher.digest();
}

/**
 * One-shot contents hash over an in-memory entry set.
 *
 * @throws {TypeError} if any path contains a NUL byte.
 */
export function computeContentsHashB64(entries: Iterable<ContentsHashEntry>): string {
  const digests: ContentsHashEntryDigest[] = [];
  for (const entry of entries) {
    digests.push({ path: entry.path, entryDigest: computeEntryDigest(entry.path, entry.content) });
  }
  return combineEntryDigests(digests);
}

/**
 * Combine precomputed per-entry digests into the final contents hash:
 * sort by raw UTF-8 path bytes, concatenate the 32-byte digests, SHA-256,
 * base64-standard encode.
 */
export function combineEntryDigests(entries: Iterable<ContentsHashEntryDigest>): string {
  const withPathBytes = Array.from(entries, (entry) => ({
    pathBytes: encodePath(entry.path),
    entryDigest: entry.entryDigest,
  }));
  withPathBytes.sort((a, b) => compareBytes(a.pathBytes, b.pathBytes));

  const outer = sha256.create();
  for (const entry of withPathBytes) {
    outer.update(entry.entryDigest);
  }
  return Buffer.from(outer.digest()).toString("base64");
}

function encodePath(path: string): Uint8Array {
  if (path.includes("\0")) {
    throw new TypeError("bitgraph-audit: bundle entry paths must not contain NUL bytes");
  }
  return new TextEncoder().encode(path);
}

function compareBytes(a: Uint8Array, b: Uint8Array): number {
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i++) {
    const d = (a[i] as number) - (b[i] as number);
    if (d !== 0) return d;
  }
  return a.length - b.length;
}
