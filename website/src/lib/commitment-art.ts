/**
 * bitgraph-art/1 and /2: an image whose every pixel is a function of one position commitment
 * (Mike, 2026-10-05: "an image that could not have existed before" its position opened).
 *
 * The commitment is the ONLY creative input. Algorithm, dimensions, palettes and drawing
 * rules are fixed here and versioned; a change to any of them is a new version, never an edit
 * of an old one, and every version stays here so every image ever made still redraws.
 *   bitgraph-art/1 (2026-10-05, BitGraph #2,285): one sample per pixel, hard edges.
 *   bitgraph-art/2 (2026-10-06, Mike: "can you add some kind of antialiasing"): the same rules,
 *     its own stream label, 4 x 4 supersampling inside the art square (below), and a fixed
 *     deflate (encodeArtPng), so the whole recorded FILE, not only its pixels, is a function of
 *     the commitment and the proof page can redraw it byte for byte. No clock, no Math.random, no viewport, no user input,
 * no truncated seed: every value is read from a SHA-256 stream over the full 32 bytes.
 *
 * Deterministic generation is kept apart from presentation: this module produces a
 * canonical recipe and a canonical RGBA buffer with integer-only rasterization (no
 * antialiasing, no floating point in any inside test), and its own PNG encoder and decoder,
 * so the pixels are the same in every browser and in node. Browsers are never trusted to
 * rasterize or to decode: two browsers can write different PNG bytes for the same pixels,
 * so the canonical pixels are checked separately from the exact recorded file.
 *
 * ── The stream ────────────────────────────────────────────────────────────────────────
 *   block(k) = SHA-256( ASCII V || 0x00 || ASCII "draw" || 0x00 || C || u32be(k) )
 *              (V = the version string, "bitgraph-art/1" or "bitgraph-art/2")
 *   stream   = block(0) || block(1) || block(2) || ...      (C = the 32-byte commitment)
 *   u32()    = the next 4 stream bytes, big-endian
 *   pick(n)  = floor( u32() * n / 2^32 )                      (n <= 2^20, exact in a double)
 * Values are drawn in exactly the order the code below draws them.
 *
 * ── The picture (W = 1024, H = 1056, RGB, alpha always 255) ───────────────────────────
 *   ground   every pixel starts as the palette's ground colour
 *   art      a 960 x 960 square at (32, 32), split into G x G cells, G = GRIDS[pick(4)]
 *            palette = PALETTES[pick(PALETTES.length)]
 *            per cell, in row-major order: shape = pick(8), turn = pick(4),
 *            fg = pick(4) + 1, bg = pick(4) + 1, and when bg == fg, bg = 1 + (fg mod 4)
 *   strip    rows 1032..1047: 256 cells, 4 px wide, one per bit of C, most significant bit
 *            of C[0] first; a 1 is INK, a 0 is PAPER. Rows 1024..1031 and 1048..1055 are ground.
 *
 * ── Inside tests, in doubled integer cell coordinates ────────────────────────────────
 * A cell of side S has D = 2S; the pixel at local (lx, ly) samples its centre
 * (u, v) = (2lx + 1, 2ly + 1). A turn t rotates the shape a quarter turn clockwise t times:
 * (u, v) -> (v, D - u) applied t times maps the pixel into the shape's own frame.
 *   0 block      the whole cell
 *   1 disc       (u - S)^2 + (v - S)^2 <= S^2
 *   2 quarter    u^2 + v^2 <= D^2                       (centre at the frame's top-left)
 *   3 half       (u - S)^2 + v^2 <= S^2                  (centre on the top edge)
 *   4 triangle   u + v <= D
 *   5 ring       S^2/4 < (u - S)^2 + (v - S)^2 <= S^2
 *   6 bars       floor(4u / D) is even
 *   7 dot        (u - S)^2 + (v - S)^2 <= S^2 / 4
 * Version 1: a pixel inside the shape takes fg, otherwise bg.
 * Version 2: each pixel takes 16 samples, at (8lx + 2i + 1, 8ly + 2j + 1) for i, j in 0..3, in
 * units where the cell is 8S wide (the same tests with S replaced by 4S); with c samples inside,
 * each channel is (fg * c + bg * (16 - c) + 8) >> 4, integers only. The strip is not smoothed.
 *
 * ── Digests ───────────────────────────────────────────────────────────────────────────
 *   recipe digest = SHA-256 of the recipe's JSON exactly as recipeJson() writes it
 *   pixel digest  = SHA-256 of the RGBA buffer, row-major from the top-left, 4 bytes per pixel
 */
import { sha256 } from "@noble/hashes/sha256";
import { planV5, renderV5, decodeV5, type V5Plan } from "./commitment-art-v5.ts";
import { planV6, renderV6, decodeV6, type V6Plan } from "./commitment-art-v6.ts";
import { planV7, renderV7, decodeV7 } from "./commitment-art-v7.ts";
import { planV8, renderV8, decodeV8, V8_WIDTH, V8_HEIGHT, type V8Plan } from "./commitment-art-v8.ts";
import { planV9, renderV9, decodeV9, V9_WIDTH, V9_HEIGHT, type V9Plan } from "./commitment-art-v9.ts";

export const ART_ALGORITHM_V1 = "bitgraph-art/1";
export const ART_ALGORITHM_V2 = "bitgraph-art/2";
/** What a new image is drawn with: version 3 from 2026-10-06 (Mike: "lose barcode use version 3"),
 *  version 4 (the Truchet maze) the same night (Mike: "build the truchet maze as version 4"). */
