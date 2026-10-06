/**
 * bitgraph-art/6 (Mike, 2026-10-06: "build option 2 as version 6"): version 5's layered look, with
 * the code woven INTO the art instead of ticked into the frame.
 *
 * The art square is a hidden grid of 16 x 16 tiles of 60 px; tile k (row-major) carries bit k of the
 * code, most significant bit of byte 0 first. Its reading pixel is (60c + 30, 60r + 30) in the art.
 * Every layer's two colours, ink and under, differ in the parity of their palette index (the base is
 * ink 1 on background 0; a layer's under is ink plus or minus one, mod 4), and in each tile the
 * TOPMOST layer at the reading pixel's centre is given a phase (an offset of its pattern, only inside
 * that tile) that puts the centre on ink or under, whichever has the parity of the bit. The patterns
 * therefore jump a little at tile edges (the weave), and the picture spells the code: decodeV6 reads
 * the 256 reading pixels, finds the palette that holds all their colours, and takes each bit from the
 * parity of its colour's index. The reading pixels are never smoothed, so their colours are exact.
 *
 * Otherwise as version 5 (label "bitgraph-art/5" is NOT reused: this stream is "bitgraph-art/6"):
 * the same shapes and patterns, minus solid fills (a solid colour cannot carry a bit; the quiet area is
 * sparse lines instead), glitch strips placed only between reading rows, scanlines (never on a reading
 * row), 1024 x 1024 with a plain frame, integer arithmetic throughout.
 */
import { sha256 } from "@noble/hashes/sha256";

const LABEL = "bitgraph-art/6";
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

export interface V6Plan {
  palette: number;
  loud: number;
  base: number[];
  layers: Array<{ shape: number[]; fill: number[]; poly: number[] }>;
  glitch: number[][];
  scan: number;
}

const px8 = (n: number) => n * 8;
const TILE = 60, READ = 30;

// Fills: [kind, ink, under, p1, p2, p3, p4] as version 5; kind 7 is the quiet fill, sparse lines.
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
    default: return [7, colour, under, s.pick(512), px8(s.of([26, 30, 36])), px8(2), 0];
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

