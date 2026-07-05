// Copyright (c) 2024-2026 Mike Argento. Licensed under the MIT License. See LICENSE.

/**
 * bitgraph-core canonical serialization
 *
 * Produces a deterministic, UTF-8 encoded JSON byte sequence from an
 * arbitrary JavaScript value.  The output is used as the signing input
 * for BitGraphProof signatures and must be reproduced identically by any
 * verifier regardless of platform or runtime.
 *
 * Algorithm:
 *   1. Recursively sort object keys lexicographically (Unicode code-point order)
 *   2. Serialize with JSON.stringify (no whitespace)
 *   3. Encode the resulting string as UTF-8
 *
 * Constraints satisfied:
 *   - Deterministic key ordering
 *   - No whitespace variance
 *   - Stable numeric formatting (JSON.stringify uses shortest representation)
 *   - UTF-8 output (TextEncoder default)
 *   - Rejects undefined, functions, and symbols, which have no JSON repr
 *
 * Limitations:
 *   - BigInt is not serializable via JSON.stringify; callers must convert
 *     to string before passing (consistent with the `counter` field type).
 *   - NaN and Infinity serialize as `null` in JSON; callers must validate
 *     numeric fields upstream.
 *   - Object prototype chains are not walked; only own enumerable keys.
 *
 * This module has zero dependencies on other bitgraph-core modules so that it
 * can be used standalone for testing and external verification tooling.
 */

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Serialize `obj` to canonical JSON and return UTF-8 encoded bytes.
 *
 * Throws if `obj` contains values that cannot survive a JSON round-trip
 * without information loss (undefined top-level, functions, symbols, BigInt).
 */
export function canonicalize(obj: unknown): Uint8Array {
  const json = canonicalizeToString(obj);
  return new TextEncoder().encode(json);
}

/**
 * Serialize `obj` to a canonical JSON string.
 * Exposed for debugging and test assertions.
 */
export function canonicalizeToString(obj: unknown): string {
  return JSON.stringify(sortedReplacer(obj));
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/**
 * Recursively produce a value suitable for JSON.stringify that has its
 * object keys sorted lexicographically at every level of nesting.
 *
 * Arrays preserve element order (ordering arrays would change semantics).
 * Primitives are returned as-is.
 */
function sortedReplacer(value: unknown): unknown {
  if (value === null || typeof value !== "object") {
    // Primitive or null: no key ordering needed.
    // Reject types that serialize to undefined in JSON.
    if (typeof value === "undefined") {
      throw new TypeError(
        "bitgraph-core/canonical: undefined values are not serializable to canonical JSON"
      );
    }
    if (typeof value === "function" || typeof value === "symbol") {
      throw new TypeError(
        `bitgraph-core/canonical: ${typeof value} values are not serializable to canonical JSON`
      );
    }
    if (typeof value === "bigint") {
      throw new TypeError(
        "bitgraph-core/canonical: BigInt values are not serializable to canonical JSON; " +
          "convert to string (decimal) before canonicalizing"
      );
    }
    return value;
  }

  if (Array.isArray(value)) {
    // Recurse into elements; preserve order.
    return value.map(sortedReplacer);
  }

  // Plain object: sort own enumerable string keys and recurse.
  const sorted: Record<string, unknown> = {};
  for (const key of Object.keys(value as Record<string, unknown>).sort()) {
    const child = (value as Record<string, unknown>)[key];
    // Skip undefined values (JSON.stringify would omit them anyway,
    // but we skip explicitly to avoid surprising iteration behavior).
    if (typeof child === "undefined") {
      continue;
    }
    sorted[key] = sortedReplacer(child);
  }
  return sorted;
}

// ---------------------------------------------------------------------------
// Utility: constant-time Uint8Array equality
// ---------------------------------------------------------------------------

/**
 * Compare two Uint8Arrays in constant time.
 *
 * Returns true iff `a` and `b` have the same length and identical contents.
 * Resistance against timing side-channels is important when comparing
 * digests and signatures in the verifier.
 *
 * Note: JavaScript runtimes may still optimize this; a native binding would
 * provide stronger guarantees.  For v0.1 this is a reasonable best-effort.
 */
export function constantTimeEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) {
    return false;
  }
  let diff = 0;
  for (let i = 0; i < a.length; i++) {
    // biome-ignore: non-null assertion safe because lengths are equal
    diff |= (a[i] as number) ^ (b[i] as number);
  }
  return diff === 0;
}