export const ART_ALGORITHM = "bitgraph-art/9"; // version 9 from 2026-10-07 (Mike: "i want them all mixed together"): five families in one picture; version 8 before it
/** Built 2026-10-06 for a side-by-side look (Mike: "build it and show me side by side"): the art spells the commitment. */
export const ART_ALGORITHM_V3 = "bitgraph-art/3";
/** Built 2026-10-06 (Mike: "build the truchet maze as version 4"): every tile is one bit. */
export const ART_ALGORITHM_V4 = "bitgraph-art/4";
/** Built 2026-10-06 (Mike: "build it as version 5"): layered fields with a plate mark; see commitment-art-v5.ts. */
export const ART_ALGORITHM_V5 = "bitgraph-art/5";
/** Built 2026-10-06 (Mike: "build option 2 as version 6"): version 5's look with the code woven into the art. */
export const ART_ALGORITHM_V6 = "bitgraph-art/6";
/** Version 6's picture with nothing broken at the tile edges: the code in colour twins (commitment-art-v7.ts). */
export const ART_ALGORITHM_V7 = "bitgraph-art/7";
/** Landscape (1600 x 1024), mostly solid shapes, the code in 256 reading pixels (commitment-art-v8.ts). */
export const ART_ALGORITHM_V8 = "bitgraph-art/8";
/** Landscape, five families layered in one picture (strata, interference, cut paper, blocks, ribbons), one dominant; the code as version 8 (commitment-art-v9.ts). */
export const ART_ALGORITHM_V9 = "bitgraph-art/9";
export const ART_ALGORITHMS: readonly string[] = [ART_ALGORITHM_V1, ART_ALGORITHM_V2, ART_ALGORITHM_V3, ART_ALGORITHM_V4, ART_ALGORITHM_V5, ART_ALGORITHM_V6, ART_ALGORITHM_V7, ART_ALGORITHM_V8, ART_ALGORITHM_V9];
/** Each version's canvas: 1 and 2 carry a strip under the art; 3 is the art square and its frame. */
export function artSize(algorithm: string): { width: number; height: number } {
  if (algorithm === ART_ALGORITHM_V8) return { width: V8_WIDTH, height: V8_HEIGHT };
  if (algorithm === ART_ALGORITHM_V9) return { width: V9_WIDTH, height: V9_HEIGHT };
  return algorithm === ART_ALGORITHM_V3 || algorithm === ART_ALGORITHM_V4 || algorithm === ART_ALGORITHM_V5 || algorithm === ART_ALGORITHM_V6 || algorithm === ART_ALGORITHM_V7 ? { width: 1024, height: 1024 } : { width: 1024, height: 1056 };
}
export const ART_WIDTH = 1024;
export const ART_HEIGHT = 1056;
const ART_X = 32, ART_Y = 32, ART_SIDE = 960;
const GRIDS = [3, 4, 5, 6] as const;
const STRIP_Y = 1032, STRIP_ROWS = 16, STRIP_CELL = 4;
/** The PNG text chunk keyword that carries the generation manifest. */
export const ART_MANIFEST_KEYWORD = "bitgraph-art";

type RGB = readonly [number, number, number];
const hex = (h: string): RGB => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];

/** [ground, four art colours]. Part of version 1; never reorder or edit. */
const PALETTES: readonly (readonly RGB[])[] = [
  ["#f8f9fa", "#1a73e8", "#d93025", "#f9ab00", "#202124"],
  ["#f8f9fa", "#1e8e3e", "#f9ab00", "#1a73e8", "#202124"],
  ["#fbf7ef", "#e2583e", "#2d4a8a", "#efc94c", "#1b1b1b"],
  ["#f4f1ea", "#0b7a75", "#e7a33e", "#c8553d", "#2f2f2f"],
  ["#eef1f5", "#3d5a80", "#98c1d9", "#ee6c4d", "#293241"],
  ["#f7f3f0", "#8e3b46", "#e0b84a", "#4c6085", "#1f1f1f"],
  ["#f6f6f2", "#264653", "#2a9d8f", "#e9c46a", "#e76f51"],
  ["#f9f7f3", "#5f0f40", "#9a031e", "#fb8b24", "#0f4c5c"],
].map((p) => p.map(hex));
/**
 * Version 3's palettes: version 1's, with palette 1's ground and dark colour changed so that every
 * palette's ground is unique and every palette's dark colour (index 4) is unique and darker than any
 * ground. The frame alone then names the palette and the frame bit.
 */
const PALETTES_V3: readonly (readonly RGB[])[] = PALETTES.map((p, i) => (i === 1 ? [hex("#f1f7f3"), p[1]!, p[2]!, p[3]!, hex("#17301f")] : p));
const INK: RGB = hex("#202124");
const PAPER: RGB = hex("#f8f9fa");

export interface ArtCell { shape: number; turn: number; fg: number; bg: number }
export interface ArtRecipe {
  algorithm: string;
  width: number;
  height: number;
  /** The commitment, unpadded base64url (43 characters). */
  commitment: string;
  palette: number;
  grid: number;
  /** Version 3 only: 0 = the frame is the palette's ground, 1 = its dark colour. */
  frame?: number;
  /** Version 5 only: the layered plan (commitment-art-v5.ts). */
  v5?: V5Plan;
  /** Version 6 only: the layered plan with the woven code (commitment-art-v6.ts). */
  v6?: V6Plan;
  /** Version 7 only: version 6's plan, drawn without the weave. */
  v7?: V6Plan;
  /** Version 8 only: the landscape plan (commitment-art-v8.ts). */
  v8?: V8Plan;
  /** Version 9 only: the five-family plan (commitment-art-v9.ts). */
  v9?: V9Plan;
  cells: ArtCell[];
}

export interface ArtManifest {
  algorithm: string;
  width: number;
  height: number;
  commitment: string;
  recipeSha256: string;
  pixelsSha256: string;
}

const te = new TextEncoder();

