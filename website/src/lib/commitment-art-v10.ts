/**
 * bitgraph-art/10 (2026-10-07): a flow field with collision avoidance (the Fidenza class). Landscape,
 * 1600 x 1024 with the plain 32 px frame (art 1536 x 960), the code carried exactly as versions 8 and 9.
 *
 * The picture is 800 to 1,800 flat segments that never overlap, widths from a 1 px hairline to 80 px,
 * long ribbons and short dabs sharing one heading field, packed rivers against empty regions, square or
 * round ends, an optional outline. Widest first: each width tier makes a fixed number of attempts; an
 * attempt picks a start (rejection-sampled on a density field), checks the start is free across its
 * width on a 2 px occupancy grid, walks both ways along the field in 2 px steps (probing 2n + 1 points
 * across the width plus one half a width ahead, stopping at the frame, at a blocked cell, at the
 * density threshold or at its length budget), drops stubs under 2.2 widths (1.2 chunky) or 14 px, and
 * marks its cells. Four styles: ribbons (long, smooth), chunky (short, thick outline, mostly round
 * caps), sharp (the heading quantised to the nearest quarter turn from the base angle, drawn as
 * rectangles extended by half a width so the corners mitre), spiral (the heading is the angle to a
 * centre plus a quarter turn plus a pull in or out, plus noise). Three density modes: rivers (a
 * quantile of the field, 26 to 42 %, is empty; segments start only above it and stop walking into it),
 * gradient (a direction across the frame plus a little noise, 14 % empty), even. Seven palettes of a
 * ground and six weighted colours; a per-segment tint of up to 3 levels; paper grain over all.
 *
 * Everything is integer: positions in eighths of a pixel (UX = 8 x 1536, as versions 8 and 9), angles
 * as steps of 1024 per turn from version 6's SIN table (the spiral's atan2 is a binary search over it),
 * lattice value noise with one 32-bit hash per lattice point and a smoothstep in 15-bit fixed point,
 * square roots by isqrt, polygons filled by scanline with the half-open crossing rule and nonzero
 * winding, no floating point and no clock in plan or draw. The plan is the segments themselves (their
 * points, width, colour and tint), plain integers; the drawing only rasterises them (at S times the
 * size for print: every length times S, no angle).
 *
 * Drawing: a slot map at 2 x 2 samples per pixel (sample (X, Y) is the point (4X + 2, 4Y + 2) in
 * eighths), slot = palette index x 16 + tint level, so every sample knows WHICH palette colour covers
 * it. A pixel is the integer mean of its four samples' tinted colours, plus the grain (a per-pixel hash
 * and a slow mottle, both fixed, never from the code). The code: the art is a hidden grid of 16 x 16
 * tiles of 96 x 60 px; tile k (row-major) carries bit k of the code, most significant bit of byte 0
 * first, in ONE pixel, its reading pixel (96c + 48, 60r + 30), never tinted, never grained: it takes the
 * palette index that covers most of its 4 samples (the lowest index on a tie) and is drawn in that
 * colour's twin (one level away on each channel) when the bit is 1, in the colour itself when it is 0.
 * decodeV10 reads the 256 reading pixels, finds the palette whose colours and twins hold them all (no
 * colour or twin is shared between palettes), and takes each bit from whether its colour is a twin.
 */
import { sha256 } from "@noble/hashes/sha256";
import { FRAME_V6 as FRAME, SIN_V6 as SIN, idiv } from "./commitment-art-v6.ts";

type RGB = readonly [number, number, number];
const LABEL = "bitgraph-art/10";
export const V10_WIDTH = 1600, V10_HEIGHT = 1024;
const OFF = 32, AW = 1536, AH = 960, UX = 8 * AW, UY = 8 * AH, TW = 96, TH = 60, RX = 48, RY = 30;
const COS = (a: number) => SIN[(a + 256) & 1023]!;
const hex = (h: string): RGB => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];

