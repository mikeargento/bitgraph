// Copyright (c) 2024-2026 Mike Argento. All rights reserved.

/**
 * Browser-side version minting (bitgraph-versions/1).
 *
 * BYTE PARITY IS THE CONTRACT: the reference parser rejects anything
 * that is not byte-identical to its canonical serialization, so this
 * must produce exactly what packages/titles/src/version.ts produces.
 * A parity test pins this; change either side only against the other.
 *
 * A version is bearer and keyless: no signature, no WebCrypto keys, no
 * storage. Its uniqueness is the salt; its gate is the possession hash
 * (computable only from the work's full bytes, which the proof page
 * holds only after hash-validating a supplied file); its identity is
 * its file digest; its place comes from recording it like any file.
 */

const VERSION_FORMAT = "bitgraph-versions/1";
const POSSESSION_DOMAIN = "bitgraph-pm-possession/1\n";

function toHex(bytes: Uint8Array): string {
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

async function sha256(bytes: Uint8Array): Promise<Uint8Array> {
  return new Uint8Array(await globalThis.crypto.subtle.digest("SHA-256", bytes as BufferSource));
}

export async function mintVersionClient(
  workBytes: Uint8Array,
  body?: string
): Promise<{ bytes: Uint8Array; fileName: string; digestB64: string }> {
  const domain = new TextEncoder().encode(POSSESSION_DOMAIN);
  const joined = new Uint8Array(domain.length + workBytes.length);
  joined.set(domain, 0);
  joined.set(workBytes, domain.length);

  const ordered: Record<string, unknown> = {
    version: VERSION_FORMAT,
    of: `sha256:${toHex(await sha256(workBytes))}`,
  };
  if (body !== undefined && body.length > 0) ordered["body"] = body;
  ordered["salt"] = toHex(globalThis.crypto.getRandomValues(new Uint8Array(16)));
  ordered["possession"] = toHex(await sha256(joined));

  const bytes = new TextEncoder().encode(JSON.stringify(ordered, null, 2) + "\n");
  const digest = await sha256(bytes);
  let s = "";
  for (const b of digest) s += String.fromCharCode(b);
  return { bytes, fileName: "bitgraph-version.json", digestB64: btoa(s) };
}
