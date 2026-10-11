// © 2026 Michael Argento. All rights reserved.
/**
 * bitgraph-art/18 (2026-10-10), "Bridge": a suspension bridge that never existed, built from packed flat rectangles.
 * Mike's generator (a standalone page, 2026-10-10), made a BitGraph series the way "Three" is (commitment-art-v16.ts):
 * every random draw comes from the position commitment, integers only, the recorded file a PNG that carries the exact
 * SVG print master in an iTXt chunk.
 *
 * The piece is defined on a 1200 x 1200 grid of integers. A fixed bridge silhouette (the mask, below; the same for every
 * piece) is filled with small rectangles in the bridge's colours, then the field around it (sky above the horizon,
 * water below) with larger ones, in staged rejection packing: each stage tries a number of times to place a rectangle of
 * at most a given size at a random free point, shrinking it a few times when it does not fit. The ground (the
 * background colour) shows through every gap. Nothing is ever drawn with a canvas: the mask is rasterised here, by the
 * rules below, so the pixels are the same on every device.
 *
 * ── The stream (the pattern of every version) ──────────────────────────────────────────────────────────────────────
 *   block(k) = SHA-256( ASCII "bitgraph-art/18" || 0x00 || ASCII "draw" || 0x00 || C || u32be(k) ), C = 32 bytes
 *   u32()    = the next 4 stream bytes, big-endian;  below(n) = u32() mod n  (integers only)
 * The full 256 bits of the commitment key the stream: there is no 32-bit seed, so two codes never share a piece by a
 * seed collision.
 *
 * ── The mask (1 = bridge), on the 1200 grid; a rectangle R(x0, y0, x1, y1) covers the pixels [x0, x1) x [y0, y1) ─────
 *   deck        R(48, 667, 1152, 677) and R(48, 689, 1152, 697), joined by posts R(x, 677, x + 4, 689) every 16 from 48
 *   towers      at cx = 332 and 868: legs R(cx - 39, 397, cx - 15, 697) and R(cx + 15, 397, cx + 39, 697); on each leg
 *               (lx = cx -/+ 27) a finial R(lx - 5, 387, lx + 5, 397) and R(lx - 2, 379, lx + 2, 387); four struts
 *               R(cx - 39, a, cx + 39, b) for (a, b) = (409, 427), (463, 481), (525, 545), (603, 621); piers
 *               R(cx - 41, 697, cx - 13, 787) and R(cx + 13, 697, cx + 41, 787); footings R(cx - 45, 787, cx - 9, 811)
 *               and R(cx + 9, 787, cx + 45, 811); a slab R(cx - 64, 811, cx + 64, 818)
 *   cables      two, offset off = -27 and +27 from the tower centres (each runs over one leg of each tower, so the two
 *               double up and cross). With xa = 332 + off, xb = 868 + off, mid = 600 + off, each is three parabolas:
 *                 main span  xa <= x <= xb:  y = 663 - 262 ((x - mid) / 268)^2        (saddles at y = 401, low 663)
 *                 west side  48 <= x < xa:   y = 665 - 264 ((x - 48) / (xa - 48))^2   (horizontal at the deck end)
 *                 east side  xb < x <= 1152: y = 665 - 264 ((1152 - x) / (1152 - xb))^2
 *               THE CABLE RULE (a stroke 7 units thick, without a canvas): pixel (X, Y), 48 <= X < 1152, is cable when,
 *               at its centre's x = X + 1/2, its centre's vertical offset e from the parabola satisfies
 *                 e^2 <= 3.5^2 (1 + s^2),  s = the parabola's slope there,
 *               which is exactly "within 3.5 of the line" for a straight line of that slope (the curves bend gently:
 *               their tightest radius is 137 units against a half-thickness of 3.5). In integers: with
 *               t = 2X + 1 - 2 x0 (x0 = mid, 48 or 1152), Q = 4 L^2 (L = 268, xa - 48 or 1152 - xb) and
 *               N = Y0 Q - A t^2 (Y0, A = 663, 262 on the main span, 665, 264 on the sides),
 *                 E = (2Y + 1) Q - 2N,   cable  <=>  E^2 <= 49 (Q^2 + 16 A^2 t^2),
 *               every product an integer below 2^53 (exact in a double). Round ends as a stroke has: a pixel whose centre
 *               is within 3.5 of (48, 665) or (1152, 665), (2X + 1 - 2ex)^2 + (2Y + 1 - 1330)^2 <= 49, is cable too.
 *               Each column's band is at least 7 pixels tall and its centre moves at most about 2.1 a column, so a
 *               cable is one connected run of pixels from deck end to deck end (tested).
 *   suspenders  for x = 58, 76, ... (every 18) up to 1152, skipping |x - 332| < 46 and |x - 868| < 46: under the higher
 *               cable at the integer x (top = the smaller y, a fraction compared exactly), skipped when 667 - top < 14,
 *               else R(x - 2, floor(top), x + 2, 667)
 *   horizon     y = 697 (the deck's underside): the field's sky is above it, its water below.
 * A summed-area table of the mask answers "how much bridge is in this box" in four reads.
 *
 * ── The plan, read in exactly this order ───────────────────────────────────────────────────────────────────────────
 *   palette   PALETTES_V18[below(5)]: background, bridge, footing, sky, water (Mike's five presets)
 *   bridge    stages (largest side, attempts) (90, 150), (50, 800), (28, 4000), (16, 14000), (9, 45000), (5, 120000),
 *             gap 1: every rectangle fully inside the mask
 *   field     stages (360, 60), (210, 220), (120, 750), (60, 2400), (30, 7000), (15, 22000), (8, 40000), gap 5: every
 *             rectangle clear of the mask by 4 on every side, at least 16 from the canvas edge, and wholly above or
 *             wholly below the horizon
 *   one attempt, for a stage of largest side M (units in thousandths, m-units, so every choice is an integer):
 *     the point   up to 12 tries: i = below(1200 * 1200), (x, y) = (i mod 1200, i div 1200); taken when the pixel is
 *                 free and in the region (mask 1 for the bridge, 0 for the field); none in 12 tries, the attempt ends
 *     the size    s = 450 M + below(550 M)                  (0.45 M to M, in m-units)
 *     the shape   below(100) < 55: a bar, ratio r = 80 + below(250) (0.080 to 0.329); else a block, r = 550 + below(450)
 *                 (0.550 to 0.999); w = s, h = floor(s r / 1000); below(2) == 0 swaps w and h
 *     placing     up to 5 tries: iw = max(2, round(w / 1000)), ih likewise (round half up, integer division);
 *                 x0 = x - floor(iw / 2), y0 = y - floor(ih / 2); kept when it is inside the canvas and its region's
 *                 rules hold and no occupied pixel lies within the gap of it; otherwise w = floor(62 w / 100),
 *                 h = floor(62 h / 100), and when both are under 2 units the attempt ends
 *   colour    by position: a bridge rectangle is footing when its centre is below y = 787 (y0 + y1 > 1574), else bridge;
 *             a field rectangle is sky above the horizon (y0 + y1 < 1394), else water.
 *
 * ── The files ──────────────────────────────────────────────────────────────────────────────────────────────────────
 *   the SVG (svgV18)  the print master: the background, then every rectangle in the order placed, integers on a
 *                     1200 x 1200 viewBox, crisp edges. Canonical bytes: fixed element and attribute order, LF, a final LF.
 *   the PNG           THE RECORDED FILE: 1200 x 1200 RGB, the same rectangles as pixels, written exactly as version 16
 *                     writes its file (pngFileThree: the manifest and the copyright in tEXt, the SVG byte for byte in
 *                     iTXt "bitgraph-print-svg", version 15's pure deflate).
 */
