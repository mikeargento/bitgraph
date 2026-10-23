/**
 * bitgraph-art/8 (Mike, 2026-10-06: "make there be less lines in photo demo and make the image
 * landscape"): landscape, 1600 x 1024 with the plain 32 px frame (art 1536 x 960), mostly solid shapes.
 *
 * The plan is version 6's language (shapes, fills, palettes, calm or loud, glitch strips, scanlines)
 * drawn from its own stream ("bitgraph-art/8"), with solid fills back (kind 9): the code no longer needs
 * a pattern to ride on, because it is carried in the colour. The art is a hidden grid of 16 x 16 tiles
 * of 96 x 60 px; tile k (row-major) carries bit k of the code, most significant bit of byte 0 first, in
 * ONE pixel, its reading pixel (96c + 48, 60r + 30): drawn in the palette colour's twin (one level away on
 * each channel) when the bit is 1, in the colour itself when it is 0, never smoothed. Not the whole
 * tile, as version 7 does: on version 8's large flat shapes a whole tile one level off showed as a faint
 * grid. decodeV8 reads the 256 reading pixels and takes each bit from whether its colour is a twin.
 * Integer arithmetic throughout.
 */
import { sha256 } from "@noble/hashes/sha256";
import { PALETTES_V6 as PALETTES, FRAME_V6 as FRAME, SIN_V6 as SIN, idiv, imod, inShape, ink, scaleShape, scaleFill, BASE_SHAPE } from "./commitment-art-v6.ts";

type RGB = readonly [number, number, number];
const LABEL = "bitgraph-art/8";
export const V8_WIDTH = 1600, V8_HEIGHT = 1024;
const OFF = 32, AW = 1536, AH = 960, UX = 8 * AW, UY = 8 * AH, TW = 96, TH = 60, RX = 48, RY = 30;
const COS = (a: number) => SIN[(a + 256) & 1023]!;
const twin = (c: RGB): RGB => [c[0] < 128 ? c[0] + 1 : c[0] - 1, c[1] < 128 ? c[1] + 1 : c[1] - 1, c[2] < 128 ? c[2] + 1 : c[2] - 1];
const TWINS: readonly (readonly RGB[])[] = PALETTES.map((p) => p.map(twin));

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
}

export interface V8Plan {
  palette: number;
  loud: number;
  base: number[];
  layers: Array<{ shape: number[]; fill: number[]; poly: number[] }>;
  glitch: number[][];
  scan: number;
}

const px8 = (n: number) => n * 8;

// Fills: [kind, ink, under, p1, p2, p3, p4] in version 6's units; kind 9 is solid. Patterns are wider apart than version 6's.
function makeFill(s: Stream, kinds: readonly number[], colours: () => [number, number]): number[] {
  const kind = s.of(kinds);
  const [colour, under] = colours();
  switch (kind) {
    case 0: return [0, colour, under, s.pick(512), px8(s.of([14, 18, 24])), px8(s.of([3, 4, 6])), 0];
    case 2: return [2, colour, under, 0, px8(s.of([18, 24, 30])), px8(s.of([4, 6])), 0];
    case 4: return [4, colour, under, s.of([16, 32, 64]), 0, 0, 0];
    case 5: return [5, colour, under, px8(s.of([22, 28, 36])), s.pick(UX), s.pick(UY), s.pick(1024) * 16 + 2 + s.pick(5)];
    case 6: return [6, colour, under, px8(s.of([16, 24, 32])), 0, 0, 0];
    default: return [9, colour, colour, 0, 0, 0, 0];
  }
}

