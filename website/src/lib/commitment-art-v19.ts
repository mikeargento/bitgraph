// © 2026 Michael Argento. All rights reserved.
/**
 * bitgraph-art/19 (2026-10-11), "Bridge" at 16:9: version 18's suspension bridge (commitment-art-v18.ts) on a 1920 x 1080
 * canvas, for /generate (2026-10-11: the site's demo). The same rules, the same
 * engine (commitment-art-bridge.ts), the same five palettes and the same file; the silhouette redrawn for the wide frame
 * and every size scaled so a piece reads as densely as a square one. Every random draw comes from the position
 * commitment, integers only, the recorded file a PNG that carries the exact SVG print master in an iTXt chunk.
 *
 * ── The stream ─────────────────────────────────────────────────────────────────────────────────────────────────────
 *   block(k) = SHA-256( ASCII "bitgraph-art/19" || 0x00 || ASCII "draw" || 0x00 || C || u32be(k) ), C = 32 bytes
 *   u32()    = the next 4 stream bytes, big-endian;  below(n) = u32() mod n  (integers only)
 *
 * ── The silhouette, redesigned for 16:9 (a rectangle R(x0, y0, x1, y1) covers the pixels [x0, x1) x [y0, y1)) ─────
 * A bridge is naturally wide, so the deck runs nearly the full width, with end margins of about 4% as version 18 has
 * (80 of 1920; 48 of 1200 there). The towers stand where version 18's do along the deck (about 25.7% and 74.3% of its
 * length). Every member is version 18's, 7/6 as thick (the towers 7/6 as tall above the deck), so at the column's width
 * the bridge reads as the same bridge, a little bolder; the cables keep their rule and sag from saddle to deck. The
 * horizon (the deck's underside) sits at 640 of 1080, 59% down, where version 18's is 58%: the sky keeps room above
 * the finials (268 rows) and the water room below the slabs (299 rows).
 *   deck        R(80, 605, 1840, 617) and R(80, 631, 1840, 640), joined by posts R(x, 617, x + 5, 631) every 18 from 80
 *   towers      at cx = 532 and 1388: legs R(cx - 46, 290, cx - 18, 640) and R(cx + 18, 290, cx + 46, 640); on each leg
 *               (lx = cx -/+ 32) a finial R(lx - 6, 278, lx + 6, 290) and R(lx - 2, 269, lx + 2, 278); four struts
 *               R(cx - 46, a, cx + 46, b) for (a, b) = (304, 325), (367, 388), (439, 463), (530, 551); piers
 *               R(cx - 48, 640, cx - 16, 745) and R(cx + 16, 640, cx + 48, 745); footings R(cx - 53, 745, cx - 11, 773)
 *               and R(cx + 11, 745, cx + 53, 773); a slab R(cx - 75, 773, cx + 75, 781)
 *   cables      two, offset off = -32 and +32 from the tower centers (over the legs, doubling up and crossing). With
 *               xa = 532 + off, xb = 1388 + off, mid = 960 + off, each is three parabolas:
 *                 main span  xa <= x <= xb:  y = 601 - 307 ((x - mid) / 428)^2        (saddles at y = 294, low 601)
 *                 west side  80 <= x < xa:   y = 603 - 309 ((x - 80) / (xa - 80))^2   (horizontal at the deck end)
 *                 east side  xb < x <= 1840: y = 603 - 309 ((1840 - x) / (1840 - xb))^2
 *               THE CABLE RULE, version 18's with a stroke 8 units thick: pixel (X, Y), 80 <= X < 1840, is cable when
 *               e^2 <= 4^2 (1 + s^2) at its center's x (e its center's vertical offset from the parabola, s the slope). In
 *               integers: t = 2X + 1 - 2 x0, Q = 4 L^2, N = Y0 Q - A t^2 (Y0, A = 601, 307 on the main span, 603, 309 on
 *               the sides), E = (2Y + 1) Q - 2N, and
 *                 cable  <=>  E^2 <= 64 (Q^2 + 16 A^2 t^2),
 *               every product an integer below 2^53 (the largest, E^2 within the 25-row search band, under 10^15).
 *               Round ends: (2X + 1 - 2ex)^2 + (2Y + 1 - 1206)^2 <= 64 at ex = 80 and 1840. Each column's band is at least
 *               8 pixels tall and its center moves at most about 1.5 a column, so a cable is one connected run (tested).
 *   suspenders  for x = 92, 113, ... (every 21) up to 1840, skipping |x - 532| < 54 and |x - 1388| < 54: under the higher
 *               cable at the integer x (top = the smaller y, a fraction compared exactly), skipped when 605 - top < 16,
 *               else R(x - 2, floor(top), x + 2, 605)
 *   horizon     y = 640 (the deck's underside): the field's sky is above it, its water below.
 *
 * ── The plan, read in exactly this order (version 18's draws; the ranges scaled for the canvas) ─────────────────────
 *   palette      PALETTES_V19[below(5)], version 18's five presets, uniform
 *   detail       2 to 6, by u = below(100): u < 8: 2, u < 20: 3, u < 35: 4, u < 60: 5, else 6 (as version 18)
 *   bridge gap   1 to 5, by u = below(100): u < 40: 1, u < 65: 2, u < 80: 3, u < 92: 4, else 5 (as version 18)
 *   field gap    the bridge gap plus an offset 0 to 14, by u = below(100) against the cuts 3, 9, 17, 27, 38, 49, 59, 68,
 *                76, 83, 89, 93, 96, 98 (percent 3, 6, 8, 10, 11, 11, 10, 9, 8, 7, 6, 4, 3, 2, 2: peak 4 and 5)
 *   buffer       field clear of the bridge by 0 to 18, tri(10, 10)                                 (peak 9)
 *   margin       field this far from the canvas edge, 0 to 76, tri(39, 39)                         (peak 38)
 *   bars         the share of bars, 0 to 100 percent, tri(51, 51)                                  (peak 50)
 *   bridge max   the largest bridge rectangle, 23 to 187, 23 + tri(83, 83)                         (peak 105: 90 x 7/6)
 *   field max    the largest field rectangle, 70 to 710 in tens, 70 + 10 tri(33, 33)               (peak 390: about 330 x 1.2)
 * Then version 18's packing exactly, with these stages:
 *   bridge   (105, 180), (58, 960), (33, 4800), (19, 14000), (10, 45000), (6, 120000): version 18's sides x 7/6, its
 *            attempts, the first three 20% more for the larger mask; each side scaled by bridge max / 105
 *   field    (432, 60), (252, 220), (144, 750), (72, 2400), (36, 7000), (18, 22000), (10, 40000): version 18's sides x 1.2,
 *            its attempts; each side scaled by field max / 432
 *   a point  i = below(1920 * 1080), (x, y) = (i mod 1920, i div 1920); everything else as version 18
 *   color    a bridge rectangle is footing when its center is below y = 745 (y0 + y1 > 1490), else bridge; a field
 *            rectangle is sky above the horizon (y0 + y1 < 1280), else water.
 * Matched against version 18 under equivalent settings, the bridge's share of its mask that is covered comes out the same
 * (0.53 against 0.53 at detail 6) and the field's within a few points (0.54 against 0.57: the bands are shorter).
 *
 * ── The files ──────────────────────────────────────────────────────────────────────────────────────────────────────
 *   the SVG   the print master, version 18's form on a 1920 x 1080 viewBox, its metadata naming bitgraph-art/19.
 *   the PNG   THE RECORDED FILE: 1920 x 1080 RGB, version 18's chunks (the manifest, the copyright, the settings, the
 *             print SVG, version 15's pure deflate).
 */