import { sha256 } from "@noble/hashes/sha256";
import { THREE_SPEC_V16, V16_COPYRIGHT, V16_SVG_KEYWORD, pngFileThree, svgFromPngV16 } from "./commitment-art-v16.ts";

export const ART_ALGORITHM_V18 = "bitgraph-art/18";
export const V18_SIZE = 1200;
export const V18_WIDTH = V18_SIZE, V18_HEIGHT = V18_SIZE;
export const V18_COPYRIGHT = V16_COPYRIGHT;
/** The iTXt keyword of the print SVG: version 16's. */
export const V18_SVG_KEYWORD = V16_SVG_KEYWORD;
export const V18_HORIZON = 697;
/** A bridge rectangle centred below this line is footing. */
export const V18_FOOTING_LINE = 787;

const G = V18_SIZE;

/** Mike's five presets, in his order: background, bridge, footing, sky, water. */
export const PALETTES_V18: readonly { name: string; colours: readonly [string, string, string, string, string] }[] = [
  { name: "International orange", colours: ["#f5efe0", "#c0362c", "#b08d4a", "#8fb3c9", "#1d4e6b"] },
  { name: "Red and black", colours: ["#ffffff", "#000000", "#000000", "#ee1c25", "#ee1c25"] },
  { name: "Night", colours: ["#0d1b2a", "#f25c3b", "#c9a45c", "#2c4f7c", "#1b3a5c"] },
  { name: "Sunset", colours: ["#fbe3c2", "#7a1f2b", "#4a2a1a", "#f08a24", "#3a2d6b"] },
  { name: "Fog", colours: ["#ecebe6", "#b3341f", "#8a7a55", "#a3b0b5", "#55707d"] },
];
/** A rectangle's kind; its colour is the palette's entry kind + 1 (entry 0 is the background). */
export const KINDS_V18 = ["bridge", "footing", "sky", "water"] as const;
export const KIND_BRIDGE = 0, KIND_FOOTING = 1, KIND_SKY = 2, KIND_WATER = 3;