function makeShape(s: Stream, big: boolean): { shape: number[]; poly: number[] } {
  const kind = big ? s.of([0, 5, 2]) : s.of([0, 1, 2, 3, 4, 5, 0, 5]);
  const cx = Math.floor(UX / 10) + s.pick(Math.floor((UX * 8) / 10)), cy = Math.floor(UY / 10) + s.pick(Math.floor((UY * 8) / 10));
  const r = big ? Math.floor((UY * 40) / 100) + s.pick(Math.floor((UY * 20) / 100)) : Math.floor((UY * 14) / 100) + s.pick(Math.floor((UY * 30) / 100));
  switch (kind) {
    case 1: return { shape: [1, cx, cy, r, idiv(r * (40 + s.pick(36)), 100), 0, 0], poly: [] };
    case 2: return { shape: [2, cx, cy, r, s.pick(4), 0, 0], poly: [] };
    case 3: {
      const n = 3 + s.pick(4), a0 = s.pick(1024), poly: number[] = [];
      for (let i = 0; i < n; i++) {
        const a = (a0 + idiv(i * 1024, n)) & 1023, rv = idiv(r * (60 + s.pick(51)), 100);
        poly.push(cx + idiv(rv * COS(a), 16384), cy + idiv(rv * SIN[a]!, 16384));
      }
      return { shape: [3, cx, cy, r, n, 0, 0], poly };
    }
    case 4: return { shape: [4, cx, cy, r, s.pick(512), Math.floor((UY * 5) / 100) + s.pick(Math.floor((UY * 10) / 100)), 0], poly: [] };
    case 5: return { shape: [5, cx, cy, idiv(r * (100 + s.pick(80)), 100), 0, idiv(r * (35 + s.pick(46)), 100), 0], poly: [] };
    default: return { shape: [0, cx, cy, r, 0, 0, 0], poly: [] };
  }
}

export function planV8(commitment: Uint8Array): V8Plan {
  const s = new Stream(commitment);
  const palette = s.pick(PALETTES.length);
  const loud = s.pick(10) < 3 ? 1 : 0;
  const two = (): [number, number] => { const c = 1 + s.pick(3); return [c, (c + 1 + s.pick(3)) & 3]; };
  // The ground: plain three times in four, otherwise wide quiet lines.
  const base = s.pick(4) < 3 ? [9, 0, 0, 0, 0, 0, 0] : [0, 1, 0, s.pick(512), px8(s.of([28, 36, 44])), px8(2), 0];
  const layers: V8Plan["layers"] = [];
  { const { shape, poly } = makeShape(s, true); layers.push({ shape, fill: makeFill(s, [9, 9, 9, 2, 5], two), poly }); }
  const count = loud ? 5 + s.pick(4) : 2 + s.pick(3);
  // Mostly solids; one kind of pattern in four at most when calm.
  const kinds = loud ? [9, 9, 9, 0, 2, 4, 5, 6] : [9, 9, 9, 9, 9, 0, 2, 5];
  let last = layers[0]!.fill[1]!;
  for (let i = 0; i < count; i++) {
    const { shape, poly } = makeShape(s, false);
    let fill = makeFill(s, kinds, two);
    if (fill[1] === last) fill = [fill[0]!, 1 + (fill[1]! % 3), ...fill.slice(2)]; // never the colour of the shape just under it
    layers.push({ shape, fill, poly });
    last = fill[1]!;
  }
  // Glitch strips sit wholly between two reading rows (rows 60k + 30), so no reading pixel moves.
  const glitch: number[][] = [];
  if (loud && s.pick(2) === 0) {
    const n = 2 + s.pick(5);
    for (let i = 0; i < n; i++) {
      const gap = s.pick(17);
      const lo = gap === 0 ? 0 : TH * gap - 29, hi = gap === 16 ? AH - 1 : TH * gap + 29;
      const y0 = lo + s.pick(hi - lo), h = 1 + s.pick(Math.min(40, hi - y0));
      glitch.push([y0, h, s.pick(241) - 120]);
    }
  }
  const scan = loud && s.pick(3) === 0 ? 1 : 0;
  return { palette, loud, base, layers, glitch, scan };
}

