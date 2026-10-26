// Copyright (c) Argento Computing Inc. All rights reserved. See LICENSE.

/**
 * A photo's Content Credentials (its C2PA manifest store), bound in the photo's own BitGraph as one more file beside
 * it, `<photo>.c2pa`, so a copy's pointer can show who made the original without the original on hand.
 *
 * A copy shows those credentials only when the manifest's own signed thumbnail matches the copy (align.ts): the
 * signature covers the thumbnail, so credentials taken from another picture cannot pass. A manifest with no thumbnail
 * is never shown for a copy; with the original on hand, the proof page checks the credentials against its exact bytes
 * as before. A manifest that records a location is never published.
 *
 * The store is read out of the file as it is: JPEG keeps it in APP11 segments (JUMBF packets, each after the first
 * repeating the box header), PNG in a caBX chunk. Other formats carry no leaf.
 */

const JPEG_APP11 = 0xeb;

function fromJpeg(b: Uint8Array): Uint8Array | null {
  const parts: Uint8Array[] = [];
  let i = 2, first = true;
  while (i + 4 <= b.length && b[i] === 0xff) {
    const m = b[i + 1]!;
    if (m === 0xda || m === 0xd9) break; // the image data, or the end
    const len = (b[i + 2]! << 8) | b[i + 3]!;
    // APP11 "JP": instance (2 bytes), packet sequence (4), then box bytes
    if (m === JPEG_APP11 && b[i + 4] === 0x4a && b[i + 5] === 0x50) {
      let payload = b.subarray(i + 12, i + 2 + len);
      if (!first) {
        // a later packet repeats LBox and TBox, and XLBox when LBox is 1
        const lbox = (payload[0]! << 24) | (payload[1]! << 16) | (payload[2]! << 8) | payload[3]!;
        payload = payload.subarray(lbox === 1 ? 16 : 8);
      }
      parts.push(payload);
      first = false;
    }
    i += 2 + len;
  }
  return join(parts);
}

function fromPng(b: Uint8Array): Uint8Array | null {
  let i = 8;
  while (i + 12 <= b.length) {
    const len = ((b[i]! << 24) | (b[i + 1]! << 16) | (b[i + 2]! << 8) | b[i + 3]!) >>> 0;
    const type = String.fromCharCode(b[i + 4]!, b[i + 5]!, b[i + 6]!, b[i + 7]!);
    if (type === "caBX") return b.slice(i + 8, i + 8 + len);
    if (type === "IEND") break;
    i += 12 + len;
  }
  return null;
}

function join(parts: Uint8Array[]): Uint8Array | null {
  if (parts.length === 0) return null;
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let o = 0;
  for (const p of parts) { out.set(p, o); o += p.length; }
  // a manifest store is a JUMBF superbox
  return out.length > 8 && String.fromCharCode(out[4]!, out[5]!, out[6]!, out[7]!) === "jumb" ? out : null;
}

/** The C2PA manifest store embedded in a photo's bytes, exactly as stored, or null. */
export function manifestStoreOf(bytes: Uint8Array): Uint8Array | null {
  if (bytes[0] === 0xff && bytes[1] === 0xd8) return fromJpeg(bytes);
  if (bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) return fromPng(bytes);
  return null;
}

export const C2PA_SUFFIX = ".c2pa";
export const MAX_MANIFEST_BYTES = 2_000_000;
