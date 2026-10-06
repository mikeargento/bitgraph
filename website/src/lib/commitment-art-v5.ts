/**
 * bitgraph-art/5 (Mike, 2026-10-06: "build it as version 5"): layered line fields, rings, bursts,
 * halftone, checks and solids in code-chosen shapes, with a calm or loud mood, glitch slicing and
 * scanlines when loud; and a PLATE MARK: 256 tick marks around the frame, one per bit of the code.
 *
 * Same contract as versions 1 to 4: the commitment is the only input (a SHA-256 stream, label
 * "bitgraph-art/5"), every pixel is integer arithmetic (sine and cosine from SIN below, a fixed
 * table; square roots exact; divisions floored exactly), so every browser draws the same pixels.
 *
 *   canvas   1024 x 1024; the art in the 960 x 960 square at (32, 32); the frame #f4f2ee
 *   units    inside the art, 1/8 px: a pixel's centre is (8x + 4, 8y + 4), its 16 smoothing samples
 *            (8x + 2i + 1, 8y + 2j + 1), i, j in 0..3
 *   painting bottom to top: the base field, then each layer; at a sample, the TOPMOST layer whose
 *            shape holds it decides, with its fill's ink colour or its under colour (solid fills
 *            have no under colour). A pixel whose centre colour equals its four neighbours' is that
 *            colour; any other pixel is the integer mean of its 16 samples (rounded half up).
 *   glitch   (loud only) for a pixel row inside a strip, the LAST strip holding it shifts it:
 *            x' = (x - dx) mod 960, before sampling
 *   scan     (loud only, half the time) rows with y mod 12 < 2 become (2c + bg) / 3, floored
 *   plate    bit k of the code, most significant bit of byte 0 first, is tick k: 64 per side,
 *            top left to right, right top to bottom, bottom right to left, left bottom to top;
 *            each 15 px cell centred on the art's span; a 1 is a 3 x 12 px tick in #1f1f1f, a 0 is
 *            frame. The picture spells the code exactly; decodeV5 reads it from the ticks.
 */
import { sha256 } from "@noble/hashes/sha256";

