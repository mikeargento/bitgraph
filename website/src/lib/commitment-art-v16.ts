// © 2026 Michael Argento. All rights reserved.
/**
 * bitgraph-art/16 (2026-10-09), "Three": a square of one flat colour holding exactly three flat squares or rectangles
 * that never touch, every decision drawn from the position commitment. Mike's rules: a square canvas, one solid
 * background colour, exactly 3 objects, each a square or a rectangle (axis-aligned), never touching each other, flat
 * solid colour only (no texture, no shading, no outlines). Colours (Mike, 2026-10-09, locked): four, a mid-century red,
 * yellow, blue and green; the background is one of the four and each object one of the three that are not the
 * background, so no object ever matches the ground (two objects may share a colour: they never touch).
 *
 * The piece is defined on an 1800 x 1800 grid of integers, and two files are written from it, both pure functions of
 * the commitment and both carrying it as base64url text (the content floor: the bytes hold the commitment). The PNG is
 * recorded, exactly as a painting is, and carries the SVG:
 *   the SVG (svgV16)  the print master: integer rectangles on an 1800 x 1800 viewBox, crisp edges, so it prints sharp
 *                     at any size. Canonical bytes: fixed element and attribute order, no floats, fixed whitespace,
 *                     UTF-8, LF line ends.
 *   the PNG           THE RECORDED FILE (Mike, 2026-10-09: share it anywhere; its BitGraphed file works as a painting's):
 *                     1800 x 1800 RGB, the same rectangles as pixels, encoded by version 15's pure deflate
 *                     (png-deflate-v15.ts), with the manifest and a copyright line in tEXt and the SVG, byte for byte, in
 *                     an iTXt chunk (pngFileV16), so the proof covers the print master too: it is inside the recorded
 *                     bytes, and it redraws from the commitment the proof authenticates.
 *
 * ── The stream (the pattern of every version) ──────────────────────────────────────────────────────────────────────
 *   block(k) = SHA-256( ASCII "bitgraph-art/16" || 0x00 || ASCII "draw" || 0x00 || C || u32be(k) ), C = 32 bytes
 *   u32()    = the next 4 stream bytes, big-endian;  below(n) = u32() mod n  (integers only)
 *
 * ── The plan, read in exactly this order (the approved sketch's order and loops) ───────────────────────────────────
 *   background  COLOURS[below(4)]
 *   gap         12 + below(140): the least background between any two objects, 12 to 151 grid units
 *   objects     until there are three, one attempt at a time:
 *                 below(3) == 0: a square, side 90 + below(760)
 *                 otherwise:     a rectangle, w = 40 + below(1300), h = 40 + below(1300); when |w - h| < 40 the
 *                                attempt is dropped (a rectangle is never nearly square)
 *                 x = below(1800 - w + 1), y = below(1800 - h + 1)   (an object may touch the canvas edge)
 *                 kept only when, against every object already kept, there are at least `gap` units of background
 *                 between them on x or on y (half-open boxes [x, x + w) x [y, y + h))
 *   colours     for each object in order: the three colours other than the background, in COLOURS order, [below(3)]
 * Objects are drawn in the order kept; they never overlap, so the order does not change the picture.
 */
import { sha256 } from "@noble/hashes/sha256";
import { deflateV15, filterRowsV15 } from "./png-deflate-v15.ts";

export const ART_ALGORITHM_V16 = "bitgraph-art/16";
const LABEL = ART_ALGORITHM_V16;
export const V16_SIZE = 1800;
export const V16_WIDTH = V16_SIZE, V16_HEIGHT = V16_SIZE;
export const V16_COPYRIGHT = "© 2026 Michael Argento. All rights reserved.";

export type RGB = readonly [number, number, number];
/**
 * The four colours, in one place (Mike, 2026-10-09: mid-century modern, locked). Tunable before the first piece is
 * recorded; after that a change of any value is a new version, as every drawing rule is.
 */
export const COLOURS_V16: readonly { name: string; hex: string; rgb: RGB }[] = [
  { name: "red", hex: "#C8442C", rgb: [200, 68, 44] },
  { name: "yellow", hex: "#E4A930", rgb: [228, 169, 48] },
  { name: "blue", hex: "#244E7A", rgb: [36, 78, 122] },
  { name: "green", hex: "#6B8E4E", rgb: [107, 142, 78] },
];

export interface V16Object {
  /** "square" or "rectangle". */
  kind: "square" | "rectangle";
  x: number;
  y: number;
  w: number;
  h: number;
  /** Index into COLOURS_V16; never the background's. */
  colour: number;
}
export interface V16Plan {
  /** Index into COLOURS_V16. */
  background: number;
  /** The least background between any two objects, in grid units. */
  gap: number;
  objects: V16Object[];
  /** Attempts drawn to place the three objects (informational; a function of the commitment like the rest). */
  attempts: number;
}

