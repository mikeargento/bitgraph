// Copyright (c) Argento Computing Inc. All rights reserved. See LICENSE.

/**
 * Marks that survive the crops feeds and viewers make, on top of plain TrustMark (tm.ts).
 *
 * Marking is nested: the whole frame, then its centre square again with the same payload. A feed that squares the
 * photo (or cuts it to 4:5) keeps that square, so it still reads: on the test set this took feed crops from 18-20 of
 * 25 to 25 of 25, at 0.5 dB more visibility, with nothing else read worse in any test that tried both readings.
 *
 * Reading tries the whole picture, then its centre square, then, for a copy zoomed in (cut equally on every side),
 * the copy put back in a frame 10, 15, 20 and 25% larger each side: a 15% zoom went from 0 to 19 of 25. Every read is
 * only a candidate: the caller keeps one only if its pointer checks out against the ledger.
 */

import { aspectOk, mark, read, type MarkEnv, type ReadEnv } from "./tm.ts";

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

/** Mark the whole frame, then its centre square again. Returns RGBA. */
export async function markNested(rgba: Uint8ClampedArray, W: number, H: number, payload: string, env: MarkEnv): Promise<Uint8ClampedArray> {
  const out = await mark(rgba, W, H, payload, env);
  if (nearSquare(W, H)) return out;
  const { x, y, s } = centreSquare(W, H);
  pasteRGBA(out, W, await mark(cropRGBA(out, W, x, y, s, s), s, s, payload, env), x, y, s, s);
  return out;
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

export type Candidate = { payload: string; bitflips: number; how: string };

/**
 * Every mark that reads in this picture, in the order tried. zooms: false skips the re-padded reads (for the
 * rectangles a screenshot is searched in, where they would multiply the cost of a miss).
 */
export async function* readings(rgba: Uint8ClampedArray, W: number, H: number, env: ReadEnv, { zooms = true } = {}): AsyncGenerator<Candidate> {
  if (aspectOk(W, H)) {
    const r = await read(rgba, W, H, env);
    if (r.present) yield { payload: r.payload, bitflips: r.bitflips, how: "whole" };
  }
  if (!nearSquare(W, H)) {
    const { x, y, s } = centreSquare(W, H);
    const r = await read(cropRGBA(rgba, W, x, y, s, s), s, s, env);
    if (r.present) yield { payload: r.payload, bitflips: r.bitflips, how: "centre square" };
  }
  if (!aspectOk(W, H) || !zooms) return;
  for (const p of ZOOMS) {
    const f = repad(rgba, W, H, p);
    const r = await read(f.rgba, f.w, f.h, env);
    if (r.present) yield { payload: r.payload, bitflips: r.bitflips, how: `zoomed ${Math.round(p * 100)}%` };
  }
}