const LABEL = "bitgraph-art/5";
const SIN: readonly number[] = [0,101,201,302,402,503,603,704,804,904,1005,1105,1205,1306,1406,1506,1606,1706,1806,1906,2006,2105,2205,2305,2404,2503,2603,2702,2801,2900,2999,3098,3196,3295,3393,3492,3590,3688,3786,3883,3981,4078,4176,4273,4370,4467,4563,4660,4756,4852,4948,5044,5139,5235,5330,5425,5520,5614,5708,5803,5897,5990,6084,6177,6270,6363,6455,6547,6639,6731,6823,6914,7005,7096,7186,7276,7366,7456,7545,7635,7723,7812,7900,7988,8076,8163,8250,8337,8423,8509,8595,8680,8765,8850,8935,9019,9102,9186,9269,9352,9434,9516,9598,9679,9760,9841,9921,10001,10080,10159,10238,10316,10394,10471,10549,10625,10702,10778,10853,10928,11003,11077,11151,11224,11297,11370,11442,11514,11585,11656,11727,11797,11866,11935,12004,12072,12140,12207,12274,12340,12406,12472,12537,12601,12665,12729,12792,12854,12916,12978,13039,13100,13160,13219,13279,13337,13395,13453,13510,13567,13623,13678,13733,13788,13842,13896,13949,14001,14053,14104,14155,14206,14256,14305,14354,14402,14449,14497,14543,14589,14635,14680,14724,14768,14811,14854,14896,14937,14978,15019,15059,15098,15137,15175,15213,15250,15286,15322,15357,15392,15426,15460,15493,15525,15557,15588,15619,15649,15679,15707,15736,15763,15791,15817,15843,15868,15893,15917,15941,15964,15986,16008,16029,16049,16069,16088,16107,16125,16143,16160,16176,16192,16207,16221,16235,16248,16261,16273,16284,16295,16305,16315,16324,16332,16340,16347,16353,16359,16364,16369,16373,16376,16379,16381,16383,16384,16384,16384,16383,16381,16379,16376,16373,16369,16364,16359,16353,16347,16340,16332,16324,16315,16305,16295,16284,16273,16261,16248,16235,16221,16207,16192,16176,16160,16143,16125,16107,16088,16069,16049,16029,16008,15986,15964,15941,15917,15893,15868,15843,15817,15791,15763,15736,15707,15679,15649,15619,15588,15557,15525,15493,15460,15426,15392,15357,15322,15286,15250,15213,15175,15137,15098,15059,15019,14978,14937,14896,14854,14811,14768,14724,14680,14635,14589,14543,14497,14449,14402,14354,14305,14256,14206,14155,14104,14053,14001,13949,13896,13842,13788,13733,13678,13623,13567,13510,13453,13395,13337,13279,13219,13160,13100,13039,12978,12916,12854,12792,12729,12665,12601,12537,12472,12406,12340,12274,12207,12140,12072,12004,11935,11866,11797,11727,11656,11585,11514,11442,11370,11297,11224,11151,11077,11003,10928,10853,10778,10702,10625,10549,10471,10394,10316,10238,10159,10080,10001,9921,9841,9760,9679,9598,9516,9434,9352,9269,9186,9102,9019,8935,8850,8765,8680,8595,8509,8423,8337,8250,8163,8076,7988,7900,7812,7723,7635,7545,7456,7366,7276,7186,7096,7005,6914,6823,6731,6639,6547,6455,6363,6270,6177,6084,5990,5897,5803,5708,5614,5520,5425,5330,5235,5139,5044,4948,4852,4756,4660,4563,4467,4370,4273,4176,4078,3981,3883,3786,3688,3590,3492,3393,3295,3196,3098,2999,2900,2801,2702,2603,2503,2404,2305,2205,2105,2006,1906,1806,1706,1606,1506,1406,1306,1205,1105,1005,904,804,704,603,503,402,302,201,101,0,-101,-201,-302,-402,-503,-603,-704,-804,-904,-1005,-1105,-1205,-1306,-1406,-1506,-1606,-1706,-1806,-1906,-2006,-2105,-2205,-2305,-2404,-2503,-2603,-2702,-2801,-2900,-2999,-3098,-3196,-3295,-3393,-3492,-3590,-3688,-3786,-3883,-3981,-4078,-4176,-4273,-4370,-4467,-4563,-4660,-4756,-4852,-4948,-5044,-5139,-5235,-5330,-5425,-5520,-5614,-5708,-5803,-5897,-5990,-6084,-6177,-6270,-6363,-6455,-6547,-6639,-6731,-6823,-6914,-7005,-7096,-7186,-7276,-7366,-7456,-7545,-7635,-7723,-7812,-7900,-7988,-8076,-8163,-8250,-8337,-8423,-8509,-8595,-8680,-8765,-8850,-8935,-9019,-9102,-9186,-9269,-9352,-9434,-9516,-9598,-9679,-9760,-9841,-9921,-10001,-10080,-10159,-10238,-10316,-10394,-10471,-10549,-10625,-10702,-10778,-10853,-10928,-11003,-11077,-11151,-11224,-11297,-11370,-11442,-11514,-11585,-11656,-11727,-11797,-11866,-11935,-12004,-12072,-12140,-12207,-12274,-12340,-12406,-12472,-12537,-12601,-12665,-12729,-12792,-12854,-12916,-12978,-13039,-13100,-13160,-13219,-13279,-13337,-13395,-13453,-13510,-13567,-13623,-13678,-13733,-13788,-13842,-13896,-13949,-14001,-14053,-14104,-14155,-14206,-14256,-14305,-14354,-14402,-14449,-14497,-14543,-14589,-14635,-14680,-14724,-14768,-14811,-14854,-14896,-14937,-14978,-15019,-15059,-15098,-15137,-15175,-15213,-15250,-15286,-15322,-15357,-15392,-15426,-15460,-15493,-15525,-15557,-15588,-15619,-15649,-15679,-15707,-15736,-15763,-15791,-15817,-15843,-15868,-15893,-15917,-15941,-15964,-15986,-16008,-16029,-16049,-16069,-16088,-16107,-16125,-16143,-16160,-16176,-16192,-16207,-16221,-16235,-16248,-16261,-16273,-16284,-16295,-16305,-16315,-16324,-16332,-16340,-16347,-16353,-16359,-16364,-16369,-16373,-16376,-16379,-16381,-16383,-16384,-16384,-16384,-16383,-16381,-16379,-16376,-16373,-16369,-16364,-16359,-16353,-16347,-16340,-16332,-16324,-16315,-16305,-16295,-16284,-16273,-16261,-16248,-16235,-16221,-16207,-16192,-16176,-16160,-16143,-16125,-16107,-16088,-16069,-16049,-16029,-16008,-15986,-15964,-15941,-15917,-15893,-15868,-15843,-15817,-15791,-15763,-15736,-15707,-15679,-15649,-15619,-15588,-15557,-15525,-15493,-15460,-15426,-15392,-15357,-15322,-15286,-15250,-15213,-15175,-15137,-15098,-15059,-15019,-14978,-14937,-14896,-14854,-14811,-14768,-14724,-14680,-14635,-14589,-14543,-14497,-14449,-14402,-14354,-14305,-14256,-14206,-14155,-14104,-14053,-14001,-13949,-13896,-13842,-13788,-13733,-13678,-13623,-13567,-13510,-13453,-13395,-13337,-13279,-13219,-13160,-13100,-13039,-12978,-12916,-12854,-12792,-12729,-12665,-12601,-12537,-12472,-12406,-12340,-12274,-12207,-12140,-12072,-12004,-11935,-11866,-11797,-11727,-11656,-11585,-11514,-11442,-11370,-11297,-11224,-11151,-11077,-11003,-10928,-10853,-10778,-10702,-10625,-10549,-10471,-10394,-10316,-10238,-10159,-10080,-10001,-9921,-9841,-9760,-9679,-9598,-9516,-9434,-9352,-9269,-9186,-9102,-9019,-8935,-8850,-8765,-8680,-8595,-8509,-8423,-8337,-8250,-8163,-8076,-7988,-7900,-7812,-7723,-7635,-7545,-7456,-7366,-7276,-7186,-7096,-7005,-6914,-6823,-6731,-6639,-6547,-6455,-6363,-6270,-6177,-6084,-5990,-5897,-5803,-5708,-5614,-5520,-5425,-5330,-5235,-5139,-5044,-4948,-4852,-4756,-4660,-4563,-4467,-4370,-4273,-4176,-4078,-3981,-3883,-3786,-3688,-3590,-3492,-3393,-3295,-3196,-3098,-2999,-2900,-2801,-2702,-2603,-2503,-2404,-2305,-2205,-2105,-2006,-1906,-1806,-1706,-1606,-1506,-1406,-1306,-1205,-1105,-1005,-904,-804,-704,-603,-503,-402,-302,-201,-101];
const COS = (a: number) => SIN[(a + 256) & 1023]!;
const ART = 960, OFF = 32, U = 8 * ART;
type RGB = readonly [number, number, number];
const hex = (h: string): RGB => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];
/** [background, ink 1, ink 2, ink 3]. Part of version 5; never reorder or edit. */
const PALETTES: readonly (readonly RGB[])[] = [
  ["#12001a", "#ff2bd6", "#ffe3f8", "#7a00ff"],
  ["#0b0b0b", "#f2efe6", "#ff3b1f", "#2b59ff"],
  ["#f3ede1", "#14213d", "#fca311", "#e5383b"],
  ["#041014", "#2ec4b6", "#ff9f1c", "#f7fff7"],
  ["#efe9dc", "#111111", "#ff4f00", "#0047ab"],
  ["#1c0d05", "#ffb26b", "#f6f2c4", "#d7263d"],
  ["#f6f6f2", "#264653", "#e9c46a", "#e76f51"],
  ["#0f1020", "#f4f1de", "#e07a5f", "#81b29a"],
].map((p) => p.map(hex));
const FRAME: RGB = hex("#f4f2ee");
const MARK: RGB = hex("#1f1f1f");

