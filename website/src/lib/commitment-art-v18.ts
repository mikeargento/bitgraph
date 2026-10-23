// © 2026 Michael Argento. All rights reserved.
/**
 * bitgraph-art/18 (2026-10-10), "Bridge": a suspension bridge that never existed, built from packed flat rectangles.
 * A standalone generator page (2026-10-10), made a BitGraph series the way "Three" is (commitment-art-v16.ts):
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
 * Every setting of the standalone page comes from the commitment, per click (2026-10-10, so every possibility
 * can occur), drawn first, in this order, each a sum of below() draws so the space is wide while most
 * pieces still read well (tri(a, b) = below(a) + below(b), a triangle peaked in the middle):
 *   palette      PALETTES_V18[below(5)]: background, bridge, footing, sky, water (the five presets), uniform
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
 *
 * Since 2026-10-11 the code that carries these rules out lives in commitment-art-bridge.ts, shared with bitgraph-art/19
 * (the 16:9 Bridge); SPEC_V18 below holds every number above, and the pins (unchanged) show the bytes did not move.
 */
import {
  BRIDGE_COPYRIGHT, BRIDGE_KINDS, BRIDGE_PALETTES, BRIDGE_RULES, BRIDGE_SETTINGS_KEYWORD, BRIDGE_SVG_KEYWORD, bridgeVersion, describeBridge, settingsTextBridge, svgFromPngBridge,
  type BridgePlan, type BridgeSettings, type BridgeSpec,
} from "./commitment-art-bridge.ts";

export const ART_ALGORITHM_V18 = "bitgraph-art/18";
export const V18_SIZE = 1200;
export const V18_WIDTH = V18_SIZE, V18_HEIGHT = V18_SIZE;
export const V18_COPYRIGHT = BRIDGE_COPYRIGHT;
/** The iTXt keyword of the print SVG: version 16's. */
export const V18_SVG_KEYWORD = BRIDGE_SVG_KEYWORD;
export const V18_HORIZON = 697;
/** A bridge rectangle centerd below this line is footing. */
export const V18_FOOTING_LINE = 787;

/** The five presets, in the original order: background, bridge, footing, sky, water. */
export const PALETTES_V18 = BRIDGE_PALETTES;
/** A rectangle's kind; its color is the palette's entry kind + 1 (entry 0 is the background). */
export const KINDS_V18 = BRIDGE_KINDS;
export { KIND_BRIDGE, KIND_FOOTING, KIND_SKY, KIND_WATER } from "./commitment-art-bridge.ts";

/** (largest side, attempts), in order. */
export const BRIDGE_STAGES_V18: readonly (readonly [number, number])[] = [[90, 150], [50, 800], [28, 4000], [16, 14000], [9, 45000], [5, 120000]];
export const FIELD_STAGES_V18: readonly (readonly [number, number])[] = [[360, 60], [210, 220], [120, 750], [60, 2400], [30, 7000], [15, 22000], [8, 40000]];
/** The packing's fixed numbers. */
export const V18_RULES = BRIDGE_RULES;

/** The settings of the standalone generator page, each drawn from the commitment (the header gives the distributions). */
export type V18Settings = BridgeSettings;
/** The standalone page's sliders: each setting's range, inclusive. */
export const V18_SETTING_RANGES: Readonly<Record<keyof V18Settings, readonly [number, number]>> = {
  detail: [2, 6], bridgeGap: [1, 5], fieldGapOffset: [0, 12], buffer: [0, 16], margin: [0, 64], bars: [0, 100], bridgeMax: [20, 160], fieldMax: [60, 600],
};

/**
 * A piece's plan: the palette (an index into PALETTES_V18), the settings drawn, and every rectangle in the order placed, flat, five integers
 * each: x, y, w, h, kind (KINDS_V18). Never overlapping, so the order does not change the picture.
 */
export type V18Plan = BridgePlan;

export const TOWER_CENTERS_V18 = [332, 868] as const;
export const CABLE_OFFSETS_V18 = [-27, 27] as const;