export function toBase64Url(b: Uint8Array): string {
  let s = "";
  for (const x of b) s += String.fromCharCode(x);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
export function fromBase64Url(s: string): Uint8Array | null {
  if (!/^[A-Za-z0-9_-]*$/.test(s)) return null;
  try {
    const bin = atob(s.replace(/-/g, "+").replace(/_/g, "/") + "=".repeat((4 - (s.length % 4)) % 4));
    return Uint8Array.from(bin, (c) => c.charCodeAt(0));
  } catch {
    return null;
  }
}
export const toHex = (b: Uint8Array): string => Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("");

function requireCommitment(c: Uint8Array): void {
  if (!(c instanceof Uint8Array) || c.length !== 32) throw new TypeError("a bitgraph-art commitment is exactly 32 bytes");
}

/** The stream of the header comment: block(k) concatenated, read 4 bytes at a time. */
class Stream {
  private buf: Uint8Array = new Uint8Array(0);
  private at = 0;
  private k = 0;
  private readonly prefix: Uint8Array;
  constructor(commitment: Uint8Array, algorithm: string) {
    const label = te.encode(algorithm), purpose = te.encode("draw");
    this.prefix = new Uint8Array(label.length + 1 + purpose.length + 1 + 32);
    this.prefix.set(label, 0);
    this.prefix.set(purpose, label.length + 1);
    this.prefix.set(commitment, label.length + 1 + purpose.length + 1);
  }
  private refill(): void {
    const input = new Uint8Array(this.prefix.length + 4);
    input.set(this.prefix, 0);
    const k = this.k++;
    input.set([(k >>> 24) & 0xff, (k >>> 16) & 0xff, (k >>> 8) & 0xff, k & 0xff], this.prefix.length);
    this.buf = sha256(input);
    this.at = 0;
  }
  u32(): number {
    if (this.at + 4 > this.buf.length) this.refill();
    const b = this.buf, i = this.at;
    this.at += 4;
    return ((b[i]! << 24) | (b[i + 1]! << 16) | (b[i + 2]! << 8) | b[i + 3]!) >>> 0;
  }
  pick(n: number): number {
    return Math.floor((this.u32() * n) / 4294967296);
  }
}

/** The canonical recipe: every drawing decision, read from the commitment's stream. */
export function artRecipe(commitment: Uint8Array, algorithm: string = ART_ALGORITHM): ArtRecipe {
  requireCommitment(commitment);
  if (!ART_ALGORITHMS.includes(algorithm)) throw new TypeError(`unknown art algorithm ${algorithm}`);
  if (algorithm === ART_ALGORITHM_V3) return recipeV3(commitment);
  if (algorithm === ART_ALGORITHM_V4) return recipeV4(commitment);
  if (algorithm === ART_ALGORITHM_V9) {
    const v9 = planV9(commitment);
    return { algorithm, width: V9_WIDTH, height: V9_HEIGHT, commitment: toBase64Url(commitment), palette: v9.palette, grid: 16, cells: [], v9 };
  }
  if (algorithm === ART_ALGORITHM_V8) {
    const v8 = planV8(commitment);
    return { algorithm, width: V8_WIDTH, height: V8_HEIGHT, commitment: toBase64Url(commitment), palette: v8.palette, grid: 16, cells: [], v8 };
  }
  if (algorithm === ART_ALGORITHM_V7) {
    const v7 = planV7(commitment);
    return { algorithm, width: 1024, height: 1024, commitment: toBase64Url(commitment), palette: v7.palette, grid: 16, cells: [], v7 };
  }
  if (algorithm === "bitgraph-art/6") {
    const v6 = planV6(commitment);
    return { algorithm, width: 1024, height: 1024, commitment: toBase64Url(commitment), palette: v6.palette, grid: 16, cells: [], v6 };
  }
  if (algorithm === "bitgraph-art/5") {
    const v5 = planV5(commitment);
    return { algorithm, width: 1024, height: 1024, commitment: toBase64Url(commitment), palette: v5.palette, grid: 16, cells: [], v5 };
  }
  const s = new Stream(commitment, algorithm);
  const grid = GRIDS[s.pick(GRIDS.length)]!;
  const palette = s.pick(PALETTES.length);
  const cells: ArtCell[] = [];
  for (let i = 0; i < grid * grid; i++) {
    const shape = s.pick(8), turn = s.pick(4), fg = s.pick(4) + 1;
    let bg = s.pick(4) + 1;
    if (bg === fg) bg = 1 + (fg % 4);
    cells.push({ shape, turn, fg, bg });
  }
  return { algorithm, width: ART_WIDTH, height: ART_HEIGHT, commitment: toBase64Url(commitment), palette, grid, cells };
}

/* ── Version 3: the art spells the commitment ─────────────────────────────────────────
 * No stream: the commitment is already a SHA-256 output, so its bits are used directly, and
 * every bit lands in the picture. Read most significant bit of byte 0 first:
 *   bits 0..251    36 cells, row-major in a 6 x 6 grid, 7 bits each:
 *                  3 bits SHAPE: split, disc, quarter, half, triangle, ring, bars, dot
 *                  4 bits LOOK:  for split, quarter, half, triangle, bars (shapes with a direction):
 *                                turn = LOOK >> 2, fg = 1 + (LOOK & 3), bg = 1 + ((LOOK + 1) & 3);
 *                                for disc, ring, dot (no direction): (fg, bg) = PAIRS[LOOK], the 16
 *                                ordered pairs of palette colours with fg in 1..4 and bg != fg
 *   bits 252..254  the palette (PALETTES_V3)
 *   bit  255       the frame: 0 = the palette's ground, 1 = its dark colour (index 4)
 * Within a palette the 128 cell looks are pixel-distinct, and the frame names the palette and
 * the frame bit, so the picture is a one-to-one spelling of the commitment: two commitments can
 * never draw the same image, and decodeArtV3 reads the commitment back from the pixels alone.
 * 1024 x 1024, the art square at (32, 32), smoothed as version 2, written with the fixed deflate.
 */
const V3_SHAPES = [8, 1, 2, 3, 4, 5, 6, 7]; // split, disc, quarter, half, triangle, ring, bars, dot (inside() ids)
const V3_ROUND = new Set([1, 5, 7]);
const V3_PAIRS: ReadonlyArray<readonly [number, number]> = (() => {
  const out: Array<[number, number]> = [];
  for (let a = 1; a <= 4; a++) for (let b = 0; b <= 4; b++) if (b !== a) out.push([a, b]);
  return out; // 16
})();
const bitAt = (c: Uint8Array, i: number) => (c[i >> 3]! >> (7 - (i & 7))) & 1;
function v3Cell(code: number): ArtCell {
  const shape = V3_SHAPES[code >> 4]!, look = code & 15;
  if (V3_ROUND.has(shape)) { const [fg, bg] = V3_PAIRS[look]!; return { shape, turn: 0, fg, bg }; }
  return { shape, turn: look >> 2, fg: 1 + (look & 3), bg: 1 + ((look + 1) & 3) };
}
function recipeV3(commitment: Uint8Array): ArtRecipe {
  const cells: ArtCell[] = [];
  for (let k = 0; k < 36; k++) {
    let code = 0;
    for (let b = 0; b < 7; b++) code = (code << 1) | bitAt(commitment, 7 * k + b);
    cells.push(v3Cell(code));
  }
  const palette = (bitAt(commitment, 252) << 2) | (bitAt(commitment, 253) << 1) | bitAt(commitment, 254);
  const { width, height } = artSize(ART_ALGORITHM_V3);
  return { algorithm: ART_ALGORITHM_V3, width, height, commitment: toBase64Url(commitment), palette, grid: 6, frame: bitAt(commitment, 255), cells };
}

/* ── Version 4: the Truchet maze ─────────────────────────────────────────────────────────
 * A 16 x 16 grid of 60 px tiles, row-major; tile k is bit k of the commitment, most significant
 * bit of byte 0 first. Bit 0: quarter discs of radius 30 px at the tile's top-left and bottom-right
 * corners; bit 1: at the top-right and bottom-left (the same tile turned a quarter). The arcs meet
 * across tiles, so the 256 bits draw one continuous pattern.
 * Colours: the stream (as version 2, label "bitgraph-art/4") picks the palette, pick(8), then one
 * pair (A, B) from that palette's high-contrast pairs, pick(n), A always the lower index. With
 * par = (row + col + bit) mod 2, the discs take A when par is 0 and B when it is 1, the band between
 * them the other. The frame is the palette's ground (PALETTES_V3, so the frame names the palette).
 * One-to-one: the centre of every tile is always band (it lies 42 px from every corner), so its colour
 * and the fixed order of (A, B) give the tile's bit; the picture spells the commitment and decodeArtV4
 * reads it back from the pixels alone. Smoothed and written as version 3, 1024 x 1024.
 */
const V4_PAIRS: ReadonlyArray<ReadonlyArray<readonly [number, number]>> = [
  [[1, 3], [1, 4], [2, 3], [2, 4], [3, 4]],
  [[1, 4], [2, 3], [2, 4], [3, 4]],
  [[1, 2], [1, 3], [1, 4], [2, 3], [3, 4]],
  [[1, 2], [1, 4], [2, 4], [3, 4]],
  [[1, 2], [1, 3], [2, 4], [3, 4]],
  [[1, 2], [1, 4], [2, 3], [2, 4], [3, 4]],
  [[1, 2], [1, 3], [1, 4]],
  [[1, 3], [2, 3], [3, 4]],
]; // contrast ratio >= 2.2 within each palette, measured 2026-10-06
const V4_TILE = 9; // inside() id of the Truchet tile
function recipeV4(commitment: Uint8Array): ArtRecipe {
  const s = new Stream(commitment, ART_ALGORITHM_V4);
  const palette = s.pick(PALETTES_V3.length);
  const pairs = V4_PAIRS[palette]!;
  const [A, B] = pairs[s.pick(pairs.length)]!;
  const cells: ArtCell[] = [];
  for (let k = 0; k < 256; k++) {
    const row = k >> 4, col = k & 15, bit = bitAt(commitment, k);
    const disc = (row + col + bit) % 2 === 0 ? A : B;
    cells.push({ shape: V4_TILE, turn: bit, fg: disc, bg: disc === A ? B : A });
  }
  const { width, height } = artSize(ART_ALGORITHM_V4);
  return { algorithm: ART_ALGORITHM_V4, width, height, commitment: toBase64Url(commitment), palette, grid: 16, cells };
}

/**
 * Version 4: read the commitment back from the picture alone. The frame pixel names the palette; the
 * two band colours seen at the tile centres name the pair (in its fixed order); each centre's colour
 * then gives its tile's bit. Returns null when the pixels are not a version 4 image.
 */
export function decodeArtV4(px: Uint8Array, width: number, height: number): Uint8Array | null {
  const size = artSize(ART_ALGORITHM_V4);
  if (width !== size.width || height !== size.height || px.length !== width * height * 4) return null;
  const at = (x: number, y: number): RGB => { const i = (y * width + x) * 4; return [px[i]!, px[i + 1]!, px[i + 2]!]; };
  const same = (a: RGB, b: RGB) => a[0] === b[0] && a[1] === b[1] && a[2] === b[2];
  const palette = PALETTES_V3.findIndex((p) => same(p[0]!, at(0, 0)));
  if (palette < 0) return null;
  const pal = PALETTES_V3[palette]!;
  const centres: RGB[] = [];
  for (let k = 0; k < 256; k++) centres.push(at(ART_X + (k & 15) * 60 + 30, ART_Y + (k >> 4) * 60 + 30));
  // Every tile shows both colours of its pair, so the pair is the one whose colours the centres use;
  // when the centres alone fit two pairs, the code's own colour choice (a function of the code) decides.
  for (const [A, B] of V4_PAIRS[palette]!) {
    if (!centres.every((c) => same(c, pal[A]!) || same(c, pal[B]!))) continue;
    const out = new Uint8Array(32);
    for (let k = 0; k < 256; k++) {
      const row = k >> 4, col = k & 15;
      // The centre is band; the band is B exactly when par = (row + col + bit) mod 2 is 0.
      const bit = same(centres[k]!, pal[B]!) ? (row + col) % 2 : (row + col + 1) % 2;
      if (bit) out[k >> 3]! |= 1 << (7 - (k & 7));
    }
    const r = recipeV4(out);
    if (r.palette === palette && r.cells.every((c, k) => same(pal[c.bg]!, centres[k]!)) && r.cells.some((c) => c.fg === A || c.bg === A) && r.cells.some((c) => c.fg === B || c.bg === B)) return out;
  }
  return null;
}

/** The recipe's JSON, keys in this fixed order: the bytes the recipe digest is taken over. */
export function recipeJson(r: ArtRecipe): string {
  const cells = r.cells.map((c) => `[${c.shape},${c.turn},${c.fg},${c.bg}]`).join(",");
  if (r.v9) return `{"algorithm":${JSON.stringify(r.algorithm)},"width":${r.width},"height":${r.height},"commitment":${JSON.stringify(r.commitment)},"plan":${JSON.stringify(r.v9)}}`;
  if (r.v8) return `{"algorithm":${JSON.stringify(r.algorithm)},"width":${r.width},"height":${r.height},"commitment":${JSON.stringify(r.commitment)},"plan":${JSON.stringify(r.v8)}}`;
  if (r.v7) return `{"algorithm":${JSON.stringify(r.algorithm)},"width":${r.width},"height":${r.height},"commitment":${JSON.stringify(r.commitment)},"plan":${JSON.stringify(r.v7)}}`;
  if (r.v6) return `{"algorithm":${JSON.stringify(r.algorithm)},"width":${r.width},"height":${r.height},"commitment":${JSON.stringify(r.commitment)},"plan":${JSON.stringify(r.v6)}}`;
  if (r.v5) return `{"algorithm":${JSON.stringify(r.algorithm)},"width":${r.width},"height":${r.height},"commitment":${JSON.stringify(r.commitment)},"plan":${JSON.stringify(r.v5)}}`;
  const frame = r.algorithm === ART_ALGORITHM_V3 ? `,"frame":${r.frame ?? 0}` : "";
  return `{"algorithm":${JSON.stringify(r.algorithm)},"width":${r.width},"height":${r.height},"commitment":${JSON.stringify(r.commitment)},"palette":${r.palette},"grid":${r.grid}${frame},"cells":[${cells}]}`;
}

function inside(shape: number, u: number, v: number, S: number): boolean {
  const D = 2 * S;
  switch (shape) {
    case 0: return true;
    case 1: return (u - S) ** 2 + (v - S) ** 2 <= S * S;
    case 2: return u * u + v * v <= D * D;
    case 3: return (u - S) ** 2 + v * v <= S * S;
    case 4: return u + v <= D;
    case 5: { const r = (u - S) ** 2 + (v - S) ** 2; return 4 * r > S * S && r <= S * S; }
    case 6: return Math.floor((4 * u) / D) % 2 === 0;
    case 7: return 4 * ((u - S) ** 2 + (v - S) ** 2) <= S * S;
    case 8: return v <= S; // split (version 3): the frame's top half
    case 9: return u * u + v * v <= S * S || (2 * S - u) ** 2 + (2 * S - v) ** 2 <= S * S; // Truchet (version 4): discs of radius S/2 cell at two opposite corners
    default: return false;
  }
}

function put(px: Uint8Array, width: number, x: number, y: number, c: RGB): void {
  const i = (y * width + x) * 4;
  px[i] = c[0]; px[i + 1] = c[1]; px[i + 2] = c[2]; px[i + 3] = 255;
}

/**
 * One cell of side S, drawn into a buffer of the given width at (x0, y0): one sample per pixel, or
 * (smooth) 16 samples blended with integers. Shared by renderArt and the version 3 reader.
 */
function drawCell(px: Uint8Array, width: number, x0: number, y0: number, S: number, cell: ArtCell, fg: RGB, bg: RGB, smooth: boolean): void {
  const H = smooth ? 4 * S : S; // the half-size in sample units
  const D = 2 * H;
  const mix: number[] = [0, 0, 0];
  for (let ly = 0; ly < S; ly++) {
    for (let lx = 0; lx < S; lx++) {
      if (!smooth) {
        let u = 2 * lx + 1, v = 2 * ly + 1;
        for (let t = 0; t < cell.turn; t++) { const nu = v; v = D - u; u = nu; }
        put(px, width, x0 + lx, y0 + ly, inside(cell.shape, u, v, S) ? fg : bg);
        continue;
      }
      let c = 0;
      for (let j = 0; j < 4; j++) for (let i = 0; i < 4; i++) {
        let u = 8 * lx + 2 * i + 1, v = 8 * ly + 2 * j + 1;
        for (let t = 0; t < cell.turn; t++) { const nu = v; v = D - u; u = nu; }
        if (inside(cell.shape, u, v, H)) c++;
      }
      if (c === 16) put(px, width, x0 + lx, y0 + ly, fg);
      else if (c === 0) put(px, width, x0 + lx, y0 + ly, bg);
      else {
        for (let k = 0; k < 3; k++) mix[k] = (fg[k]! * c + bg[k]! * (16 - c) + 8) >> 4;
        put(px, width, x0 + lx, y0 + ly, mix as unknown as RGB);
      }
    }
  }
}

const paletteOf = (r: ArtRecipe): readonly RGB[] => (r.algorithm === ART_ALGORITHM_V3 || r.algorithm === ART_ALGORITHM_V4 ? PALETTES_V3 : PALETTES)[r.palette]!;

/** The canonical RGBA buffer for a recipe. Integer arithmetic only. */
export function renderArt(r: ArtRecipe): Uint8Array {
  const commitment = fromBase64Url(r.commitment);
  if (commitment === null) throw new TypeError("the recipe's commitment is not base64url");
  requireCommitment(commitment);
  if (r.v9) return renderV9(r.v9, commitment);
  if (r.v8) return renderV8(r.v8, commitment);
  if (r.v7) return renderV7(r.v7, commitment);
  if (r.v6) return renderV6(r.v6, commitment);
  if (r.v5) return renderV5(r.v5, commitment);
  const { width, height } = artSize(r.algorithm);
  const pal = paletteOf(r);
  const v3 = r.algorithm === ART_ALGORITHM_V3;
  const ground = v3 && r.frame === 1 ? pal[4]! : pal[0]!;
  const px = new Uint8Array(width * height * 4);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) put(px, width, x, y, ground);

  const S = ART_SIDE / r.grid; // every grid divides 960
  const smooth = r.algorithm !== ART_ALGORITHM_V1;
  for (let row = 0; row < r.grid; row++) {
    for (let col = 0; col < r.grid; col++) {
      const cell = r.cells[row * r.grid + col]!;
      drawCell(px, width, ART_X + col * S, ART_Y + row * S, S, cell, pal[cell.fg]!, pal[cell.bg]!, smooth);
    }
  }

  if (!v3) {
    for (let i = 0; i < 256; i++) {
      const c = bitAt(commitment, i) === 1 ? INK : PAPER;
      for (let y = STRIP_Y; y < STRIP_Y + STRIP_ROWS; y++) for (let x = i * STRIP_CELL; x < (i + 1) * STRIP_CELL; x++) put(px, width, x, y, c);
    }
  }
  return px;
}