/** [ground, six colours] with the colours' weights (the ground is never a segment colour). Never reorder or edit. */
const PALS: ReadonlyArray<{ name: string; cols: readonly string[]; w: readonly number[] }> = [
  { name: "luxe", cols: ["#f1eadb", "#1b2a41", "#c8102e", "#f2a93b", "#2a9d8f", "#ebe4d1", "#171717"], w: [4, 3, 3, 2, 2, 1] },
  { name: "golf", cols: ["#e7e3d6", "#2c6e49", "#4c956c", "#fefee3", "#ffc9b9", "#d68c45", "#1f1f1f"], w: [4, 3, 2, 2, 2, 1] },
  { name: "dark", cols: ["#141414", "#f2f0ea", "#ff5c39", "#ffd166", "#4ecdc4", "#7b61ff", "#2a2a2a"], w: [4, 3, 2, 2, 1, 3] },
  { name: "politique", cols: ["#f7f3ee", "#d6336c", "#1c7ed6", "#fab005", "#2b8a3e", "#212529", "#f3e9d8"], w: [3, 3, 2, 2, 2, 2] },
  { name: "baked", cols: ["#efe6d5", "#b5522e", "#d98c3f", "#e3b866", "#6b4f3a", "#3b5b66", "#f5f0e6"], w: [3, 3, 3, 2, 1, 2] },
  { name: "cool", cols: ["#e9eef2", "#0b3d91", "#2d7dd2", "#97cc04", "#f45d01", "#ffffff", "#1f2933"], w: [4, 3, 2, 2, 2, 1] },
  { name: "rose", cols: ["#f6eee9", "#b23a48", "#fcb9b2", "#8c2f39", "#461220", "#fed0bb", "#2d2a32"], w: [3, 3, 2, 2, 2, 1] },
];
export const PALETTES_V10: readonly (readonly RGB[])[] = PALS.map((p) => p.cols.map(hex));
export const PALETTE_NAMES_V10: readonly string[] = PALS.map((p) => p.name);
const twin = (c: RGB): RGB => [c[0] < 128 ? c[0] + 1 : c[0] - 1, c[1] < 128 ? c[1] + 1 : c[1] - 1, c[2] < 128 ? c[2] + 1 : c[2] - 1];
export const TWINS_V10: readonly (readonly RGB[])[] = PALETTES_V10.map((p) => p.map(twin));
export const STYLE_NAMES_V10: readonly string[] = ["ribbons", "chunky", "sharp", "spiral"];
export const DENSITY_NAMES_V10: readonly string[] = ["rivers", "gradient", "even"];
/** Tint level 0..15 to a pigment nudge in levels; a segment's tint is 4..11, so at most 3 levels. */
const TINTS: readonly number[] = [-7, -6, -5, -4, -3, -2, -1, 0, 0, 1, 2, 3, 4, 5, 6, 7];
const slot = (idx: number, tint: number) => idx * 16 + tint;

function isqrt(n: number): number {
  if (n <= 0) return 0;
  let r = Math.floor(Math.sqrt(n));
  while (r * r > n) r--;
  while ((r + 1) * (r + 1) <= n) r++;
  return r;
}
/** ceil(p / q) for q > 0. */
const cdiv = (p: number, q: number): number => idiv(p + q - 1, q);

class Stream {
  private buf: Uint8Array = new Uint8Array(0);
  private at = 0;
  private k = 0;
  private readonly prefix: Uint8Array;
  constructor(commitment: Uint8Array) {
    const te = new TextEncoder();
    const label = te.encode(LABEL), purpose = te.encode("draw");
    this.prefix = new Uint8Array(label.length + 1 + purpose.length + 1 + 32);
    this.prefix.set(label, 0);
    this.prefix.set(purpose, label.length + 1);
    this.prefix.set(commitment, label.length + 1 + purpose.length + 1);
  }
  u32(): number {
    if (this.at + 4 > this.buf.length) {
      const input = new Uint8Array(this.prefix.length + 4);
      input.set(this.prefix, 0);
      const k = this.k++;
      input.set([(k >>> 24) & 0xff, (k >>> 16) & 0xff, (k >>> 8) & 0xff, k & 0xff], this.prefix.length);
      this.buf = sha256(input);
      this.at = 0;
    }
    const b = this.buf, i = this.at;
    this.at += 4;
    return ((b[i]! << 24) | (b[i + 1]! << 16) | (b[i + 2]! << 8) | b[i + 3]!) >>> 0;
  }
  pick(n: number): number { return Math.floor((this.u32() * n) / 4294967296); }
  of<T>(xs: readonly T[]): T { return xs[this.pick(xs.length)]!; }
}

/* ── Noise: lattice value noise in 1/8192, smoothstep bilinear in 15-bit fixed point ───────────── */

