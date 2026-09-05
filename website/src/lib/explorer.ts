/** Convert standard base64 to URL-safe base64 */
export function toUrlSafeB64(b64: string): string {
  return b64.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/** Convert URL-safe base64 back to standard base64 */
export function fromUrlSafeB64(urlSafe: string): string {
  let b64 = urlSafe.replace(/-/g, "+").replace(/_/g, "/");
  while (b64.length % 4 !== 0) b64 += "=";
  return b64;
}

/** Truncate a base64 hash for display */
export function truncateHash(hash: string, len = 12): string {
  if (hash.length <= len) return hash;
  return hash.slice(0, len) + "…";
}

/** Format Unix ms timestamp as relative time */
export function relativeTime(unixMs: number): string {
  const now = Date.now();
  const diff = now - unixMs;

  const seconds = Math.floor(diff / 1000);
  if (seconds < 60) return "just now";

  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;

  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;

  const days = Math.floor(hours / 24);
  if (days < 30) return `${days}d ago`;

  const months = Math.floor(days / 30);
  if (months < 12) return `${months}mo ago`;

  return `${Math.floor(months / 12)}y ago`;
}

/** Base64 to hex string */
export function b64ToHex(b64: string): string {
  const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

/**
 * The Ledger row's tag for a proof that is neither an anchor nor an interval:
 * "file", "set of N", or "set" when the count is unreadable. Lives here, in
 * the package-free helpers, so the Ledger's client chunk carries no verifier.
 */
export function setRowLabel(set: number | undefined): string {
  return set === undefined ? "file" : set > 0 ? `set of ${set}` : "set";
}

/** Enforcement tier display label */
export function enforcementLabel(enforcement: string): string {
  switch (enforcement) {
    case "measured-tee":
      return "Hardware Enclave";
    case "hw-key":
      return "Hardware Key";
    case "stub":
      return "Software";
    default:
      return enforcement;
  }
}

/** Enforcement tier color class */
export function enforcementColor(enforcement: string): string {
  switch (enforcement) {
    case "measured-tee":
      return "text-blue-600";
    case "hw-key":
      return "text-blue-600";
    case "stub":
      return "text-yellow-600";
    default:
      return "text-text-tertiary";
  }
}
