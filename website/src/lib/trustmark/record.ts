// Copyright (c) Argento Computing Inc. All rights reserved. See LICENSE.

/**
 * A photo's fingerprint record: what the original looks like, bound in the original's own BitGraph.
 *
 * Make adds it to the drop's tree as one more file, `<photo>.trustmark.json`, beside the photo. A TrustMark's pointer
 * is checked against it, and a copy is compared with it, only when the record is a member of the very tree the
 * original's proof signs: nobody but whoever made the original can say what the original looks like.
 *
 *   { "format": "bitgraph-trustmark-fingerprint/1", "photo": <SHA-256 of the photo, base64>,
 *     "phash": <16 hex>, "blocks": { "grid": 32, "bits": 4, "values": <1024 hex> } }
 *
 * The record is computed from the decoded photo, the same way every time, so the proof page can compute it again from
 * the file in hand and find its place in the tree by its hash. It is published (made findable from the pointer's
 * position) only when the photo is exported with a TrustMark.
 */

import { GRID, BITS, signature } from "./align.ts";
import { phash } from "./payload.ts";

export const RECORD_FORMAT = "bitgraph-trustmark-fingerprint/1" as const;
export const RECORD_SUFFIX = ".trustmark.json";
/** Photos fingerprinted per drop; a larger drop is recorded as before, and its photos can be made again to carry one. */
export const MAX_FINGERPRINTED = 1000;

export type FingerprintRecord = { format: typeof RECORD_FORMAT; photo: string; phash: string; blocks: { grid: number; bits: number; values: string } };

const PHOTO_TYPES = /^image\/(jpeg|png|webp|heic|heif|avif|bmp|tiff)$/i;
const PHOTO_NAMES = /\.(jpe?g|png|webp|heic|heif|avif|bmp|tiff?)$/i;
/** A file this browser may decode as a photo (GIFs and SVGs are not photos for this purpose). */
export const looksLikePhoto = (f: { name: string; type?: string }) => (f.type ? PHOTO_TYPES.test(f.type) : false) || PHOTO_NAMES.test(f.name);

export type Decoded = { rgba: Uint8ClampedArray; w: number; h: number };

/** The photo's pixels as the browser shows them (orientation applied), or null when this browser cannot open it. */
export async function decodePhoto(blob: Blob): Promise<Decoded | null> {
  let bmp: ImageBitmap;
  try { bmp = await createImageBitmap(blob); } catch { return null; }
  try {
    const c = new OffscreenCanvas(bmp.width, bmp.height), g = c.getContext("2d", { willReadFrequently: true });
    if (!g) return null;
    g.drawImage(bmp, 0, 0);
    return { rgba: g.getImageData(0, 0, bmp.width, bmp.height).data, w: bmp.width, h: bmp.height };
  } finally { bmp.close(); }
}

/** A photo decoded straight to at most `max` pixels on its longer side, by the browser: what a pointer is read from.
 *  Decoding a large photo whole and shrinking it in script held hundreds of MB and the page for seconds, per photo. */
export async function decodeForReading(blob: Blob, max = 1600): Promise<Decoded | null> {
  const size = await naturalSize(blob);
  if (!size) return null;
  const s = max / Math.max(size.w, size.h);
  if (s >= 1) return decodePhoto(blob);
  let bmp: ImageBitmap;
  try { bmp = await createImageBitmap(blob, { resizeWidth: Math.max(1, Math.round(size.w * s)), resizeHeight: Math.max(1, Math.round(size.h * s)), resizeQuality: "high" }); } catch { return null; }
  try {
    const c = new OffscreenCanvas(bmp.width, bmp.height), g = c.getContext("2d", { willReadFrequently: true });
    if (!g) return null;
    g.drawImage(bmp, 0, 0);
    return { rgba: g.getImageData(0, 0, bmp.width, bmp.height).data, w: bmp.width, h: bmp.height };
  } finally { bmp.close(); }
}

/** A picture's size, as shown (its orientation applied), from the browser's own reading of the file: no pixels kept. */
async function naturalSize(blob: Blob): Promise<{ w: number; h: number } | null> {
  if (typeof Image === "undefined") return null;
  const url = URL.createObjectURL(blob);
  try {
    const im = new Image();
    await new Promise<void>((ok, no) => { im.onload = () => ok(); im.onerror = () => no(new Error("unreadable")); im.src = url; });
    return im.naturalWidth && im.naturalHeight ? { w: im.naturalWidth, h: im.naturalHeight } : null;
  } catch { return null; } finally { URL.revokeObjectURL(url); }
}

