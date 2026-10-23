/** Decode standard base64 to Uint8Array */
export function b64ToBytes(b64: string): Uint8Array<ArrayBuffer> {
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

/**
 * Canonical JSON serialization matching bitgraph-core/canonical.ts.
 * Sorts object keys lexicographically at every level, no whitespace.
 */
export function canonicalize(obj: unknown): Uint8Array<ArrayBuffer> {
  return new TextEncoder().encode(JSON.stringify(sortKeys(obj)));
}

export function sortKeys(value: unknown): unknown {
  if (value === null || typeof value !== "object") return value;
  if (Array.isArray(value)) return value.map(sortKeys);
  const sorted: Record<string, unknown> = {};
  for (const key of Object.keys(value as Record<string, unknown>).sort()) {
    const child = (value as Record<string, unknown>)[key];
    if (typeof child === "undefined") continue;
    sorted[key] = sortKeys(child);
  }
  return sorted;
}