/** Portable 32-bit hash of (x, y, salt). */
function hash2(x: number, y: number, s: number): number {
  let h = Math.imul(x | 0, 0x9e3779b1) ^ Math.imul(y | 0, 0x85ebca77) ^ Math.imul(s | 0, 0xc2b2ae3d);
  h ^= h >>> 15; h = Math.imul(h, 0x2c1b3c6d); h ^= h >>> 12; h = Math.imul(h, 0x297a2d39); h ^= h >>> 15;
  return h >>> 0;
}
/** smoothstep of t in [0, 32768], in the same units. */
const sm = (t: number): number => (((t * t) >> 15) * (98304 - 2 * t)) >> 15;
const NOISE_ONE = 8192;
/** Value noise in [-8192, 8191] at (x, y) eighths over a lattice of the given cell (eighths). */
function vnoise(x: number, y: number, cell: number, salt: number): number {
  const x0 = idiv(x, cell), y0 = idiv(y, cell);
  const tx = sm(idiv((x - x0 * cell) * 32768, cell)), ty = sm(idiv((y - y0 * cell) * 32768, cell));
  const v00 = (hash2(x0, y0, salt) >>> 19) - 4096, v10 = (hash2(x0 + 1, y0, salt) >>> 19) - 4096;
  const v01 = (hash2(x0, y0 + 1, salt) >>> 19) - 4096, v11 = (hash2(x0 + 1, y0 + 1, salt) >>> 19) - 4096;
  const a = v00 + (((v10 - v00) * tx) >> 15), b = v01 + (((v11 - v01) * tx) >> 15);
  return 2 * (a + (((b - a) * ty) >> 15));
}
/** Two octaves, the second at half the cell and half the weight, normalised: [-8192, 8191]. */
function fbm2(x: number, y: number, cell: number, salt: number): number {
  return idiv(2 * vnoise(x, y, cell, salt) + vnoise(x, y, cell >> 1, salt + 31), 3);
}
/** The angle (steps of 1024 a turn) of (dx, dy), 0 along +x and 256 along +y: a binary search over the SIN table. */
function atan2i(dy: number, dx: number): number {
  const ax = dx < 0 ? -dx : dx, ay = dy < 0 ? -dy : dy;
  if (ax === 0 && ay === 0) return 0;
  const ratio = (num: number, den: number): number => { // the largest a in [0, 128] with tan(a) <= num / den
    let lo = 0, hi = 128;
    while (lo < hi) { const mid = (lo + hi + 1) >> 1; if (SIN[mid]! * den <= COS(mid) * num) lo = mid; else hi = mid - 1; }
    return lo;
  };
  let a = ay <= ax ? ratio(ay, ax) : 256 - ratio(ax, ay);
  if (dx < 0) a = 512 - a;
  if (dy < 0) a = -a;
  return a & 1023;
}

/* ── The plan: the segments, in eighths of a pixel, every number from the stream ─────────────── */

export interface V10Segment {
  /** The width, eighths. */
  width: number;
  colour: number;
  /** The tint level, 4..11 (TINTS). */
  tint: number;
  /** The walked centre line, 2 px apart, eighths. */
  points: number[];
}
export interface V10Plan {
  palette: number;
  /** 0 ribbons, 1 chunky, 2 sharp, 3 spiral. */
  style: number;
  /** 0 rivers, 1 gradient, 2 even. */
  density: number;
  /** The outline's width in eighths, 0 for none. */
  outline: number;
  outlineColour: number;
  /** 1 for round caps, 0 for square. */
  roundCaps: number;
  segments: V10Segment[];
}

const CELL = 16, GW = cdiv(UX, CELL), GH = cdiv(UY, CELL);
const CHUNKY_TIERS: ReadonlyArray<readonly [number, number]> = [[80, 3], [60, 6], [44, 14], [32, 36], [24, 90], [16, 260], [11, 700], [8, 1800], [5, 5000], [3, 8000]];
const TIERS: ReadonlyArray<readonly [number, number]> = [[80, 2], [56, 3], [40, 6], [28, 14], [20, 30], [14, 80], [10, 250], [7, 700], [5, 2500], [3, 6000], [2, 8000], [1, 11000]];