/** The labelled stream. */
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
  u32(): number {
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
  below(n: number): number {
    return this.u32() % n;
  }
}

/** True when two half-open boxes have less than `gap` units of background between them on both axes. */
export function touchingV16(a: { x: number; y: number; w: number; h: number }, b: { x: number; y: number; w: number; h: number }, gap: number): boolean {
  return !(a.x + a.w + gap <= b.x || b.x + b.w + gap <= a.x || a.y + a.h + gap <= b.y || b.y + b.h + gap <= a.y);
}

/** Far past any placement this plan has needed (a few hundred at most); a guard against a loop, never reached. */
const MAX_ATTEMPTS = 1_000_000;

function requireCommitment(c: Uint8Array): void {
  if (!(c instanceof Uint8Array) || c.length !== 32) throw new TypeError("a bitgraph-art commitment is exactly 32 bytes");
}

export function planV16(commitment: Uint8Array): V16Plan {
  requireCommitment(commitment);
  const s = new Stream(commitment);
  const background = s.below(COLOURS_V16.length);
  const gap = 12 + s.below(140);
  const placed: Array<Omit<V16Object, "colour">> = [];
  let attempts = 0;
  while (placed.length < 3) {
    if (++attempts > MAX_ATTEMPTS) throw new Error("bitgraph-art/16: no placement found");
    let w: number, h: number, kind: V16Object["kind"];
    if (s.below(3) === 0) {
      kind = "square";
      w = h = 90 + s.below(760);
    } else {
      kind = "rectangle";
      w = 40 + s.below(1300);
      h = 40 + s.below(1300);
      if (Math.abs(w - h) < 40) continue;
    }
    const x = s.below(V16_SIZE - w + 1), y = s.below(V16_SIZE - h + 1);
    const r = { kind, x, y, w, h };
    if (placed.every((o) => !touchingV16(r, o, gap))) placed.push(r);
  }
  const others = COLOURS_V16.map((_, c) => c).filter((c) => c !== background);
  const objects = placed.map((o) => ({ ...o, colour: others[s.below(others.length)]! }));
  return { background, gap, objects, attempts };
}

const b64url = (b: Uint8Array): string => {
  let s = "";
  for (const x of b) s += String.fromCharCode(x);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
};

/** The SVG text, canonical: one element a line, attributes in a fixed order, integers only, LF, a final LF. */
export function svgTextV16(plan: V16Plan, commitment: Uint8Array): string {
  requireCommitment(commitment);
  const fill = (c: number) => COLOURS_V16[c]!.hex;
  const lines = [
    `<?xml version="1.0" encoding="UTF-8"?>`,
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${V16_SIZE} ${V16_SIZE}" width="100%" height="100%" shape-rendering="crispEdges">`,
    `<title>Three</title>`,
    `<desc>${V16_COPYRIGHT}</desc>`,
    `<metadata>${ART_ALGORITHM_V16} commitment ${b64url(commitment)}</metadata>`,
    `<rect x="0" y="0" width="${V16_SIZE}" height="${V16_SIZE}" fill="${fill(plan.background)}"/>`,
    ...plan.objects.map((o) => `<rect x="${o.x}" y="${o.y}" width="${o.w}" height="${o.h}" fill="${fill(o.colour)}"/>`),
    `</svg>`,
  ];
  return lines.join("\n") + "\n";
}

/** The SVG file's bytes (UTF-8). */
export function svgV16(commitment: Uint8Array): Uint8Array {
  return new TextEncoder().encode(svgTextV16(planV16(commitment), commitment));
}

/** The canonical RGBA pixels of the plan, 1800 x 1800. */
export function renderV16(plan: V16Plan): Uint8Array {
  const W = V16_SIZE, px = new Uint8Array(W * W * 4);
  const bg = COLOURS_V16[plan.background]!.rgb;
  for (let i = 0; i < px.length; i += 4) { px[i] = bg[0]; px[i + 1] = bg[1]; px[i + 2] = bg[2]; px[i + 3] = 255; }
  for (const o of plan.objects) {
    const c = COLOURS_V16[o.colour]!.rgb;
    for (let y = o.y; y < o.y + o.h; y++) {
      for (let x = o.x, i = (y * W + o.x) * 4; x < o.x + o.w; x++, i += 4) { px[i] = c[0]; px[i + 1] = c[1]; px[i + 2] = c[2]; }
    }
  }
  return px;
}

/* ── The PNG ─────────────────────────────────────────────────────────────────────────────────────────────────────── */

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
function chunk(type: string, data: Uint8Array): Uint8Array {
  const t = latin1(type);
  const out = new Uint8Array(12 + data.length);
  out.set(u32be(data.length), 0);
  out.set(t, 4);
  out.set(data, 8);
  out.set(u32be(crc32([t, data])), 8 + data.length);
  return out;
}
const concat = (parts: Uint8Array[]): Uint8Array => {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const p of parts) { out.set(p, at); at += p.length; }
  return out;
};
const text = (keyword: string, value: string) => chunk("tEXt", concat([latin1(keyword), Uint8Array.of(0), latin1(value)]));

