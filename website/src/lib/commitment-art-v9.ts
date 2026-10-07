/**
 * bitgraph-art/9 (Mike, 2026-10-07): five families in one picture. Landscape, 1600 x 1024 with the
 * plain 32 px frame (art 1536 x 960), the code carried exactly as version 8 carries it.
 *
 * Every image layers the same five families, bottom to top, each painting flat palette indices into one
 * index map inside a region it owns, later layers over earlier ones:
 *   1 strata        the ground: two to five wide bands stacked under a wandering horizon (two long sines),
 *                   each band's thickness breathing along x (a slow swell and a small quick one; the running
 *                   sum of thicknesses never crosses), over the whole frame or only its lower or upper part;
 *   2 interference  ONE bounded region (a disc, a rectangle or a band across the frame) holding two families
 *                   of thick concentric bands (rings, squares, diamonds or stripes) from their own centres,
 *                   periods 100 to 210 px, duty 34 to 46 %; a four-entry table turns on/off into colours,
 *                   overlaps mostly in the third ink; outside the region nothing is drawn;
 *   3 cut paper     one to three big torn-edge shapes (disc, blob, half disc, ring, polygon, rectangle,
 *                   band), each laid down after a shadow duplicate offset by the image's light vector (10 to
 *                   24 px, 22 % more per layer) in the darkest palette colour that is not the shape's own
 *                   (the ground only when the ground is dark); the edges are a smoothed random walk of 2 to
 *                   6 px with up to three deeper nicks; a later shape overlaps the first;
 *   4 blocks        one small isometric cluster of three to nine blocks (2:1 prisms, back to front), standing
 *                   on the first paper shape or on a stratum's edge, top / left / right faces in the three inks;
 *   5 ribbons       two to five thick ribbons grown both ways along a smooth heading field (three long waves),
 *                   the turn per 5 px step clamped so the turning radius stays above 0.75 widths (the offset
 *                   curves never fold), stopping at the frame margin, at another ribbon (an 8 px occupancy
 *                   grid) or at a length limit; stubs under 2.5 widths are dropped; square ends.
 * The stream ("bitgraph-art/9") picks the palette, calm or loud (one in five: the upper ends of every
 * count), and the DOMINANT family, which is drawn largest; the other four are present but smaller.
 *
 * Everything is integer: positions in eighths of a pixel (UX = 8 x 1536, as version 8), angles as steps of
 * 1024 per turn read from version 6's SIN table, square roots by isqrt, polygons filled by scanline with the
 * half-open crossing rule and nonzero winding, no floating point and no clock in plan or draw. The plan is
 * geometry, plain integers; the drawing only rasterises it (at S times the size for print: every length
 * times S, no angle).
 *
 * Drawing: the index map is rasterised at 4 x 4 samples per pixel (sample (X, Y) is the point (2X + 1,
 * 2Y + 1) in eighths, version 6's sample positions), in strips of 16 rows so a print redrawing needs no
 * large buffer. A pixel whose 16 samples agree is that colour; otherwise it is the integer mean of its
 * samples' colours ((sum + 8) >> 4): version 6's edge smoothing, applied everywhere but the reading pixels.
 * The code: the art is a hidden grid of 16 x 16 tiles of 96 x 60 px; tile k (row-major) carries bit k of the
 * code, most significant bit of byte 0 first, in ONE pixel, its reading pixel (96c + 48, 60r + 30), never
 * smoothed: it takes the palette index that covers most of its 16 samples (the lowest index on a tie) and
 * is drawn in that colour's twin (one level away on each channel) when the bit is 1, in the colour itself
 * when it is 0. decodeV9 reads the 256 reading pixels, finds the palette whose colours and twins hold them
 * all (no colour or twin is shared between palettes), and takes each bit from whether its colour is a twin.
 */
import { sha256 } from "@noble/hashes/sha256";
import { PALETTES_V6, FRAME_V6 as FRAME, SIN_V6 as SIN, idiv } from "./commitment-art-v6.ts";

type RGB = readonly [number, number, number];
const LABEL = "bitgraph-art/9";
export const V9_WIDTH = 1600, V9_HEIGHT = 1024;
const OFF = 32, AW = 1536, AH = 960, UX = 8 * AW, UY = 8 * AH, TW = 96, TH = 60, RX = 48, RY = 30;
const COS = (a: number) => SIN[(a + 256) & 1023]!;
const hex = (h: string): RGB => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];
/** Version 6's eight palettes and three more (the 2026-10-07 sketches): [ground, ink 1, ink 2, ink 3]. Never reorder or edit. */
export const PALETTES_V9: readonly (readonly RGB[])[] = [
  ...PALETTES_V6,
  ...[
    ["#ebe3d2", "#1d3557", "#d1495b", "#edae49"], // bone / indigo / madder / ochre
    ["#0b132b", "#6fffe9", "#ffd166", "#ef476f"], // midnight / mint / sun / raspberry
    ["#f4f1ea", "#2541b2", "#f26419", "#1b1b1e"], // paper / ultramarine / orange / near-black
  ].map((p) => p.map(hex)),
];
const twin = (c: RGB): RGB => [c[0] < 128 ? c[0] + 1 : c[0] - 1, c[1] < 128 ? c[1] + 1 : c[1] - 1, c[2] < 128 ? c[2] + 1 : c[2] - 1];
export const TWINS_V9: readonly (readonly RGB[])[] = PALETTES_V9.map((p) => p.map(twin));

const px8 = (n: number) => n * 8;
function isqrt(n: number): number {
  if (n <= 0) return 0;
  let r = Math.floor(Math.sqrt(n));
  while (r * r > n) r--;
  while ((r + 1) * (r + 1) <= n) r++;
  return r;
}
/** The smallest m >= 0 with m * m >= n. */
const csqrt = (n: number): number => (n <= 0 ? 0 : isqrt(n - 1) + 1);
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
  private u32(): number {
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
  shuffle<T>(xs: T[]): T[] {
    for (let i = xs.length - 1; i > 0; i--) { const j = this.pick(i + 1); const t = xs[i]!; xs[i] = xs[j]!; xs[j] = t; }
    return xs;
  }
}

/* ── The plan: geometry in eighths of a pixel, every number from the stream ───────────────────── */