/**
 * Version 3: read the commitment back from the picture alone. The frame pixel (0, 0) names the
 * palette and the frame bit; each 160 px cell is matched exactly against the 128 looks drawn in
 * that palette. Returns null when the pixels are not a version 3 image.
 */
export function decodeArtV3(px: Uint8Array, width: number, height: number): Uint8Array | null {
  const size = artSize(ART_ALGORITHM_V3);
  if (width !== size.width || height !== size.height || px.length !== width * height * 4) return null;
  const at = (x: number, y: number): RGB => { const i = (y * width + x) * 4; return [px[i]!, px[i + 1]!, px[i + 2]!]; };
  const same = (a: RGB, b: RGB) => a[0] === b[0] && a[1] === b[1] && a[2] === b[2];
  const corner = at(0, 0);
  let palette = -1, frame = -1;
  PALETTES_V3.forEach((p, i) => { if (same(p[0]!, corner)) { palette = i; frame = 0; } else if (same(p[4]!, corner)) { palette = i; frame = 1; } });
  if (palette < 0) return null;
  const pal = PALETTES_V3[palette]!;
  const S = ART_SIDE / 6;
  const looks: Uint8Array[] = [];
  for (let code = 0; code < 128; code++) {
    const cell = v3Cell(code);
    const buf = new Uint8Array(S * S * 4);
    drawCell(buf, S, 0, 0, S, cell, pal[cell.fg]!, pal[cell.bg]!, true);
    looks.push(buf);
  }
  const bits: number[] = [];
  for (let k = 0; k < 36; k++) {
    const x0 = ART_X + (k % 6) * S, y0 = ART_Y + Math.floor(k / 6) * S;
    let found = -1;
    for (let code = 0; code < 128 && found < 0; code++) {
      const look = looks[code]!;
      let ok = true;
      for (let y = 0; y < S && ok; y++) {
        const row = ((y0 + y) * width + x0) * 4, lrow = y * S * 4;
        for (let x = 0; x < S * 4; x++) if (px[row + x] !== look[lrow + x]) { ok = false; break; }
      }
      if (ok) found = code;
    }
    if (found < 0) return null;
    for (let b = 6; b >= 0; b--) bits.push((found >> b) & 1);
  }
  bits.push((palette >> 2) & 1, (palette >> 1) & 1, palette & 1, frame);
  const out = new Uint8Array(32);
  bits.forEach((b, i) => { if (b) out[i >> 3]! |= 1 << (7 - (i & 7)); });
  return out;
}