export function planV10(commitment: Uint8Array): V10Plan {
  const s = new Stream(commitment);
  const palette = s.pick(PALETTES_V10.length), pal = PALETTES_V10[palette]!, weights = PALS[palette]!.w;
  const style = s.of([0, 0, 1, 2, 3]);
  const salt = s.u32() >>> 8;
  // the heading field: base + noise(cell 560..1100 px) x turn (0.55..1.35 half turns)
  const fieldCell = 4480 + s.pick(4321), turn = 282 + s.pick(410), base = s.pick(1024);
  const spiral = { cx: idiv(UX * (25 + s.pick(51)), 100), cy: idiv(UY * (25 + s.pick(51)), 100), pull: (24 + s.pick(50)) * (s.pick(2) ? 1 : -1), noise: 154 + s.pick(308) };
  // the density field: lattice noise (cell 380..700 px); rivers, gradient or even
  const dmode = s.of([0, 0, 1, 2]);
  const dcell = 3040 + s.pick(2561), dsalt = s.u32() >>> 8, gradAng = s.pick(1024), threshold = 26 + s.pick(17);
  const gc = COS(gradAng), gs = SIN[gradAng]!;
  // raw field in about [-1.7, 1.7] (1/8192); the river threshold is a quantile of it, so the empty fraction is what the code says
  const raw = (x: number, y: number): number => {
    const d = idiv(fbm2(x, y, dcell, dsalt) * 17, 10);
    if (dmode !== 1) return d;
    const proj = idiv((x - (UX >> 1)) * gc + (y - (UY >> 1)) * gs, 16384);
    return idiv(proj * 16384, UX) + idiv(35 * d, 100);
  };
  const vals: number[] = [];
  for (let gy = 0; gy < 30; gy++) for (let gx = 0; gx < 48; gx++) vals.push(raw(gx * 256 + 128, gy * 256 + 128));
  vals.sort((a, b) => a - b);
  const top = vals[vals.length - 1]!;
  const hasHard = dmode !== 2;
  const hard = dmode === 0 ? vals[idiv(vals.length * threshold, 100)]! : dmode === 1 ? vals[idiv(vals.length * 14, 100)]! : -2 * NOISE_ONE;
  const span = Math.max(1, top - hard);
  // start acceptance in thousandths: none below the threshold, then 300 .. 1000 up to the field's top
  const density = (x: number, y: number): number => {
    const d = raw(x, y);
    if (d < hard) return -1;
    return 300 + idiv(700 * Math.min(span, d - hard), span);
  };
  const lum = (c: RGB) => 299 * c[0] + 587 * c[1] + 114 * c[2];
  const groundLight = lum(pal[0]!) > 128000;
  const outlineOn = style !== 3 && s.pick(100) < 55;
  let darkest = 1;
  for (let k = 2; k < pal.length; k++) if (lum(pal[k]!) < lum(pal[darkest]!)) darkest = k;
  const outlineColour = groundLight ? darkest : 0, OL = outlineOn ? (style === 1 ? 16 : 12) : 0;
  const roundCaps = style === 1 ? (s.pick(100) < 70 ? 1 : 0) : style === 2 ? 0 : s.pick(100) < 35 ? 1 : 0;
  const gap0 = s.of([12, 16, 20]) + OL;
  const cell7 = idiv(fieldCell * 7, 10);

  const angle = (x: number, y: number): number => {
    let a = base + ((fbm2(x, y, fieldCell, salt) * turn) >> 13);
    if (style === 3) a = atan2i(y - spiral.cy, x - spiral.cx) + 256 + spiral.pull + ((fbm2(x, y, cell7, salt) * spiral.noise) >> 13);
    if (style === 2) { const d = ((a - base + 512) & 1023) - 512; a = base + idiv(d + 128, 256) * 256; }
    return a & 1023;
  };

  const occ = new Uint8Array(GW * GH);
  const isOcc = (x: number, y: number): boolean => {
    const gx = x >> 4, gy = y >> 4;
    if (gx < 0 || gy < 0 || gx >= GW || gy >= GH) return false;
    return occ[gy * GW + gx] === 1;
  };
  const mark = (x: number, y: number, r: number): void => {
    const gx0 = Math.max(0, (x - r) >> 4), gx1 = Math.min(GW - 1, (x + r) >> 4), gy0 = Math.max(0, (y - r) >> 4), gy1 = Math.min(GH - 1, (y + r) >> 4), r2 = r * r;
    for (let gy = gy0; gy <= gy1; gy++) for (let gx = gx0; gx <= gx1; gx++) {
      const dx = gx * CELL + 8 - x, dy = gy * CELL + 8 - y;
      if (dx * dx + dy * dy <= r2) occ[gy * GW + gx] = 1;
    }
  };
  const inArt = (x: number, y: number, m: number): boolean => x >= -m && y >= -m && x < UX + m && y < UY + m;
  const gapFor = (w: number): number => (w <= 16 ? 5 + OL : w < 32 ? 8 + OL : gap0) + idiv(w * 4, 100);

  // Walk from (x0, y0) along the field (sgn < 0: against it) up to maxLen, 2 px a step, in 1/128 of an
  // eighth; the points kept are eighths. Returns the length walked, eighths.
  const walk = (x0: number, y0: number, sgn: number, w: number, maxLen: number, out: number[]): number => {
    let x = x0 * 128, y = y0 * 128, len = 0;
    const half = (w >> 1) + gapFor(w), nchk = Math.max(2, cdiv(half, 24)), m = w >> 1;
    while (len < maxLen) {
      const a = (angle(x >> 7, y >> 7) + (sgn < 0 ? 512 : 0)) & 1023, c = COS(a), sn = SIN[a]!;
      const nx = x + (c >> 3), ny = y + (sn >> 3), nxe = nx >> 7, nye = ny >> 7;
      if (!inArt(nxe, nye, m)) break;
      if (hasHard && density(nxe, nye) < 0) break;
      let blocked = false;
      for (let k = -nchk; k <= nchk && !blocked; k++) { const t = idiv(k * half, nchk); if (isOcc(nxe - idiv(sn * t, 16384), nye + idiv(c * t, 16384))) blocked = true; }
      // a little ahead too, so ends stop square against the neighbour
      if (!blocked && isOcc(nxe + idiv(c * half, 32768), nye + idiv(sn * half, 32768))) blocked = true;
      if (blocked) break;
      x = nx; y = ny; len += 16;
      out.push(nxe, nye);
    }
    return len;
  };
  const lenFor = (w: number): number => {
    if (style === 1) return idiv(w * (160 + s.pick(291)), 100) + 160;
    const cap = w >= 320 ? 4960 : w >= 80 ? 3840 : w >= 32 ? 2560 : 2080;
    const lo = w >= 320 ? 1440 : w >= 80 ? 720 : 320;
    const L = lo + s.pick(cap - lo + 1);
    return style === 0 && w < 32 ? idiv(L * 14, 10) : L;
  };
  let totalW = 0;
  for (const w of weights) totalW += w;
  const pickColour = (): number => { let r = s.pick(totalW); for (let k = 0; k < weights.length; k++) { r -= weights[k]!; if (r < 0) return k + 1; } return 1; };

  const segments: V10Segment[] = [];
  const fwd: number[] = [], back: number[] = [];
  for (const [w0, tries] of style === 1 ? CHUNKY_TIERS : TIERS) {
    for (let t = 0; t < tries; t++) {
      const w = idiv(w0 * 8 * (85 + s.pick(31)), 100);
      // the start: rejection-sampled against the density
      let x = 0, y = 0, ok = false;
      for (let k = 0; k < 6 && !ok; k++) {
        x = s.pick(UX); y = s.pick(UY);
        const d = density(x, y);
        if (d > 0 && s.pick(1000) < d) ok = true;
      }
      if (!ok) continue;
      // the start itself must be free across the width
      const a = angle(x, y), half = (w >> 1) + gapFor(w), sn = SIN[a]!, c = COS(a);
      let free = true;
      for (let k = -2; k <= 2 && free; k++) { const d = idiv(half * k, 2); if (isOcc(x - idiv(sn * d, 16384), y + idiv(c * d, 16384))) free = false; }
      if (!free) continue;
      const maxLen = lenFor(w), halfLen = maxLen >> 1;
      fwd.length = 0; back.length = 0;
      const L = walk(x, y, 1, w, halfLen, fwd) + walk(x, y, -1, w, halfLen, back);
      if (L < Math.max(style === 1 ? idiv(w * 12, 10) : idiv(w * 22, 10), 112)) continue;
      const points: number[] = [];
      for (let i = back.length - 2; i >= 0; i -= 2) points.push(back[i]!, back[i + 1]!);
      points.push(x, y);
      for (let i = 0; i < fwd.length; i++) points.push(fwd[i]!);
      const r = (w >> 1) + (w <= 16 ? 4 : 8);
      for (let i = 0; i < points.length; i += 2) mark(points[i]!, points[i + 1]!, r);
      const colour = pickColour(), tint = 4 + s.pick(8);
      segments.push({ width: w, colour, tint, points });
    }
  }
  return { palette, style, density: dmode, outline: OL, outlineColour, roundCaps, segments };
}