export interface V9Shape {
  /** 0 disc, 1 blob, 2 half disc, 3 ring, 4 polygon, 5 rectangle, 6 band. */
  kind: number;
  colour: number;
  /** The shadow's colour. */
  shade: number;
  cx: number;
  cy: number;
  /** The nominal radius. */
  r: number;
  /** Half disc: which half is kept (0 upper, 1 right, 2 lower, 3 left). */
  side: number;
  /** The shadow's offset. */
  dx: number;
  dy: number;
  /** Radial kinds: the torn radius at each of 256 angles (steps of 4). */
  radii: number[];
  /** Ring: the inner radii; half disc: the torn offsets along the cut. */
  inner: number[];
  /** Polygon kinds: the torn outline, subdivided about every 20 px. */
  points: number[];
}
export interface V9Plan {
  palette: number;
  loud: number;
  /** 0 strata, 1 interference, 2 cut paper, 3 blocks, 4 ribbons: drawn largest. */
  dominant: number;
  strata: {
    /** [hy, A0, L0, p0, A1, L1, p1]: the horizon's height, two swells (amplitude, wavelength, phase). */
    horizon: number[];
    /** Per band [base, m, L, p, m2, L2, p2, colour]: thickness, a slow breath (percent, wavelength, phase), a quick one. */
    bands: number[][];
  };
  interference: {
    /** [0, cx, cy, R] a disc; [1, x0, y0, x1, y1] a rectangle; [2, cx, cy, angle, half width] a band. */
    region: number[];
    /** Per family [type, cx, cy, period, on, phase, angle]; type 0 ring, 1 square, 2 diamond, 3 stripe. */
    families: number[][];
    /** The colour for off/off, on/off, off/on, on/on. */
    table: number[];
  };
  paper: V9Shape[];
  blocks: {
    ox: number;
    oy: number;
    /** Half the width of a cell's diamond; a level is half of it. */
    a: number;
    ni: number;
    nj: number;
    heights: number[];
    hollow: number[];
    /** The inks of the top, left and right faces. */
    faces: number[];
  };
  ribbons: Array<{ width: number; colour: number; points: number[] }>;
}

/** The horizon and the band boundaries below it at x, for a plan at the scale its lengths are in: out[off .. off + bands]. */
function strataBounds(horizon: number[], bands: number[][], x: number, out: Int32Array | number[], off: number): void {
  const [hy, A0, L0, p0, A1, L1, p1] = horizon as [number, number, number, number, number, number, number];
  let y = hy + idiv(A0 * SIN[(idiv(x * 1024, L0) + p0) & 1023]!, 16384) + idiv(A1 * SIN[(idiv(x * 1024, L1) + p1) & 1023]!, 16384);
  out[off] = y;
  for (let j = 0; j < bands.length; j++) {
    const [base, m, L, p, m2, L2, p2] = bands[j]! as [number, number, number, number, number, number, number];
    const t = base + idiv(base * (m * SIN[(idiv(x * 1024, L) + p) & 1023]! + m2 * SIN[(idiv(x * 1024, L2) + p2) & 1023]!), 1638400);
    y += Math.max(0, t);
    out[off + j + 1] = y;
  }
}

function planStrata(s: Stream, dominant: number, loud: number): V9Plan["strata"] {
  const mode = dominant === 0 ? 0 : s.of([0, 1, 1, 2]); // 0 the whole frame, 1 the lower part, 2 the upper part
  const n = loud ? 4 + s.pick(2) : 2 + s.pick(dominant === 0 ? 3 : 2);
  const hy = mode === 1 ? idiv(UY * (35 + s.pick(26)), 100) : -idiv(UY * (5 + s.pick(21)), 100);
  const horizon = [hy, px8(40 + s.pick(91)), px8(1500 + s.pick(1901)), s.pick(1024), px8(8 + s.pick(23)), px8(380 + s.pick(521)), s.pick(1024)];
  const inks = s.shuffle([1, 2, 3]);
  const weights: Array<[number, number]> = [[inks[0]!, 42], [inks[1]!, 28], [inks[2]!, 10], [0, 20]];
  const pickColour = (prev: number): number => { // two mains, an accent, gaps of ground; never the band above's colour
    let total = 0;
    for (const [c, w] of weights) if (c !== prev) total += w;
    let r = s.pick(total);
    for (const [c, w] of weights) { if (c === prev) continue; if (r < w) return c; r -= w; }
    return 0;
  };
  const p0 = s.pick(1024), dp = 57 + s.pick(139), Lb = px8(900 + s.pick(1701));
  const need = mode === 2 ? idiv(UY * (40 + s.pick(21)), 100) - hy : UY - hy + px8(260);
  const bases: number[] = [];
  let total = 0;
  for (let j = 0; j < n; j++) { const b = px8(60 + s.pick(161)); bases.push(b); total += b; }
  const bands: number[][] = [];
  let prev = 0;
  for (let j = 0; j < n; j++) {
    const lens = s.pick(5) === 0, m = lens ? 80 + s.pick(21) : 8 + s.pick(31);
    const c = pickColour(prev);
    bands.push([idiv(bases[j]! * need, total), m, idiv(Lb * (80 + s.pick(46)), 100), (p0 + j * dp + s.pick(99) - 49) & 1023, 3 + s.pick(8), px8(520 + s.pick(581)), s.pick(1024), c]);
    prev = c;
  }
  return { horizon, bands };
}

function planInterference(s: Stream, dominant: number, loud: number): V9Plan["interference"] {
  const big = dominant === 1;
  const kind = s.of([0, 0, 0, 1, 1, 2]); // mostly a disc; a band across the frame now and then
  const cx = idiv(UX * (20 + s.pick(61)), 100), cy = idiv(UY * (20 + s.pick(61)), 100);
  let region: number[];
  if (kind === 0) region = [0, cx, cy, px8(big ? 340 + s.pick(121) : loud ? 200 + s.pick(101) : 150 + s.pick(111))];
  else if (kind === 1) {
    const hw = px8(big ? 450 + s.pick(201) : loud ? 220 + s.pick(121) : 180 + s.pick(131)), hh = px8(big ? 250 + s.pick(131) : loud ? 150 + s.pick(81) : 120 + s.pick(91));
    region = [1, cx - hw, cy - hh, cx + hw, cy + hh];
  } else region = [2, cx, cy, s.pick(1024), px8(big ? 170 + s.pick(61) : loud ? 110 + s.pick(51) : 80 + s.pick(51))];
  const families: number[][] = [];
  for (let f = 0; f < 2; f++) {
    // calm: rings or squares, then rings (two ring systems beat; rings nest in a square; two square systems
    // made a maze); loud: the second family may be squares, diamonds or stripes, which hatch across rings
    const type = f === 0 ? s.of([0, 0, 0, 1]) : loud ? s.of([0, 0, 1, 2, 3]) : 0;
    // both centres near the region's: the two systems beat (a far centre only drew straight stripes through a small region)
    const fx = cx + px8(s.pick(241) - 120), fy = cy + px8(s.pick(241) - 120);
    // a second ring family beats slowly against a first (near-equal period); periods never under 100 px
    const P = f === 1 && type === 0 && families[0]![0] === 0 ? Math.max(px8(100), idiv(families[0]![3]! * (84 + s.pick(35)), 100)) : px8(104 + s.pick(107));
    families.push([type, fx, fy, P, idiv(P * (34 + s.pick(13)), 100), s.pick(P), s.pick(1024)]);
  }
  const [c1, c2, c3] = s.shuffle([1, 2, 3]) as [number, number, number];
  const table = s.of([[0, c1, c2, c3], [0, c1, c2, c3], [0, c1, c2, c3], [0, c1, c2, 0], [0, c1, c1, c2]]);
  return { region, families, table };
}

