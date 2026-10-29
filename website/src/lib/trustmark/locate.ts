// Copyright (c) Argento Computing Inc. All rights reserved. See LICENSE.

/**
 * Where the photo might be inside a wider picture: a screenshot that also shows a toolbar, a window frame or a page
 * around it. A copy is matched to its original by what it looks like (check.ts), and the match runs one way round, the
 * copy as a crop of the original; a photo framed by a post, a card or a window must be cut back out first.
 *
 * A photo shown on screen meets what surrounds it along straight lines that run its full width or height. This finds
 * the rows and columns where such long edges are, and returns the rectangles they bound, best supported first,
 * together with the whole picture. Nothing here decides whether a rectangle holds the photo: the caller matches each
 * and keeps one only if a record matches it.
 */

const WORK = 800;     // edges are found on a copy at most this many pixels on its long side
const STEP = 8;       // a pixel pair differing by more than this (of 255) in any channel is an edge
const MIN_RUN = 0.2;  // a line must have edges along at least this share of the picture
const MIN_SIDE = 0.2; // a rectangle must be at least this share of the picture each way
const BORDER = 0.6;   // how much the picture's own edge counts as a side
const GAP = 3;        // how far to one side a border's edges must thin out
const KEEP = 8;       // lines kept in each direction
const INSIDE = 0.15;  // weight of the texture just inside a side
const REFINE = 4;     // best rectangles whose own spans are searched again for lines
const TRY = 16;       // rectangles returned (plus the whole picture)

export type Rect = { x: number; y: number; w: number; h: number };

/** The pixels inside a rectangle, as their own RGBA picture. */
export function cropRGBA(rgba: Uint8ClampedArray, W: number, x: number, y: number, w: number, h: number): Uint8ClampedArray {
  const out = new Uint8ClampedArray(w * h * 4);
  for (let r = 0; r < h; r++) out.set(rgba.subarray(((y + r) * W + x) * 4, ((y + r) * W + x + w) * 4), r * w * 4);
  return out;
}
type Work = { g: Float32Array; w: number; h: number };

// a dark photo on a dark viewer differs from it in colour more than in brightness, so all three channels are kept
function colorWork(rgba: Uint8ClampedArray, W: number, H: number): Work {
  const s = Math.min(1, WORK / Math.max(W, H)), w = Math.max(1, Math.round(W * s)), h = Math.max(1, Math.round(H * s));
  const g = new Float32Array(w * h * 3);
  for (let y = 0; y < h; y++) {
    const y0 = Math.floor((y * H) / h), y1 = Math.max(y0 + 1, Math.floor(((y + 1) * H) / h));
    for (let x = 0; x < w; x++) {
      const x0 = Math.floor((x * W) / w), x1 = Math.max(x0 + 1, Math.floor(((x + 1) * W) / w));
      let r = 0, gr = 0, b = 0, n = 0;
      for (let yy = y0; yy < y1; yy += 2) for (let xx = x0; xx < x1; xx += 2) { const p = (yy * W + xx) * 4; r += rgba[p]!; gr += rgba[p + 1]!; b += rgba[p + 2]!; n++; }
      const q = (y * w + x) * 3; g[q] = r / n; g[q + 1] = gr / n; g[q + 2] = b / n;
    }
  }
  return { g, w, h };
}

// share of positions along a line where the pixels just before and just after it differ
function edges({ g, w, h }: Work, horizontal: boolean, i: number, from: number, to: number): number {
  const n = horizontal ? h : w;
  if (i < 1 || i >= n) return 0;
  let hit = 0;
  for (let k = from; k < to; k++) {
    const a = 3 * (horizontal ? (i - 1) * w + k : k * w + i - 1);
    const b = 3 * (horizontal ? Math.min(i + 1, n - 1) * w + k : k * w + Math.min(i + 1, n - 1));
    if (Math.abs(g[a]! - g[b]!) > STEP || Math.abs(g[a + 1]! - g[b + 1]!) > STEP || Math.abs(g[a + 2]! - g[b + 2]!) > STEP) hit++;
  }
  return to > from ? hit / (to - from) : 0;
}
// A photo's border is where edges START: dense here, sparse a few lines to one side. Inside a textured photo, edges
// are as dense a few lines away, so its rows and columns score near zero.
function support(wk: Work, horizontal: boolean, i: number, from: number, to: number): number {
  const here = edges(wk, horizontal, i, from, to);
  return Math.max(0, here - Math.min(edges(wk, horizontal, i - GAP, from, to), edges(wk, horizontal, i + GAP, from, to)));
}

