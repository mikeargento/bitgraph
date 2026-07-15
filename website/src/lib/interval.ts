/**
 * Interval markers, client side.
 *
 * A marker is a tiny site-generated text file whose only content that matters
 * is 256 bits of local randomness. Its bytes are the interval's KEY: the first
 * recording opens the interval, and closing requires presenting bytes that
 * hash back to the same digest (possession, not identity). The bytes stay with
 * the user; the ledger only ever holds the digest.
 *
 * The byte format is canonical and generated, never hand-edited: one encoding
 * (UTF-8), LF, fixed field order, trailing newline. A single drifted byte is a
 * different digest, which is why users never author these by hand.
 */

export interface IntervalMarker {
  bytes: Uint8Array;
  digestB64: string;
  fileName: string;
}

const toSafe = (b64: string) => b64.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

export async function generateIntervalMarker(): Promise<IntervalMarker> {
  const nonce = new Uint8Array(32);
  crypto.getRandomValues(nonce);
  const nonceB64 = btoa(String.fromCharCode(...nonce));
  const text = `BITGRAPH INTERVAL v1\nnonce: ${nonceB64}\n`;
  const bytes = new TextEncoder().encode(text);
  const hashBuf = await crypto.subtle.digest("SHA-256", bytes as unknown as BufferSource);
  const digestB64 = btoa(String.fromCharCode(...new Uint8Array(hashBuf)));
  return { bytes, digestB64, fileName: `interval-${toSafe(digestB64).slice(0, 8)}.txt` };
}

/** Hand the key bytes to the user as a file download. */
export function downloadIntervalKey(bytes: ArrayBuffer | Uint8Array, fileName: string) {
  const buf = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  const blob = new Blob([buf as unknown as BlobPart], { type: "text/plain" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = fileName;
  a.click();
  URL.revokeObjectURL(url);
}

/**
 * Possession-verified close: POSTs the raw key bytes; the server hashes,
 * verifies an open interval exists for that digest, commits, and discards the
 * bytes. Returns the close proof + updated interval record.
 */
export async function closeInterval(bytes: ArrayBuffer | Uint8Array): Promise<{
  proof: { commit?: { counter?: string; epochId?: string } };
  interval: unknown;
}> {
  const buf = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  const resp = await fetch("/api/interval/close", {
    method: "POST",
    headers: { "Content-Type": "application/octet-stream" },
    body: buf as unknown as BodyInit,
  });
  const data = await resp.json().catch(() => ({}));
  if (!resp.ok) throw new Error((data as { error?: string }).error || `Close failed: ${resp.status}`);
  return data;
}