/** sqrt(W) * 1.6 / 2^20 for a box window of W entries: the sketch's amplitude normalisation, fixed. */
const TEAR_SCALE: Readonly<Record<number, number>> = { 5: 3751500, 7: 4438834, 9: 5033165, 11: 5564373, 13: 6049111, 15: 6497788 };
/** A torn edge: n offsets in eighths, a random walk box-smoothed twice (it wanders, it does not fizz), amp its size, with nicks deeper one way. */
function tearTable(s: Stream, n: number, amp: number, nicks: number, depth: number): number[] {
  const raw: number[] = [];
  for (let i = 0; i < n; i++) raw.push(s.pick(2001) - 1000);
  const span = Math.min(7, Math.max(2, idiv(n + 20, 40))), W = 2 * span + 1;
  const box = (src: number[]): number[] => {
    const out: number[] = [];
    for (let i = 0; i < n; i++) { let v = 0; for (let k = -span; k <= span; k++) v += src[(((i + k) % n) + n) % n]!; out.push(v); }
    return out;
  };
  const t = box(box(raw)).map((v) => idiv(v * amp * TEAR_SCALE[W]!, W * W * 1000 * 1048576));
  for (let q = 0; q < nicks; q++) {
    const at = s.pick(n), w = Math.max(1, idiv(n * (6 + s.pick(13)), 1024)), d = idiv(depth * (40 + s.pick(61)), 100);
    for (let k = -w; k <= w; k++) { const i = (((at + k) % n) + n) % n; t[i] = t[i]! - idiv(d * (w + 1 - Math.abs(k)), w + 1); }
  }
  return t;
}

/** The centre and a radius of the interference region: what a paper shape keeps clear of. */
function regionCentre(region: number[]): [number, number, number] {
  if (region[0] === 0) return [region[1]!, region[2]!, region[3]!];
  if (region[0] === 1) return [idiv(region[1]! + region[3]!, 2), idiv(region[2]! + region[4]!, 2), Math.min(region[3]! - region[1]!, region[4]! - region[2]!) >> 1];
  return [region[1]!, region[2]!, region[4]!];
}

function makeShape(s: Stream, big: boolean, dominant: boolean, first: V9Shape | null, region: number[]): V9Shape {
  const kind = big ? s.of([0, 1, 2, 6, 5, 1]) : s.of([0, 1, 3, 2, 4, 5, 1, 4]);
  const r = big ? idiv(UY * (dominant ? 32 + s.pick(24) : 18 + s.pick(13)), 100) : idiv(UY * (12 + s.pick(19)), 100);
  const clampX = (x: number) => Math.min(idiv(UX * 95, 100), Math.max(idiv(UX * 5, 100), x));
  const clampY = (y: number) => Math.min(idiv(UY * 95, 100), Math.max(idiv(UY * 5, 100), y));
  let cx: number, cy: number;
  if (!first) {
    cx = idiv(UX * (25 + s.pick(51)), 100); cy = idiv(UY * (30 + s.pick(41)), 100);
    // the first shape sits clear of the interference region's heart, so the rings are never wholly under it
    const [rx, ry, rr] = regionCentre(region), need = r + idiv(rr * 7, 10), d = isqrt((cx - rx) ** 2 + (cy - ry) ** 2);
    if (d < need) {
      if (d === 0) cx = clampX(rx + need);
      else { cx = clampX(rx + idiv((cx - rx) * need, d)); cy = clampY(ry + idiv((cy - ry) * need, d)); }
    }
  } else { // overlaps the first shape: its centre within 0.3 to 0.85 of the two radii from the first's
    const ang = s.pick(1024), dist = idiv((first.r + r) * (30 + s.pick(56)), 100);
    cx = clampX(first.cx + idiv(dist * COS(ang), 16384));
    cy = clampY(first.cy + idiv(dist * SIN[ang]!, 16384));
  }
  const amp = px8(2 + s.pick(5)), nicks = s.pick(4), depth = px8(8 + s.pick(9));
  const sh: V9Shape = { kind, colour: 0, shade: 0, cx, cy, r, side: 0, dx: 0, dy: 0, radii: [], inner: [], points: [] };
  if (kind <= 3) {
    const tear = tearTable(s, 256, amp, nicks, depth);
    const lobes: number[][] = kind === 1 ? [[2, 4 + s.pick(9), s.pick(1024)], [3, 3 + s.pick(8), s.pick(1024)], [5, s.pick(6), s.pick(1024)]] : [];
    for (let i = 0; i < 256; i++) {
      let v = r;
      for (const [m, b, p] of lobes) v += idiv(r * b! * SIN[(m! * 4 * i + p!) & 1023]!, 1638400);
      sh.radii.push(v + tear[i]!);
    }
    if (kind === 3) { const ri = idiv(r * (45 + s.pick(26)), 100), t2 = tearTable(s, 256, amp, 0, 0); for (let i = 0; i < 256; i++) sh.inner.push(ri + t2[i]!); }
    if (kind === 2) { sh.side = s.pick(4); sh.inner = tearTable(s, Math.max(1, idiv(2 * r + 80, 160)) + 1, amp, 0, 0); }
    return sh;
  }
  // polygons, rectangles and bands: vertices, then every edge subdivided about every 20 px with a torn offset
  const verts: number[] = [];
  if (kind === 4) {
    const n = 3 + s.pick(4), a0 = s.pick(1024);
    for (let i = 0; i < n; i++) { const a = (a0 + idiv(1024 * i, n)) & 1023, rv = idiv(r * (60 + s.pick(51)), 100); verts.push(cx + idiv(rv * COS(a), 16384), cy + idiv(rv * SIN[a]!, 16384)); }
  } else {
    const hw = kind === 6 ? px8(2400) : idiv(r * (100 + s.pick(81)), 100), hh = kind === 6 ? idiv(r * (30 + s.pick(31)), 100) : idiv(r * (35 + s.pick(46)), 100);
    const rot = kind === 6 ? s.pick(512) : (s.pick(33) - 16) & 1023;
    for (const [ux, uy] of [[-1, -1], [1, -1], [1, 1], [-1, 1]] as const) verts.push(cx + idiv(ux * hw * COS(rot) - uy * hh * SIN[rot]!, 16384), cy + idiv(ux * hw * SIN[rot]! + uy * hh * COS(rot), 16384));
  }
  const nv = verts.length / 2;
  for (let i = 0; i < nv; i++) {
    const xa = verts[2 * i]!, ya = verts[2 * i + 1]!, xb = verts[(2 * i + 2) % (2 * nv)]!, yb = verts[(2 * i + 3) % (2 * nv)]!;
    const ex = xb - xa, ey = yb - ya, len = Math.max(1, isqrt(ex * ex + ey * ey)), segs = Math.max(1, idiv(len + 80, 160));
    const tear = tearTable(s, segs + 1, amp, Math.min(nicks, idiv(segs, 12)), depth);
    for (let q = 0; q < segs; q++) { const off = q === 0 ? 0 : tear[q]!; sh.points.push(xa + idiv(ex * q, segs) + idiv(-ey * off, len), ya + idiv(ey * q, segs) + idiv(ex * off, len)); }
  }
  return sh;
}