/**
 * Read the strip back: the centre pixel of each 4 x 16 cell, (4i + 2, 1040). A cell is a 1
 * when its luma (299 R + 587 G + 114 B) is below 127,500, a 0 otherwise. Returns null when a
 * buffer is not this algorithm's size.
 */
export function decodeStrip(px: Uint8Array, width: number, height: number): Uint8Array | null {
  if (width !== ART_WIDTH || height !== ART_HEIGHT || px.length !== width * height * 4) return null;
  const out = new Uint8Array(32);
  const y = STRIP_Y + STRIP_ROWS / 2;
  for (let i = 0; i < 256; i++) {
    const p = (y * width + i * STRIP_CELL + STRIP_CELL / 2) * 4;
    const luma = 299 * px[p]! + 587 * px[p + 1]! + 114 * px[p + 2]!;
    if (luma < 127_500) out[i >> 3]! |= 1 << (7 - (i & 7));
  }
  return out;
}

export function artManifest(r: ArtRecipe, px: Uint8Array): ArtManifest {
  return {
    algorithm: r.algorithm,
    width: r.width,
    height: r.height,
    commitment: r.commitment,
    recipeSha256: toHex(sha256(te.encode(recipeJson(r)))),
    pixelsSha256: toHex(sha256(px)),
  };
}
export function manifestJson(m: ArtManifest): string {
  return `{"algorithm":${JSON.stringify(m.algorithm)},"width":${m.width},"height":${m.height},"commitment":${JSON.stringify(m.commitment)},"recipeSha256":${JSON.stringify(m.recipeSha256)},"pixelsSha256":${JSON.stringify(m.pixelsSha256)}}`;
}

