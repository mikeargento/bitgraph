// Copyright (c) Argento Computing Inc. All rights reserved. See LICENSE.

/**
 * "Looks like the original", for a copy that may be cropped.
 *
 * The original's signature is its mean brightness on a 32 x 32 grid, contrast-normalized and quantized to 4 bits
 * (512 bytes: too coarse to show detail, enough to recognize the picture). A copy is some window [x0, x1] x [y0, y1]
 * of the original, in fractions of its width and height, resized. For each window considered, the copy is sampled on
 * the grid cells inside that window and compared with the signature by normalized correlation; the best window is the
 * alignment, and its score is the match. On a test set of 35 images, genuine copies (crops, feed squares,
 * recompression, screenshots) scored at least 0.934, and other pictures, including other shots of the same scene, at
 * most 0.733; a 16 x 16 grid separated them less (0.953 against 0.831).
 */

export const GRID = 32, BITS = 4, MATCH = 0.85;

// PIL's bilinear resample of one 8-bit channel (as in tm.ts): triangle filter widened when shrinking, two passes.
function coefficients(inSize: number, outSize: number) {
  const scale = inSize / outSize, fs = Math.max(scale, 1), out: Array<{ xmin: number; w: number[] }> = [];
  for (let i = 0; i < outSize; i++) {
    const center = (i + 0.5) * scale, xmin = Math.max(Math.trunc(center - fs + 0.5), 0), xmax = Math.min(Math.trunc(center + fs + 0.5), inSize);
    const w: number[] = []; let total = 0;
    for (let x = xmin; x < xmax; x++) { const t = Math.abs((x - center + 0.5) / fs), k = t < 1 ? 1 - t : 0; w.push(k); total += k; }
    out.push({ xmin, w: w.map((k) => (total ? k / total : 0)) });
  }
  return out;
}
function resize1(src: ArrayLike<number>, W: number, H: number, w: number, h: number): Float64Array {
  const cx = coefficients(W, w), cy = coefficients(H, h), tmp = new Uint8Array(w * H), out = new Float64Array(w * h);
  for (let y = 0; y < H; y++) for (let i = 0; i < w; i++) {
    const { xmin, w: k } = cx[i]!; let s = 0;
    for (let j = 0; j < k.length; j++) s += src[y * W + xmin + j]! * k[j]!;
    tmp[y * w + i] = Math.min(255, Math.max(0, Math.round(s)));
  }
  for (let i = 0; i < h; i++) for (let x = 0; x < w; x++) {
    const { xmin, w: k } = cy[i]!; let s = 0;
    for (let j = 0; j < k.length; j++) s += tmp[(xmin + j) * w + x]! * k[j]!;
    out[i * w + x] = Math.min(255, Math.max(0, Math.round(s)));
  }
  return out;
}
/** Grayscale (PIL "L") at most `longSide` pixels on its long side. */
function gray(rgba: ArrayLike<number>, W: number, H: number, longSide: number) {
  const g = new Uint8Array(W * H);
  for (let i = 0; i < W * H; i++) g[i] = (rgba[i * 4]! * 19595 + rgba[i * 4 + 1]! * 38470 + rgba[i * 4 + 2]! * 7471 + 0x8000) >> 16;
  const s = longSide / Math.max(W, H);
  if (s >= 1) return { g: Float64Array.from(g), w: W, h: H };
  const w = Math.max(1, Math.round(W * s)), h = Math.max(1, Math.round(H * s));
  return { g: resize1(g, W, H, w, h), w, h };
}

/** The original's signature: GRID x GRID values 0..15, as hex (one character each). */
export function signature(rgba: ArrayLike<number>, W: number, H: number): string {
  const { g, w, h } = gray(rgba, W, H, 256), n = GRID, m = new Float64Array(n * n);
  for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
    const y0 = Math.floor((j * h) / n), y1 = Math.floor(((j + 1) * h) / n), x0 = Math.floor((i * w) / n), x1 = Math.floor(((i + 1) * w) / n);
    let s = 0;
    for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) s += g[y * w + x]!;
    m[j * n + i] = s / Math.max(1, (y1 - y0) * (x1 - x0));
  }
  const mean = m.reduce((a, b) => a + b, 0) / m.length;
  const sd = Math.sqrt(m.reduce((a, b) => a + (b - mean) ** 2, 0) / m.length) || 1;
  const top = 2 ** BITS - 1;
  return Array.from(m, (v) => Math.round(((Math.min(2.5, Math.max(-2.5, (v - mean) / sd)) + 2.5) / 5) * top).toString(16)).join("");
}