function planPaper(s: Stream, dominant: number, loud: number, pal: readonly RGB[], region: number[]): V9Shape[] {
  const big = dominant === 2;
  const count = big ? (loud ? 3 : 2 + s.pick(2)) : loud ? 2 : 1 + s.pick(2);
  const sx = (s.pick(2) === 0 ? -1 : 1) * px8(10 + s.pick(11)), sy = px8(12 + s.pick(13)); // the light
  const lum = (c: RGB) => 2126 * c[0] + 7152 * c[1] + 722 * c[2];
  const darkGround = lum(pal[0]!) < 1_000_000;
  const byDark = [0, 1, 2, 3].sort((p, q) => lum(pal[p]!) - lum(pal[q]!) || p - q);
  const shadeFor = (c: number): number => { for (const k of byDark) { if (k === c || (k === 0 && !darkGround)) continue; return k; } return 1; };
  const shapes: V9Shape[] = [];
  let prev = 0;
  for (let k = 0; k < count; k++) {
    const sh = makeShape(s, k === 0, big, shapes[0] ?? null, region);
    let c = k > 0 && s.pick(6) === 0 ? 0 : 1 + s.pick(3);
    if (c === prev) c = 1 + (prev % 3); // never the colour of the shape under it
    sh.colour = c;
    sh.shade = shadeFor(c);
    sh.dx = idiv(sx * (100 + 22 * k), 100);
    sh.dy = idiv(sy * (100 + 22 * k), 100);
    shapes.push(sh);
    prev = c;
  }
  return shapes;
}

function planBlocks(s: Stream, dominant: number, loud: number, strata: V9Plan["strata"], paper: V9Shape[]): V9Plan["blocks"] {
  const big = dominant === 3;
  const [ni, nj] = (loud || big ? s.of([[2, 3], [3, 2], [3, 3], [2, 4], [4, 2]]) : s.of([[2, 2], [2, 3], [3, 2]])) as [number, number];
  const a = px8(big ? 56 + s.pick(25) : 34 + s.pick(17));
  const n = ni * nj, heights: number[] = [], hollow: number[] = [];
  for (let k = 0; k < n; k++) { heights.push(1 + s.pick(big ? 3 : 2)); hollow.push(0); }
  // towers: a few cells higher, never above 7 levels (5 when small), so the cluster stays an object and not a skyline
  const towers = loud || big ? 2 + s.pick(2) : 1 + s.pick(2), hollowTops = s.pick(3) === 0, cap = big ? 7 : 5;
  for (let t = 0; t < towers; t++) { const k = s.pick(n); heights[k] = Math.min(cap, heights[k]! + (big ? 2 + s.pick(3) : 1 + s.pick(3))); if (hollowTops && s.pick(3) === 0) hollow[k] = 1; }
  const faces = s.shuffle([1, 2, 3]);
  // Where it stands: its footprint centred on the first paper shape, or its front corner on a stratum's edge.
  let ox = 0, oy = 0, placed = false;
  if (s.pick(2) === 1) {
    const x = idiv(UX * (15 + s.pick(71)), 100), b: number[] = [];
    strataBounds(strata.horizon, strata.bands, x, b, 0);
    const edges = b.filter((y) => y >= idiv(UY * 15, 100) && y <= idiv(UY * 90, 100));
    if (edges.length > 0) {
      const y = s.of(edges) + idiv(a, 2);
      ox = x - (ni - nj) * a; oy = y - idiv((ni + nj) * a, 2);
      placed = true;
    }
  }
  if (!placed) {
    const sh = paper[0]!, fx = sh.cx + px8(s.pick(81) - 40), fy = sh.cy + px8(s.pick(61) - 30);
    ox = fx - idiv((ni - nj) * a, 2); oy = fy - idiv((ni + nj) * a, 4);
  }
  // the whole cluster stays inside the art
  let hmax = 0;
  for (const h of heights) hmax = Math.max(hmax, h);
  const margin = px8(16), xmin = ox - nj * a, xmax = ox + ni * a, ymin = oy - idiv(hmax * a, 2), ymax = oy + idiv((ni + nj) * a, 2);
  if (xmin < margin) ox += margin - xmin; else if (xmax > UX - margin) ox -= xmax - (UX - margin);
  if (ymin < margin) oy += margin - ymin; else if (ymax > UY - margin) oy -= ymax - (UY - margin);
  return { ox, oy, a, ni, nj, heights, hollow, faces };
}