/* ── PNG, written and read here so no browser codec is in the path ─────────────────── */

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
function chunk(type: string, data: Uint8Array): Uint8Array {
  const t = te.encode(type);
  const out = new Uint8Array(12 + data.length);
  out.set(u32be(data.length), 0);
  out.set(t, 4);
  out.set(data, 8);
  out.set(u32be(crc32([t, data])), 8 + data.length);
  return out;
}
async function pipe(bytes: Uint8Array, stream: CompressionStream | DecompressionStream): Promise<Uint8Array> {
  const out = await new Response(new Blob([bytes as BlobPart]).stream().pipeThrough(stream)).arrayBuffer();
  return new Uint8Array(out);
}
const concat = (parts: Uint8Array[]): Uint8Array => {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const p of parts) { out.set(p, at); at += p.length; }
  return out;
};

/**
 * An RGB PNG of the canonical pixels with the manifest in a tEXt chunk before the image data.
 * The manifest holds the commitment as base64url text, which is how the recorded file carries
 * it for the verifier (bitgraph-fuse/2, carry "base64url"). The deflate stream is the
 * platform's, so these bytes may differ between browsers; the pixels they decode to do not.
 */
/* ── A fixed deflate, so a version-2 file is a pure function of its commitment ─────────
 * Browsers compress the same pixels to different bytes, so a version-1 file could only be
 * checked by its pixels. Version 2 writes its own zlib stream (Mike, 2026-10-06: the proof page
 * should open the image): one final block with the fixed Huffman codes of RFC 1951, built
 * greedily from two candidates only, the previous pixel (distance 3) and the pixel above
 * (distance = one row, 1 + 3W bytes), the longer match winning and distance 3 on a tie; a
 * match shorter than 3 is a literal. zlib header 78 01, Adler-32 at the end. The same pixels
 * always give the same bytes, so the proof page can redraw the exact recorded file.
 */
const LEN_BASE = [3, 4, 5, 6, 7, 8, 9, 10, 11, 13, 15, 17, 19, 23, 27, 31, 35, 43, 51, 59, 67, 83, 99, 115, 131, 163, 195, 227, 258];
const LEN_EXTRA = [0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 2, 2, 2, 2, 3, 3, 3, 3, 4, 4, 4, 4, 5, 5, 5, 5, 0];
const DIST_BASE = [1, 2, 3, 4, 5, 7, 9, 13, 17, 25, 33, 49, 65, 97, 129, 193, 257, 385, 513, 769, 1025, 1537, 2049, 3073, 4097, 6145, 8193, 12289, 16385, 24577];
const DIST_EXTRA = [0, 0, 0, 0, 1, 1, 2, 2, 3, 3, 4, 4, 5, 5, 6, 6, 7, 7, 8, 8, 9, 9, 10, 10, 11, 11, 12, 12, 13, 13];

function fixedDeflate(raw: Uint8Array, rowLen: number): Uint8Array {
  const out: number[] = [0x78, 0x01];
  let acc = 0, nbits = 0;
  const bits = (value: number, count: number) => { // least significant bit first
    for (let i = 0; i < count; i++) { acc |= ((value >> i) & 1) << nbits; nbits++; if (nbits === 8) { out.push(acc); acc = 0; nbits = 0; } }
  };
  const huff = (code: number, len: number) => { for (let i = len - 1; i >= 0; i--) bits((code >> i) & 1, 1); }; // most significant bit first
  const sym = (s: number) => {
    if (s <= 143) huff(0x30 + s, 8);
    else if (s <= 255) huff(0x190 + (s - 144), 9);
    else if (s <= 279) huff(s - 256, 7);
    else huff(0xc0 + (s - 280), 8);
  };
  const lengthOf = (i: number, d: number): number => {
    if (i < d) return 0;
    let L = 0;
    while (L < 258 && i + L < raw.length && raw[i + L] === raw[i + L - d]) L++;
    return L;
  };
  bits(1, 1); bits(1, 2); // BFINAL = 1, BTYPE = 01 (fixed Huffman)
  for (let i = 0; i < raw.length;) {
    const a = lengthOf(i, 3), b = lengthOf(i, rowLen);
    const L = Math.max(a, b), d = a >= b ? 3 : rowLen;
    if (L < 3) { sym(raw[i]!); i++; continue; }
    let lc = LEN_BASE.length - 1;
    while (LEN_BASE[lc]! > L) lc--;
    sym(257 + lc); bits(L - LEN_BASE[lc]!, LEN_EXTRA[lc]!);
    let dc = DIST_BASE.length - 1;
    while (DIST_BASE[dc]! > d) dc--;
    huff(dc, 5); bits(d - DIST_BASE[dc]!, DIST_EXTRA[dc]!);
    i += L;
  }
  sym(256);
  if (nbits > 0) out.push(acc);
  let s1 = 1, s2 = 0;
  for (let i = 0; i < raw.length; i++) { s1 = (s1 + raw[i]!) % 65521; s2 = (s2 + s1) % 65521; }
  const adler = ((s2 << 16) | s1) >>> 0;
  out.push((adler >>> 24) & 0xff, (adler >>> 16) & 0xff, (adler >>> 8) & 0xff, adler & 0xff);
  return Uint8Array.from(out);
}

