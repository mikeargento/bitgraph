/**
 * bitgraph-art/7 (Mike, 2026-10-06: "make the style stay square, but make it less jagged"): version 6's
 * picture with nothing broken at the tile edges.
 *
 * Version 6 carried each bit by shifting the top pattern inside its hidden tile, so lines, rings and
 * dots jumped at every tile edge: the jagged stitching. Version 7 draws the SAME plan as version 6
 * (planV6: the same shapes, patterns, palette, mood, glitch strips and scanlines for the same code),
 * every pattern unbroken, and carries the code in the colour instead: every palette colour has a twin
 * one level away on each channel (up below 128, down from 128), too close to see, and every pixel of a
 * tile whose bit is 1 is drawn in the twins. decodeV7 reads the 256 reading pixels (60c + 30, 60r + 30),
 * never smoothed, finds the palette whose colours and twins hold all of them, and takes each bit from
 * whether its colour is a twin. 1024 x 1024 with the plain frame; integer arithmetic throughout.
 */
import { planV6, PALETTES_V6 as PALETTES, FRAME_V6 as FRAME, TILE_V6 as TILE, READ_V6 as READ, idiv, imod, ink, inShape, topAt, scaleShape, scaleFill, BASE_SHAPE, type V6Plan } from "./commitment-art-v6.ts";

type RGB = readonly [number, number, number];
const ART = 960, OFF = 32;
const twin = (c: RGB): RGB => [c[0] < 128 ? c[0] + 1 : c[0] - 1, c[1] < 128 ? c[1] + 1 : c[1] - 1, c[2] < 128 ? c[2] + 1 : c[2] - 1];
export const TWINS_V7: readonly (readonly RGB[])[] = PALETTES.map((p) => p.map(twin));
export const PALETTES_V7 = PALETTES;

/** The plan is version 6's: the same picture for the same code. */
export const planV7 = planV6;
export type V7Plan = V6Plan;

function draw(plan: V7Plan, commitment: Uint8Array, S: number): Uint8Array {
  const W = 1024 * S, AS = ART * S, TS = TILE * S, pal = PALETTES[plan.palette]!, tw = TWINS_V7[plan.palette]!;
  const base = S === 1 ? plan.base : scaleFill(plan.base, S);
  const layers = S === 1 ? plan.layers : plan.layers.map((l) => ({ ...scaleShape(l.shape, l.poly, S), fill: scaleFill(l.fill, S) }));
  const colourAt = (x: number, y: number): number => {
    let l = layers.length - 1;
    if (S === 1) l = topAt(plan, x, y);
    else for (; l >= 0; l--) if (inShape(layers[l]!.shape, layers[l]!.poly, x, y)) break;
    const layer = l < 0 ? { fill: base, shape: BASE_SHAPE } : layers[l]!;
    return ink(layer.fill, layer.shape, x, y, 0, 0, S) ? layer.fill[1]! : layer.fill[2]!;
  };
  const bitAt = (x: number, y: number): number => { const k = (idiv(y, TS) << 4) + idiv(x, TS); return (commitment[k >> 3]! >> (7 - (k & 7))) & 1; };
  const px = new Uint8Array(W * W * 4);
  for (let i = 0; i < W * W; i++) { px[4 * i] = FRAME[0]; px[4 * i + 1] = FRAME[1]; px[4 * i + 2] = FRAME[2]; px[4 * i + 3] = 255; }
  const shiftOf = (y: number): number => { const yo = idiv(y, S); let dx = 0; for (const [y0, h, d] of plan.glitch) if (yo >= y0! && yo < y0! + h!) dx = d! * S; return dx; };
  const id = new Uint8Array(AS * AS);
  for (let y = 0; y < AS; y++) {
    const dx = shiftOf(y);
    for (let x = 0; x < AS; x++) id[y * AS + x] = colourAt(8 * imod(x - dx, AS) + 4, 8 * y + 4);
  }
  for (let y = 0; y < AS; y++) {
    const dx = shiftOf(y), yo = idiv(y, S);
    const readingRow = S === 1 && y % TILE === READ;
    const scanned = plan.scan && yo % 12 < 2;
    for (let x = 0; x < AS; x++) {
      const c = id[y * AS + x]!, colours = bitAt(x, y) ? tw : pal;
      const reading = readingRow && x % TILE === READ;
      const same = (x === 0 || id[y * AS + x - 1] === c) && (x === AS - 1 || id[y * AS + x + 1] === c) && (y === 0 || id[(y - 1) * AS + x] === c) && (y === AS - 1 || id[(y + 1) * AS + x] === c);
      let col: RGB;
      if (same || reading) col = colours[c]!; // reading pixels are never smoothed: their colour is exact
      else {
        const sx = imod(x - dx, AS);
        let r = 0, g = 0, b = 0;
        for (let j = 0; j < 4; j++) for (let i = 0; i < 4; i++) { const p = colours[colourAt(8 * sx + 2 * i + 1, 8 * y + 2 * j + 1)]!; r += p[0]; g += p[1]; b += p[2]; }
        col = [(r + 8) >> 4, (g + 8) >> 4, (b + 8) >> 4];
      }
      if (scanned) { const bg = colours[0]!; col = [Math.floor((2 * col[0] + bg[0]) / 3), Math.floor((2 * col[1] + bg[1]) / 3), Math.floor((2 * col[2] + bg[2]) / 3)]; }
      const i = ((OFF * S + y) * W + OFF * S + x) * 4;
      px[i] = col[0]; px[i + 1] = col[1]; px[i + 2] = col[2];
    }
  }
  return px;
}

export function renderV7(plan: V7Plan, commitment: Uint8Array): Uint8Array { return draw(plan, commitment, 1); }
/** The same image at S times the resolution, for print: a redrawing, not the recorded file. */
export function renderV7At(plan: V7Plan, commitment: Uint8Array, S: number): Uint8Array { return draw(plan, commitment, S); }

/** Read the code from the art alone: the 256 reading pixels, their palette, and whether each is a twin. */
export function decodeV7(px: Uint8Array, width: number, height: number): Uint8Array | null {
  if (width !== 1024 || height !== 1024 || px.length !== width * height * 4) return null;
  const same = (a: RGB, b: RGB) => a[0] === b[0] && a[1] === b[1] && a[2] === b[2];
  const read: RGB[] = [];
  for (let k = 0; k < 256; k++) {
    const x = OFF + TILE * (k & 15) + READ, y = OFF + TILE * (k >> 4) + READ;
    const i = (y * width + x) * 4;
    read.push([px[i]!, px[i + 1]!, px[i + 2]!]);
  }
  for (let p = 0; p < PALETTES.length; p++) {
    const out = new Uint8Array(32);
    let ok = true;
    for (let k = 0; k < 256 && ok; k++) {
      if (TWINS_V7[p]!.some((c) => same(c, read[k]!))) out[k >> 3]! |= 1 << (7 - (k & 7));
      else if (!PALETTES[p]!.some((c) => same(c, read[k]!))) ok = false;
    }
    if (ok) return out;
  }
  return null;
}