import {
  BRIDGE_COPYRIGHT, BRIDGE_KINDS, BRIDGE_PALETTES, BRIDGE_SETTINGS_KEYWORD, BRIDGE_SVG_KEYWORD, bridgeVersion, describeBridge, settingsTextBridge, svgFromPngBridge,
  type BridgePlan, type BridgeSettings, type BridgeSpec,
} from "./commitment-art-bridge.ts";

export const ART_ALGORITHM_V19 = "bitgraph-art/19";
export const V19_WIDTH = 1920, V19_HEIGHT = 1080;
export const V19_COPYRIGHT = BRIDGE_COPYRIGHT;
/** The iTXt keyword of the print SVG: version 16's. */
export const V19_SVG_KEYWORD = BRIDGE_SVG_KEYWORD;
/** The tEXt keyword under which the PNG states the settings drawn. */
export const V19_SETTINGS_KEYWORD = BRIDGE_SETTINGS_KEYWORD;
export const V19_HORIZON = 640;
/** A bridge rectangle centered below this line is footing. */
export const V19_FOOTING_LINE = 745;
/** The deck's top: suspenders hang to it. */
export const V19_DECK_TOP = 605;

/** Version 18's five presets: background, bridge, footing, sky, water. */
export const PALETTES_V19 = BRIDGE_PALETTES;
export const KINDS_V19 = BRIDGE_KINDS;
export { KIND_BRIDGE, KIND_FOOTING, KIND_SKY, KIND_WATER } from "./commitment-art-bridge.ts";