/* ── Drawing: the slot map at 2 x 2 samples a pixel, then the colours ──────────────────────────
 * Sample (X, Y) is the point (4X + 2, 4Y + 2) in eighths. A span [xa, xb) in eighths covers the samples
 * X with 4X + 2 in it, [idiv(xa + 1, 4), idiv(xb + 1, 4)); a point at or past a rational crossing N / D
 * (D > 0) is the first X with (4X + 2) D >= N, idiv(N + 2D - 1, 4D). */

class Slots {
  readonly w: number;
  readonly h: number;
  readonly idx: Uint8Array;
  constructor(S: number) { this.w = 2 * AW * S; this.h = 2 * AH * S; this.idx = new Uint8Array(this.w * this.h); }
  span(Y: number, X0: number, X1: number, c: number): void {
    if (Y < 0 || Y >= this.h) return;
    if (X0 < 0) X0 = 0;
    if (X1 > this.w) X1 = this.w;
    if (X0 < X1) this.idx.fill(c, Y * this.w + X0, Y * this.w + X1);
  }
  /** Scanline fill, nonzero winding; pts flat [x, y, ...] in eighths. */
  poly(pts: number[], c: number): void {
    const n = pts.length >> 1;
    const exa: number[] = [], eya: number[] = [], exb: number[] = [], eyb: number[] = [], edir: number[] = [], ey0: number[] = [], ey1: number[] = [];
    let ymin = this.h, ymax = 0;
    for (let i = 0, j = n - 1; i < n; j = i++) {
      let xa = pts[2 * j]!, ya = pts[2 * j + 1]!, xb = pts[2 * i]!, yb = pts[2 * i + 1]!, dir = 1;
      if (ya === yb) continue;
      if (ya > yb) { const tx = xa, ty = ya; xa = xb; ya = yb; xb = tx; yb = ty; dir = -1; }
      const y0 = Math.max(0, idiv(ya + 1, 4)), y1 = Math.min(this.h, idiv(yb + 1, 4)); // the rows Y with ya <= 4Y + 2 < yb
      if (y1 <= y0) continue;
      exa.push(xa); eya.push(ya); exb.push(xb); eyb.push(yb); edir.push(dir); ey0.push(y0); ey1.push(y1);
      if (y0 < ymin) ymin = y0;
      if (y1 > ymax) ymax = y1;
    }
    const m = exa.length;
    if (m < 2) return;
    const cx: number[] = [], cd: number[] = [];
    for (let Y = ymin; Y < ymax; Y++) {
      const y = 4 * Y + 2;
      cx.length = 0; cd.length = 0;
      for (let i = 0; i < m; i++) {
        if (Y < ey0[i]! || Y >= ey1[i]!) continue;
        const D = eyb[i]! - eya[i]!, N = exa[i]! * D + (y - eya[i]!) * (exb[i]! - exa[i]!);
        const X = idiv(N + 2 * D - 1, 4 * D), d = edir[i]!;
        let k = cx.length;
        cx.push(X); cd.push(d);
        while (k > 0 && cx[k - 1]! > X) { cx[k] = cx[k - 1]!; cd[k] = cd[k - 1]!; k--; }
        cx[k] = X; cd[k] = d;
      }
      let wind = 0;
      for (let k = 0; k + 1 < cx.length; k++) {
        wind += cd[k]!;
        if (wind !== 0) this.span(Y, cx[k]!, cx[k + 1]!, c);
      }
    }
  }
  disc(cx: number, cy: number, r: number, c: number): void {
    const Y0 = Math.max(0, idiv(cy - r + 1, 4)), Y1 = Math.min(this.h, idiv(cy + r + 1, 4)), r2 = r * r;
    for (let Y = Y0; Y < Y1; Y++) {
      const dy = 4 * Y + 2 - cy, h2 = r2 - dy * dy;
      if (h2 <= 0) continue;
      const h = isqrt(h2);
      this.span(Y, idiv(cx - h + 1, 4), idiv(cx + h + 1, 4), c);
    }
  }
}

