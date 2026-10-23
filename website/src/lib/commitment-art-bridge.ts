// © 2026 Michael Argento. All rights reserved.
/**
 * The Bridge engine (2026-10-11): the code of bitgraph-art/18 (commitment-art-v18.ts, the square Bridge), taken out so
 * bitgraph-art/19 (commitment-art-v19.ts, the 16:9 Bridge) runs the very same rules on its own numbers. Each version's
 * file states its rules and its numbers in full (its header is the spec); this file only carries them out. Nothing here
 * is a choice: every number comes from the version's BridgeSpec, and version 18's spec reproduces its file byte for byte
 * (its pins, unchanged, are the proof).
 *
 * Integers only. The canvas is W x H; a point is drawn as i = below(W * H), (x, y) = (i mod W, i div W).
 */
import { sha256 } from "@noble/hashes/sha256";
import { V16_COPYRIGHT, V16_SVG_KEYWORD, svgFromPngV16 } from "./commitment-art-v16.ts";
import { deflateV15, filterRowsV15 } from "./png-deflate-v15.ts";

/** The copyright line both Bridges carry: version 16's. */
export const BRIDGE_COPYRIGHT = V16_COPYRIGHT;
/** The iTXt keyword of the print SVG: version 16's. */
export const BRIDGE_SVG_KEYWORD = V16_SVG_KEYWORD;
/** The tEXt keyword under which the PNG states the settings drawn. */
export const BRIDGE_SETTINGS_KEYWORD = "bitgraph-art-settings";

/** The five presets, in the original order: background, bridge, footing, sky, water. Both Bridges draw from these. */
export const BRIDGE_PALETTES: readonly { name: string; colors: readonly [string, string, string, string, string] }[] = [
  { name: "International orange", colors: ["#f5efe0", "#c0362c", "#b08d4a", "#8fb3c9", "#1d4e6b"] },
  { name: "Red and black", colors: ["#ffffff", "#000000", "#000000", "#ee1c25", "#ee1c25"] },
  { name: "Night", colors: ["#0d1b2a", "#f25c3b", "#c9a45c", "#2c4f7c", "#1b3a5c"] },
  { name: "Sunset", colors: ["#fbe3c2", "#7a1f2b", "#4a2a1a", "#f08a24", "#3a2d6b"] },
  { name: "Fog", colors: ["#ecebe6", "#b3341f", "#8a7a55", "#a3b0b5", "#55707d"] },
];
/** A rectangle's kind; its color is the palette's entry kind + 1 (entry 0 is the background). */
export const BRIDGE_KINDS = ["bridge", "footing", "sky", "water"] as const;
export const KIND_BRIDGE = 0, KIND_FOOTING = 1, KIND_SKY = 2, KIND_WATER = 3;

/** The settings of the standalone generator page, each drawn from the commitment (each version's header gives the distributions). */
export interface BridgeSettings {
  /** Bridge stages run, 2 to 6. */
  detail: number;
  /** Least space between bridge rectangles. */
  bridgeGap: number;
  /** Added to the bridge gap for the field. */
  fieldGapOffset: number;
  /** Field kept this far from the bridge. */
  buffer: number;
  /** Field kept this far from the canvas edge. */
  margin: number;
  /** Percent of rectangles that are bars, 0 to 100. */
  bars: number;
  /** Largest bridge rectangle. */
  bridgeMax: number;
  /** Largest field rectangle, in tens. */
  fieldMax: number;
}

/**
 * A piece's plan: the palette (an index into BRIDGE_PALETTES), the settings drawn, and every rectangle in the order placed,
 * flat, five integers each: x, y, w, h, kind (BRIDGE_KINDS). Never overlapping, so the order does not change the picture.
 */
export interface BridgePlan {
  palette: number;
  settings: BridgeSettings;
  rects: number[];
}