function planRibbons(s: Stream, dominant: number, loud: number): V9Plan["ribbons"] {
  const big = dominant === 4;
  const target = big ? (loud ? 5 : 3 + s.pick(2)) : loud ? 3 + s.pick(2) : 2 + s.pick(2);
  // the field: a heading near horizontal (one in six near vertical), bent by three long waves
  const th0 = (s.pick(147) - 73 + (s.pick(6) === 0 ? 256 : 0)) & 1023;
  const turbulent = loud === 1 && s.pick(2) === 0; // a calm image's ribbons never wriggle
  const waves: number[][] = [];
  for (let k = 0; k < 3; k++) waves.push([turbulent ? 65 + s.pick(66) : 24 + s.pick(42), s.pick(1024), px8(turbulent ? 450 + s.pick(651) : 700 + s.pick(1501)), s.pick(1024)]);
  const field = (x: number, y: number): number => {
    let t = th0;
    for (const [A, ang, L, p] of waves) t += idiv(A! * SIN[(idiv((x * COS(ang!) + y * SIN[ang!]!) * 1024, L! * 16384) + p!) & 1023]!, 16384);
    return t & 1023;
  };
  // occupancy: 8 px cells over a margin of 200 px around the art
  const gap = px8(10 + s.pick(11)), M = px8(200), G = 64, gw = cdiv(UX + 2 * M, G), gh = cdiv(UY + 2 * M, G);
  const occ = new Uint8Array(gw * gh);
  const hits = (x: number, y: number, r: number, id: number): boolean => {
    const X0 = Math.max(0, idiv(x - r + M, G)), X1 = Math.min(gw - 1, idiv(x + r + M, G)), Y0 = Math.max(0, idiv(y - r + M, G)), Y1 = Math.min(gh - 1, idiv(y + r + M, G));
    for (let Y = Y0; Y <= Y1; Y++) for (let X = X0; X <= X1; X++) {
      const ex = X * G + 32 - M - x, ey = Y * G + 32 - M - y;
      if (ex * ex + ey * ey <= r * r) { const o = occ[Y * gw + X]!; if (o !== 0 && o !== id) return true; }
    }
    return false;
  };
  const stamp = (x: number, y: number, r: number, id: number): void => {
    const X0 = Math.max(0, idiv(x - r + M, G)), X1 = Math.min(gw - 1, idiv(x + r + M, G)), Y0 = Math.max(0, idiv(y - r + M, G)), Y1 = Math.min(gh - 1, idiv(y + r + M, G));
    for (let Y = Y0; Y <= Y1; Y++) for (let X = X0; X <= X1; X++) {
      const ex = X * G + 32 - M - x, ey = Y * G + 32 - M - y;
      if (ex * ex + ey * ey <= r * r) occ[Y * gw + X] = id;
    }
  };
  const widths: number[] = [];
  for (let k = 0; k < target; k++) widths.push(px8(big ? s.of([96, 120, 150, 180, 210]) : loud ? s.of([48, 64, 80, 96, 120]) : s.of([64, 80, 96, 120])));
  widths.sort((p, q) => q - p); // the fat ones claim space first
  // start points: a jittered grid over the art and its margin, in a shuffled order
  const cand: number[][] = [];
  for (let gy = -80; gy < AH + 80; gy += 120) for (let gx = -80; gx < AW + 80; gx += 120) cand.push([px8(gx + s.pick(111)), px8(gy + s.pick(111))]);
  s.shuffle(cand);
  const ribbons: V9Plan["ribbons"] = [];
  for (let t = 0; t < cand.length && ribbons.length < target; t++) {
    const [x0, y0] = cand[t]! as [number, number];
    const w = widths[ribbons.length]!, r = idiv(w + gap, 2), id = ribbons.length + 1, half = idiv(gap, 2);
    if (hits(x0, y0, r + half, id)) continue;
    // 5 px a step: 500 to 1400 px short, 1600 to 4800 long; when ribbons are not the subject, half are short and none wraps the frame twice
    const maxSteps = big ? (s.pick(3) === 0 ? 100 + s.pick(181) : 320 + s.pick(641)) : s.pick(2) === 0 ? 100 + s.pick(181) : 320 + s.pick(281);
    const maxTurn = idiv(8692, w); // per step, in 1024ths of a turn: the turning radius stays above 0.75 widths
    // positions in 1/128 of an eighth while tracing; the field is read and the points are kept in eighths
    const trace = (dir: number): number[] => {
      const pts = [x0, y0];
      let x = x0 * 128, y = y0 * 128, th = (field(x0, y0) + (dir < 0 ? 512 : 0)) & 1023, steps = 0;
      while (steps < maxSteps) {
        const want = (field(idiv(x, 128), idiv(y, 128)) + (dir < 0 ? 512 : 0)) & 1023;
        const d = Math.max(-maxTurn, Math.min(maxTurn, ((want - th + 512) & 1023) - 512));
        th = (th + d) & 1023;
        const nx = x + idiv(5120 * COS(th), 16384), ny = y + idiv(5120 * SIN[th]!, 16384);
        const nxu = idiv(nx, 128), nyu = idiv(ny, 128);
        if (nxu < -M + r || nxu > UX + M - r || nyu < -M + r || nyu > UY + M - r) break;
        if (hits(nxu, nyu, r + half, id)) break;
        x = nx; y = ny; steps++;
        pts.push(nxu, nyu);
      }
      return pts;
    };
    const fwd = trace(1), back = trace(-1), pts: number[] = [];
    for (let k = back.length - 2; k >= 2; k -= 2) pts.push(back[k]!, back[k + 1]!);
    for (let k = 0; k < fwd.length; k += 2) pts.push(fwd[k]!, fwd[k + 1]!);
    if (pts.length / 2 < Math.max(idiv(w + 15, 16), 32)) continue; // stubs shorter than 2.5 widths are not kept
    for (let k = 0; k < pts.length; k += 2) stamp(pts[k]!, pts[k + 1]!, r, id);
    ribbons.push({ width: w, colour: 0, points: pts });
  }
  // colours: the three inks, neighbours in the placement order differ
  const inks = s.shuffle([1, 2, 3]);
  let prev = -1;
  for (const rb of ribbons) {
    let i = s.pick(10) < 5 ? 0 : s.pick(10) < 7 ? 1 : 2;
    if (inks[i] === prev && ribbons.length > 1) i = (i + 1) % 3;
    rb.colour = inks[i]!;
    prev = rb.colour;
  }
  return ribbons;
}

export function planV9(commitment: Uint8Array): V9Plan {
  const s = new Stream(commitment);
  const palette = s.pick(PALETTES_V9.length);
  const loud = s.pick(5) === 0 ? 1 : 0;
  const dominant = s.pick(5);
  const strata = planStrata(s, dominant, loud);
  const interference = planInterference(s, dominant, loud);
  const paper = planPaper(s, dominant, loud, PALETTES_V9[palette]!, interference.region);
  const blocks = planBlocks(s, dominant, loud, strata, paper);
  const ribbons = planRibbons(s, dominant, loud);
  return { palette, loud, dominant, strata, interference, paper, blocks, ribbons };
}

/* ── Drawing: the index map in strips of 16 rows, 4 x 4 samples a pixel, then the colours ─────────
 * Sample (X, Y) is the point (2X + 1, 2Y + 1) in eighths. A span [xa, xb) in eighths covers the samples
 * X with 2X + 1 in it; for integer bounds that is [idiv(xa, 2), idiv(xb, 2)), and a point at or past a
 * rational crossing N / D (D > 0) is the first X with (2X + 1) D >= N, idiv(N + D - 1, 2D). */

const STRIP = 16, SROWS = 4 * STRIP;

interface Edges { xa: number[]; ya: number[]; xb: number[]; yb: number[]; dir: number[]; y0: number[]; y1: number[]; colour: number; ymin: number; ymax: number }