/** Floor division, exact for integers below 2^53. */
function idiv(a: number, b: number): number {
  let q = Math.floor(a / b);
  if (q * b > a) q--; else if ((q + 1) * b <= a) q++;
  return q;
}
const imod = (a: number, b: number) => a - idiv(a, b) * b;
function isqrt(n: number): number {
  let r = Math.floor(Math.sqrt(n));
  while (r * r > n) r--;
  while ((r + 1) * (r + 1) <= n) r++;
  return r;
}
/** The angle of (dx, dy) as a step of 1024 per turn, from the table alone. */
function angleOf(dx: number, dy: number): number {
  if (dx === 0 && dy === 0) return 0;
  let base: number, x: number, y: number;
  if (dx > 0 && dy >= 0) { base = 0; x = dx; y = dy; }
  else if (dx <= 0 && dy > 0) { base = 256; x = dy; y = -dx; }
  else if (dx < 0 && dy <= 0) { base = 512; x = -dx; y = -dy; }
  else { base = 768; x = -dy; y = dx; }
  let lo = 0, hi = 255; // the largest k with direction k at or before (x, y)
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (COS(mid) * y - SIN[mid]! * x >= 0) lo = mid; else hi = mid - 1;
  }
  return base + lo;
}

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

// Shapes: [kind, cx, cy, r, a, b, c]; kinds 0 circle, 1 ring (a = inner radius), 2 half (a = side),
// 3 polygon (a = vertex count, then vertices in V5Plan.polys), 4 band (a = angle, b = half width),
// 5 rect (b = half height). Fills: [kind, colour, under, p1, p2, p3, p4]; kinds 0 hatch (p1 angle,
// p2 spacing, p3 width), 1 wavy (+ p4 = amplitude * 8192 + wavelength), 2 rings and 3 squares
// (p2 spacing, p3 width), 4 burst (p1 wedges), 5 halftone (p1 grid, p2 focus x, p3 focus y, p4 phase *
// 16 + frequency), 6 checks (p1 size), 7 solid.
export interface V5Plan {
  palette: number;
  loud: number;
  base: number[];
  layers: Array<{ shape: number[]; fill: number[]; poly: number[] }>;
  glitch: number[][];
  scan: number;
}