/** (largest side, attempts), in order. */
export const BRIDGE_STAGES_V18: readonly (readonly [number, number])[] = [[90, 150], [50, 800], [28, 4000], [16, 14000], [9, 45000], [5, 120000]];
export const FIELD_STAGES_V18: readonly (readonly [number, number])[] = [[360, 60], [210, 220], [120, 750], [60, 2400], [30, 7000], [15, 22000], [8, 40000]];
/** The spec's fixed numbers. */
export const V18_RULES = { bridgeGap: 1, fieldGap: 5, buffer: 4, margin: 16, barPercent: 55, pointTries: 12, sizeTries: 5 } as const;

/**
 * A piece's plan: the palette (an index into PALETTES_V18) and every rectangle in the order placed, flat, five integers
 * each: x, y, w, h, kind (KINDS_V18). Never overlapping, so the order does not change the picture.
 */
export interface V18Plan {
  palette: number;
  rects: number[];
}

/** The labelled stream (version 16's, under this version's label). */
class Stream {
  private buf: Uint8Array = new Uint8Array(0);
  private at = 0;
  private k = 0;
  private readonly prefix: Uint8Array;
  constructor(label_: string, commitment: Uint8Array) {
    const te = new TextEncoder();
    const label = te.encode(label_), purpose = te.encode("draw");
    this.prefix = new Uint8Array(label.length + 1 + purpose.length + 1 + 32 + 4);
    this.prefix.set(label, 0);
    this.prefix.set(purpose, label.length + 1);
    this.prefix.set(commitment, label.length + 1 + purpose.length + 1);
  }
  u32(): number {
    if (this.at + 4 > this.buf.length) {
      // the block input is the prefix and u32be(k), written in place (the same bytes version 16 hashes)
      const p = this.prefix, n = p.length - 4, k = this.k++;
      p[n] = (k >>> 24) & 0xff; p[n + 1] = (k >>> 16) & 0xff; p[n + 2] = (k >>> 8) & 0xff; p[n + 3] = k & 0xff;
      this.buf = sha256(p);
      this.at = 0;
    }
    const b = this.buf, i = this.at;
    this.at += 4;
    return ((b[i]! << 24) | (b[i + 1]! << 16) | (b[i + 2]! << 8) | b[i + 3]!) >>> 0;
  }
  below(n: number): number {
    return this.u32() % n;
  }
}