/**
 * An RGB PNG of the canonical pixels with the manifest in a tEXt chunk before the image data.
 * The manifest holds the commitment as base64url text, which is how the recorded file carries
 * it for the verifier (bitgraph-fuse/2, carry "base64url"). Version 2 uses the fixed deflate
 * above, so its bytes are the same everywhere; version 1 used the platform's deflate, so its
 * bytes could differ between browsers while the pixels they decode to could not.
 */
export async function encodeArtPng(px: Uint8Array, manifest: ArtManifest): Promise<Uint8Array> {
  const { width: w, height: h } = artSize(manifest.algorithm);
  const rowLen = 1 + w * 3;
  const raw = new Uint8Array(h * rowLen);
  for (let y = 0; y < h; y++) {
    const o = y * rowLen; // filter byte 0 (None)
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4;
      raw[o + 1 + x * 3] = px[i]!; raw[o + 2 + x * 3] = px[i + 1]!; raw[o + 3 + x * 3] = px[i + 2]!;
    }
  }
  const ihdr = new Uint8Array(13);
  ihdr.set(u32be(w), 0); ihdr.set(u32be(h), 4);
  ihdr[8] = 8; ihdr[9] = 2; // 8-bit truecolour, no alpha; compression, filter, interlace 0
  const text = concat([te.encode(ART_MANIFEST_KEYWORD), Uint8Array.of(0), te.encode(manifestJson(manifest))]);
  const idat = manifest.algorithm === ART_ALGORITHM_V1 ? await pipe(raw, new CompressionStream("deflate")) : fixedDeflate(raw, rowLen);
  return concat([PNG_SIG, chunk("IHDR", ihdr), chunk("tEXt", text), chunk("IDAT", idat), chunk("IEND", new Uint8Array(0))]);
}

/**
 * A PNG of any size, for the print redrawing (Mike, 2026-10-06: "make a download high resolution
 * button"). Not a recorded file and never made into one: the platform's deflate, the Sub filter
 * (the larger drawing is mostly flat runs), 300 dpi in pHYs, and a tEXt chunk saying what it is.
 * It carries no manifest and no commitment, so it is never mistaken for the recorded image.
 */
export async function encodePrintPng(px: Uint8Array, w: number, h: number, note: Record<string, string | number>): Promise<Uint8Array> {
  const rowLen = 1 + w * 3;
  const raw = new Uint8Array(h * rowLen);
  for (let y = 0; y < h; y++) {
    const o = y * rowLen;
    raw[o] = 1; // filter Sub: each byte minus the one three to its left
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4;
      for (let c = 0; c < 3; c++) raw[o + 1 + x * 3 + c] = (px[i + c]! - (x > 0 ? px[i - 4 + c]! : 0)) & 0xff;
    }
  }
  const ihdr = new Uint8Array(13);
  ihdr.set(u32be(w), 0); ihdr.set(u32be(h), 4);
  ihdr[8] = 8; ihdr[9] = 2;
  const phys = new Uint8Array(9);
  phys.set(u32be(11811), 0); phys.set(u32be(11811), 4); phys[8] = 1; // 300 dots per inch, in dots per metre
  const text = concat([te.encode("bitgraph-art-print"), Uint8Array.of(0), te.encode(JSON.stringify(note))]);
  const idat = await pipe(raw, new CompressionStream("deflate"));
  return concat([PNG_SIG, chunk("IHDR", ihdr), chunk("pHYs", phys), chunk("tEXt", text), chunk("IDAT", idat), chunk("IEND", new Uint8Array(0))]);
}

export interface DecodedPng { width: number; height: number; rgba: Uint8Array; texts: Record<string, string> }

/**
 * Decode a non-interlaced 8-bit RGB or RGBA PNG to RGBA, every filter type, checking each
 * chunk's CRC. Bytes after IEND (a carrier's proof block) are ignored. Throws on anything else.
 */
export async function decodePng(bytes: Uint8Array): Promise<DecodedPng> {
  for (let i = 0; i < 8; i++) if (bytes[i] !== PNG_SIG[i]) throw new Error("not a PNG");
  let at = 8, width = 0, height = 0, channels = 0;
  const idat: Uint8Array[] = [];
  const texts: Record<string, string> = {};
  const view = (a: number, n: number) => bytes.subarray(a, a + n);
  for (;;) {
    if (at + 12 > bytes.length) throw new Error("PNG ends before IEND");
    const len = ((bytes[at]! << 24) | (bytes[at + 1]! << 16) | (bytes[at + 2]! << 8) | bytes[at + 3]!) >>> 0;
    const type = new TextDecoder().decode(view(at + 4, 4));
    if (at + 12 + len > bytes.length) throw new Error(`PNG chunk ${type} runs past the end`);
    const data = view(at + 8, len);
    const crc = ((bytes[at + 8 + len]! << 24) | (bytes[at + 9 + len]! << 16) | (bytes[at + 10 + len]! << 8) | bytes[at + 11 + len]!) >>> 0;
    if (crc !== crc32([view(at + 4, 4), data])) throw new Error(`PNG chunk ${type} fails its CRC`);
    if (type === "IHDR") {
      width = ((data[0]! << 24) | (data[1]! << 16) | (data[2]! << 8) | data[3]!) >>> 0;
      height = ((data[4]! << 24) | (data[5]! << 16) | (data[6]! << 8) | data[7]!) >>> 0;
      if (data[8] !== 8 || (data[9] !== 2 && data[9] !== 6) || data[12] !== 0) throw new Error("only 8-bit, non-interlaced RGB or RGBA PNGs are read");
      channels = data[9] === 6 ? 4 : 3;
    } else if (type === "IDAT") idat.push(data);
    else if (type === "tEXt") {
      const z = data.indexOf(0);
      if (z > 0) texts[new TextDecoder("latin1").decode(data.subarray(0, z))] = new TextDecoder("latin1").decode(data.subarray(z + 1));
    } else if (type === "IEND") break;
    at += 12 + len;
  }
  if (width === 0 || height === 0 || width * height > 1 << 24) throw new Error("PNG has no usable IHDR");
  const raw = await pipe(concat(idat), new DecompressionStream("deflate"));
  const stride = width * channels;
  if (raw.length !== height * (stride + 1)) throw new Error("PNG image data is the wrong length");
  const out = new Uint8Array(width * height * channels);
  for (let y = 0; y < height; y++) {
    const f = raw[y * (stride + 1)]!;
    const src = y * (stride + 1) + 1, dst = y * stride;
    for (let x = 0; x < stride; x++) {
      const a = x >= channels ? out[dst + x - channels]! : 0;
      const b = y > 0 ? out[dst - stride + x]! : 0;
      const c = x >= channels && y > 0 ? out[dst - stride + x - channels]! : 0;
      let pr = 0;
      if (f === 0) pr = 0;
      else if (f === 1) pr = a;
      else if (f === 2) pr = b;
      else if (f === 3) pr = (a + b) >> 1;
      else if (f === 4) { const p = a + b - c, pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c); pr = pa <= pb && pa <= pc ? a : pb <= pc ? b : c; }
      else throw new Error(`PNG filter ${f} is not a PNG filter`);
      out[dst + x] = (raw[src + x]! + pr) & 0xff;
    }
  }
  if (channels === 4) return { width, height, rgba: out, texts };
  const rgba = new Uint8Array(width * height * 4);
  for (let i = 0, j = 0; i < out.length; i += 3, j += 4) { rgba[j] = out[i]!; rgba[j + 1] = out[i + 1]!; rgba[j + 2] = out[i + 2]!; rgba[j + 3] = 255; }
  return { width, height, rgba, texts };
}