function draw(plan: V8Plan, commitment: Uint8Array, S: number): Uint8Array {
  const W = V8_WIDTH * S, H = V8_HEIGHT * S, AWs = AW * S, AHs = AH * S, pal = PALETTES[plan.palette]!, tw = TWINS[plan.palette]!;
  const base = S === 1 ? plan.base : scaleFill(plan.base, S);
  const layers = S === 1 ? plan.layers : plan.layers.map((l) => ({ ...scaleShape(l.shape, l.poly, S), fill: scaleFill(l.fill, S) }));
  const colourAt = (x: number, y: number): number => {
    let l = layers.length - 1;
    for (; l >= 0; l--) if (inShape(layers[l]!.shape, layers[l]!.poly, x, y)) break;
    const layer = l < 0 ? { fill: base, shape: BASE_SHAPE } : layers[l]!;
    const f = layer.fill;
    return f[0] === 9 || ink(f, layer.shape, x, y, 0, 0, S) ? f[1]! : f[2]!;
  };
  const bitAt = (x: number, y: number): number => { const k = (idiv(y, TH * S) << 4) + idiv(x, TW * S); return (commitment[k >> 3]! >> (7 - (k & 7))) & 1; };
  const px = new Uint8Array(W * H * 4);
  for (let i = 0; i < W * H; i++) { px[4 * i] = FRAME[0]; px[4 * i + 1] = FRAME[1]; px[4 * i + 2] = FRAME[2]; px[4 * i + 3] = 255; }
  const shiftOf = (y: number): number => { const yo = idiv(y, S); let dx = 0; for (const [y0, h, d] of plan.glitch) if (yo >= y0! && yo < y0! + h!) dx = d! * S; return dx; };
  const id = new Uint8Array(AWs * AHs);
  for (let y = 0; y < AHs; y++) {
    const dx = shiftOf(y);
    for (let x = 0; x < AWs; x++) id[y * AWs + x] = colourAt(8 * imod(x - dx, AWs) + 4, 8 * y + 4);
  }
  for (let y = 0; y < AHs; y++) {
    const dx = shiftOf(y), yo = idiv(y, S);
    const readingRow = S === 1 && y % TH === RY;
    const scanned = plan.scan && yo % 12 < 2;
    for (let x = 0; x < AWs; x++) {
      const reading = readingRow && x % TW === RX;
      const c = id[y * AWs + x]!, colours = reading && bitAt(x, y) ? tw : pal;
      const same = (x === 0 || id[y * AWs + x - 1] === c) && (x === AWs - 1 || id[y * AWs + x + 1] === c) && (y === 0 || id[(y - 1) * AWs + x] === c) && (y === AHs - 1 || id[(y + 1) * AWs + x] === c);
      let col: RGB;
      if (same || reading) col = colours[c]!; // reading pixels are never smoothed: their colour is exact
      else {
        const sx = imod(x - dx, AWs);
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

export function renderV8(plan: V8Plan, commitment: Uint8Array): Uint8Array { return draw(plan, commitment, 1); }
/** The same image at S times the resolution, for print: a redrawing, not the recorded file. */
export function renderV8At(plan: V8Plan, commitment: Uint8Array, S: number): Uint8Array { return draw(plan, commitment, S); }

/** Read the code from the art alone: the 256 reading pixels, their palette, and whether each is a twin. */
export function decodeV8(px: Uint8Array, width: number, height: number): Uint8Array | null {
  if (width !== V8_WIDTH || height !== V8_HEIGHT || px.length !== width * height * 4) return null;
  const same = (a: RGB, b: RGB) => a[0] === b[0] && a[1] === b[1] && a[2] === b[2];
  const read: RGB[] = [];
  for (let k = 0; k < 256; k++) {
    const x = OFF + TW * (k & 15) + RX, y = OFF + TH * (k >> 4) + RY;
    const i = (y * width + x) * 4;
    read.push([px[i]!, px[i + 1]!, px[i + 2]!]);
  }
  for (let p = 0; p < PALETTES.length; p++) {
    const out = new Uint8Array(32);
    let ok = true;
    for (let k = 0; k < 256 && ok; k++) {
      if (TWINS[p]!.some((c) => same(c, read[k]!))) out[k >> 3]! |= 1 << (7 - (k & 7));
      else if (!PALETTES[p]!.some((c) => same(c, read[k]!))) ok = false;
    }
    if (ok) return out;
  }
  return null;
}
