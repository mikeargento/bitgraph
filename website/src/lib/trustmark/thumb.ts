// Copyright (c) Argento Computing Inc. All rights reserved. See LICENSE.

/**
 * A photo's reference thumbnail (2026-10-29): a small JPEG bound beside the photo in its tree and published with its
 * fingerprint record, so someone who finds the proof with only a copy sees what was bound. Shown only to a holder of a
 * copy (the record opens with the tag the copy's pHash gives), after it matches the bound fingerprint (align.ts); a
 * reference, never proof: only the original's exact bytes prove the photo.
 */

export const THUMB_SUFFIX = ".thumb.jpg";
export const THUMB_MAX = 512;
export const THUMB_QUALITY = 0.82;

/** The thumbnail's bytes, or null where the browser cannot draw the picture. Orientation is applied as the browser shows it. */
export async function makeThumb(blob: Blob): Promise<Uint8Array | null> {
  if (typeof createImageBitmap === "undefined" || typeof OffscreenCanvas === "undefined") return null;
  let bmp: ImageBitmap;
  try { bmp = await createImageBitmap(blob); } catch { return null; }
  try {
    const s = Math.min(1, THUMB_MAX / Math.max(bmp.width, bmp.height));
    const w = Math.max(1, Math.round(bmp.width * s)), h = Math.max(1, Math.round(bmp.height * s));
    const c = new OffscreenCanvas(w, h), g = c.getContext("2d");
    if (!g) return null;
    g.imageSmoothingQuality = "high";
    g.drawImage(bmp, 0, 0, w, h);
    const out = await c.convertToBlob({ type: "image/jpeg", quality: THUMB_QUALITY });
    return new Uint8Array(await out.arrayBuffer());
  } catch { return null; } finally { bmp.close(); }
}
