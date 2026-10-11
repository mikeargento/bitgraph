// © 2026 Michael Argento. All rights reserved.
/**
 * bitgraph-art/18 (2026-10-10), "Bridge": a suspension bridge that never existed, built from packed flat rectangles.
 * Mike's generator (a standalone page, 2026-10-10), made a BitGraph series the way "Three" is (commitment-art-v16.ts):
 * every random draw comes from the position commitment, integers only, the recorded file a PNG that carries the exact
 * SVG print master in an iTXt chunk.
 *
 * The piece is defined on a 1200 x 1200 grid of integers. A fixed bridge silhouette (the mask, below; the same for every
 * piece) is filled with small rectangles in the bridge's colors, then the field around it (sky above the horizon,
 * water below) with larger ones, in staged rejection packing: each stage tries a number of times to place a rectangle of
 * at most a given size at a random free point, shrinking it a few times when it does not fit. The ground (the
 * background color) shows through every gap. Nothing is ever drawn with a canvas: the mask is rasterized here, by the
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
 *   cables      two, offset off = -27 and +27 from the tower centers (each runs over one leg of each tower, so the two
 *               double up and cross). With xa = 332 + off, xb = 868 + off, mid = 600 + off, each is three parabolas:
 *                 main span  xa <= x <= xb:  y = 663 - 262 ((x - mid) / 268)^2        (saddles at y = 401, low 663)
 *                 west side  48 <= x < xa:   y = 665 - 264 ((x - 48) / (xa - 48))^2   (horizontal at the deck end)
 *                 east side  xb < x <= 1152: y = 665 - 264 ((1152 - x) / (1152 - xb))^2
 *               THE CABLE RULE (a stroke 7 units thick, without a canvas): pixel (X, Y), 48 <= X < 1152, is cable when,
 *               at its center's x = X + 1/2, its center's vertical offset e from the parabola satisfies
 *                 e^2 <= 3.5^2 (1 + s^2),  s = the parabola's slope there,
 *               which is exactly "within 3.5 of the line" for a straight line of that slope (the curves bend gently:
 *               their tightest radius is 137 units against a half-thickness of 3.5). In integers: with
 *               t = 2X + 1 - 2 x0 (x0 = mid, 48 or 1152), Q = 4 L^2 (L = 268, xa - 48 or 1152 - xb) and
 *               N = Y0 Q - A t^2 (Y0, A = 663, 262 on the main span, 665, 264 on the sides),
 *                 E = (2Y + 1) Q - 2N,   cable  <=>  E^2 <= 49 (Q^2 + 16 A^2 t^2),
 *               every product an integer below 2^53 (exact in a double). Round ends as a stroke has: a pixel whose center
 *               is within 3.5 of (48, 665) or (1152, 665), (2X + 1 - 2ex)^2 + (2Y + 1 - 1330)^2 <= 49, is cable too.
 *               Each column's band is at least 7 pixels tall and its center moves at most about 2.1 a column, so a
 *               cable is one connected run of pixels from deck end to deck end (tested).
 *   suspenders  for x = 58, 76, ... (every 18) up to 1152, skipping |x - 332| < 46 and |x - 868| < 46: under the higher
 *               cable at the integer x (top = the smaller y, a fraction compared exactly), skipped when 667 - top < 14,
 *               else R(x - 2, floor(top), x + 2, 667)
 *   horizon     y = 697 (the deck's underside): the field's sky is above it, its water below.
 * A summed-area table of the mask answers "how much bridge is in this box" in four reads.
 *
 * ── The plan, read in exactly this order ───────────────────────────────────────────────────────────────────────────
 * Every setting of Mike's standalone page comes from the commitment, per click (Mike, 2026-10-10: "i want all the
 * different possibilities"), drawn first, in this order, each a sum of below() draws so the space is wide while most
 * pieces still read well (tri(a, b) = below(a) + below(b), a triangle peaked in the middle):
 *   palette      PALETTES_V18[below(5)]: background, bridge, footing, sky, water (Mike's five presets), uniform
 *   detail       how many bridge stages run, 2 to 6, by u = below(100): u < 8: 2, u < 20: 3 (the sparse "ghost"
 *                bridges, 1 in 5), u < 35: 4, u < 60: 5, else 6 (dense, 2 in 5)
 *   bridge gap   1 to 5, by u = below(100): u < 40: 1, u < 65: 2, u < 80: 3, u < 92: 4, else 5 (tight most often)
 *   field gap    the bridge gap plus an offset 0 to 12, by u = below(100) against the cuts 4, 11, 21, 33, 46, 58,
 *                68, 77, 84, 90, 94, 97 (percent 4, 7, 10, 12, 13, 12, 10, 9, 7, 6, 4, 3, 3: peak 4, the page's default)
 *   buffer       field clear of the bridge by 0 to 16, tri(9, 9)                                   (peak 8)
 *   margin       field this far from the canvas edge, 0 to 64, tri(33, 33)                         (peak 32)
 *   bars         the share of bars, 0 to 100 percent, tri(51, 51)                                  (peak 50)
 *   bridge max   the largest bridge rectangle, 20 to 160, 20 + tri(71, 71)                         (peak 90, the page's default)
 *   field max    the largest field rectangle, 60 to 600 in tens, 60 + 10 tri(28, 28)               (peak 330)
 * Then the packing (lengths in thousandths, m-units, so every choice is an integer):
 *   bridge   stages (largest side, attempts) (90, 150), (50, 800), (28, 4000), (16, 14000), (9, 45000), (5, 120000),
 *            the first `detail` of them, each side scaled by bridge max / 90: M = max(2000, floor(1000 side bridgeMax / 90));
 *            every rectangle fully inside the mask, the bridge gap from every rectangle before it
 *   field    stages (360, 60), (210, 220), (120, 750), (60, 2400), (30, 7000), (15, 22000), (8, 40000), each side scaled
 *            by field max / 360: M = max(2000, floor(1000 side fieldMax / 360)); every rectangle clear of the mask by the
 *            buffer on every side, at least the margin from the canvas edge, wholly above or wholly below the horizon,
 *            and the field gap from every rectangle before it
 *   one attempt, for a stage of largest side M (m-units):
 *     the point   up to 12 tries: i = below(1200 * 1200), (x, y) = (i mod 1200, i div 1200); taken when the pixel is
 *                 free and in the region (mask 1 for the bridge, 0 for the field); none in 12 tries, the attempt ends
 *     the size    s = floor(45 M / 100) + below(floor(55 M / 100))      (0.45 M to M)
 *     the shape   below(100) < bars: a bar, ratio r = 80 + below(250) (0.080 to 0.329); else a block, r = 550 + below(450)
 *                 (0.550 to 0.999); w = s, h = floor(s r / 1000); below(2) == 0 swaps w and h
 *     placing     up to 5 tries: iw = max(2, round(w / 1000)), ih likewise (round half up, integer division);
 *                 x0 = x - floor(iw / 2), y0 = y - floor(ih / 2); kept when it is inside the canvas and its region's
 *                 rules hold and no occupied pixel lies within the gap of it; otherwise w = floor(62 w / 100),
 *                 h = floor(62 h / 100), and when both are under 2 units the attempt ends
 *   color    by position: a bridge rectangle is footing when its center is below y = 787 (y0 + y1 > 1574), else bridge;
 *            a field rectangle is sky above the horizon (y0 + y1 < 1394), else water.
 *
 * ── The files ──────────────────────────────────────────────────────────────────────────────────────────────────────
 *   the SVG (svgV18)  the print master: the background, then every rectangle in the order placed, integers on a
 *                     1200 x 1200 viewBox, crisp edges; its metadata states the commitment and every setting drawn.
 *                     Canonical bytes: fixed element and attribute order, LF, a final LF.
 *   the PNG           THE RECORDED FILE: 1200 x 1200 RGB, the same rectangles as pixels, laid out as version 16's file:
 *                     IHDR; tEXt "bitgraph-art" (the manifest); tEXt "Copyright"; tEXt "bitgraph-art-settings" (the
 *                     settings, as in the SVG); iTXt "bitgraph-print-svg" (the SVG, byte for byte); IDAT (version 15's
 *                     pure deflate); IEND.
 */