const px8 = (n: number) => n * 8;

function makeFill(s: Stream, kinds: readonly number[], colours: () => [number, number]): number[] {
  const kind = s.of(kinds);
  const [colour, under] = colours();
  switch (kind) {
    case 0: return [0, colour, under, s.pick(512), px8(s.of([7, 9, 11, 14, 18])), px8(s.of([1, 2, 2, 3])), 0];
    case 1: return [1, colour, under, s.pick(512), px8(s.of([9, 11, 14, 18])), px8(s.of([1, 2, 2, 3])), px8(6 + s.pick(25)) * 8192 + px8(150 + s.pick(551))];
    case 2: return [2, colour, under, 0, px8(s.of([10, 14, 20])), px8(2), 0];
    case 3: return [3, colour, under, 0, px8(s.of([10, 14, 20])), px8(2), 0];
    case 4: return [4, colour, under, s.of([32, 64, 128]), 0, 0, 0];
    case 5: return [5, colour, under, px8(s.of([16, 22, 28])), s.pick(U), s.pick(U), s.pick(1024) * 16 + 3 + s.pick(7)];
    case 6: return [6, colour, under, px8(s.of([4, 6, 8, 12])), 0, 0, 0];
    default: return [7, colour, under, 0, 0, 0, 0];
  }
}