/** One version's numbers. Every name is the one its header uses. */
export interface BridgeSpec {
  /** The version's label, "bitgraph-art/18": the stream's label and the SVG's metadata. */
  algorithm: string;
  W: number;
  H: number;
  /** The deck: top chord R(x0, top, x1, chordBottom), bottom chord R(x0, postsBottom, x1, underside), posts R(x, chordBottom, x + postWidth, postsBottom) every postStep from x0. */
  deck: { x0: number; x1: number; top: number; chordBottom: number; postsBottom: number; underside: number; postWidth: number; postStep: number };
  /** The two towers' centers (their midpoint and half the distance between them are whole numbers). */
  towers: readonly [number, number];
  /** Each leg, R(cx - outer, top, cx - inner, deck underside) and its mirror; its center lx = cx -/+ center. */
  leg: { outer: number; inner: number; top: number; center: number };
  /** Each leg's finials, top down the leg: [half width, y0, y1], R(lx - half, y0, lx + half, y1). Listed in mask order. */
  finials: readonly (readonly [number, number, number])[];
  /** The struts R(cx - leg.outer, a, cx + leg.outer, b). */
  struts: readonly (readonly [number, number])[];
  /** Piers R(cx - outer, deck underside, cx - inner, bottom) and mirrored; footings R(cx - outer, pier bottom, cx - inner, bottom); the slab R(cx - half, footing bottom, cx + half, bottom). */
  pier: { outer: number; inner: number; bottom: number };
  footing: { outer: number; inner: number; bottom: number };
  slab: { half: number; bottom: number };
  /**
   * The cables: one per offset, each three parabolas (main span y = mainY0 - mainA ((x - mid) / L)^2, the sides
   * y = sideY0 - sideA ((x - end) / L)^2). `thick2` is the stroke's thickness squared ((2 x half-thickness)^2, an integer);
   * `band` how far above and below the curve's row a column is searched (wider than any column's stroke).
   */
  cable: { offsets: readonly [number, number]; mainY0: number; mainA: number; sideY0: number; sideA: number; thick2: number; band: number };
  /** For x = start, start + step, ... up to the deck's end, skipping |x - cx| < clear: R(x - half, top, x + half, deck top) unless shorter than minLength. */
  suspenders: { start: number; step: number; clear: number; minLength: number; half: number };
  /** The field's sky is above it, its water below. */
  horizon: number;
  /** A bridge rectangle centered below this line is footing. */
  footingLine: number;
  /** (largest side, attempts), in order, and the size each set of stages is drawn for (scaled by the setting's largest). */
  bridgeStages: readonly (readonly [number, number])[];
  bridgeBase: number;
  fieldStages: readonly (readonly [number, number])[];
  fieldBase: number;
  /** The settings' draws: cuts of below(100), and the terms of tri(a, b) = below(a) + below(b). */
  draws: {
    detailCuts: readonly number[]; gapCuts: readonly number[]; offsetCuts: readonly number[];
    buffer: readonly [number, number]; margin: readonly [number, number]; bars: readonly [number, number];
    /** bridgeMax = base + tri(a, b) */
    bridgeMax: readonly [number, number, number];
    /** fieldMax = base + step tri(a, b) */
    fieldMax: readonly [number, number, number, number];
  };
  /** Each setting's range, inclusive (the standalone page's sliders). */
  ranges: Readonly<Record<keyof BridgeSettings, readonly [number, number]>>;
}

/** The packing's fixed numbers, the same in every Bridge. */
export const BRIDGE_RULES = { pointTries: 12, sizeTries: 5 } as const;

/** The labeled stream (version 16's, under the version's label). */
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

const b64url = (b: Uint8Array): string => {
  let s = "";
  for (const x of b) s += String.fromCharCode(x);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
};
const rgbOf = (hex: string): [number, number, number] => [parseInt(hex.slice(1, 3), 16), parseInt(hex.slice(3, 5), 16), parseInt(hex.slice(5, 7), 16)];

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

/** The print SVG a Bridge PNG carries (version 16's iTXt keyword), or null. */
export const svgFromPngBridge = svgFromPngV16;