/** The size a photo's fingerprint is computed at: a 16x16 grid and a 64-bit hash need no more, and a 24-megapixel photo
 *  read whole took about a second each, minutes for a drop of hundreds. Make and the BitGraphed file both use it, so
 *  the record they compute is the same bytes. */
export const RECORD_DECODE = 1024;
export const decodeForRecord = (blob: Blob) => decodeForReading(blob, RECORD_DECODE);

const decoded = new WeakMap<Blob, Promise<Decoded | null>>();
/** decodePhoto, once per file: a drop reads a photo for a pointer and for its fingerprint, from the same pixels. */
export function decodeOnce(blob: Blob): Promise<Decoded | null> {
  let p = decoded.get(blob);
  if (!p) { p = decodePhoto(blob); decoded.set(blob, p); }
  return p;
}
/** Let a photo's decoded pixels go once nothing will read them again: a large photo's pixels are hundreds of MB, and a
 *  drop of twenty kept them all while the drop's files were held. */
export function forgetDecoded(blob: Blob) { decoded.delete(blob); }

/**
 * Whether the picture is a photograph, where a TrustMark is invisible, and not a graphic (flat colour, text, line art,
 * a screenshot of an interface), where it shows as blotches in the flat areas and halos at edges. A graphic has large
 * areas of exactly equal pixels: sampled on a grid of about 20,000 points, photographs measured 0-44% such pixels and
 * screenshots, diagrams and generated art 70-100%.
 */
export const GRAPHIC_FLAT_SHARE = 0.6;
export function isPhotographic({ rgba, w, h }: Decoded): boolean {
  const step = Math.max(1, Math.floor(Math.sqrt((w * h) / 20000)));
  let flat = 0, n = 0;
  for (let y = 0; y + 1 < h; y += step) for (let x = 0; x + 1 < w; x += step) {
    const p = (y * w + x) * 4, r = p + 4, d = p + w * 4;
    n++;
    if (rgba[p] === rgba[r] && rgba[p + 1] === rgba[r + 1] && rgba[p + 2] === rgba[r + 2] && rgba[p] === rgba[d] && rgba[p + 1] === rgba[d + 1] && rgba[p + 2] === rgba[d + 2]) flat++;
  }
  return n > 0 && flat / n <= GRAPHIC_FLAT_SHARE;
}

/** The record's exact bytes: fixed key order, no whitespace. */
export function recordBytes(photoDigestB64: string, img: Decoded): Uint8Array {
  return recordBytesOf(photoDigestB64, fingerprintOf(img));
}

/** The picture's part of its record, without its SHA-256: worked out while the file is still being hashed. */
export type Fingerprint = { phash: string; values: string };
export const fingerprintOf = (img: Decoded): Fingerprint => ({ phash: phash(img.rgba, img.w, img.h), values: signature(img.rgba, img.w, img.h) });
export function recordBytesOf(photoDigestB64: string, fp: Fingerprint): Uint8Array {
  const rec: FingerprintRecord = { format: RECORD_FORMAT, photo: photoDigestB64, phash: fp.phash, blocks: { grid: GRID, bits: BITS, values: fp.values } };
  return new TextEncoder().encode(JSON.stringify(rec));
}

/** The record file that goes into the tree beside the photo. */
export const recordFile = (photoName: string, bytes: Uint8Array) => new File([bytes as BlobPart], `${photoName}${RECORD_SUFFIX}`, { type: "application/json" });

export function parseRecord(bytes: Uint8Array): FingerprintRecord | null {
  try {
    const r = JSON.parse(new TextDecoder().decode(bytes)) as Partial<FingerprintRecord>;
    if (r.format !== RECORD_FORMAT || typeof r.photo !== "string" || !/^[0-9a-f]{16}$/.test(r.phash ?? "")) return null;
    const b = r.blocks;
    if (!b || b.grid !== GRID || b.bits !== BITS || typeof b.values !== "string" || !/^[0-9a-f]+$/.test(b.values) || b.values.length !== GRID * GRID) return null;
    return r as FingerprintRecord;
  } catch { return null; }
}
