/**
 * Remote MCP endpoint: digest encoding.
 *
 * BitGraph uses two base64 forms for the same SHA-256 digest:
 * standard base64 with padding inside proof objects and commit requests,
 * URL-safe unpadded base64 in API lookups, S3 keys, and proof page URLs.
 *
 * Ported from packages/mcp/src/encoding.ts minus local file hashing: a hosted
 * server has no caller filesystem, so digests are the only currency here.
 */

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