function requireCommitment(c: Uint8Array): void {
  if (!(c instanceof Uint8Array) || c.length !== 32) throw new TypeError("a bitgraph-art commitment is exactly 32 bytes");
}

/** Integer division of a non-negative integer. */
const idiv = (n: number, d: number): number => (n - (n % d)) / d;

/* ── The mask ─────────────────────────────────────────────────────────────────────────────────────────────────────── */

export const TOWER_CENTRES_V18 = [332, 868] as const;
export const CABLE_OFFSETS_V18 = [-27, 27] as const;
const STRUTS: readonly (readonly [number, number])[] = [[409, 427], [463, 481], [525, 545], [603, 621]];

/** The mask's rectangles, named: [x0, y0, x1, y1, part]. */
export function maskRectsV18(): Array<[number, number, number, number, string]> {
  const out: Array<[number, number, number, number, string]> = [];
  out.push([48, 667, 1152, 677, "deck top chord"], [48, 689, 1152, 697, "deck bottom chord"]);
  for (let x = 48; x + 4 <= 1152; x += 16) out.push([x, 677, x + 4, 689, "deck post"]);
  for (const cx of TOWER_CENTRES_V18) {
    out.push([cx - 39, 397, cx - 15, 697, "leg"], [cx + 15, 397, cx + 39, 697, "leg"]);
    for (const lx of [cx - 27, cx + 27]) out.push([lx - 5, 387, lx + 5, 397, "finial"], [lx - 2, 379, lx + 2, 387, "finial"]);
    for (const [a, b] of STRUTS) out.push([cx - 39, a, cx + 39, b, "strut"]);
    out.push([cx - 41, 697, cx - 13, 787, "pier"], [cx + 13, 697, cx + 41, 787, "pier"]);
    out.push([cx - 45, 787, cx - 9, 811, "footing"], [cx + 9, 787, cx + 45, 811, "footing"]);
    out.push([cx - 64, 811, cx + 64, 818, "slab"]);
  }
  return out;
}

/** One cable's parabola for the column (or integer x) given: y = Y0 - A ((x - x0) / L)^2. */
function cablePiece(off: number, x: number, integerX: boolean): { Y0: number; A: number; x0: number; L: number } {
  const xa = 332 + off, xb = 868 + off;
  // A column X has its centre at X + 1/2, never on xa or xb, so it is main span exactly when xa <= X < xb; an integer x
  // (a suspender) is main span when xa <= x <= xb, as the generator chose it.
  const main = integerX ? x >= xa && x <= xb : x >= xa && x < xb;
  if (main) return { Y0: 663, A: 262, x0: 600 + off, L: 268 };
  return x < xa ? { Y0: 665, A: 264, x0: 48, L: xa - 48 } : { Y0: 665, A: 264, x0: 1152, L: 1152 - xb };
}

/** One cable's pixels, by the cable rule in the header (1 = cable). */
export function cableMaskV18(off: number): Uint8Array {
  const m = new Uint8Array(G * G);
  for (let X = 48; X < 1152; X++) {
    const { Y0, A, x0, L } = cablePiece(off, X, false);
    const t = 2 * X + 1 - 2 * x0, Q = 4 * L * L;
    const N = Y0 * Q - A * t * t;
    const rhs = 49 * (Q * Q + 16 * A * A * t * t);
    const yc = idiv(N, Q); // the curve's y, rounded down (N > 0 everywhere on the cables)
    for (let Y = yc - 12; Y <= yc + 12; Y++) {
      const E = (2 * Y + 1) * Q - 2 * N;
      if (E * E <= rhs) m[Y * G + X] = 1;
    }
  }
  for (const ex of [48, 1152]) {
    for (let X = ex - 4; X <= ex + 4; X++) for (let Y = 661; Y <= 669; Y++) {
      const dx = 2 * X + 1 - 2 * ex, dy = 2 * Y + 1 - 1330;
      if (dx * dx + dy * dy <= 49) m[Y * G + X] = 1;
    }
  }
  return m;
}

