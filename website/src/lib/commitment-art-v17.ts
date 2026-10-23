// © 2026 Michael Argento. All rights reserved.
/**
 * bitgraph-art/17 (2026-10-10), "Three" at 16:9 (Mike, 2026-10-10: "tweak the model to make 16:9 instead so its wider
 * and takes up less vertical space"), for the home page. Version 16's rules exactly (commitment-art-v16.ts: one flat
 * ground, exactly three axis-aligned squares or rectangles that never touch, the same locked four colours and colour
 * rules, integers only, no stroke, the recorded PNG carrying the canonical print SVG in iTXt, the copyright line), the
 * same code, on a 1920 x 1080 canvas. Version 16 is unchanged: its pieces are recorded and /generate (once /three) keeps making them.
 *
 * ── The stream ─────────────────────────────────────────────────────────────────────────────────────────────────────
 *   block(k) = SHA-256( ASCII "bitgraph-art/17" || 0x00 || ASCII "draw" || 0x00 || C || u32be(k) ), C = 32 bytes
 *   u32()    = the next 4 stream bytes, big-endian;  below(n) = u32() mod n  (integers only)
 *
 * ── The numbers (version 16's, refitted to the wide canvas) ───────────────────────────────────────────────────────
 * Version 16's square stretched to 16:9: a length along x scales by 1920/1800 (16/15), a length along y by 1080/1800
 * (3/5), and a length that must hold on both axes (a square's side, the gap, the near-square margin) by 3/5, the short
 * side's, so a square fills the height as much as it filled version 16's side and no shape is ever taller than the
 * canvas allows. Each object covers about the share of the canvas it did in version 16, so the compositions read alike.
 *   gap         7 + below(84):       7 to 90      (version 16: 12 + below(140))
 *   square      54 + below(456):     54 to 509    (version 16: 90 + below(760))
 *   rectangle   w = 43 + below(1387): 43 to 1429  (version 16: 40 + below(1300))
 *               h = 24 + below(780):  24 to 803   (version 16: 40 + below(1300))
 *               dropped when |w - h| < 24        (version 16: 40)
 *   x = below(1920 - w + 1), y = below(1080 - h + 1); the plan is read in version 16's order, loop for loop.
 */
import {
  COLOURS_V16, V16_COPYRIGHT, V16_SVG_KEYWORD, describeV16, planThree, pngFileThree, readCommitmentThree, renderThree, svgFromPngV16, svgTextThree, touchingV16,
  type ThreeSpec, type V16Object, type V16Plan,
} from "./commitment-art-v16.ts";

export const ART_ALGORITHM_V17 = "bitgraph-art/17";
export const V17_WIDTH = 1920, V17_HEIGHT = 1080;
export const V17_COPYRIGHT = V16_COPYRIGHT;
/** Version 16's four colours, the same objects (locked 2026-10-09). */
export const COLOURS_V17 = COLOURS_V16;
export const V17_SVG_KEYWORD = V16_SVG_KEYWORD;
export type V17Object = V16Object;
export type V17Plan = V16Plan;

export const THREE_SPEC_V17: ThreeSpec = {
  label: ART_ALGORITHM_V17,
  width: V17_WIDTH,
  height: V17_HEIGHT,
  gap: [7, 84],
  square: [54, 456],
  rectW: [43, 1387],
  rectH: [24, 780],
  nearSquare: 24,
};
export const touchingV17 = touchingV16;
export const describeV17 = describeV16;

export function planV17(commitment: Uint8Array): V17Plan {
  return planThree(THREE_SPEC_V17, commitment);
}
/** The SVG text, canonical as version 16's: one element a line, a fixed attribute order, integers only, LF, a final LF. */
export function svgTextV17(plan: V17Plan, commitment: Uint8Array): string {
  return svgTextThree(THREE_SPEC_V17, plan, commitment);
}
/** The SVG file's bytes (UTF-8). */
export function svgV17(commitment: Uint8Array): Uint8Array {
  return new TextEncoder().encode(svgTextV17(planV17(commitment), commitment));
}
/** The canonical RGBA pixels of the plan, 1920 x 1080. */
export function renderV17(plan: V17Plan): Uint8Array {
  return renderThree(THREE_SPEC_V17, plan);
}
/** The recorded PNG: version 16's file, chunk for chunk, 1920 x 1080. */
export function pngFileV17(px: Uint8Array, manifestText: string, svgText: string): Uint8Array {
  return pngFileThree(THREE_SPEC_V17, px, manifestText, svgText);
}
/** The print SVG a version 17 PNG carries (the same iTXt keyword as version 16), or null. */
export const svgFromPngV17 = svgFromPngV16;
/** The commitment a version 17 SVG states in its metadata, or null. Informational: a check redraws instead. */
export function readCommitmentV17(svg: Uint8Array): Uint8Array | null {
  return readCommitmentThree(THREE_SPEC_V17, svg);
}