/** The iTXt keyword under which the PNG carries its print SVG, byte for byte. */
export const V16_SVG_KEYWORD = "bitgraph-print-svg";

/**
 * The recorded PNG's bytes, given the canonical pixels, the manifest JSON (commitment-art.ts writes it, as for every
 * version) and the SVG text: IHDR; tEXt "bitgraph-art" (the manifest, with the commitment as base64url); tEXt
 * "Copyright"; iTXt "bitgraph-print-svg" (uncompressed, no language: its text bytes ARE the SVG file's UTF-8 bytes;
 * tEXt is Latin-1, so the copyright sign would not survive there byte for byte); IDAT (version 15's pure deflate); IEND.
 */
export function pngFileV16(px: Uint8Array, manifestText: string, svgText: string): Uint8Array {
  const ihdr = new Uint8Array(13);
  ihdr.set(u32be(V16_SIZE), 0); ihdr.set(u32be(V16_SIZE), 4);
  ihdr[8] = 8; ihdr[9] = 2; // 8-bit truecolour, no alpha; compression, filter, interlace 0
  const itxt = chunk("iTXt", concat([latin1(V16_SVG_KEYWORD), Uint8Array.of(0, 0, 0, 0, 0), new TextEncoder().encode(svgText)]));
  const idat = deflateV15(filterRowsV15(px, V16_SIZE, V16_SIZE));
  return concat([PNG_SIG, chunk("IHDR", ihdr), text("bitgraph-art", manifestText), text("Copyright", V16_COPYRIGHT), itxt, chunk("IDAT", idat), chunk("IEND", new Uint8Array(0))]);
}

/**
 * The print SVG a version 16 PNG carries: the text of its iTXt "bitgraph-print-svg" chunk, or null. Walks the chunks
 * from the signature to IEND (bytes after IEND, a carrier's proof block, are not read). The CRCs are not trusted here:
 * a caller compares the SVG with a redrawing from the authenticated commitment.
 */
export function svgFromPngV16(png: Uint8Array): Uint8Array | null {
  for (let i = 0; i < 8; i++) if (png[i] !== PNG_SIG[i]) return null;
  const key = latin1(V16_SVG_KEYWORD);
  for (let at = 8; at + 12 <= png.length;) {
    const len = ((png[at]! << 24) | (png[at + 1]! << 16) | (png[at + 2]! << 8) | png[at + 3]!) >>> 0;
    if (at + 12 + len > png.length) return null;
    const type = String.fromCharCode(png[at + 4]!, png[at + 5]!, png[at + 6]!, png[at + 7]!);
    const data = png.subarray(at + 8, at + 8 + len);
    if (type === "IEND") return null;
    if (type === "iTXt" && data.length >= key.length + 5 && key.every((b, k) => data[k] === b) && data[key.length] === 0) {
      const head = key.length + 1;
      if (data[head] !== 0 || data[head + 1] !== 0 || data[head + 2] !== 0 || data[head + 3] !== 0) return null; // uncompressed, no language, no translation
      return data.slice(head + 4);
    }
    at += 12 + len;
  }
  return null;
}

/* ── Reading a file back ─────────────────────────────────────────────────────────────────────────────────────────── */

/** The commitment an SVG of this version states in its metadata, or null. Informational: a check redraws instead. */
export function readCommitmentV16(svg: Uint8Array): Uint8Array | null {
  let s: string;
  try { s = new TextDecoder("utf-8", { fatal: true }).decode(svg); } catch { return null; }
  const m = /<metadata>bitgraph-art\/16 commitment ([A-Za-z0-9_-]{43})<\/metadata>/.exec(s);
  if (!m) return null;
  try {
    const bin = atob(m[1]!.replace(/-/g, "+").replace(/_/g, "/") + "=");
    const out = Uint8Array.from(bin, (c) => c.charCodeAt(0));
    return out.length === 32 ? out : null;
  } catch { return null; }
}

/** A short description of a plan: "blue ground, two rectangles and a square". */
export function describeV16(plan: V16Plan): string {
  const sq = plan.objects.filter((o) => o.kind === "square").length;
  const words = ["no", "one", "two", "three"];
  const parts = [sq < 3 ? `${words[3 - sq]} rectangle${3 - sq === 1 ? "" : "s"}` : "", sq > 0 ? `${words[sq]} square${sq === 1 ? "" : "s"}` : ""].filter(Boolean);
  return `${COLOURS_V16[plan.background]!.name} ground, ${parts.join(" and ")}`;
}