/** Rasterise a centre line of width w (eighths): chunked offset polygons, or straight runs as extended rectangles (sharp). */
function drawPath(cv: Slots, pts: number[], w: number, c: number, sharp: boolean, round: boolean): void {
  const n = pts.length >> 1;
  if (n < 2) return;
  const hw = w >> 1;
  if (sharp) {
    let i0 = 0;
    for (let i = 1; i <= n; i++) {
      const end = i === n;
      let turned = false;
      if (!end && i >= 2) {
        const ax = pts[2 * i - 2]! - pts[2 * i - 4]!, ay = pts[2 * i - 1]! - pts[2 * i - 3]!, bx = pts[2 * i]! - pts[2 * i - 2]!, by = pts[2 * i + 1]! - pts[2 * i - 1]!;
        const dot = ax * bx + ay * by;
        turned = dot < 0 || 4 * dot * dot < (ax * ax + ay * ay) * (bx * bx + by * by);
      }
      if (end || turned) {
        const j = end ? n - 1 : i - 1;
        const x0 = pts[2 * i0]!, y0 = pts[2 * i0 + 1]!, x1 = pts[2 * j]!, y1 = pts[2 * j + 1]!;
        const dx = x1 - x0, dy = y1 - y0, L = Math.max(1, isqrt(dx * dx + dy * dy));
        const ex = idiv(dx * hw, L), ey = idiv(dy * hw, L), nx = -ey, ny = ex;
        cv.poly([x0 - ex + nx, y0 - ey + ny, x1 + ex + nx, y1 + ey + ny, x1 + ex - nx, y1 + ey - ny, x0 - ex - nx, y0 - ey - ny], c);
        i0 = j;
      }
    }
    return;
  }
  const CH = 14;
  for (let a = 0; a < n - 1; a += CH) {
    const b = Math.min(n - 1, a + CH), poly: number[] = [], right: number[] = [];
    for (let i = a; i <= b; i++) {
      const ip = Math.max(0, i - 1), inx = Math.min(n - 1, i + 1);
      const dx = pts[2 * inx]! - pts[2 * ip]!, dy = pts[2 * inx + 1]! - pts[2 * ip + 1]!, L = Math.max(1, isqrt(dx * dx + dy * dy));
      const nx = idiv(-dy * hw, L), ny = idiv(dx * hw, L), x = pts[2 * i]!, y = pts[2 * i + 1]!;
      poly.push(x + nx, y + ny); right.push(x - nx, y - ny);
    }
    for (let i = right.length - 2; i >= 0; i -= 2) poly.push(right[i]!, right[i + 1]!);
    cv.poly(poly, c);
  }
  if (round) { cv.disc(pts[0]!, pts[1]!, hw, c); cv.disc(pts[2 * n - 2]!, pts[2 * n - 1]!, hw, c); }
}