/** Recipe, pixels, manifest and the PNG to record, for one commitment. */
export async function makeArt(commitment: Uint8Array, algorithm: string = ART_ALGORITHM): Promise<{ recipe: ArtRecipe; pixels: Uint8Array; manifest: ArtManifest; png: Uint8Array }> {
  const recipe = artRecipe(commitment, algorithm);
  const pixels = renderArt(recipe);
  const manifest = artManifest(recipe, pixels);
  return { recipe, pixels, manifest, png: await encodeArtPng(pixels, manifest) };
}

/* ── The two image checks (the proof's own checks are the existing verifier's) ──────── */

export type ArtCheckResult = "TRUE" | "FALSE" | "UNDETERMINED";
export interface ArtChecks {
  /** Regenerating from the authenticated commitment gives exactly the file's pixels. */
  regenerated: { result: ArtCheckResult; detail: string };
  /** The strip in the file's pixels spells the authenticated commitment. */
  strip: { result: ArtCheckResult; detail: string };
  /** Informational: what the file's own manifest says, never trusted for the checks above. */
  manifest: ArtManifest | null;
}

/**
 * Check a recorded image against the commitment the PROOF authenticates (from the signed
 * position record and floor block), never against the commitment the file's manifest states.
 */
export async function checkArt(pngBytes: Uint8Array, authenticatedCommitment: Uint8Array): Promise<ArtChecks> {
  requireCommitment(authenticatedCommitment);
  let decoded: DecodedPng;
  try {
    decoded = await decodePng(pngBytes);
  } catch (e) {
    const detail = `the image could not be read: ${e instanceof Error ? e.message : String(e)}`;
    return { regenerated: { result: "FALSE", detail }, strip: { result: "FALSE", detail }, manifest: null };
  }
  let manifest: ArtManifest | null = null;
  try {
    const m = JSON.parse(decoded.texts[ART_MANIFEST_KEYWORD] ?? "null") as ArtManifest | null;
    if (m && typeof m.commitment === "string") manifest = m;
  } catch { /* informational only */ }

  // The version is the file's own claim, and it only chooses WHICH fixed rules redraw it: under
  // either, the pixels must come from the authenticated commitment, or the check fails.
  const algorithm = manifest && ART_ALGORITHMS.includes(manifest.algorithm) ? manifest.algorithm : ART_ALGORITHM;
  const expected = renderArt(artRecipe(authenticatedCommitment, algorithm));
  const { width: W, height: Hh } = artSize(algorithm);
  const sameSize = decoded.width === W && decoded.height === Hh && decoded.rgba.length === expected.length;
  let firstDiff = -1;
  if (sameSize) for (let i = 0; i < expected.length; i++) if (expected[i] !== decoded.rgba[i]) { firstDiff = i; break; }
  const regenerated: ArtChecks["regenerated"] = !sameSize
    ? { result: "FALSE", detail: `the image is ${decoded.width} x ${decoded.height}; ${algorithm} draws ${W} x ${Hh}` }
    : firstDiff === -1
      ? { result: "TRUE", detail: `regenerated with ${algorithm} from the authenticated commitment, all ${(W * Hh).toLocaleString("en-US")} pixels match (SHA-256 ${toHex(sha256(expected))})` }
      : { result: "FALSE", detail: `the first differing pixel is at (${(firstDiff >> 2) % W}, ${Math.floor((firstDiff >> 2) / W)})` };

  // Read the commitment back from the pixels: the strip for versions 1 and 2, the art itself for 3.
  const v6 = algorithm === ART_ALGORITHM_V6, v7 = algorithm === ART_ALGORITHM_V7, v8 = algorithm === ART_ALGORITHM_V8, v9 = algorithm === ART_ALGORITHM_V9;
  const v5 = algorithm === ART_ALGORITHM_V5;
  const v4 = algorithm === ART_ALGORITHM_V4;
  const v3 = algorithm === ART_ALGORITHM_V3 || v4;
  const read = v9 ? decodeV9(decoded.rgba, decoded.width, decoded.height) : v8 ? decodeV8(decoded.rgba, decoded.width, decoded.height) : v7 ? decodeV7(decoded.rgba, decoded.width, decoded.height) : v6 ? decodeV6(decoded.rgba, decoded.width, decoded.height) : v5 ? decodeV5(decoded.rgba, decoded.width, decoded.height) : v4 ? decodeArtV4(decoded.rgba, decoded.width, decoded.height) : v3 ? decodeArtV3(decoded.rgba, decoded.width, decoded.height) : decodeStrip(decoded.rgba, decoded.width, decoded.height);
  const what = v5 ? "the plate mark" : v3 || v6 || v7 || v8 || v9 ? "the art" : "the 256-cell strip";
  const strip: ArtChecks["strip"] = read === null
    ? { result: "FALSE", detail: v3 ? `the picture does not read as a ${algorithm} spelling of any commitment` : "the image is not this algorithm's size, so it has no strip to read" }
    : read.every((b, i) => b === authenticatedCommitment[i])
      ? { result: "TRUE", detail: `${what} reads ${toBase64Url(read)}, the authenticated commitment` }
      : { result: "FALSE", detail: `${what} reads ${toBase64Url(read)}, not the authenticated commitment ${toBase64Url(authenticatedCommitment)}` };
  return { regenerated, strip, manifest };
}