/** The edges of a filled shape (one or more contours, nonzero winding), each with the sample rows it crosses. */
function edgesOf(contours: number[][], colour: number, rows: number): Edges | null {
  const e: Edges = { xa: [], ya: [], xb: [], yb: [], dir: [], y0: [], y1: [], colour, ymin: rows, ymax: 0 };
  for (const c of contours) {
    const n = c.length / 2;
    for (let i = 0; i < n; i++) {
      let xa = c[2 * i]!, ya = c[2 * i + 1]!, xb = c[(2 * i + 2) % (2 * n)]!, yb = c[(2 * i + 3) % (2 * n)]!, dir = 1;
      if (ya === yb) continue;
      if (ya > yb) { const tx = xa, ty = ya; xa = xb; ya = yb; xb = tx; yb = ty; dir = -1; }
      const y0 = Math.max(0, idiv(ya, 2)), y1 = Math.min(rows, idiv(yb, 2)); // the rows Y with ya <= 2Y + 1 < yb
      if (y1 <= y0) continue;
      e.xa.push(xa); e.ya.push(ya); e.xb.push(xb); e.yb.push(yb); e.dir.push(dir); e.y0.push(y0); e.y1.push(y1);
      e.ymin = Math.min(e.ymin, y0); e.ymax = Math.max(e.ymax, y1);
    }
  }
  return e.xa.length === 0 ? null : e;
}

/** Fill the rows [Y0, Y1) of a strip buffer whose first row is row Y0. */
function fillEdges(e: Edges, buf: Uint8Array, SW: number, Y0: number, Y1: number): void {
  if (e.ymax <= Y0 || e.ymin >= Y1) return;
  const active: number[] = [];
  for (let i = 0; i < e.xa.length; i++) if (e.y0[i]! < Y1 && e.y1[i]! > Y0) active.push(i);
  const cx: number[] = [], cd: number[] = [];
  for (let Y = Math.max(Y0, e.ymin); Y < Math.min(Y1, e.ymax); Y++) {
    const y = 2 * Y + 1;
    cx.length = 0; cd.length = 0;
    for (const i of active) {
      if (Y < e.y0[i]! || Y >= e.y1[i]!) continue;
      const D = e.yb[i]! - e.ya[i]!, N = e.xa[i]! * D + (y - e.ya[i]!) * (e.xb[i]! - e.xa[i]!);
      const X = idiv(N + D - 1, 2 * D), d = e.dir[i]!;
      let k = cx.length; // insertion sort by X
      cx.push(X); cd.push(d);
      while (k > 0 && cx[k - 1]! > X) { cx[k] = cx[k - 1]!; cd[k] = cd[k - 1]!; k--; }
      cx[k] = X; cd[k] = d;
    }
    const row = (Y - Y0) * SW;
    let wind = 0;
    for (let k = 0; k + 1 < cx.length; k++) {
      wind += cd[k]!;
      if (wind === 0) continue;
      const a = Math.max(0, cx[k]!), b = Math.min(SW, cx[k + 1]!);
      if (b > a) buf.fill(e.colour, row + a, row + b);
    }
  }
}

interface Family { type: number; cx: number; cy: number; P: number; on: number; ph: number; c: number; s: number; kmax: number }

/** One family's on-intervals along sample row y (eighths), as [Xa, Xb) pairs in increasing order within [X0, X1). */
function familyRow(f: Family, y: number, X0: number, X1: number, out: number[]): void {
  out.length = 0;
  const emit = (xa: number, xb: number): void => { // inclusive bounds in eighths
    const a = Math.max(X0, idiv(xa, 2)), b = Math.min(X1, idiv(xb + 1, 2));
    if (b > a) out.push(a, b);
  };
  const dy = y - f.cy, h = Math.abs(dy);
  if (f.type === 3) { // stripes: d = |dx c + dy s| / 16384 with c >= 0, increasing in dx
    const K = dy * f.s;
    if (f.c === 0) { if ((idiv(Math.abs(K), 16384) + f.ph) % f.P < f.on) out.push(X0, X1); return; }
    const emitD = (lo: number, hi: number): void => { const xa = f.cx + cdiv(lo - K, f.c), xb = f.cx + cdiv(hi - K, f.c) - 1; if (xb >= xa) emit(xa, xb); };
    const as: number[] = [], bs: number[] = [];
    for (let k = 0; k <= f.kmax; k++) { const b = k * f.P - f.ph + f.on; if (b > 0) { as.push(Math.max(0, k * f.P - f.ph)); bs.push(b); } }
    for (let i = as.length - 1; i >= 0; i--) if (as[i]! > 0) emitD(-16384 * bs[i]! + 1, -16384 * as[i]! + 1);
    if (as.length > 0 && as[0] === 0) emitD(-16384 * bs[0]! + 1, 16384 * bs[0]!);
    for (let i = 0; i < as.length; i++) if (as[i]! > 0) emitD(16384 * as[i]!, 16384 * bs[i]!);
    return;
  }
  const neg: number[] = [], pos: number[] = [];
  let c0 = 0, c1 = -1;
  for (let k = 0; k <= f.kmax; k++) {
    const a = Math.max(0, k * f.P - f.ph), b = k * f.P - f.ph + f.on; // the band of distances [a, b)
    if (b <= 0) continue;
    let m1: number, m2: number; // |dx| in [m1, m2)
    if (f.type === 0) { if (b * b <= h * h) continue; m1 = a <= h ? 0 : csqrt(a * a - h * h); m2 = csqrt(b * b - h * h); }
    else if (f.type === 1) { if (b <= h) continue; m1 = a <= h ? 0 : a; m2 = b; }
    else { if (b <= h) continue; m1 = a <= h ? 0 : a - h; m2 = b - h; }
    if (m2 <= m1) continue;
    if (m1 === 0) { c0 = f.cx - m2 + 1; c1 = f.cx + m2 - 1; }
    else { neg.push(f.cx - m2 + 1, f.cx - m1); pos.push(f.cx + m1, f.cx + m2 - 1); }
  }
  for (let i = neg.length - 2; i >= 0; i -= 2) emit(neg[i]!, neg[i + 1]!);
  if (c1 >= c0) emit(c0, c1);
  for (let i = 0; i < pos.length; i += 2) emit(pos[i]!, pos[i + 1]!);
}

