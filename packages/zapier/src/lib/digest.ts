// Copyright (c) 2024-2026 Mike Argento. Licensed under the MIT License. See LICENSE.

/**
 * Digest encoding and streaming hashes for the Zapier connector.
 *
 * BitGraph uses two base64 forms of the same SHA-256 digest: standard base64
 * with padding inside proof objects and commit requests, URL-safe unpadded
 * base64 in API lookups, S3 keys, and proof page URLs. Automation platforms
 * add a third form: their built-in sha256() helpers emit lowercase hex, so a
 * user who already has a digest is most likely holding hex. All three are
 * accepted on input; the wire form is chosen per call site.
 *
 * This module is the only place in the connector that touches file bytes, and
 * it never retains them: bytes are hashed as they stream through and dropped.
 * The digest is the only thing that reaches BitGraph.
 */

import { createHash } from "node:crypto";

/** Standard base64 to URL-safe unpadded base64. */
export function toUrlSafeB64(b64: string): string {
  return b64.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/**
 * URL-safe base64 to standard base64 with padding. A no-op apart from
 * re-padding when the input is already standard, so it is safe on either form.
 */
export function fromUrlSafeB64(urlSafe: string): string {
  let b64 = urlSafe.replace(/-/g, "+").replace(/_/g, "/");
  while (b64.length % 4 !== 0) b64 += "=";
  return b64;
}

/** True if the string is 64 hex characters, i.e. a hex-encoded SHA-256. */
export function looksLikeHexDigest(s: string): boolean {
  return /^[0-9a-fA-F]{64}$/.test(s.trim());
}

/** True if the string plausibly encodes 32 bytes of SHA-256 in either base64 form. */
export function looksLikeB64Digest(s: string): boolean {
  const normalized = fromUrlSafeB64(s.trim());
  if (!/^[A-Za-z0-9+/]{43}=$/.test(normalized)) return false;
  return Buffer.from(normalized, "base64").length === 32;
}

/**
 * Accept a SHA-256 digest in any form a user or upstream step is likely to
 * hold (hex, standard base64, URL-safe base64) and return the standard base64
 * form the commit API expects. Throws with a message naming the accepted forms
 * rather than a bare validation code, because this error surfaces to someone
 * building a Zap who has never encoded a digest by hand.
 */
export function normalizeDigest(input: string): string {
  const trimmed = input.trim();
  if (looksLikeHexDigest(trimmed)) {
    return Buffer.from(trimmed, "hex").toString("base64");
  }
  if (looksLikeB64Digest(trimmed)) {
    return fromUrlSafeB64(trimmed);
  }
  throw new Error(
    `"${input}" is not a SHA-256 digest. Provide 64 hex characters, or the 32 digest bytes in base64 (standard or URL-safe). ` +
      `Leave the digest field empty to have this step hash the file for you.`
  );
}

/**
 * A hashed file: the digest, plus how many bytes went into it.
 * Byte count is reported so the step's output can show what was hashed
 * without ever exposing the content.
 */
export interface HashedBytes {
  /** Standard base64, the form /api/commit takes. */
  digestB64: string;
  /** URL-safe unpadded base64, the form lookups and proof URLs take. */
  digestUrlSafe: string;
  /** Lowercase hex, the form most automation platforms display. */
  digestHex: string;
  bytes: number;
}

function finish(hash: ReturnType<typeof createHash>, bytes: number): HashedBytes {
  const raw = hash.digest();
  const digestB64 = raw.toString("base64");
  return {
    digestB64,
    digestUrlSafe: toUrlSafeB64(digestB64),
    digestHex: raw.toString("hex"),
    bytes,
  };
}

/**
 * Hard cap on what this connector will hash. A Zapier action is killed at 30
 * seconds, so anything approaching this size fails on the clock long before
 * the limit itself binds; the cap exists so the failure is a clear message
 * instead of an opaque timeout.
 */
export const MAX_FILE_BYTES = 1024 * 1024 * 1024;

/** SHA-256 a byte stream without buffering it. Bytes are hashed and discarded. */
export async function sha256Stream(stream: NodeJS.ReadableStream): Promise<HashedBytes> {
  const hash = createHash("sha256");
  let bytes = 0;
  for await (const chunk of stream) {
    const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk as string);
    bytes += buf.length;
    if (bytes > MAX_FILE_BYTES) {
      throw new Error(
        `File exceeds ${MAX_FILE_BYTES / (1024 * 1024)} MB, which cannot be hashed inside a Zapier step's time limit. ` +
          `Hash the file where it lives and pass the digest to this step instead.`
      );
    }
    hash.update(buf);
  }
  return finish(hash, bytes);
}

/** SHA-256 an in-memory buffer or string. */
export function sha256Buffer(data: Buffer | string): HashedBytes {
  const buf = Buffer.isBuffer(data) ? data : Buffer.from(data, "utf8");
  return finish(createHash("sha256").update(buf), buf.length);
}

/** Present a standard-base64 digest in all three forms, for step output. */
export function digestForms(digestB64: string): Omit<HashedBytes, "bytes"> {
  const raw = Buffer.from(digestB64, "base64");
  return {
    digestB64,
    digestUrlSafe: toUrlSafeB64(digestB64),
    digestHex: raw.toString("hex"),
  };
}