function makeShape(s: Stream, big = false): { shape: number[]; poly: number[] } {
  const kind = big ? s.of([0, 5]) : s.of([0, 1, 2, 3, 4, 5, 0, 3]);
  const cx = Math.floor(U / 10) + s.pick(Math.floor((U * 8) / 10)), cy = Math.floor(U / 10) + s.pick(Math.floor((U * 8) / 10));
  const r = big ? Math.floor((U * 35) / 100) + s.pick(Math.floor((U * 15) / 100)) : Math.floor((U * 12) / 100) + s.pick(Math.floor((U * 36) / 100));
  switch (kind) {
    case 1: return { shape: [1, cx, cy, r, idiv(r * (40 + s.pick(36)), 100), 0, 0], poly: [] };
    case 2: return { shape: [2, cx, cy, r, s.pick(4), 0, 0], poly: [] };
    case 3: {
      const n = 3 + s.pick(6), a0 = s.pick(1024), poly: number[] = [];
      for (let i = 0; i < n; i++) {
        const a = (a0 + idiv(i * 1024, n)) & 1023, rv = idiv(r * (55 + s.pick(61)), 100);
        poly.push(cx + idiv(rv * COS(a), 16384), cy + idiv(rv * SIN[a]!, 16384));
      }
      return { shape: [3, cx, cy, r, n, 0, 0], poly };
    }
    case 4: return { shape: [4, cx, cy, r, s.pick(512), Math.floor((U * 4) / 100) + s.pick(Math.floor((U * 12) / 100)), 0], poly: [] };
    case 5: return { shape: [5, cx, cy, r, 0, idiv(r * (30 + s.pick(51)), 100), 0], poly: [] };
    default: return { shape: [0, cx, cy, r, 0, 0, 0], poly: [] };
  }
}

/** The plan: every decision, read from the code's stream, in exactly this order. */
export function planV5(commitment: Uint8Array): V5Plan {
  const s = new Stream(commitment);
  const palette = s.pick(PALETTES.length);
  const loud = s.pick(10) < 4 ? 1 : 0; // about 60% calm, 40% loud
  const two = (): [number, number] => { const c = 1 + s.pick(3); let u = s.pick(4); if (u === c) u = (u + 1) & 3; return [c, u]; };
  const base = makeFill(s, s.pick(2) === 0 ? [0] : [1], () => [1, 0]);
  const layers: V5Plan["layers"] = [];
  if (!loud) { const { shape, poly } = makeShape(s, true); layers.push({ shape, fill: makeFill(s, [7], two), poly }); } // one large quiet area
  const count = loud ? 8 + s.pick(7) : 4 + s.pick(4);
  const kinds = loud ? [0, 1, 2, 3, 4, 5, 6, 7, 0, 1, 5] : [0, 0, 2, 3, 6, 7, 1];
  for (let i = 0; i < count; i++) {
    const { shape, poly } = makeShape(s);
    layers.push({ shape, fill: makeFill(s, kinds, two), poly });
  }
  const glitch: number[][] = [];
  if (loud && s.pick(4) < 3) {
    const n = 4 + s.pick(9);
    for (let i = 0; i < n; i++) glitch.push([s.pick(ART), 4 + s.pick(57), s.pick(321) - 160]);
  }
  const scan = loud && s.pick(2) === 0 ? 1 : 0;
  return { palette, loud, base, layers, glitch, scan };
}