import { sha256 } from "@noble/hashes/sha256";
import { V16_COPYRIGHT, V16_SVG_KEYWORD, svgFromPngV16 } from "./commitment-art-v16.ts";
import { deflateV15, filterRowsV15 } from "./png-deflate-v15.ts";

export const ART_ALGORITHM_V18 = "bitgraph-art/18";
export const V18_SIZE = 1200;
export const V18_WIDTH = V18_SIZE, V18_HEIGHT = V18_SIZE;
export const V18_COPYRIGHT = V16_COPYRIGHT;
/** The iTXt keyword of the print SVG: version 16's. */
export const V18_SVG_KEYWORD = V16_SVG_KEYWORD;
export const V18_HORIZON = 697;
/** A bridge rectangle centerd below this line is footing. */
export const V18_FOOTING_LINE = 787;

const G = V18_SIZE;

/** Mike's five presets, in his order: background, bridge, footing, sky, water. */
export const PALETTES_V18: readonly { name: string; colors: readonly [string, string, string, string, string] }[] = [
  { name: "International orange", colors: ["#f5efe0", "#c0362c", "#b08d4a", "#8fb3c9", "#1d4e6b"] },
  { name: "Red and black", colors: ["#ffffff", "#000000", "#000000", "#ee1c25", "#ee1c25"] },
  { name: "Night", colors: ["#0d1b2a", "#f25c3b", "#c9a45c", "#2c4f7c", "#1b3a5c"] },
  { name: "Sunset", colors: ["#fbe3c2", "#7a1f2b", "#4a2a1a", "#f08a24", "#3a2d6b"] },
  { name: "Fog", colors: ["#ecebe6", "#b3341f", "#8a7a55", "#a3b0b5", "#55707d"] },
];
/** A rectangle's kind; its color is the palette's entry kind + 1 (entry 0 is the background). */
export const KINDS_V18 = ["bridge", "footing", "sky", "water"] as const;
export const KIND_BRIDGE = 0, KIND_FOOTING = 1, KIND_SKY = 2, KIND_WATER = 3;