// the strongest border lines in one direction, measured along [from, to) of the other
function lines(wk: Work, horizontal: boolean, from: number, to: number): number[] {
  const n = horizontal ? wk.h : wk.w, score = new Float32Array(n);
  for (let i = 1; i < n; i++) score[i] = support(wk, horizontal, i, from, to);
  const picked: number[] = [];
  const order = [...score.keys()].filter((i) => score[i]! >= MIN_RUN).sort((a, b) => score[b]! - score[a]!);
  for (const i of order) {
    if (picked.length >= KEEP) break;
    if (picked.every((j) => Math.abs(i - j) > n * 0.01)) picked.push(i);
  }
  return [0, ...picked, n];
}

/** Candidate rectangles in the full picture's pixels, the whole picture first. */
export function candidates(rgba: Uint8ClampedArray, W: number, H: number): Rect[] {
  const wk = colorWork(rgba, W, H), { w, h } = wk, fx = W / w, fy = H / h;
  // a side's score: a border along its own span, plus a little for texture just inside it (a photo has some; a bar of
  // text or a panel edge mostly does not)
  const side = (horizontal: boolean, i: number, from: number, to: number, inward: number) =>
    i === 0 || i === (horizontal ? h : w) ? BORDER : support(wk, horizontal, i, from, to) + INSIDE * edges(wk, horizontal, i + inward * GAP, from, to);
  type Found = Rect & { s: number; t: number; b: number; l: number; r: number };
  const found = new Map<string, Found>();
  const add = (t: number, b: number, l: number, r: number) => {
    if (b - t < h * MIN_SIDE || r - l < w * MIN_SIDE || (t === 0 && b === h && l === 0 && r === w)) return;
    const rw = (r - l) * fx, rh = (b - t) * fy;
    if (Math.max(rw, rh) / Math.min(rw, rh) > 2) return;
    const key = `${t},${b},${l},${r}`;
    if (found.has(key)) return;
    const s = (side(true, t, l, r, 1) + side(true, b, l, r, -1) + side(false, l, t, b, 1) + side(false, r, t, b, -1)) / 4;
    found.set(key, { s, t, b, l, r, x: Math.round(l * fx), y: Math.round(t * fy), w: Math.round(rw), h: Math.round(rh) });
  };
  const combine = (rows: number[], cols: number[]) => { for (const t of rows) for (const b of rows) for (const l of cols) for (const r of cols) add(t, b, l, r); };
  // first the lines that run across the whole picture; then, for the best rectangles, the lines along their own span,
  // which a photo beside text or other panels only shows there
  combine(lines(wk, true, 0, w), lines(wk, false, 0, h));
  for (let round = 0; round < 2; round++) {
    const best = [...found.values()].sort((a, c) => c.s - a.s).slice(0, REFINE);
    for (const q of best) combine(lines(wk, true, q.l, q.r), lines(wk, false, q.t, q.b));
  }
  // near-duplicates read the same, so keep one of each and spend the tries on different rectangles
  const out: Found[] = [];
  for (const q of [...found.values()].sort((a, c) => c.s - a.s)) {
    if (out.length >= TRY) break;
    const near = (o: Found) => Math.abs(o.l - q.l) + Math.abs(o.r - q.r) <= 0.01 * w * 2 && Math.abs(o.t - q.t) + Math.abs(o.b - q.b) <= 0.01 * h * 2;
    if (!out.some(near)) out.push(q);
  }
  return [{ x: 0, y: 0, w: W, h: H }, ...out.map(({ x, y, w: rw, h: rh }) => ({ x, y, w: rw, h: rh }))];
}