function inShape(shape: number[], poly: number[], x: number, y: number): boolean {
  const [kind, cx, cy, r, a, b] = shape as [number, number, number, number, number, number];
  const dx = x - cx, dy = y - cy;
  switch (kind) {
    case 0: return dx * dx + dy * dy <= r * r;
    case 1: { const d = dx * dx + dy * dy; return d <= r * r && d > a * a; }
    case 2: return dx * dx + dy * dy <= r * r && (a === 0 ? dy <= 0 : a === 1 ? dx >= 0 : a === 2 ? dy >= 0 : dx <= 0);
    case 3: {
      let inside = false;
      const n = poly.length / 2;
      for (let i = 0, j = n - 1; i < n; j = i++) {
        const xi = poly[2 * i]!, yi = poly[2 * i + 1]!, xj = poly[2 * j]!, yj = poly[2 * j + 1]!;
        if ((yi > y) !== (yj > y)) {
          const lhs = (x - xi) * (yj - yi), rhs = (xj - xi) * (y - yi);
          if (yj - yi > 0 ? lhs < rhs : lhs > rhs) inside = !inside;
        }
      }
      return inside;
    }
    case 4: { const d = -dx * SIN[a]! + dy * COS(a); return Math.abs(d) <= b * 16384; }
    default: return Math.abs(dx) <= r && Math.abs(dy) <= b;
  }
}

function ink(fill: number[], shape: number[], x: number, y: number): boolean {
  const [kind, , , p1, p2, p3, p4] = fill as [number, number, number, number, number, number, number];
  switch (kind) {
    case 0: case 1: {
      let d = -x * SIN[p1]! + y * COS(p1);
      if (kind === 1) {
        const amp = Math.floor(p4 / 8192), wave = p4 % 8192;
        const t = x * COS(p1) + y * SIN[p1]!;
        const phase = imod(idiv(t * 64, wave * 1024), 1024);
        d += amp * SIN[phase]!;
      }
      return imod(d, p2 * 16384) < p3 * 16384;
    }
    case 2: case 3: {
      const dx = x - shape[1]!, dy = y - shape[2]!;
      const dist = kind === 2 ? isqrt(dx * dx + dy * dy) : Math.max(Math.abs(dx), Math.abs(dy));
      return imod(dist, p2) < p3;
    }
    case 4: return ((angleOf(x - shape[1]!, y - shape[2]!) * p1) >> 10) % 2 === 0;
    case 5: {
      const g = p1, cxc = idiv(x, g) * g + (g >> 1), cyc = idiv(y, g) * g + (g >> 1);
      const dist = isqrt((cxc - p2) ** 2 + (cyc - p3) ** 2);
      const phase = (Math.floor(p4 / 16) + idiv(dist * (p4 % 16) * 1024, U)) & 1023;
      const rr = idiv(g * 48 * (15 * 16384 + 85 * Math.abs(SIN[phase]!)), 100 * 100 * 16384);
      return (x - cxc) ** 2 + (y - cyc) ** 2 <= rr * rr;
    }
    case 6: return (idiv(x, p1) + idiv(y, p1)) % 2 === 0;
    default: return true;
  }
}

/** The palette index at one sample (units, inside the art square). */
function colourAt(plan: V5Plan, x: number, y: number): number {
  for (let l = plan.layers.length - 1; l >= 0; l--) {
    const layer = plan.layers[l]!;
    if (inShape(layer.shape, layer.poly, x, y)) return layer.fill[0] === 7 || ink(layer.fill, layer.shape, x, y) ? layer.fill[1]! : layer.fill[2]!;
  }
  return ink(plan.base, [0, 0, 0, 0, 0, 0, 0], x, y) ? plan.base[1]! : plan.base[2]!;
}