/** (largest side, attempts), in order. */
export const BRIDGE_STAGES_V18: readonly (readonly [number, number])[] = [[90, 150], [50, 800], [28, 4000], [16, 14000], [9, 45000], [5, 120000]];
export const FIELD_STAGES_V18: readonly (readonly [number, number])[] = [[360, 60], [210, 220], [120, 750], [60, 2400], [30, 7000], [15, 22000], [8, 40000]];
/** The packing's fixed numbers. */
export const V18_RULES = { pointTries: 12, sizeTries: 5 } as const;

/** The settings of Mike's standalone page, each drawn from the commitment (the header gives the distributions). */
export interface V18Settings {
  /** Bridge stages run, 2 to 6. */
  detail: number;
  /** Least space between bridge rectangles, 1 to 5. */
  bridgeGap: number;
  /** Added to the bridge gap for the field, 0 to 12. */
  fieldGapOffset: number;
  /** Field kept this far from the bridge, 0 to 16. */
  buffer: number;
  /** Field kept this far from the canvas edge, 0 to 64. */
  margin: number;
  /** Percent of rectangles that are bars, 0 to 100. */
  bars: number;
  /** Largest bridge rectangle, 20 to 160. */
  bridgeMax: number;
  /** Largest field rectangle, 60 to 600, in tens. */
  fieldMax: number;
}
/** The standalone page's sliders: each setting's range, inclusive. */
export const V18_SETTING_RANGES: Readonly<Record<keyof V18Settings, readonly [number, number]>> = {
  detail: [2, 6], bridgeGap: [1, 5], fieldGapOffset: [0, 12], buffer: [0, 16], margin: [0, 64], bars: [0, 100], bridgeMax: [20, 160], fieldMax: [60, 600],
};

/**
 * A piece's plan: the palette (an index into PALETTES_V18), the settings drawn, and every rectangle in the order placed, flat, five integers
 * each: x, y, w, h, kind (KINDS_V18). Never overlapping, so the order does not change the picture.
 */
