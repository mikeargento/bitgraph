// Copyright (c) Argento Computing Inc. All rights reserved. See LICENSE.

/**
 * Writing a pointer, and every way of reading one back from a copy that a feed or a viewer has cropped.
 *
 * A pointer is written once, over the whole frame, with Pixel Seal (ps.ts): on the test set it read after feed
 * squares, 4:5 cuts, 20% crops from every side and 15% zooms without the nested centre mark TrustMark needed.
 *
 * Reading tries the whole picture, then its centre square, then, for a copy zoomed in (cut equally on every side),
 * the copy put back in a frame 10, 15, 20 and 25% larger each side. Every region is read for a Pixel Seal pointer
 * first, then for a TrustMark one (tm.ts, the pointers written before Pixel Seal, whose reader is fetched only then).
 * Every read is only a candidate: the caller keeps one only if its pointer checks out against the ledger.
 */

import { mark as psMark, read as psRead } from "./ps.ts";
import { legacyReadRuntime, markRuntime, readRuntime } from "./runtime.ts";
import { aspectOk, read as tmRead } from "./tm.ts";

const SQUARE_TOLERANCE = 0.05; // a picture this close to square has no separate centre square
const ZOOMS = [0.1, 0.15, 0.2, 0.25];

export function cropRGBA(rgba: Uint8ClampedArray, W: number, x: number, y: number, w: number, h: number): Uint8ClampedArray {
  const out = new Uint8ClampedArray(w * h * 4);
  for (let r = 0; r < h; r++) out.set(rgba.subarray(((y + r) * W + x) * 4, ((y + r) * W + x + w) * 4), r * w * 4);
  return out;
}
function pasteRGBA(dst: Uint8ClampedArray, W: number, src: Uint8ClampedArray, x: number, y: number, w: number, h: number) {
  for (let r = 0; r < h; r++) dst.set(src.subarray(r * w * 4, (r + 1) * w * 4), ((y + r) * W + x) * 4);
}
const centreSquare = (W: number, H: number) => { const s = Math.min(W, H); return { x: Math.floor((W - s) / 2), y: Math.floor((H - s) / 2), s }; };
const nearSquare = (W: number, H: number) => Math.abs(W - H) < SQUARE_TOLERANCE * Math.max(W, H);

/** Write the pointer into the photo. Returns RGBA. */
export async function markPhoto(rgba: Uint8ClampedArray, W: number, H: number, payload: string): Promise<Uint8ClampedArray> {
  return psMark(rgba, W, H, payload, await markRuntime());
}

// the copy centred in a frame large enough for a cut of p on every side, the rest its mean colour
function repad(rgba: Uint8ClampedArray, w: number, h: number, p: number) {
  const W = Math.round(w / (1 - 2 * p)), H = Math.round(h / (1 - 2 * p)), n = w * h;
  let r = 0, g = 0, b = 0;
  for (let i = 0; i < n; i++) { r += rgba[i * 4]!; g += rgba[i * 4 + 1]!; b += rgba[i * 4 + 2]!; }
  const fill = [Math.trunc(r / n), Math.trunc(g / n), Math.trunc(b / n)];
  const out = new Uint8ClampedArray(W * H * 4);
  for (let i = 0; i < W * H; i++) { out[i * 4] = fill[0]!; out[i * 4 + 1] = fill[1]!; out[i * 4 + 2] = fill[2]!; out[i * 4 + 3] = 255; }
  pasteRGBA(out, W, rgba, Math.floor((W - w) / 2), Math.floor((H - h) / 2), w, h);
  return { rgba: out, w: W, h: H };
}

type Region = { rgba: Uint8ClampedArray; w: number; h: number; how: string };
export type Candidate = { payload: string; bitflips: number; how: string; scheme: "pixelseal" | "trustmark" };

// the regions to read, in order, made only as they are reached
function* regions(rgba: Uint8ClampedArray, W: number, H: number, zooms: boolean): Generator<Region> {
  yield { rgba, w: W, h: H, how: "whole" };
  if (!nearSquare(W, H)) {
    const { x, y, s } = centreSquare(W, H);
    yield { rgba: cropRGBA(rgba, W, x, y, s, s), w: s, h: s, how: "centre square" };
  }
  if (!aspectOk(W, H) || !zooms) return;
  for (const p of ZOOMS) { const f = repad(rgba, W, H, p); yield { ...f, how: `zoomed ${Math.round(p * 100)}%` }; }
}

/**
 * Every pointer that reads in this picture, in the order tried. zooms: false skips the re-padded reads (for the
 * rectangles a screenshot is searched in, where they would multiply the cost of a miss). legacy: false skips
 * TrustMark (for reading back a pointer just written).
 */
export async function* readings(rgba: Uint8ClampedArray, W: number, H: number, { zooms = true, legacy = true } = {}): AsyncGenerator<Candidate> {
  const ps = await readRuntime();
  for (const r of regions(rgba, W, H, zooms)) {
    const got = await psRead(r.rgba, r.w, r.h, ps);
    if (got.present) yield { payload: got.payload, bitflips: got.bitflips, how: r.how, scheme: "pixelseal" };
  }
  if (!legacy) return;
  const tm = await legacyReadRuntime();
  for (const r of regions(rgba, W, H, zooms)) {
    if (!aspectOk(r.w, r.h)) continue;
    const got = await tmRead(r.rgba, r.w, r.h, tm);
    if (got.present) yield { payload: got.payload, bitflips: got.bitflips, how: r.how, scheme: "trustmark" };
  }
}