/** The suspenders: x and the top row (floor of the higher cable's y at x); each is R(x - 2, top, x + 2, 667). */
export function suspendersV18(): Array<{ x: number; top: number }> {
  const out: Array<{ x: number; top: number }> = [];
  for (let x = 58; x <= 1152; x += 18) {
    if (Math.abs(x - 332) < 46 || Math.abs(x - 868) < 46) continue;
    // the higher cable: the smaller y, compared as exact fractions num / den
    let best: [number, number] | null = null;
    for (const off of CABLE_OFFSETS_V18) {
      const { Y0, A, x0, L } = cablePiece(off, x, true);
      const den = L * L, num = Y0 * den - A * (x - x0) * (x - x0);
      if (best === null || num * best[1] < best[0] * den) best = [num, den];
    }
    const [num, den] = best!;
    if (num > 653 * den) continue; // 667 - top < 14: too short
    out.push({ x, top: idiv(num, den) });
  }
  return out;
}

let MASK: Uint8Array | null = null;
let SAT: Int32Array | null = null;

function fill(m: Uint8Array, x0: number, y0: number, x1: number, y1: number): void {
  for (let y = y0; y < y1; y++) m.fill(1, y * G + x0, y * G + x1);
}

/** The bridge mask, G x G, 1 = bridge. Computed once; the same for every piece. Callers must not write to it. */
export function bridgeMaskV18(): Uint8Array {
  if (MASK) return MASK;
  const m = new Uint8Array(G * G);
  for (const [x0, y0, x1, y1] of maskRectsV18()) fill(m, x0, y0, x1, y1);
  for (const off of CABLE_OFFSETS_V18) {
    const c = cableMaskV18(off);
    for (let i = 0; i < c.length; i++) if (c[i]) m[i] = 1;
  }
  for (const { x, top } of suspendersV18()) fill(m, x - 2, top, x + 2, 667);
  MASK = m;
  return m;
}

/** The summed-area table: S[y (G + 1) + x] = bridge pixels in [0, x) x [0, y). */
function satV18(): Int32Array {
  if (SAT) return SAT;
  const m = bridgeMaskV18(), W = G + 1, s = new Int32Array(W * W);
  for (let y = 1; y <= G; y++) {
    let row = 0;
    for (let x = 1; x <= G; x++) { row += m[(y - 1) * G + (x - 1)]!; s[y * W + x] = s[(y - 1) * W + x]! + row; }
  }
  SAT = s;
  return s;
}

/* ── The plan ─────────────────────────────────────────────────────────────────────────────────────────────────────── */

let memo: { key: string; plan: V18Plan } | null = null;
const keyOf = (c: Uint8Array) => Array.from(c, (b) => b.toString(16).padStart(2, "0")).join("");

export function planV18(commitment: Uint8Array): V18Plan {
  requireCommitment(commitment);
  const key = keyOf(commitment);
  if (memo && memo.key === key) return memo.plan; // the last plan (frozen): the file, its check and its redraw ask in turn
  const plan = packV18(commitment);
  Object.freeze(plan.rects);
  memo = { key, plan: Object.freeze(plan) };
  return plan;
}