export function renderV5(plan: V5Plan, commitment: Uint8Array): Uint8Array {
  const W = 1024, pal = PALETTES[plan.palette]!;
  const px = new Uint8Array(W * W * 4);
  const put = (x: number, y: number, c: RGB) => { const i = (y * W + x) * 4; px[i] = c[0]; px[i + 1] = c[1]; px[i + 2] = c[2]; px[i + 3] = 255; };
  for (let y = 0; y < W; y++) for (let x = 0; x < W; x++) put(x, y, FRAME);
  const shiftOf = (y: number): number => { let dx = 0; for (const [y0, h, d] of plan.glitch) if (y >= y0! && y < y0! + h!) dx = d!; return dx; };
  // Pass 1: each pixel's centre colour.
  const id = new Uint8Array(ART * ART);
  for (let y = 0; y < ART; y++) {
    const dx = shiftOf(y);
    for (let x = 0; x < ART; x++) {
      const sx = imod(x - dx, ART);
      id[y * ART + x] = colourAt(plan, 8 * sx + 4, 8 * y + 4);
    }
  }
  // Pass 2: smooth only where a pixel differs from a neighbour.
  for (let y = 0; y < ART; y++) {
    const dx = shiftOf(y);
    for (let x = 0; x < ART; x++) {
      const c = id[y * ART + x]!;
      const same = (x === 0 || id[y * ART + x - 1] === c) && (x === ART - 1 || id[y * ART + x + 1] === c) && (y === 0 || id[(y - 1) * ART + x] === c) && (y === ART - 1 || id[(y + 1) * ART + x] === c);
      let col: RGB;
      if (same) col = pal[c]!;
      else {
        const sx = imod(x - dx, ART);
        let r = 0, g = 0, b = 0;
        for (let j = 0; j < 4; j++) for (let i = 0; i < 4; i++) { const p = pal[colourAt(plan, 8 * sx + 2 * i + 1, 8 * y + 2 * j + 1)]!; r += p[0]; g += p[1]; b += p[2]; }
        col = [(r + 8) >> 4, (g + 8) >> 4, (b + 8) >> 4];
      }
      if (plan.scan && y % 12 < 2) { const bg = pal[0]!; col = [Math.floor((2 * col[0] + bg[0]) / 3), Math.floor((2 * col[1] + bg[1]) / 3), Math.floor((2 * col[2] + bg[2]) / 3)]; }
      put(OFF + x, OFF + y, col);
    }
  }
  // The plate mark.
  for (let k = 0; k < 256; k++) {
    if (((commitment[k >> 3]! >> (7 - (k & 7))) & 1) === 0) continue;
    const [x0, y0, w, h] = tickRect(k);
    for (let y = y0; y < y0 + h; y++) for (let x = x0; x < x0 + w; x++) put(x, y, MARK);
  }
  return px;
}

/** Tick k's rectangle [x, y, w, h]. */
function tickRect(k: number): [number, number, number, number] {
  const side = k >> 6, i = k & 63;
  const along = (j: number) => OFF + 15 * j + 7; // the centre of cell j along a side
  switch (side) {
    case 0: return [along(i) - 1, 10, 3, 12];
    case 1: return [1002, along(i) - 1, 12, 3];
    case 2: return [along(63 - i) - 1, 1002, 3, 12];
    default: return [10, along(63 - i) - 1, 12, 3];
  }
}

/** Read the code from the plate mark alone: the centre pixel of each tick cell, ink or frame. */
export function decodeV5(px: Uint8Array, width: number, height: number): Uint8Array | null {
  if (width !== 1024 || height !== 1024 || px.length !== width * height * 4) return null;
  const out = new Uint8Array(32);
  for (let k = 0; k < 256; k++) {
    const [x0, y0, w, h] = tickRect(k);
    const i = ((y0 + (h >> 1)) * width + x0 + (w >> 1)) * 4;
    const c: RGB = [px[i]!, px[i + 1]!, px[i + 2]!];
    if (c[0] === MARK[0] && c[1] === MARK[1] && c[2] === MARK[2]) out[k >> 3]! |= 1 << (7 - (k & 7));
    else if (!(c[0] === FRAME[0] && c[1] === FRAME[1] && c[2] === FRAME[2])) return null;
  }
  return out;
}