export function planV6(commitment: Uint8Array): V6Plan {
  const s = new Stream(commitment);
  const palette = s.pick(PALETTES.length);
  const loud = s.pick(10) < 4 ? 1 : 0;
  // ink and under always differ in parity: under = ink + 1 or ink - 1, mod 4
  const two = (): [number, number] => { const c = 1 + s.pick(3); return [c, (c + 1 + 2 * s.pick(2)) & 3]; };
  const base = makeFill(s, s.pick(2) === 0 ? [0] : [1], () => [1, 0]);
  const layers: V6Plan["layers"] = [];
  if (!loud) { const { shape, poly } = makeShape(s, true); layers.push({ shape, fill: makeFill(s, [7], two), poly }); }
  const count = loud ? 8 + s.pick(7) : 4 + s.pick(4);
  const kinds = loud ? [0, 1, 2, 3, 4, 5, 6, 7, 0, 1, 5] : [0, 0, 2, 3, 6, 7, 1];
  for (let i = 0; i < count; i++) {
    const { shape, poly } = makeShape(s);
    layers.push({ shape, fill: makeFill(s, kinds, two), poly });
  }
  // Glitch strips sit wholly between two reading rows (rows 60k + 30), so no reading pixel moves.
  const glitch: number[][] = [];
  if (loud && s.pick(4) < 3) {
    const n = 4 + s.pick(9);
    for (let i = 0; i < n; i++) {
      const gap = s.pick(17); // 0: rows 0..29, k: rows 60k - 29 .. 60k + 29, 16: rows 931..959
      const lo = gap === 0 ? 0 : TILE * gap - 29, hi = gap === 16 ? ART - 1 : TILE * gap + 29;
      const y0 = lo + s.pick(hi - lo), h = 1 + s.pick(Math.min(56, hi - y0));
      glitch.push([y0, h, s.pick(321) - 160]);
    }
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

/** The pattern's scalar at a point, before any phase: the quantity its stripes, rings or wedges repeat in. */
function lineValue(fill: number[], x: number, y: number, S = 1): number {
  const [kind, , , p1, , , p4] = fill as [number, number, number, number, number, number, number];
  let d = -x * SIN[p1]! + y * COS(p1);
  if (kind === 1) {
    const amp = Math.floor(p4 / 8192) * S, wave = (p4 % 8192) * S;
    const t = x * COS(p1) + y * SIN[p1]!;
    d += amp * SIN[imod(idiv(t * 64, wave * 1024), 1024)]!;
  }
  return d;
}

function ink(fill: number[], shape: number[], x: number, y: number, pa: number, pb: number, S = 1): boolean {
  const [kind, , , p1, p2, p3, p4] = fill as [number, number, number, number, number, number, number];
  switch (kind) {
    case 0: case 1: case 7: return imod(lineValue(fill, x, y, S) + pa * 16384, p2 * 16384) < p3 * 16384;
    case 2: case 3: {
      const dx = x - shape[1]!, dy = y - shape[2]!;
      const dist = kind === 2 ? isqrt(dx * dx + dy * dy) : Math.max(Math.abs(dx), Math.abs(dy));
      return imod(dist + pa, p2) < p3;
    }
    case 4: return imod(angleOf(x - shape[1]!, y - shape[2]!) * p1 + pa, 2048) < 1024;
    case 5: {
      const g = p1, xx = x + pa, yy = y + pb;
      const cxc = idiv(xx, g) * g + (g >> 1), cyc = idiv(yy, g) * g + (g >> 1);
      const dist = isqrt((cxc - p2) ** 2 + (cyc - p3) ** 2);
      const phase = (Math.floor(p4 / 16) + idiv(dist * (p4 % 16) * 1024, U * S)) & 1023;
      const rr = idiv(g * 48 * (15 * 16384 + 85 * Math.abs(SIN[phase]!)), 100 * 100 * 16384);
      return (xx - cxc) ** 2 + (yy - cyc) ** 2 <= rr * rr;
    }
    default: return (idiv(x + pa, p1) + idiv(y + pb, p1)) % 2 === 0; // 6 checks
  }
}

/** The phase that puts the point (x, y) on ink (want = true) or under, for this fill. Exact. */
function phaseFor(fill: number[], shape: number[], x: number, y: number, want: boolean): [number, number] {
  const [kind, , , p1, p2, p3] = fill as [number, number, number, number, number, number];
  let pa = 0, pb = 0;
  switch (kind) {
    case 0: case 1: case 7: {
      const P = p2 * 16384, W = p3 * 16384, T = want ? W >> 1 : (W + P) >> 1;
      pa = idiv(imod(T - lineValue(fill, x, y), P), 16384);
      break;
    }
    case 2: case 3: {
      const dx = x - shape[1]!, dy = y - shape[2]!;
      const dist = kind === 2 ? isqrt(dx * dx + dy * dy) : Math.max(Math.abs(dx), Math.abs(dy));
      pa = imod((want ? p3 >> 1 : (p3 + p2) >> 1) - dist, p2);
      break;
    }
    case 4: pa = imod((want ? 512 : 1536) - angleOf(x - shape[1]!, y - shape[2]!) * p1, 2048); break;
    case 5: {
      const g = p1;
      if (want) { pa = imod((g >> 1) - x, g); pb = imod((g >> 1) - y, g); } // on a dot's centre
      else { pa = imod(-x, g); pb = imod(-y, g); } // on a cell corner, between dots
      break;
    }
    default: { // 6 checks: the middle of a cell, then the right colour
      pa = imod((p1 >> 1) - x, p1); pb = imod((p1 >> 1) - y, p1);
      if (ink(fill, shape, x, y, pa, pb) !== want) pa += p1;
    }
  }
  if (ink(fill, shape, x, y, pa, pb) !== want) throw new Error("bitgraph-art/6: no phase puts this reading point on the wanted colour");
  return [pa, pb];
}

const BASE_SHAPE = [0, 0, 0, 0, 0, 0, 0];

/** Which layer is on top at a point (-1: the base). */
function topAt(plan: V6Plan, x: number, y: number): number {
  for (let l = plan.layers.length - 1; l >= 0; l--) if (inShape(plan.layers[l]!.shape, plan.layers[l]!.poly, x, y)) return l;
  return -1;
}

function tilePhases(plan: V6Plan, commitment: Uint8Array): { tLayer: Int16Array; tA: Float64Array; tB: Float64Array } {
  const tLayer = new Int16Array(256), tA = new Float64Array(256), tB = new Float64Array(256);
  for (let k = 0; k < 256; k++) {
    const r = k >> 4, c = k & 15;
    const x0 = 8 * (TILE * c + READ) + 4, y0 = 8 * (TILE * r + READ) + 4;
    const l = topAt(plan, x0, y0);
    const layer = l < 0 ? { fill: plan.base, shape: BASE_SHAPE } : plan.layers[l]!;
    const bit = (commitment[k >> 3]! >> (7 - (k & 7))) & 1;
    const want = (layer.fill[1]! & 1) === bit; // ink when the ink's parity is the bit's, under otherwise
    const [pa, pb] = phaseFor(layer.fill, layer.shape, x0, y0, want);
    tLayer[k] = l; tA[k] = pa; tB[k] = pb;
  }
  return { tLayer, tA, tB };
}

export function renderV6(plan: V6Plan, commitment: Uint8Array): Uint8Array {
  const W = 1024, pal = PALETTES[plan.palette]!;
  // Per tile: the layer that carries its bit, and that layer's phase inside the tile.
  const { tLayer, tA, tB } = tilePhases(plan, commitment);
  const colourAt = (x: number, y: number): number => {
    const k = (idiv(y >> 3, TILE) << 4) + idiv(x >> 3, TILE);
    const l = topAt(plan, x, y);
    const layer = l < 0 ? { fill: plan.base, shape: BASE_SHAPE } : plan.layers[l]!;
    const [pa, pb] = tLayer[k] === l ? [tA[k]!, tB[k]!] : [0, 0];
    return ink(layer.fill, layer.shape, x, y, pa, pb) ? layer.fill[1]! : layer.fill[2]!;
  };
  const px = new Uint8Array(W * W * 4);
  const put = (x: number, y: number, c: RGB) => { const i = (y * W + x) * 4; px[i] = c[0]; px[i + 1] = c[1]; px[i + 2] = c[2]; px[i + 3] = 255; };
  for (let y = 0; y < W; y++) for (let x = 0; x < W; x++) put(x, y, FRAME);
  const shiftOf = (y: number): number => { let dx = 0; for (const [y0, h, d] of plan.glitch) if (y >= y0! && y < y0! + h!) dx = d!; return dx; };
  const id = new Uint8Array(ART * ART);
  for (let y = 0; y < ART; y++) {
    const dx = shiftOf(y);
    for (let x = 0; x < ART; x++) id[y * ART + x] = colourAt(8 * imod(x - dx, ART) + 4, 8 * y + 4);
  }
  for (let y = 0; y < ART; y++) {
    const dx = shiftOf(y);
    const readingRow = y % TILE === READ;
    for (let x = 0; x < ART; x++) {
      const c = id[y * ART + x]!;
      const reading = readingRow && x % TILE === READ;
      const same = (x === 0 || id[y * ART + x - 1] === c) && (x === ART - 1 || id[y * ART + x + 1] === c) && (y === 0 || id[(y - 1) * ART + x] === c) && (y === ART - 1 || id[(y + 1) * ART + x] === c);
      let col: RGB;
      if (same || reading) col = pal[c]!; // reading pixels are never smoothed: their colour is exact
      else {
        const sx = imod(x - dx, ART);
        let r = 0, g = 0, b = 0;
        for (let j = 0; j < 4; j++) for (let i = 0; i < 4; i++) { const p = pal[colourAt(8 * sx + 2 * i + 1, 8 * y + 2 * j + 1)]!; r += p[0]; g += p[1]; b += p[2]; }
        col = [(r + 8) >> 4, (g + 8) >> 4, (b + 8) >> 4];
      }
      if (plan.scan && y % 12 < 2) { const bg = pal[0]!; col = [Math.floor((2 * col[0] + bg[0]) / 3), Math.floor((2 * col[1] + bg[1]) / 3), Math.floor((2 * col[2] + bg[2]) / 3)]; }
      put(OFF + x, OFF + y, col);
    }
  }
  return px;
}

/** Read the code from the art alone: the 256 reading pixels, their palette, and each colour's parity. */
export function decodeV6(px: Uint8Array, width: number, height: number): Uint8Array | null {
  if (width !== 1024 || height !== 1024 || px.length !== width * height * 4) return null;
  const read: RGB[] = [];
  for (let k = 0; k < 256; k++) {
    const x = OFF + TILE * (k & 15) + READ, y = OFF + TILE * (k >> 4) + READ;
    const i = (y * width + x) * 4;
    read.push([px[i]!, px[i + 1]!, px[i + 2]!]);
  }
  const same = (a: RGB, b: RGB) => a[0] === b[0] && a[1] === b[1] && a[2] === b[2];
  for (const pal of PALETTES) {
    const idx = read.map((c) => pal.findIndex((p) => same(p, c)));
    if (idx.some((i) => i < 0)) continue;
    const out = new Uint8Array(32);
    idx.forEach((i, k) => { if (i & 1) out[k >> 3]! |= 1 << (7 - (k & 7)); });
    return out;
  }
  return null;
}

/* ── A larger drawing, for print (Mike, 2026-10-06: "make a download high resolution button") ───
 * The same geometry at S times the resolution: every length in the plan and every tile phase is
 * multiplied by S (an angle is not), a pixel is still 8 units, so lines, rings and the weave are
 * drawn sharper, not enlarged. This is a REDRAWING of the recorded image for print, not the recorded
 * file: the proof covers the 1024 px file; anyone can redraw this one from the same code. The 1024 px
 * path above is untouched (its pixels are pinned by the tests). */
function scaleShape(shape: number[], poly: number[], S: number): { shape: number[]; poly: number[] } {
  const [kind, cx, cy, r, a, b, c] = shape as [number, number, number, number, number, number, number];
  // ring: a is a radius; band: a is an angle, b a half width; half: a is a side; rect: b a half height
  const sa = kind === 1 ? a * S : a;
  const sb = kind === 4 || kind === 5 ? b * S : b;
  return { shape: [kind, cx * S, cy * S, r * S, sa, sb, c], poly: poly.map((v) => v * S) };
}
function scaleFill(fill: number[], S: number): number[] {
  const [kind, ink1, under, p1, p2, p3, p4] = fill as [number, number, number, number, number, number, number];
  switch (kind) {
    case 0: case 1: case 7: return [kind, ink1, under, p1, p2 * S, p3 * S, p4]; // wavy's p4 is scaled where it is read
    case 2: case 3: return [kind, ink1, under, p1, p2 * S, p3 * S, p4];
    case 5: return [kind, ink1, under, p1 * S, p2 * S, p3 * S, p4];
    case 6: return [kind, ink1, under, p1 * S, p2, p3, p4];
    default: return fill.slice();
  }
}

export function renderV6At(plan: V6Plan, commitment: Uint8Array, S: number): Uint8Array {
  const W = 1024 * S, AS = ART * S, TS = TILE * S, pal = PALETTES[plan.palette]!;
  const { tLayer, tA, tB } = tilePhases(plan, commitment);
  const base = scaleFill(plan.base, S);
  const layers = plan.layers.map((l) => ({ ...scaleShape(l.shape, l.poly, S), fill: scaleFill(l.fill, S) }));
  const phase = (fill: number[], a: number, b: number): [number, number] => (fill[0] === 4 ? [a, b] : [a * S, b * S]);
  const colourAt = (x: number, y: number): number => {
    const k = (idiv(y >> 3, TS) << 4) + idiv(x >> 3, TS);
    let l = layers.length - 1;
    for (; l >= 0; l--) if (inShape(layers[l]!.shape, layers[l]!.poly, x, y)) break;
    const layer = l < 0 ? { fill: base, shape: BASE_SHAPE } : layers[l]!;
    const [pa, pb] = tLayer[k] === l ? phase(layer.fill, tA[k]!, tB[k]!) : [0, 0];
    return ink(layer.fill, layer.shape, x, y, pa, pb, S) ? layer.fill[1]! : layer.fill[2]!;
  };
  const px = new Uint8Array(W * W * 4);
  for (let i = 0; i < W * W; i++) { px[4 * i] = FRAME[0]; px[4 * i + 1] = FRAME[1]; px[4 * i + 2] = FRAME[2]; px[4 * i + 3] = 255; }
  const shiftOf = (y: number): number => { const yo = idiv(y, S); let dx = 0; for (const [y0, h, d] of plan.glitch) if (yo >= y0! && yo < y0! + h!) dx = d! * S; return dx; };
  const id = new Uint8Array(AS * AS);
  for (let y = 0; y < AS; y++) {
    const dx = shiftOf(y);
    for (let x = 0; x < AS; x++) id[y * AS + x] = colourAt(8 * imod(x - dx, AS) + 4, 8 * y + 4);
  }
  for (let y = 0; y < AS; y++) {
    const dx = shiftOf(y), scanned = plan.scan && idiv(y, S) % 12 < 2;
    for (let x = 0; x < AS; x++) {
      const c = id[y * AS + x]!;
      const same = (x === 0 || id[y * AS + x - 1] === c) && (x === AS - 1 || id[y * AS + x + 1] === c) && (y === 0 || id[(y - 1) * AS + x] === c) && (y === AS - 1 || id[(y + 1) * AS + x] === c);
      let col: RGB;
      if (same) col = pal[c]!;
      else {
        const sx = imod(x - dx, AS);
        let r = 0, g = 0, b = 0;
        for (let j = 0; j < 4; j++) for (let i = 0; i < 4; i++) { const p = pal[colourAt(8 * sx + 2 * i + 1, 8 * y + 2 * j + 1)]!; r += p[0]; g += p[1]; b += p[2]; }
        col = [(r + 8) >> 4, (g + 8) >> 4, (b + 8) >> 4];
      }
      if (scanned) { const bg = pal[0]!; col = [Math.floor((2 * col[0] + bg[0]) / 3), Math.floor((2 * col[1] + bg[1]) / 3), Math.floor((2 * col[2] + bg[2]) / 3)]; }
      const i = ((OFF * S + y) * W + OFF * S + x) * 4;
      px[i] = col[0]; px[i + 1] = col[1]; px[i + 2] = col[2];
    }
  }
  return px;
}