/** Every number of the header, in the engine's names. */
export const SPEC_V18: BridgeSpec = {
  algorithm: ART_ALGORITHM_V18,
  W: V18_SIZE, H: V18_SIZE,
  deck: { x0: 48, x1: 1152, top: 667, chordBottom: 677, postsBottom: 689, underside: V18_HORIZON, postWidth: 4, postStep: 16 },
  towers: TOWER_CENTERS_V18,
  leg: { outer: 39, inner: 15, top: 397, center: 27 },
  finials: [[5, 387, 397], [2, 379, 387]],
  struts: [[409, 427], [463, 481], [525, 545], [603, 621]],
  pier: { outer: 41, inner: 13, bottom: 787 },
  footing: { outer: 45, inner: 9, bottom: 811 },
  slab: { half: 64, bottom: 818 },
  cable: { offsets: CABLE_OFFSETS_V18, mainY0: 663, mainA: 262, sideY0: 665, sideA: 264, thick2: 49, band: 12 },
  suspenders: { start: 58, step: 18, clear: 46, minLength: 14, half: 2 },
  horizon: V18_HORIZON,
  footingLine: V18_FOOTING_LINE,
  bridgeStages: BRIDGE_STAGES_V18, bridgeBase: 90,
  fieldStages: FIELD_STAGES_V18, fieldBase: 360,
  draws: {
    detailCuts: [8, 20, 35, 60], gapCuts: [40, 65, 80, 92], offsetCuts: [4, 11, 21, 33, 46, 58, 68, 77, 84, 90, 94, 97],
    buffer: [9, 9], margin: [33, 33], bars: [51, 51], bridgeMax: [20, 71, 71], fieldMax: [60, 10, 28, 28],
  },
  ranges: V18_SETTING_RANGES,
};

const V18 = bridgeVersion(SPEC_V18);

/** The mask's rectangles, named: [x0, y0, x1, y1, part]. */
export const maskRectsV18 = V18.maskRects;
/** One cable's pixels, by the cable rule in the header (1 = cable). */
export const cableMaskV18 = V18.cableMask;
/** The suspenders: x and the top row (floor of the higher cable's y at x); each is R(x - 2, top, x + 2, 667). */
export const suspendersV18 = V18.suspenders;
/** The bridge mask, G x G, 1 = bridge. Computed once; the same for every piece. Callers must not write to it. */
export const bridgeMaskV18 = V18.bridgeMask;
/** The plan for a commitment (the last one is kept, frozen: the file, its check and its redraw ask in turn). */
export const planV18 = V18.plan;
/** The palette and settings a commitment draws, without packing (they are the stream's first draws). */
export const settingsV18 = V18.settingsOf;
/** The settings in words, as the SVG's metadata and the PNG's text state them. */
export const settingsTextV18 = settingsTextBridge;
/** The plan packed afresh, never from the memo (planV18 keeps the last one): the tests draw every piece twice with it. */
export const packV18 = V18.pack;
/** The SVG text, canonical: one element a line, attributes in a fixed order, integers only, LF, a final LF. */
export const svgTextV18 = V18.svgText;
/** The SVG file's bytes (UTF-8). */
export const svgV18 = V18.svg;
/** The canonical RGBA pixels of the plan, 1200 x 1200. */
export const renderV18 = V18.render;
/** The tEXt keyword under which the PNG states the settings drawn. */
export const V18_SETTINGS_KEYWORD = BRIDGE_SETTINGS_KEYWORD;
/** The recorded PNG, 1200 x 1200 (the header's file). */
export const pngFileV18 = V18.pngFile;
/** The print SVG a version 18 PNG carries (version 16's iTXt keyword), or null. */
export const svgFromPngV18 = svgFromPngBridge;
/** The commitment a version 18 SVG states in its metadata, or null. Informational: a check redraws instead. */
export const readCommitmentV18 = V18.readCommitment;
/** A short description of a plan: "Fog, detail 6, 7,345 rectangles". */
export const describeV18 = describeBridge;