/** The plan packed afresh, never from the memo (planV18 keeps the last one): the tests draw every piece twice with it. */
export function packV18(commitment: Uint8Array): V18Plan {
  requireCommitment(commitment);
  const s = new Stream(ART_ALGORITHM_V18, commitment);
  const palette = s.below(PALETTES_V18.length);
  const mask = bridgeMaskV18(), sat = satV18(), W = G + 1;
  const occ = new Uint8Array(G * G);
  const rects: number[] = [];
  const { margin, buffer, barPercent, pointTries, sizeTries } = V18_RULES;

  /** Bridge pixels in [x0, x1) x [y0, y1), clipped to the grid. */
  const bridgeIn = (x0: number, y0: number, x1: number, y1: number): number => {
    if (x0 < 0) x0 = 0; if (y0 < 0) y0 = 0; if (x1 > G) x1 = G; if (y1 > G) y1 = G;
    if (x1 <= x0 || y1 <= y0) return 0;
    return sat[y1 * W + x1]! - sat[y0 * W + x1]! - sat[y1 * W + x0]! + sat[y0 * W + x0]!;
  };
  /** No occupied pixel in [x0, x1) x [y0, y1), clipped. */
  const free = (x0: number, y0: number, x1: number, y1: number): boolean => {
    if (x0 < 0) x0 = 0; if (y0 < 0) y0 = 0; if (x1 > G) x1 = G; if (y1 > G) y1 = G;
    for (let y = y0; y < y1; y++) { const r = y * G; for (let x = x0; x < x1; x++) if (occ[r + x]) return false; }
    return true;
  };

  const run = (stages: readonly (readonly [number, number])[], field: boolean, gap: number) => {
    const want = field ? 0 : 1;
    for (const [M, attempts] of stages) {
      for (let a = 0; a < attempts; a++) {
        let p = -1;
        for (let t = 0; t < pointTries; t++) {
          const i = s.below(G * G);
          if (occ[i] || mask[i] !== want) continue;
          p = i; break;
        }
        if (p < 0) continue;
        const px = p % G, py = (p - px) / G;
        const size = 450 * M + s.below(550 * M);
        const ratio = s.below(100) < barPercent ? 80 + s.below(250) : 550 + s.below(450);
        let w = size, h = idiv(size * ratio, 1000);
        if (s.below(2) === 0) { const t = w; w = h; h = t; }
        for (let tries = 0; tries < sizeTries; tries++) {
          const iw = Math.max(2, idiv(w + 500, 1000)), ih = Math.max(2, idiv(h + 500, 1000));
          const x0 = px - (iw >> 1), y0 = py - (ih >> 1), x1 = x0 + iw, y1 = y0 + ih;
          let ok = x0 >= 0 && y0 >= 0 && x1 <= G && y1 <= G;
          if (ok && !field) ok = bridgeIn(x0, y0, x1, y1) === iw * ih;
          if (ok && field) {
            ok = x0 >= margin && y0 >= margin && x1 <= G - margin && y1 <= G - margin
              && bridgeIn(x0 - buffer, y0 - buffer, x1 + buffer, y1 + buffer) === 0
              && (y1 <= V18_HORIZON || y0 >= V18_HORIZON);
          }
          if (ok) ok = free(x0 - gap, y0 - gap, x1 + gap, y1 + gap);
          if (ok) {
            for (let y = y0; y < y1; y++) occ.fill(1, y * G + x0, y * G + x1);
            const kind = field ? (y0 + y1 < 2 * V18_HORIZON ? KIND_SKY : KIND_WATER) : (y0 + y1 > 2 * V18_FOOTING_LINE ? KIND_FOOTING : KIND_BRIDGE);
            rects.push(x0, y0, iw, ih, kind);
            break;
          }
          w = idiv(62 * w, 100); h = idiv(62 * h, 100);
          if (w < 2000 && h < 2000) break;
        }
      }
    }
  };
  run(BRIDGE_STAGES_V18, false, V18_RULES.bridgeGap);
  run(FIELD_STAGES_V18, true, V18_RULES.fieldGap);
  return { palette, rects };
}

/* ── The files ────────────────────────────────────────────────────────────────────────────────────────────────────── */

const b64url = (b: Uint8Array): string => {
  let s = "";
  for (const x of b) s += String.fromCharCode(x);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
};

