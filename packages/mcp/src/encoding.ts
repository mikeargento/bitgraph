// Copyright (c) 2024-2026 Mike Argento. Licensed under the MIT License. See LICENSE.

/**
 * @mikeargento/bitgraph-mcp: digest encoding and file hashing.
 *
 * BitGraph uses two base64 forms for the same SHA-256 digest:
 * standard base64 with padding inside proof objects and commit requests,
 * URL-safe unpadded base64 in API lookups, S3 keys, and proof page URLs.
 */

import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";

/** Standard base64 → URL-safe unpadded base64. */
export function toUrlSafeB64(b64: string): string {
  return b64.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/**
 * URL-safe base64 → standard base64 with padding.
 * A no-op (apart from re-padding) when the input is already standard base64,
 * so it is safe to call on either form.
 */
export function fromUrlSafeB64(urlSafe: string): string {
  let b64 = urlSafe.replace(/-/g, "+").replace(/_/g, "/");
  while (b64.length % 4 !== 0) b64 += "=";
  return b64;
}

/** True if the string plausibly encodes 32 bytes of SHA-256 in either base64 form. */
export function looksLikeDigest(s: string): boolean {
  const normalized = fromUrlSafeB64(s.trim());
  if (!/^[A-Za-z0-9+/]{43}=$/.test(normalized)) return false;
  return Buffer.from(normalized, "base64").length === 32;
}

/**
 * SHA-256 of a file's bytes as standard base64.
 * Streams from disk, so file size is not a memory concern. Only this digest
 * ever leaves the machine; file contents are never uploaded.
 */
export async function sha256FileB64(path: string): Promise<string> {
  const info = await stat(path);
  if (!info.isFile()) {
    throw new Error(`Not a regular file: ${path}`);
  }
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(path)) {
    hash.update(chunk as Buffer);
  }
  return hash.digest("base64");
}

/** Run an async mapper over items with bounded concurrency, preserving order. */
export async function mapConcurrent<T, R>(
  items: readonly T[],
  concurrency: number,
  fn: (item: T, index: number) => Promise<R>
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let next = 0;
  async function worker(): Promise<void> {
    while (next < items.length) {
      const index = next++;
      results[index] = await fn(items[index] as T, index);
    }
  }
  const workers = Array.from({ length: Math.min(concurrency, items.length) }, () => worker());
  await Promise.all(workers);
  return results;
}