/** The grain of the recorded picture, in 1/256 of a level per pixel: a per-pixel hash and a slow mottle, fixed for all time. */
function grainTable(groundLight: boolean): Int16Array {
  const amp = groundLight ? 563 : 410, mot = groundLight ? 640 : 384, out = new Int16Array(AW * AH); // 2.2 / 1.6 and 2.5 / 1.5 levels
  for (let y = 0; y < AH; y++) for (let x = 0; x < AW; x++) {
    out[y * AW + x] = idiv(((hash2(x, y, 7) >>> 16) - 32768) * amp, 32768) + idiv(fbm2(x * 8, y * 8, 2080, 107) * mot, NOISE_ONE);
  }
  return out;
}

function draw(plan: V10Plan, commitment: Uint8Array, S: number): Uint8Array {
  const W = V10_WIDTH * S, H = V10_HEIGHT * S, AWs = AW * S, AHs = AH * S;
  const pal = PALETTES_V10[plan.palette]!, tw = TWINS_V10[plan.palette]!;
  const cv = new Slots(S);
  cv.idx.fill(slot(0, 8));
  const sharp = plan.style === 2, round = plan.roundCaps === 1, OL = plan.outline * S, outlineSlot = slot(plan.outlineColour, 8);
  const scaled: number[] = [];
  for (const g of plan.segments) {
    scaled.length = 0;
    for (const v of g.points) scaled.push(v * S);
    const w = g.width * S;
    if (OL) drawPath(cv, scaled, w + 2 * OL, outlineSlot, sharp, round);
    drawPath(cv, scaled, w, slot(g.colour, g.tint), sharp, round);
  }
  // the colours: the mean of the four samples' tinted colours plus the grain; a reading pixel is exact
  const nslot = pal.length * 16, pr = new Int32Array(nslot), pg = new Int32Array(nslot), pb = new Int32Array(nslot);
  for (let k = 0; k < pal.length; k++) for (let t = 0; t < 16; t++) {
    const o = TINTS[t]!, p = pal[k]!;
    pr[k * 16 + t] = Math.min(255, Math.max(0, p[0] + o)); pg[k * 16 + t] = Math.min(255, Math.max(0, p[1] + o)); pb[k * 16 + t] = Math.min(255, Math.max(0, p[2] + o));
  }
  const lum = (c: RGB) => 299 * c[0] + 587 * c[1] + 114 * c[2];
  const grain = grainTable(lum(pal[0]!) > 128000);
  const px = new Uint8Array(W * H * 4);
  for (let i = 0; i < W * H; i++) { px[4 * i] = FRAME[0]; px[4 * i + 1] = FRAME[1]; px[4 * i + 2] = FRAME[2]; px[4 * i + 3] = 255; }
  const counts = new Int32Array(pal.length), idx = cv.idx, sw = cv.w;
  const bitAt = (x: number, y: number): number => { const k = (idiv(y, TH) << 4) + idiv(x, TW); return (commitment[k >> 3]! >> (7 - (k & 7))) & 1; };
  const clamp = (v: number) => (v < 0 ? 0 : v > 255 ? 255 : v);
  for (let y = 0; y < AHs; y++) {
    const readingRow = S === 1 && y % TH === RY, r0 = 2 * y * sw, r1 = r0 + sw, o = (OFF * S + y) * W + OFF * S, gy = idiv(y, S) * AW;
    for (let x = 0; x < AWs; x++) {
      const a = r0 + 2 * x, b = r1 + 2 * x, k0 = idx[a]!, k1 = idx[a + 1]!, k2 = idx[b]!, k3 = idx[b + 1]!;
      const i = (o + x) * 4;
      if (readingRow && x % TW === RX) {
        counts.fill(0);
        counts[k0 >> 4]!++; counts[k1 >> 4]!++; counts[k2 >> 4]!++; counts[k3 >> 4]!++;
        let best = 0;
        for (let k = 1; k < counts.length; k++) if (counts[k]! > counts[best]!) best = k;
        const col = (bitAt(x, y) ? tw : pal)[best]!;
        px[i] = col[0]; px[i + 1] = col[1]; px[i + 2] = col[2];
        continue;
      }
      const g = grain[gy + idiv(x, S)]!;
      px[i] = clamp((((pr[k0]! + pr[k1]! + pr[k2]! + pr[k3]! + 2) >> 2) * 256 + g + 128) >> 8);
      px[i + 1] = clamp((((pg[k0]! + pg[k1]! + pg[k2]! + pg[k3]! + 2) >> 2) * 256 + g + 128) >> 8);
      px[i + 2] = clamp((((pb[k0]! + pb[k1]! + pb[k2]! + pb[k3]! + 2) >> 2) * 256 + g + 128) >> 8);
    }
  }
  return px;
}