/** The SVG text, canonical: one element a line, attributes in a fixed order, integers only, LF, a final LF. */
export function svgTextV18(plan: V18Plan, commitment: Uint8Array): string {
  requireCommitment(commitment);
  const pal = PALETTES_V18[plan.palette]!.colours;
  const lines = [
    `<?xml version="1.0" encoding="UTF-8"?>`,
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${G} ${G}" width="100%" height="100%" shape-rendering="crispEdges">`,
    `<title>Bridge</title>`,
    `<desc>${V18_COPYRIGHT}</desc>`,
    `<metadata>${ART_ALGORITHM_V18} commitment ${b64url(commitment)}</metadata>`,
    `<rect x="0" y="0" width="${G}" height="${G}" fill="${pal[0]}"/>`,
  ];
  const r = plan.rects;
  for (let i = 0; i < r.length; i += 5) lines.push(`<rect x="${r[i]}" y="${r[i + 1]}" width="${r[i + 2]}" height="${r[i + 3]}" fill="${pal[r[i + 4]! + 1]}"/>`);
  lines.push(`</svg>`);
  return lines.join("\n") + "\n";
}

/** The SVG file's bytes (UTF-8). */
export function svgV18(commitment: Uint8Array): Uint8Array {
  return new TextEncoder().encode(svgTextV18(planV18(commitment), commitment));
}

const rgbOf = (hex: string): [number, number, number] => [parseInt(hex.slice(1, 3), 16), parseInt(hex.slice(3, 5), 16), parseInt(hex.slice(5, 7), 16)];

/** The canonical RGBA pixels of the plan, 1200 x 1200. */
export function renderV18(plan: V18Plan): Uint8Array {
  const pal = PALETTES_V18[plan.palette]!.colours.map(rgbOf);
  const px = new Uint8Array(G * G * 4);
  const bg = pal[0]!;
  for (let i = 0; i < px.length; i += 4) { px[i] = bg[0]; px[i + 1] = bg[1]; px[i + 2] = bg[2]; px[i + 3] = 255; }
  const r = plan.rects;
  for (let k = 0; k < r.length; k += 5) {
    const x = r[k]!, y = r[k + 1]!, w = r[k + 2]!, h = r[k + 3]!, c = pal[r[k + 4]! + 1]!;
    for (let yy = y; yy < y + h; yy++) {
      for (let i = (yy * G + x) * 4, e = i + w * 4; i < e; i += 4) { px[i] = c[0]; px[i + 1] = c[1]; px[i + 2] = c[2]; }
    }
  }
  return px;
}

/** The recorded PNG: version 16's file, chunk for chunk (the manifest, the copyright, the SVG in iTXt), 1200 x 1200. */
export function pngFileV18(px: Uint8Array, manifestText: string, svgText: string): Uint8Array {
  return pngFileThree({ ...THREE_SPEC_V16, label: ART_ALGORITHM_V18, width: G, height: G }, px, manifestText, svgText);
}

/** The print SVG a version 18 PNG carries (version 16's iTXt keyword), or null. */
export const svgFromPngV18 = svgFromPngV16;

/** The commitment a version 18 SVG states in its metadata, or null. Informational: a check redraws instead. */
export function readCommitmentV18(svg: Uint8Array): Uint8Array | null {
  let s: string;
  try { s = new TextDecoder("utf-8", { fatal: true }).decode(svg); } catch { return null; }
  const m = /<metadata>bitgraph-art\/18 commitment ([A-Za-z0-9_-]{43})<\/metadata>/.exec(s);
  if (!m) return null;
  try {
    const bin = atob(m[1]!.replace(/-/g, "+").replace(/_/g, "/") + "=");
    const out = Uint8Array.from(bin, (c) => c.charCodeAt(0));
    return out.length === 32 ? out : null;
  } catch { return null; }
}

/** A short description of a plan: "Fog, 21,345 rectangles". */
export function describeV18(plan: V18Plan): string {
  return `${PALETTES_V18[plan.palette]!.name}, ${(plan.rects.length / 5).toLocaleString("en-US")} rectangles`;
}