/** The samples of row y (eighths) inside the region, [X0, X1), or null. */
function regionRow(region: number[], y: number, SW: number): [number, number] | null {
  const clip = (xa: number, xb: number): [number, number] | null => { const a = Math.max(0, idiv(xa, 2)), b = Math.min(SW, idiv(xb + 1, 2)); return b > a ? [a, b] : null; };
  if (region[0] === 0) {
    const [, cx, cy, R] = region as [number, number, number, number], dy = y - cy;
    if (dy * dy > R * R) return null;
    const w = isqrt(R * R - dy * dy);
    return clip(cx - w, cx + w);
  }
  if (region[0] === 1) {
    const [, x0, y0, x1, y1] = region as [number, number, number, number, number];
    return y >= y0 && y < y1 ? clip(x0, x1 - 1) : null;
  }
  const [, cx, cy, ang, hw] = region as [number, number, number, number, number];
  const c = COS(ang), s = SIN[ang]!, dy = y - cy, H = hw * 16384, t = -s, lo = -H - dy * c, hi = H - dy * c; // dx t in [lo, hi]
  if (t === 0) return lo <= 0 && 0 <= hi ? [0, SW] : null;
  const dxa = t > 0 ? cdiv(lo, t) : cdiv(-hi, -t), dxb = t > 0 ? idiv(hi, t) : idiv(-lo, -t);
  return dxb >= dxa ? clip(cx + dxa, cx + dxb) : null;
}

function draw(plan: V9Plan, commitment: Uint8Array, S: number): Uint8Array {
  const W = V9_WIDTH * S, H = V9_HEIGHT * S, AWs = AW * S, AHs = AH * S, SW = 4 * AWs, rows = 4 * AHs;
  const pal = PALETTES_V9[plan.palette]!, tw = TWINS_V9[plan.palette]!;
  // 1 strata: every sample column's boundaries, and how many each column has passed (rows come top to bottom)
  const horizon = plan.strata.horizon.map((v, i) => (i === 3 || i === 6 ? v : v * S));
  const bands = plan.strata.bands.map((b) => [b[0]! * S, b[1]!, b[2]! * S, b[3]!, b[4]!, b[5]! * S, b[6]!, b[7]!]);
  const nb = bands.length, bounds = new Int32Array(SW * (nb + 1)), passed = new Uint8Array(SW), bandColour = new Uint8Array(nb + 2);
  for (let X = 0; X < SW; X++) strataBounds(horizon, bands, 2 * X + 1, bounds, X * (nb + 1));
  for (let j = 0; j < nb; j++) bandColour[j + 1] = bands[j]![7]!;
  // 2 interference: the region and two families, scaled
  const region = plan.interference.region.map((v, i) => (plan.interference.region[0] === 2 && i === 3 ? v : i === 0 ? v : v * S));
  const far = (cx: number, cy: number) => Math.max(Math.abs(cx), Math.abs(SW * 2 - cx)) + Math.max(Math.abs(cy), Math.abs(rows * 2 - cy)); // a bound on every distance in the art
  const families: Family[] = plan.interference.families.map(([type, cx, cy, P, on, ph, ang]) => {
    let c = COS(ang!), s = SIN[ang!]!;
    if (c < 0) { c = -c; s = -s; }
    return { type: type!, cx: cx! * S, cy: cy! * S, P: P! * S, on: on! * S, ph: ph! * S, c, s, kmax: idiv(far(cx! * S, cy! * S) + ph! * S, P! * S) + 1 };
  });
  const table = plan.interference.table;
  // 3, 4, 5: filled shapes, in drawing order
  const shapes: Edges[] = [];
  const add = (contours: number[][], colour: number) => { const e = edgesOf(contours, colour, rows); if (e) shapes.push(e); };
  for (const sh of plan.paper) {
    add(paperContours(sh, S, sh.dx * S, sh.dy * S), sh.shade);
    add(paperContours(sh, S, 0, 0), sh.colour);
  }
  for (const f of blockFaces(plan.blocks, S)) add([f.contour], f.colour);
  for (const rb of plan.ribbons) add([ribbonContour(rb, S)], rb.colour);

  const px = new Uint8Array(W * H * 4);
  for (let i = 0; i < W * H; i++) { px[4 * i] = FRAME[0]; px[4 * i + 1] = FRAME[1]; px[4 * i + 2] = FRAME[2]; px[4 * i + 3] = 255; }
  const buf = new Uint8Array(SROWS * SW), L1: number[] = [], L2: number[] = [], counts = [0, 0, 0, 0];
  const bitAt = (x: number, y: number): number => { const k = (idiv(y, TH) << 4) + idiv(x, TW); return (commitment[k >> 3]! >> (7 - (k & 7))) & 1; };
  for (let y0 = 0; y0 < AHs; y0 += STRIP) {
    const Y0 = 4 * y0, Y1 = Y0 + SROWS;
    for (let Y = Y0; Y < Y1; Y++) {
      const y = 2 * Y + 1, row = (Y - Y0) * SW;
      for (let X = 0; X < SW; X++) {
        let k = passed[X]!;
        const base = X * (nb + 1);
        while (k <= nb && y >= bounds[base + k]!) k++;
        passed[X] = k;
        buf[row + X] = bandColour[k]!;
      }
      const seg = regionRow(region, y, SW);
      if (seg !== null) {
        const [X0, X1] = seg;
        familyRow(families[0]!, y, X0, X1, L1);
        familyRow(families[1]!, y, X0, X1, L2);
        let i = 0, j = 0, x = X0;
        while (x < X1) {
          while (i < L1.length && L1[i + 1]! <= x) i += 2;
          while (j < L2.length && L2[j + 1]! <= x) j += 2;
          const in1 = i < L1.length && L1[i]! <= x, in2 = j < L2.length && L2[j]! <= x;
          const n1 = i < L1.length ? (in1 ? L1[i + 1]! : L1[i]!) : X1, n2 = j < L2.length ? (in2 ? L2[j + 1]! : L2[j]!) : X1;
          const nx = Math.min(n1, n2, X1);
          buf.fill(table[(in1 ? 1 : 0) + (in2 ? 2 : 0)]!, row + x, row + nx);
          x = nx;
        }
      }
    }
    for (const e of shapes) fillEdges(e, buf, SW, Y0, Y1);
    // the colours: flat where the 16 samples agree, their mean otherwise; a reading pixel is exact
    for (let yy = 0; yy < STRIP; yy++) {
      const y = y0 + yy, readingRow = S === 1 && y % TH === RY, o = (OFF * S + y) * W + OFF * S;
      for (let x = 0; x < AWs; x++) {
        const b = 4 * yy * SW + 4 * x, c0 = buf[b]!;
        let flat = true;
        for (let j = 0; j < 4 && flat; j++) { const r = b + j * SW; if (buf[r] !== c0 || buf[r + 1] !== c0 || buf[r + 2] !== c0 || buf[r + 3] !== c0) flat = false; }
        let col: RGB;
        if (readingRow && x % TW === RX) {
          counts[0] = counts[1] = counts[2] = counts[3] = 0;
          for (let j = 0; j < 4; j++) { const r = b + j * SW; for (let i = 0; i < 4; i++) counts[buf[r + i]!]!++; }
          let c = 0;
          for (let i = 1; i < 4; i++) if (counts[i]! > counts[c]!) c = i;
          col = (bitAt(x, y) ? tw : pal)[c]!;
        } else if (flat) col = pal[c0]!;
        else {
          let r = 0, g = 0, bl = 0;
          for (let j = 0; j < 4; j++) { const rr = b + j * SW; for (let i = 0; i < 4; i++) { const p = pal[buf[rr + i]!]!; r += p[0]; g += p[1]; bl += p[2]; } }
          col = [(r + 8) >> 4, (g + 8) >> 4, (bl + 8) >> 4];
        }
        const i = (o + x) * 4;
        px[i] = col[0]; px[i + 1] = col[1]; px[i + 2] = col[2];
      }
    }
  }
  return px;
}