function integral(g: Float64Array, w: number, h: number): Float64Array {
  const I = new Float64Array((w + 1) * (h + 1));
  for (let y = 0; y < h; y++) { let row = 0; for (let x = 0; x < w; x++) { row += g[y * w + x]!; I[(y + 1) * (w + 1) + x + 1] = I[y * (w + 1) + x + 1]! + row; } }
  return I;
}

// numpy's round (halves to even), as the reference implementation uses
const rnd = (v: number) => { const f = Math.floor(v), d = v - f; return d > 0.5 ? f + 1 : d < 0.5 ? f : f % 2 === 0 ? f : f + 1; };

function score(I: Float64Array, gw: number, gh: number, sig: number[], x0: number, x1: number, y0: number, y1: number): number {
  const n = GRID, eps = 1e-9, ci: number[] = [], cj: number[] = [];
  for (let k = 0; k < n; k++) {
    if (k / n >= x0 - eps && (k + 1) / n <= x1 + eps) ci.push(k);
    if (k / n >= y0 - eps && (k + 1) / n <= y1 + eps) cj.push(k);
  }
  if (ci.length * cj.length < 0.35 * n * n) return -1;
  const ux = (k: number) => Math.min(gw, Math.max(0, rnd(((k / n - x0) / (x1 - x0)) * gw)));
  const uy = (k: number) => Math.min(gh, Math.max(0, rnd(((k / n - y0) / (y1 - y0)) * gh)));
  const S: number[] = [], T: number[] = [], W1 = gw + 1;
  for (const j of cj) {
    const b0 = uy(j), b1 = uy(j + 1);
    if (b1 <= b0) return -1;
    for (const i of ci) {
      const a0 = ux(i), a1 = ux(i + 1);
      if (a1 <= a0) return -1;
      S.push((I[b1 * W1 + a1]! - I[b0 * W1 + a1]! - I[b1 * W1 + a0]! + I[b0 * W1 + a0]!) / ((b1 - b0) * (a1 - a0)));
      T.push(sig[j * n + i]!);
    }
  }
  const ms = S.reduce((a, b) => a + b, 0) / S.length, mt = T.reduce((a, b) => a + b, 0) / T.length;
  let st = 0, ss = 0, tt = 0;
  for (let k = 0; k < S.length; k++) { const a = S[k]! - ms, b = T[k]! - mt; st += a * b; ss += a * a; tt += b * b; }
  const d = Math.sqrt(ss * tt);
  return d > 0 ? st / d : -1;
}

/** Align a copy (RGBA) to a signature (hex): the best window [x0, x1, y0, y1] and its match. */
export function align(rgba: ArrayLike<number>, W: number, H: number, sigHex: string): { score: number; window: [number, number, number, number] } {
  const sig = Array.from(sigHex, (c) => parseInt(c, 16));
  const { g, w: gw, h: gh } = gray(rgba, W, H, 160), I = integral(g, gw, gh);
  const step = 0.05, lo: number[] = [];
  for (let v = 0; v <= 0.45 + 1e-9; v += step) lo.push(+v.toFixed(4));
  let best = { s: -2, w: [0, 1, 0, 1] as [number, number, number, number] };
  for (const x0 of lo) for (const x1 of lo.map((v) => 1 - v)) for (const y0 of lo) for (const y1 of lo.map((v) => 1 - v)) {
    const s = score(I, gw, gh, sig, x0, x1, y0, y1);
    if (s > best.s) best = { s, w: [x0, x1, y0, y1] };
  }
  for (const delta of [step / 2, step / 4, 0.01, 0.005]) {
    for (let moved = true; moved;) {
      moved = false;
      for (let k = 0; k < 4; k++) for (const d of [-delta, delta]) {
        const w = [...best.w] as [number, number, number, number]; w[k] = Math.min(1, Math.max(0, w[k] + d));
        if (w[1] - w[0] < 0.3 || w[3] - w[2] < 0.3) continue;
        const s = score(I, gw, gh, sig, ...w);
        if (s > best.s + 1e-6) { best = { s, w }; moved = true; }
      }
    }
  }
  return { score: best.s, window: best.w };
}