/** (largest side, attempts), in order. */
export const BRIDGE_STAGES_V19: readonly (readonly [number, number])[] = [[105, 180], [58, 960], [33, 4800], [19, 14000], [10, 45000], [6, 120000]];
export const FIELD_STAGES_V19: readonly (readonly [number, number])[] = [[432, 60], [252, 220], [144, 750], [72, 2400], [36, 7000], [18, 22000], [10, 40000]];

export type V19Settings = BridgeSettings;
/** Each setting's range, inclusive. */
export const V19_SETTING_RANGES: Readonly<Record<keyof V19Settings, readonly [number, number]>> = {
  detail: [2, 6], bridgeGap: [1, 5], fieldGapOffset: [0, 14], buffer: [0, 18], margin: [0, 76], bars: [0, 100], bridgeMax: [23, 187], fieldMax: [70, 710],
};
export type V19Plan = BridgePlan;

export const TOWER_CENTERS_V19 = [532, 1388] as const;
export const CABLE_OFFSETS_V19 = [-32, 32] as const;
/** The struts, (top, bottom), between each tower's legs. */
export const STRUTS_V19: readonly (readonly [number, number])[] = [[304, 325], [367, 388], [439, 463], [530, 551]];

/** Every number of the header, in the engine's names. */
export const SPEC_V19: BridgeSpec = {
  algorithm: ART_ALGORITHM_V19,
  W: V19_WIDTH, H: V19_HEIGHT,
  deck: { x0: 80, x1: 1840, top: V19_DECK_TOP, chordBottom: 617, postsBottom: 631, underside: V19_HORIZON, postWidth: 5, postStep: 18 },
  towers: TOWER_CENTERS_V19,
  leg: { outer: 46, inner: 18, top: 290, center: 32 },
  finials: [[6, 278, 290], [2, 269, 278]],
  struts: STRUTS_V19,
  pier: { outer: 48, inner: 16, bottom: V19_FOOTING_LINE },
  footing: { outer: 53, inner: 11, bottom: 773 },
  slab: { half: 75, bottom: 781 },
  cable: { offsets: CABLE_OFFSETS_V19, mainY0: 601, mainA: 307, sideY0: 603, sideA: 309, thick2: 64, band: 12 },
  suspenders: { start: 92, step: 21, clear: 54, minLength: 16, half: 2 },
  horizon: V19_HORIZON,
  footingLine: V19_FOOTING_LINE,
  bridgeStages: BRIDGE_STAGES_V19, bridgeBase: 105,
  fieldStages: FIELD_STAGES_V19, fieldBase: 432,
  draws: {
    detailCuts: [8, 20, 35, 60], gapCuts: [40, 65, 80, 92], offsetCuts: [3, 9, 17, 27, 38, 49, 59, 68, 76, 83, 89, 93, 96, 98],
    buffer: [10, 10], margin: [39, 39], bars: [51, 51], bridgeMax: [23, 83, 83], fieldMax: [70, 10, 33, 33],
  },
  ranges: V19_SETTING_RANGES,
};

const V19 = bridgeVersion(SPEC_V19);

/** The mask's rectangles, named: [x0, y0, x1, y1, part]. */
export const maskRectsV19 = V19.maskRects;
/** One cable's pixels, by the cable rule in the header (1 = cable). */
export const cableMaskV19 = V19.cableMask;
/** The suspenders: x and the top row; each is R(x - 2, top, x + 2, 605). */
export const suspendersV19 = V19.suspenders;
/** The bridge mask, 1920 x 1080, 1 = bridge. Computed once; callers must not write to it. */
export const bridgeMaskV19 = V19.bridgeMask;
/** The plan for a commitment (the last one is kept, frozen). */
export const planV19 = V19.plan;
/** The palette and settings a commitment draws, without packing. */
export const settingsV19 = V19.settingsOf;
/** The settings in words, as the SVG's metadata and the PNG's text state them. */
export const settingsTextV19 = settingsTextBridge;
/** The plan packed afresh, never from the memo. */
export const packV19 = V19.pack;
/** The SVG text, canonical. */
export const svgTextV19 = V19.svgText;
/** The SVG file's bytes (UTF-8). */
export const svgV19 = V19.svg;
/** The canonical RGBA pixels of the plan, 1920 x 1080. */
export const renderV19 = V19.render;
/** The recorded PNG, 1920 x 1080. */
export const pngFileV19 = V19.pngFile;
/** The print SVG a version 19 PNG carries (version 16's iTXt keyword), or null. */
export const svgFromPngV19 = svgFromPngBridge;
/** The commitment a version 19 SVG states in its metadata, or null. Informational: a check redraws instead. */
export const readCommitmentV19 = V19.readCommitment;
/** A short description of a plan: "Fog, detail 6, 9,612 rectangles". */
export const describeV19 = describeBridge;