/** A paper shape's outline at scale S, moved by (dx, dy): one contour, or two for a ring (the inner one reversed). */
function paperContours(sh: V9Shape, S: number, dx: number, dy: number): number[][] {
  const cx = sh.cx * S + dx, cy = sh.cy * S + dy;
  if (sh.kind >= 4) {
    const p: number[] = [];
    for (let i = 0; i < sh.points.length; i += 2) p.push(sh.points[i]! * S + dx, sh.points[i + 1]! * S + dy);
    return [p];
  }
  if (sh.kind === 2) {
    const start = (512 + 256 * sh.side) & 1023, arc: number[] = [];
    for (let i = 0; i <= 128; i++) { const ang = (start + 4 * i) & 1023, rr = sh.radii[ang >> 2]! * S; arc.push(cx + idiv(rr * COS(ang), 16384), cy + idiv(rr * SIN[ang]!, 16384)); }
    // the torn cut, from the arc's end back to its start
    const n = arc.length, ex = arc[n - 2]!, ey = arc[n - 1]!, vx = arc[0]! - ex, vy = arc[1]! - ey, len = Math.max(1, isqrt(vx * vx + vy * vy)), segs = sh.inner.length - 1;
    for (let q = 1; q < segs; q++) { const t = sh.inner[q]! * S; arc.push(ex + idiv(vx * q, segs) + idiv(-vy * t, len), ey + idiv(vy * q, segs) + idiv(vx * t, len)); }
    return [arc];
  }
  const outer: number[] = [];
  for (let i = 0; i < 256; i++) { const rr = sh.radii[i]! * S; outer.push(cx + idiv(rr * COS(4 * i), 16384), cy + idiv(rr * SIN[4 * i]!, 16384)); }
  if (sh.kind !== 3) return [outer];
  const inner: number[] = [];
  for (let i = 255; i >= 0; i--) { const rr = sh.inner[i]! * S; inner.push(cx + idiv(rr * COS(4 * i), 16384), cy + idiv(rr * SIN[4 * i]!, 16384)); }
  return [outer, inner];
}

/** The cluster's faces at scale S, back to front: left, right and top of every cell. */
function blockFaces(bl: V9Plan["blocks"], S: number): Array<{ contour: number[]; colour: number }> {
  const a = bl.a * S, hL = idiv(a, 2), ox = bl.ox * S, oy = bl.oy * S, [cTop, cLeft, cRight] = bl.faces as [number, number, number], { ni, nj } = bl;
  const P = (i: number, j: number): [number, number] => [ox + (i - j) * a, oy + idiv((i + j) * a, 2)];
  const out: Array<{ contour: number[]; colour: number }> = [];
  for (let d = 0; d <= ni + nj - 2; d++) {
    for (let i = Math.max(0, d - nj + 1); i <= Math.min(ni - 1, d); i++) {
      const j = d - i, e = bl.heights[j * ni + i]! * hL;
      const [x00, y00] = P(i, j), [x10, y10] = P(i + 1, j), [x11, y11] = P(i + 1, j + 1), [x01, y01] = P(i, j + 1);
      out.push({ contour: [x01, y01 - e, x11, y11 - e, x11, y11, x01, y01], colour: cLeft });
      out.push({ contour: [x11, y11 - e, x10, y10 - e, x10, y10, x11, y11], colour: cRight });
      out.push({ contour: [x00, y00 - e, x10, y10 - e, x11, y11 - e, x01, y01 - e], colour: bl.hollow[j * ni + i] ? 0 : cTop });
    }
  }
  return out;
}

/** A ribbon's outline at scale S: the left offsets forward, the right ones back; square ends. */
function ribbonContour(rb: V9Plan["ribbons"][number], S: number): number[] {
  const p = rb.points, n = p.length / 2, hw = idiv(rb.width * S, 2), L: number[] = [], R: number[] = [];
  for (let k = 0; k < n; k++) {
    const x = p[2 * k]! * S, y = p[2 * k + 1]! * S, ka = Math.max(0, k - 1), kb = Math.min(n - 1, k + 1);
    const tx = (p[2 * kb]! - p[2 * ka]!) * S, ty = (p[2 * kb + 1]! - p[2 * ka + 1]!) * S, len = Math.max(1, isqrt(tx * tx + ty * ty));
    const ox = idiv(ty * hw, len), oy = idiv(tx * hw, len);
    L.push(x - ox, y + oy); R.push(x + ox, y - oy);
  }
  for (let k = R.length - 2; k >= 0; k -= 2) L.push(R[k]!, R[k + 1]!);
  return L;
}

export function renderV9(plan: V9Plan, commitment: Uint8Array): Uint8Array { return draw(plan, commitment, 1); }
/** The same image at S times the resolution, for print: a redrawing, not the recorded file. */
export function renderV9At(plan: V9Plan, commitment: Uint8Array, S: number): Uint8Array { return draw(plan, commitment, S); }

/** Read the code from the art alone: the 256 reading pixels, their palette, and whether each is a twin. */
export function decodeV9(px: Uint8Array, width: number, height: number): Uint8Array | null {
  if (width !== V9_WIDTH || height !== V9_HEIGHT || px.length !== width * height * 4) return null;
  const same = (a: RGB, b: RGB) => a[0] === b[0] && a[1] === b[1] && a[2] === b[2];
  const read: RGB[] = [];
  for (let k = 0; k < 256; k++) {
    const x = OFF + TW * (k & 15) + RX, y = OFF + TH * (k >> 4) + RY;
    const i = (y * width + x) * 4;
    read.push([px[i]!, px[i + 1]!, px[i + 2]!]);
  }
  for (let p = 0; p < PALETTES_V9.length; p++) {
    const out = new Uint8Array(32);
    let ok = true;
    for (let k = 0; k < 256 && ok; k++) {
      if (TWINS_V9[p]!.some((c) => same(c, read[k]!))) out[k >> 3]! |= 1 << (7 - (k & 7));
      else if (!PALETTES_V9[p]!.some((c) => same(c, read[k]!))) ok = false;
    }
    if (ok) return out;
  }
  return null;
}