export function renderV10(plan: V10Plan, commitment: Uint8Array): Uint8Array { return draw(plan, commitment, 1); }
/** The same image at S times the resolution, for print: a redrawing, not the recorded file. */
export function renderV10At(plan: V10Plan, commitment: Uint8Array, S: number): Uint8Array { return draw(plan, commitment, S); }

/** Read the code from the art alone: the 256 reading pixels, their palette, and whether each is a twin. */
export function decodeV10(px: Uint8Array, width: number, height: number): Uint8Array | null {
  if (width !== V10_WIDTH || height !== V10_HEIGHT || px.length !== width * height * 4) return null;
  const same = (a: RGB, b: RGB) => a[0] === b[0] && a[1] === b[1] && a[2] === b[2];
  const read: RGB[] = [];
  for (let k = 0; k < 256; k++) {
    const x = OFF + TW * (k & 15) + RX, y = OFF + TH * (k >> 4) + RY;
    const i = (y * width + x) * 4;
    read.push([px[i]!, px[i + 1]!, px[i + 2]!]);
  }
  for (let p = 0; p < PALETTES_V10.length; p++) {
    const out = new Uint8Array(32);
    let ok = true;
    for (let k = 0; k < 256 && ok; k++) {
      if (TWINS_V10[p]!.some((c) => same(c, read[k]!))) out[k >> 3]! |= 1 << (7 - (k & 7));
      else if (!PALETTES_V10[p]!.some((c) => same(c, read[k]!))) ok = false;
    }
    if (ok) return out;
  }
  return null;
}