/** The settings in words, as the SVG's metadata and the PNG's text state them. */
export function settingsTextBridge(plan: Pick<BridgePlan, "palette" | "settings">): string {
  const t = plan.settings;
  return `palette ${BRIDGE_PALETTES[plan.palette]!.name}; detail ${t.detail} of 6; bridge gap ${t.bridgeGap}; field gap ${t.bridgeGap + t.fieldGapOffset} (offset ${t.fieldGapOffset}); field buffer ${t.buffer}; edge margin ${t.margin}; bars ${t.bars}%; largest bridge rectangle ${t.bridgeMax}; largest field rectangle ${t.fieldMax}`;
}

/** A short description of a plan: "Fog, detail 6, 7,345 rectangles". */
export function describeBridge(plan: BridgePlan): string {
  return `${BRIDGE_PALETTES[plan.palette]!.name}, detail ${plan.settings.detail}, ${(plan.rects.length / 5).toLocaleString("en-US")} rectangles`;
}

/** One Bridge version: its mask, plan and files, from its spec. */
export function bridgeVersion(spec: BridgeSpec) {
  const { algorithm, W, H, deck, towers, leg, cable, horizon, footingLine } = spec;
  const [t0, t1] = towers;
  const mid = (t0 + t1) / 2, half = (t1 - t0) / 2;
  if (!Number.isInteger(mid) || !Number.isInteger(half)) throw new Error("a Bridge's towers must have a whole-number midpoint");
  const version = /^bitgraph-art\/(\d+)$/.exec(algorithm)?.[1];
  if (!version) throw new Error(`not a bitgraph-art label: ${algorithm}`);
  const metaRe = new RegExp(`<metadata>bitgraph-art\\/${version} commitment ([A-Za-z0-9_-]{43})[;<]`);

  /* ── The mask ─────────────────────────────────────────────────────────────────────────────────────────────────── */

  /** The mask's rectangles, named: [x0, y0, x1, y1, part]. */
  function maskRects(): Array<[number, number, number, number, string]> {
    const out: Array<[number, number, number, number, string]> = [];
    out.push([deck.x0, deck.top, deck.x1, deck.chordBottom, "deck top chord"], [deck.x0, deck.postsBottom, deck.x1, deck.underside, "deck bottom chord"]);
    for (let x = deck.x0; x + deck.postWidth <= deck.x1; x += deck.postStep) out.push([x, deck.chordBottom, x + deck.postWidth, deck.postsBottom, "deck post"]);
    for (const cx of towers) {
      out.push([cx - leg.outer, leg.top, cx - leg.inner, deck.underside, "leg"], [cx + leg.inner, leg.top, cx + leg.outer, deck.underside, "leg"]);
      for (const lx of [cx - leg.center, cx + leg.center]) for (const [h, y0, y1] of spec.finials) out.push([lx - h, y0, lx + h, y1, "finial"]);
      for (const [a, b] of spec.struts) out.push([cx - leg.outer, a, cx + leg.outer, b, "strut"]);
      out.push([cx - spec.pier.outer, deck.underside, cx - spec.pier.inner, spec.pier.bottom, "pier"], [cx + spec.pier.inner, deck.underside, cx + spec.pier.outer, spec.pier.bottom, "pier"]);
      out.push([cx - spec.footing.outer, spec.pier.bottom, cx - spec.footing.inner, spec.footing.bottom, "footing"], [cx + spec.footing.inner, spec.pier.bottom, cx + spec.footing.outer, spec.footing.bottom, "footing"]);
      out.push([cx - spec.slab.half, spec.footing.bottom, cx + spec.slab.half, spec.slab.bottom, "slab"]);
    }
    return out;
  }

  /** One cable's parabola for the column (or integer x) given: y = Y0 - A ((x - x0) / L)^2. */
  function cablePiece(off: number, x: number, integerX: boolean): { Y0: number; A: number; x0: number; L: number } {
    const xa = t0 + off, xb = t1 + off;
    // A column X has its center at X + 1/2, never on xa or xb, so it is main span exactly when xa <= X < xb; an integer x
    // (a suspender) is main span when xa <= x <= xb, as the generator chose it.
    const main = integerX ? x >= xa && x <= xb : x >= xa && x < xb;
    if (main) return { Y0: cable.mainY0, A: cable.mainA, x0: mid + off, L: half };
    return x < xa ? { Y0: cable.sideY0, A: cable.sideA, x0: deck.x0, L: xa - deck.x0 } : { Y0: cable.sideY0, A: cable.sideA, x0: deck.x1, L: deck.x1 - xb };
  }

  /** One cable's pixels, by the cable rule (1 = cable). */
  function cableMask(off: number): Uint8Array {
    const m = new Uint8Array(W * H);
    const K = cable.thick2, band = cable.band;
    for (let X = deck.x0; X < deck.x1; X++) {
      const { Y0, A, x0, L } = cablePiece(off, X, false);
      const t = 2 * X + 1 - 2 * x0, Q = 4 * L * L;
      const N = Y0 * Q - A * t * t;
      const rhs = K * (Q * Q + 16 * A * A * t * t);
      const yc = idiv(N, Q); // the curve's y, rounded down (N > 0 everywhere on the cables)
      for (let Y = yc - band; Y <= yc + band; Y++) {
        const E = (2 * Y + 1) * Q - 2 * N;
        if (E * E <= rhs) m[Y * W + X] = 1;
      }
    }
    // round ends, as a stroke has: a pixel whose center is within half the thickness of a deck end's cable point
    const r = Math.ceil(Math.sqrt(K) / 2) + 1, ey = 2 * cable.sideY0;
    for (const ex of [deck.x0, deck.x1]) {
      for (let X = ex - r; X <= ex + r; X++) for (let Y = cable.sideY0 - r; Y <= cable.sideY0 + r; Y++) {
        const dx = 2 * X + 1 - 2 * ex, dy = 2 * Y + 1 - ey;
        if (dx * dx + dy * dy <= K) m[Y * W + X] = 1;
      }
    }
    return m;
  }

  /** The suspenders: x and the top row (floor of the higher cable's y at x); each is R(x - half, top, x + half, deck top). */
  function suspenders(): Array<{ x: number; top: number }> {
    const s = spec.suspenders, out: Array<{ x: number; top: number }> = [];
    for (let x = s.start; x <= deck.x1; x += s.step) {
      if (Math.abs(x - t0) < s.clear || Math.abs(x - t1) < s.clear) continue;
      // the higher cable: the smaller y, compared as exact fractions num / den
      let best: [number, number] | null = null;
      for (const off of cable.offsets) {
        const { Y0, A, x0, L } = cablePiece(off, x, true);
        const den = L * L, num = Y0 * den - A * (x - x0) * (x - x0);
        if (best === null || num * best[1] < best[0] * den) best = [num, den];
      }
      const [num, den] = best!;
      if (num > (deck.top - s.minLength) * den) continue; // too short
      out.push({ x, top: idiv(num, den) });
    }
    return out;
  }

  let MASK: Uint8Array | null = null;
  let SAT: Int32Array | null = null;
  const fill = (m: Uint8Array, x0: number, y0: number, x1: number, y1: number): void => {
    for (let y = y0; y < y1; y++) m.fill(1, y * W + x0, y * W + x1);
  };

  /** The bridge mask, W x H, 1 = bridge. Computed once; the same for every piece. Callers must not write to it. */
  function bridgeMask(): Uint8Array {
    if (MASK) return MASK;
    const m = new Uint8Array(W * H);
    for (const [x0, y0, x1, y1] of maskRects()) fill(m, x0, y0, x1, y1);
    for (const off of cable.offsets) {
      const c = cableMask(off);
      for (let i = 0; i < c.length; i++) if (c[i]) m[i] = 1;
    }
    const h = spec.suspenders.half;
    for (const { x, top } of suspenders()) fill(m, x - h, top, x + h, deck.top);
    MASK = m;
    return m;
  }

  /** The summed-area table: S[y (W + 1) + x] = bridge pixels in [0, x) x [0, y). */
  function sat(): Int32Array {
    if (SAT) return SAT;
    const m = bridgeMask(), SW = W + 1, s = new Int32Array(SW * (H + 1));
    for (let y = 1; y <= H; y++) {
      let row = 0;
      for (let x = 1; x <= W; x++) { row += m[(y - 1) * W + (x - 1)]!; s[y * SW + x] = s[(y - 1) * SW + x]! + row; }
    }
    SAT = s;
    return s;
  }

  /* ── The plan ─────────────────────────────────────────────────────────────────────────────────────────────────── */

  /** The palette and the settings: the stream's first draws, in the header's order. */
  function drawSettings(s: Stream): { palette: number; settings: BridgeSettings } {
    const d = spec.draws;
    const palette = s.below(BRIDGE_PALETTES.length);
    const pick = (cuts: readonly number[]) => { const u = s.below(100); let k = 0; while (k < cuts.length && u >= cuts[k]!) k++; return k; };
    const tri = (ab: readonly [number, number]) => s.below(ab[0]) + s.below(ab[1]);
    const detail = 2 + pick(d.detailCuts);
    const bridgeGap = 1 + pick(d.gapCuts);
    const fieldGapOffset = pick(d.offsetCuts);
    const buffer = tri(d.buffer);
    const margin = tri(d.margin);
    const bars = tri(d.bars);
    const bridgeMax = d.bridgeMax[0] + tri([d.bridgeMax[1], d.bridgeMax[2]]);
    const fieldMax = d.fieldMax[0] + d.fieldMax[1] * tri([d.fieldMax[2], d.fieldMax[3]]);
    return { palette, settings: { detail, bridgeGap, fieldGapOffset, buffer, margin, bars, bridgeMax, fieldMax } };
  }

  /** The palette and settings a commitment draws, without packing (they are the stream's first draws). */
  function settingsOf(commitment: Uint8Array): { palette: number; settings: BridgeSettings } {
    requireCommitment(commitment);
    return drawSettings(new Stream(algorithm, commitment));
  }

  /** The plan packed afresh, never from the memo (plan() keeps the last one). */
  function pack(commitment: Uint8Array): BridgePlan {
    requireCommitment(commitment);
    const s = new Stream(algorithm, commitment);
    const { palette, settings } = drawSettings(s);
    const mask = bridgeMask(), table = sat(), SW = W + 1, WH = W * H;
    const occ = new Uint8Array(WH);
    const rects: number[] = [];
    const { margin, buffer, bars: barPercent } = settings;
    const { pointTries, sizeTries } = BRIDGE_RULES;

    /** Bridge pixels in [x0, x1) x [y0, y1), clipped to the canvas. */
    const bridgeIn = (x0: number, y0: number, x1: number, y1: number): number => {
      if (x0 < 0) x0 = 0; if (y0 < 0) y0 = 0; if (x1 > W) x1 = W; if (y1 > H) y1 = H;
      if (x1 <= x0 || y1 <= y0) return 0;
      return table[y1 * SW + x1]! - table[y0 * SW + x1]! - table[y1 * SW + x0]! + table[y0 * SW + x0]!;
    };
    /** No occupied pixel in [x0, x1) x [y0, y1), clipped. */
    const free = (x0: number, y0: number, x1: number, y1: number): boolean => {
      if (x0 < 0) x0 = 0; if (y0 < 0) y0 = 0; if (x1 > W) x1 = W; if (y1 > H) y1 = H;
      for (let y = y0; y < y1; y++) { const r = y * W; for (let x = x0; x < x1; x++) if (occ[r + x]) return false; }
      return true;
    };

    const run = (stages: readonly (readonly [number, number])[], field: boolean, gap: number, largest: number, base: number) => {
      const want = field ? 0 : 1;
      for (const [side, attempts] of stages) {
        const M = Math.max(2000, idiv(1000 * side * largest, base)); // the stage's largest side, scaled, in m-units
        for (let a = 0; a < attempts; a++) {
          let p = -1;
          for (let t = 0; t < pointTries; t++) {
            const i = s.below(WH);
            if (occ[i] || mask[i] !== want) continue;
            p = i; break;
          }
          if (p < 0) continue;
          const px = p % W, py = (p - px) / W;
          const size = idiv(45 * M, 100) + s.below(idiv(55 * M, 100));
          const ratio = s.below(100) < barPercent ? 80 + s.below(250) : 550 + s.below(450);
          let w = size, h = idiv(size * ratio, 1000);
          if (s.below(2) === 0) { const t = w; w = h; h = t; }
          for (let tries = 0; tries < sizeTries; tries++) {
            const iw = Math.max(2, idiv(w + 500, 1000)), ih = Math.max(2, idiv(h + 500, 1000));
            const x0 = px - (iw >> 1), y0 = py - (ih >> 1), x1 = x0 + iw, y1 = y0 + ih;
            let ok = x0 >= 0 && y0 >= 0 && x1 <= W && y1 <= H;
            if (ok && !field) ok = bridgeIn(x0, y0, x1, y1) === iw * ih;
            if (ok && field) {
              ok = x0 >= margin && y0 >= margin && x1 <= W - margin && y1 <= H - margin
                && bridgeIn(x0 - buffer, y0 - buffer, x1 + buffer, y1 + buffer) === 0
                && (y1 <= horizon || y0 >= horizon);
            }
            if (ok) ok = free(x0 - gap, y0 - gap, x1 + gap, y1 + gap);
            if (ok) {
              for (let y = y0; y < y1; y++) occ.fill(1, y * W + x0, y * W + x1);
              const kind = field ? (y0 + y1 < 2 * horizon ? KIND_SKY : KIND_WATER) : (y0 + y1 > 2 * footingLine ? KIND_FOOTING : KIND_BRIDGE);
              rects.push(x0, y0, iw, ih, kind);
              break;
            }
            w = idiv(62 * w, 100); h = idiv(62 * h, 100);
            if (w < 2000 && h < 2000) break;
          }
        }
      }
    };
    run(spec.bridgeStages.slice(0, settings.detail), false, settings.bridgeGap, settings.bridgeMax, spec.bridgeBase);
    run(spec.fieldStages, true, settings.bridgeGap + settings.fieldGapOffset, settings.fieldMax, spec.fieldBase);
    return { palette, settings, rects };
  }

  let memo: { key: string; plan: BridgePlan } | null = null;
  const keyOf = (c: Uint8Array) => Array.from(c, (b) => b.toString(16).padStart(2, "0")).join("");

  function plan(commitment: Uint8Array): BridgePlan {
    requireCommitment(commitment);
    const key = keyOf(commitment);
    if (memo && memo.key === key) return memo.plan; // the last plan (frozen): the file, its check and its redraw ask in turn
    const p = pack(commitment);
    Object.freeze(p.rects); Object.freeze(p.settings);
    memo = { key, plan: Object.freeze(p) };
    return p;
  }

  /* ── The files ────────────────────────────────────────────────────────────────────────────────────────────────── */

  /** The SVG text, canonical: one element a line, attributes in a fixed order, integers only, LF, a final LF. */
  function svgText(p: BridgePlan, commitment: Uint8Array): string {
    requireCommitment(commitment);
    const pal = BRIDGE_PALETTES[p.palette]!.colors;
    const lines = [
      `<?xml version="1.0" encoding="UTF-8"?>`,
      `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="100%" height="100%" shape-rendering="crispEdges">`,
      `<title>Bridge</title>`,
      `<desc>${BRIDGE_COPYRIGHT}</desc>`,
      `<metadata>${algorithm} commitment ${b64url(commitment)}; ${settingsTextBridge(p)}</metadata>`,
      `<rect x="0" y="0" width="${W}" height="${H}" fill="${pal[0]}"/>`,
    ];
    const r = p.rects;
    for (let i = 0; i < r.length; i += 5) lines.push(`<rect x="${r[i]}" y="${r[i + 1]}" width="${r[i + 2]}" height="${r[i + 3]}" fill="${pal[r[i + 4]! + 1]}"/>`);
    lines.push(`</svg>`);
    return lines.join("\n") + "\n";
  }

  /** The SVG file's bytes (UTF-8). */
  function svg(commitment: Uint8Array): Uint8Array {
    return new TextEncoder().encode(svgText(plan(commitment), commitment));
  }

  /** The canonical RGBA pixels of the plan, W x H. */
  function render(p: BridgePlan): Uint8Array {
    const pal = BRIDGE_PALETTES[p.palette]!.colors.map(rgbOf);
    const px = new Uint8Array(W * H * 4);
    const bg = pal[0]!;
    for (let i = 0; i < px.length; i += 4) { px[i] = bg[0]; px[i + 1] = bg[1]; px[i + 2] = bg[2]; px[i + 3] = 255; }
    const r = p.rects;
    for (let k = 0; k < r.length; k += 5) {
      const x = r[k]!, y = r[k + 1]!, w = r[k + 2]!, h = r[k + 3]!, c = pal[r[k + 4]! + 1]!;
      for (let yy = y; yy < y + h; yy++) {
        for (let i = (yy * W + x) * 4, e = i + w * 4; i < e; i += 4) { px[i] = c[0]; px[i + 1] = c[1]; px[i + 2] = c[2]; }
      }
    }
    return px;
  }

  /**
   * The recorded PNG, W x H: version 16's file, chunk for chunk, with the settings in one more tEXt chunk: IHDR;
   * tEXt "bitgraph-art" (the manifest); tEXt "Copyright"; tEXt "bitgraph-art-settings"; iTXt "bitgraph-print-svg"
   * (uncompressed, no language: its text bytes ARE the SVG's UTF-8 bytes); IDAT (version 15's pure deflate); IEND.
   */
  function pngFile(px: Uint8Array, manifestText: string, svgTextValue: string, settingsText: string): Uint8Array {
    const ihdr = new Uint8Array(13);
    ihdr.set(u32be(W), 0); ihdr.set(u32be(H), 4);
    ihdr[8] = 8; ihdr[9] = 2; // 8-bit truecolor, no alpha; compression, filter, interlace 0
    const itxt = chunk("iTXt", concat([latin1(BRIDGE_SVG_KEYWORD), Uint8Array.of(0, 0, 0, 0, 0), new TextEncoder().encode(svgTextValue)]));
    const idat = deflateV15(filterRowsV15(px, W, H));
    return concat([PNG_SIG, chunk("IHDR", ihdr), text("bitgraph-art", manifestText), text("Copyright", BRIDGE_COPYRIGHT), text(BRIDGE_SETTINGS_KEYWORD, settingsText), itxt, chunk("IDAT", idat), chunk("IEND", new Uint8Array(0))]);
  }

  /** The commitment this version's SVG states in its metadata, or null. Informational: a check redraws instead. */
  function readCommitment(svgBytes: Uint8Array): Uint8Array | null {
    let s: string;
    try { s = new TextDecoder("utf-8", { fatal: true }).decode(svgBytes); } catch { return null; }
    const m = metaRe.exec(s);
    if (!m) return null;
    try {
      const bin = atob(m[1]!.replace(/-/g, "+").replace(/_/g, "/") + "=");
      const out = Uint8Array.from(bin, (c) => c.charCodeAt(0));
      return out.length === 32 ? out : null;
    } catch { return null; }
  }

  return { maskRects, cableMask, suspenders, bridgeMask, settingsOf, pack, plan, svgText, svg, render, pngFile, readCommitment };
}
