/**
 * bitgraph-art/1: an image whose every pixel is a function of one position commitment
 * (Mike, 2026-10-05: "an image that could not have existed before" its position opened).
 *
 * The commitment is the ONLY creative input. Algorithm, dimensions, palettes and drawing
 * rules are fixed here and versioned by ART_ALGORITHM; a change to any of them is a new
 * version, never an edit of this one. No clock, no Math.random, no viewport, no user input,
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
 *   block(k) = SHA-256( ASCII "bitgraph-art/1" || 0x00 || ASCII "draw" || 0x00 || C || u32be(k) )
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
 * A pixel inside the shape takes fg, otherwise bg.
 *
 * ── Digests ───────────────────────────────────────────────────────────────────────────
 *   recipe digest = SHA-256 of the recipe's JSON exactly as recipeJson() writes it
 *   pixel digest  = SHA-256 of the RGBA buffer, row-major from the top-left, 4 bytes per pixel
 */
import { sha256 } from "@noble/hashes/sha256";

export const ART_ALGORITHM = "bitgraph-art/1";
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
  if (!(c instanceof Uint8Array) || c.length !== 32) throw new TypeError("a bitgraph-art/1 commitment is exactly 32 bytes");
}

/** The stream of the header comment: block(k) concatenated, read 4 bytes at a time. */
class Stream {
  private buf: Uint8Array = new Uint8Array(0);
  private at = 0;
  private k = 0;
  private readonly prefix: Uint8Array;
  constructor(commitment: Uint8Array) {
    const label = te.encode(ART_ALGORITHM), purpose = te.encode("draw");
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
export function artRecipe(commitment: Uint8Array): ArtRecipe {
  requireCommitment(commitment);
  const s = new Stream(commitment);
  const grid = GRIDS[s.pick(GRIDS.length)]!;
  const palette = s.pick(PALETTES.length);
  const cells: ArtCell[] = [];
  for (let i = 0; i < grid * grid; i++) {
    const shape = s.pick(8), turn = s.pick(4), fg = s.pick(4) + 1;
    let bg = s.pick(4) + 1;
    if (bg === fg) bg = 1 + (fg % 4);
    cells.push({ shape, turn, fg, bg });
  }
  return { algorithm: ART_ALGORITHM, width: ART_WIDTH, height: ART_HEIGHT, commitment: toBase64Url(commitment), palette, grid, cells };
}

/** The recipe's JSON, keys in this fixed order: the bytes the recipe digest is taken over. */
export function recipeJson(r: ArtRecipe): string {
  const cells = r.cells.map((c) => `[${c.shape},${c.turn},${c.fg},${c.bg}]`).join(",");
  return `{"algorithm":${JSON.stringify(r.algorithm)},"width":${r.width},"height":${r.height},"commitment":${JSON.stringify(r.commitment)},"palette":${r.palette},"grid":${r.grid},"cells":[${cells}]}`;
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
    default: return false;
  }
}

function put(px: Uint8Array, x: number, y: number, c: RGB): void {
  const i = (y * ART_WIDTH + x) * 4;
  px[i] = c[0]; px[i + 1] = c[1]; px[i + 2] = c[2]; px[i + 3] = 255;
}

/** The canonical RGBA buffer for a recipe. Integer arithmetic only. */
export function renderArt(r: ArtRecipe): Uint8Array {
  const commitment = fromBase64Url(r.commitment);
  if (commitment === null) throw new TypeError("the recipe's commitment is not base64url");
  requireCommitment(commitment);
  const pal = PALETTES[r.palette]!;
  const px = new Uint8Array(ART_WIDTH * ART_HEIGHT * 4);
  for (let y = 0; y < ART_HEIGHT; y++) for (let x = 0; x < ART_WIDTH; x++) put(px, x, y, pal[0]!);

  const S = ART_SIDE / r.grid; // GRIDS all divide 960
  const D = 2 * S;
  for (let row = 0; row < r.grid; row++) {
    for (let col = 0; col < r.grid; col++) {
      const cell = r.cells[row * r.grid + col]!;
      const fg = pal[cell.fg]!, bg = pal[cell.bg]!;
      for (let ly = 0; ly < S; ly++) {
        for (let lx = 0; lx < S; lx++) {
          let u = 2 * lx + 1, v = 2 * ly + 1;
          for (let t = 0; t < cell.turn; t++) { const nu = v; v = D - u; u = nu; }
          put(px, ART_X + col * S + lx, ART_Y + row * S + ly, inside(cell.shape, u, v, S) ? fg : bg);
        }
      }
    }
  }

  for (let i = 0; i < 256; i++) {
    const bit = (commitment[i >> 3]! >> (7 - (i & 7))) & 1;
    const c = bit === 1 ? INK : PAPER;
    for (let y = STRIP_Y; y < STRIP_Y + STRIP_ROWS; y++) for (let x = i * STRIP_CELL; x < (i + 1) * STRIP_CELL; x++) put(px, x, y, c);
  }
  return px;
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
export async function encodeArtPng(px: Uint8Array, manifest: ArtManifest): Promise<Uint8Array> {
  const w = ART_WIDTH, h = ART_HEIGHT;
  const raw = new Uint8Array(h * (1 + w * 3));
  for (let y = 0; y < h; y++) {
    const o = y * (1 + w * 3); // filter byte 0 (None)
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4;
      raw[o + 1 + x * 3] = px[i]!; raw[o + 2 + x * 3] = px[i + 1]!; raw[o + 3 + x * 3] = px[i + 2]!;
    }
  }
  const ihdr = new Uint8Array(13);
  ihdr.set(u32be(w), 0); ihdr.set(u32be(h), 4);
  ihdr[8] = 8; ihdr[9] = 2; // 8-bit truecolour, no alpha; compression, filter, interlace 0
  const text = concat([te.encode(ART_MANIFEST_KEYWORD), Uint8Array.of(0), te.encode(manifestJson(manifest))]);
  const idat = await pipe(raw, new CompressionStream("deflate"));
  return concat([PNG_SIG, chunk("IHDR", ihdr), chunk("tEXt", text), chunk("IDAT", idat), chunk("IEND", new Uint8Array(0))]);
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
export async function makeArt(commitment: Uint8Array): Promise<{ recipe: ArtRecipe; pixels: Uint8Array; manifest: ArtManifest; png: Uint8Array }> {
  const recipe = artRecipe(commitment);
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

  const expected = renderArt(artRecipe(authenticatedCommitment));
  const sameSize = decoded.width === ART_WIDTH && decoded.height === ART_HEIGHT && decoded.rgba.length === expected.length;
  let firstDiff = -1;
  if (sameSize) for (let i = 0; i < expected.length; i++) if (expected[i] !== decoded.rgba[i]) { firstDiff = i; break; }
  const regenerated: ArtChecks["regenerated"] = !sameSize
    ? { result: "FALSE", detail: `the image is ${decoded.width} x ${decoded.height}; ${ART_ALGORITHM} draws ${ART_WIDTH} x ${ART_HEIGHT}` }
    : firstDiff === -1
      ? { result: "TRUE", detail: `regenerated from the authenticated commitment, all ${(ART_WIDTH * ART_HEIGHT).toLocaleString("en-US")} pixels match (SHA-256 ${toHex(sha256(expected))})` }
      : { result: "FALSE", detail: `the first differing pixel is at (${(firstDiff >> 2) % ART_WIDTH}, ${Math.floor((firstDiff >> 2) / ART_WIDTH)})` };

  const read = decodeStrip(decoded.rgba, decoded.width, decoded.height);
  const strip: ArtChecks["strip"] = read === null
    ? { result: "FALSE", detail: "the image is not this algorithm's size, so it has no strip to read" }
    : read.every((b, i) => b === authenticatedCommitment[i])
      ? { result: "TRUE", detail: `the 256-cell strip reads ${toBase64Url(read)}, the authenticated commitment` }
      : { result: "FALSE", detail: `the strip reads ${toBase64Url(read)}, not the authenticated commitment ${toBase64Url(authenticatedCommitment)}` };
  return { regenerated, strip, manifest };
}