export interface V18Plan {
  palette: number;
  settings: V18Settings;
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

export const TOWER_CENTERS_V18 = [332, 868] as const;
export const CABLE_OFFSETS_V18 = [-27, 27] as const;
const STRUTS: readonly (readonly [number, number])[] = [[409, 427], [463, 481], [525, 545], [603, 621]];

/** The mask's rectangles, named: [x0, y0, x1, y1, part]. */
export function maskRectsV18(): Array<[number, number, number, number, string]> {
  const out: Array<[number, number, number, number, string]> = [];
  out.push([48, 667, 1152, 677, "deck top chord"], [48, 689, 1152, 697, "deck bottom chord"]);
  for (let x = 48; x + 4 <= 1152; x += 16) out.push([x, 677, x + 4, 689, "deck post"]);
  for (const cx of TOWER_CENTERS_V18) {
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
  // A column X has its center at X + 1/2, never on xa or xb, so it is main span exactly when xa <= X < xb; an integer x
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
  Object.freeze(plan.rects); Object.freeze(plan.settings);
  memo = { key, plan: Object.freeze(plan) };
  return plan;
}

/** The palette and the settings: the stream's first draws, in the header's order. */
function drawSettings(s: Stream): { palette: number; settings: V18Settings } {
  const palette = s.below(PALETTES_V18.length);
  const pick = (cuts: readonly number[]) => { const u = s.below(100); let k = 0; while (k < cuts.length && u >= cuts[k]!) k++; return k; };
  const tri = (a: number, b: number) => s.below(a) + s.below(b);
  const detail = 2 + pick([8, 20, 35, 60]);
  const bridgeGap = 1 + pick([40, 65, 80, 92]);
  const fieldGapOffset = pick([4, 11, 21, 33, 46, 58, 68, 77, 84, 90, 94, 97]);
  const buffer = tri(9, 9);
  const margin = tri(33, 33);
  const bars = tri(51, 51);
  const bridgeMax = 20 + tri(71, 71);
  const fieldMax = 60 + 10 * tri(28, 28);
  return { palette, settings: { detail, bridgeGap, fieldGapOffset, buffer, margin, bars, bridgeMax, fieldMax } };
}

/** The palette and settings a commitment draws, without packing (they are the stream's first draws). */
export function settingsV18(commitment: Uint8Array): { palette: number; settings: V18Settings } {
  requireCommitment(commitment);
  return drawSettings(new Stream(ART_ALGORITHM_V18, commitment));
}

/** The settings in words, as the SVG's metadata and the PNG's text state them. */
export function settingsTextV18(plan: Pick<V18Plan, "palette" | "settings">): string {
  const t = plan.settings;
  return `palette ${PALETTES_V18[plan.palette]!.name}; detail ${t.detail} of 6; bridge gap ${t.bridgeGap}; field gap ${t.bridgeGap + t.fieldGapOffset} (offset ${t.fieldGapOffset}); field buffer ${t.buffer}; edge margin ${t.margin}; bars ${t.bars}%; largest bridge rectangle ${t.bridgeMax}; largest field rectangle ${t.fieldMax}`;
}

/** The plan packed afresh, never from the memo (planV18 keeps the last one): the tests draw every piece twice with it. */
export function packV18(commitment: Uint8Array): V18Plan {
  requireCommitment(commitment);
  const s = new Stream(ART_ALGORITHM_V18, commitment);
  const { palette, settings } = drawSettings(s);
  const mask = bridgeMaskV18(), sat = satV18(), W = G + 1;
  const occ = new Uint8Array(G * G);
  const rects: number[] = [];
  const { margin, buffer, bars: barPercent } = settings;
  const { pointTries, sizeTries } = V18_RULES;

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

  const run = (stages: readonly (readonly [number, number])[], field: boolean, gap: number, largest: number, base: number) => {
    const want = field ? 0 : 1;
    for (const [side, attempts] of stages) {
      const M = Math.max(2000, idiv(1000 * side * largest, base)); // the stage's largest side, scaled, in m-units
      for (let a = 0; a < attempts; a++) {
        let p = -1;
        for (let t = 0; t < pointTries; t++) {
          const i = s.below(G * G);
          if (occ[i] || mask[i] !== want) continue;
          p = i; break;
        }
        if (p < 0) continue;
        const px = p % G, py = (p - px) / G;
        const size = idiv(45 * M, 100) + s.below(idiv(55 * M, 100));
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
  run(BRIDGE_STAGES_V18.slice(0, settings.detail), false, settings.bridgeGap, settings.bridgeMax, 90);
  run(FIELD_STAGES_V18, true, settings.bridgeGap + settings.fieldGapOffset, settings.fieldMax, 360);
  return { palette, settings, rects };
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
  const pal = PALETTES_V18[plan.palette]!.colors;
  const lines = [
    `<?xml version="1.0" encoding="UTF-8"?>`,
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${G} ${G}" width="100%" height="100%" shape-rendering="crispEdges">`,
    `<title>Bridge</title>`,
    `<desc>${V18_COPYRIGHT}</desc>`,
    `<metadata>${ART_ALGORITHM_V18} commitment ${b64url(commitment)}; ${settingsTextV18(plan)}</metadata>`,
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
  const pal = PALETTES_V18[plan.palette]!.colors.map(rgbOf);
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

const PNG_SIG = Uint8Array.from([137, 80, 78, 71, 13, 10, 26, 10]);
const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; }
  return t;
})();
function crc32(parts: Uint8Array[]): number {
  let c = 0xffffffff;
  for (const b of parts) for (let i = 0; i < b.length; i++) c = CRC_TABLE[(c ^ b[i]!) & 0xff]! ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
const u32be = (n: number) => Uint8Array.from([(n >>> 24) & 0xff, (n >>> 16) & 0xff, (n >>> 8) & 0xff, n & 0xff]);
/** ASCII and Latin-1 (tEXt is Latin-1: the copyright sign is the single byte 0xA9). */
const latin1 = (s: string): Uint8Array => Uint8Array.from(s, (ch) => { const c = ch.charCodeAt(0); if (c > 255) throw new TypeError("not Latin-1"); return c; });
const concat = (parts: Uint8Array[]): Uint8Array => {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const p of parts) { out.set(p, at); at += p.length; }
  return out;
};
function chunk(type: string, data: Uint8Array): Uint8Array {
  const t = latin1(type);
  return concat([u32be(data.length), t, data, u32be(crc32([t, data]))]);
}
const text = (keyword: string, value: string) => chunk("tEXt", concat([latin1(keyword), Uint8Array.of(0), latin1(value)]));

/** The tEXt keyword under which the PNG states the settings drawn. */
export const V18_SETTINGS_KEYWORD = "bitgraph-art-settings";

/**
 * The recorded PNG, 1200 x 1200: version 16's file, chunk for chunk, with the settings in one more tEXt chunk: IHDR;
 * tEXt "bitgraph-art" (the manifest); tEXt "Copyright"; tEXt "bitgraph-art-settings"; iTXt "bitgraph-print-svg"
 * (uncompressed, no language: its text bytes ARE the SVG's UTF-8 bytes); IDAT (version 15's pure deflate); IEND.
 */
export function pngFileV18(px: Uint8Array, manifestText: string, svgText: string, settingsText: string): Uint8Array {
  const ihdr = new Uint8Array(13);
  ihdr.set(u32be(G), 0); ihdr.set(u32be(G), 4);
  ihdr[8] = 8; ihdr[9] = 2; // 8-bit truecolor, no alpha; compression, filter, interlace 0
  const itxt = chunk("iTXt", concat([latin1(V18_SVG_KEYWORD), Uint8Array.of(0, 0, 0, 0, 0), new TextEncoder().encode(svgText)]));
  const idat = deflateV15(filterRowsV15(px, G, G));
  return concat([PNG_SIG, chunk("IHDR", ihdr), text("bitgraph-art", manifestText), text("Copyright", V18_COPYRIGHT), text(V18_SETTINGS_KEYWORD, settingsText), itxt, chunk("IDAT", idat), chunk("IEND", new Uint8Array(0))]);
}

/** The print SVG a version 18 PNG carries (version 16's iTXt keyword), or null. */
export const svgFromPngV18 = svgFromPngV16;

/** The commitment a version 18 SVG states in its metadata, or null. Informational: a check redraws instead. */
export function readCommitmentV18(svg: Uint8Array): Uint8Array | null {
  let s: string;
  try { s = new TextDecoder("utf-8", { fatal: true }).decode(svg); } catch { return null; }
  const m = /<metadata>bitgraph-art\/18 commitment ([A-Za-z0-9_-]{43})[;<]/.exec(s);
  if (!m) return null;
  try {
    const bin = atob(m[1]!.replace(/-/g, "+").replace(/_/g, "/") + "=");
    const out = Uint8Array.from(bin, (c) => c.charCodeAt(0));
    return out.length === 32 ? out : null;
  } catch { return null; }
}

/** A short description of a plan: "Fog, detail 6, 7,345 rectangles". */
export function describeV18(plan: V18Plan): string {
  return `${PALETTES_V18[plan.palette]!.name}, detail ${plan.settings.detail}, ${(plan.rects.length / 5).toLocaleString("en-US")} rectangles`;
}
