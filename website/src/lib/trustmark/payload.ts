// Copyright (c) Argento Computing Inc. All rights reserved. See LICENSE.

/**
 * The pointer a TrustMark carries back to the original's BitGraph.
 *
 *   payload (68 bits) = epochRef (16) | counter (24) | tag (28)
 *   epochRef          = the first 16 bits of SHA-256(epochId)
 *   tag               = the first 28 bits of SHA-256("mark/1" || nonce || pHash || epochRef (2 bytes) || counter (3 bytes))
 *
 * The tag needs the original's nonce, which nobody could see until the original was bound, so no valid mark can
 * exist before its original. It also needs the pHash bound in the original's fingerprint record, so a mark can only
 * name a picture its BitGraph describes. Different epochs can share an epochRef; a reader tries each candidate, and
 * the tag tells them apart.
 *
 * pHash is imagehash's: grayscale, 32 x 32 Lanczos, 2-D DCT, the low 8 x 8 against their median.
 */

const TAG_BITS = 28;
const enc = new TextEncoder();
const b64bytes = (s: string) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
const hexbytes = (h: string) => Uint8Array.from(h.match(/../g) ?? [], (x) => parseInt(x, 16));
const sha256 = async (b: Uint8Array) => new Uint8Array(await crypto.subtle.digest("SHA-256", b as BufferSource));
const bits = (v: number, n: number) => v.toString(2).padStart(n, "0");

export async function epochRef(epochId: string): Promise<number> {
  const h = await sha256(enc.encode(epochId));
  return (h[0]! << 8) | h[1]!;
}

export async function tag(nonceB64: string, phashHex: string, eref: number, counter: number): Promise<number> {
  const parts = [enc.encode("mark/1"), b64bytes(nonceB64), hexbytes(phashHex), Uint8Array.of(eref >> 8, eref & 255), Uint8Array.of(counter >> 16, (counter >> 8) & 255, counter & 255)];
  const buf = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let o = 0;
  for (const p of parts) { buf.set(p, o); o += p.length; }
  const h = await sha256(buf);
  return ((h[0]! << 24) | (h[1]! << 16) | (h[2]! << 8) | h[3]!) >>> (32 - TAG_BITS);
}

export const MAX_COUNTER = 2 ** 24 - 1;
export const pack = (eref: number, counter: number, t: number) => bits(eref, 16) + bits(counter, 24) + bits(t, TAG_BITS);
export const unpack = (payload: string) => ({ eref: parseInt(payload.slice(0, 16), 2), counter: parseInt(payload.slice(16, 40), 2), tag: parseInt(payload.slice(40), 2) });

// PIL's Lanczos (a = 3) resample of one 8-bit channel: horizontal pass, then vertical, rounded between passes.
const sinc = (x: number) => (x === 0 ? 1 : Math.sin(Math.PI * x) / (Math.PI * x));
const lanczos = (x: number) => (x > -3 && x < 3 ? sinc(x) * sinc(x / 3) : 0);
function coefficients(inSize: number, outSize: number) {
  const scale = inSize / outSize, fs = Math.max(scale, 1), support = 3 * fs, out: Array<{ xmin: number; w: number[] }> = [];
  for (let i = 0; i < outSize; i++) {
    const center = (i + 0.5) * scale;
    const xmin = Math.max(Math.trunc(center - support + 0.5), 0), xmax = Math.min(Math.trunc(center + support + 0.5), inSize);
    const w: number[] = []; let total = 0;
    for (let x = xmin; x < xmax; x++) { const k = lanczos((x - center + 0.5) / fs); w.push(k); total += k; }
    out.push({ xmin, w: w.map((k) => (total ? k / total : 0)) });
  }
  return out;
}
const clamp8 = (v: number) => Math.min(255, Math.max(0, Math.round(v)));
function resizeGray(src: Uint8Array, W: number, H: number, w: number, h: number): Uint8Array {
  const cx = coefficients(W, w), cy = coefficients(H, h), tmp = new Uint8Array(w * H), out = new Uint8Array(w * h);
  for (let y = 0; y < H; y++) for (let i = 0; i < w; i++) {
    const { xmin, w: k } = cx[i]!; let s = 0;
    for (let j = 0; j < k.length; j++) s += src[y * W + xmin + j]! * k[j]!;
    tmp[y * w + i] = clamp8(s);
  }
  for (let i = 0; i < h; i++) for (let x = 0; x < w; x++) {
    const { xmin, w: k } = cy[i]!; let s = 0;
    for (let j = 0; j < k.length; j++) s += tmp[(xmin + j) * w + x]! * k[j]!;
    out[i * w + x] = clamp8(s);
  }
  return out;
}

// scipy.fftpack.dct, type II, unnormalized, along the rows of an n x n matrix
function dctRows(m: Float64Array, n: number, out: Float64Array) {
  for (let r = 0; r < n; r++) for (let k = 0; k < n; k++) {
    let s = 0;
    for (let i = 0; i < n; i++) s += m[r * n + i]! * Math.cos((Math.PI * k * (2 * i + 1)) / (2 * n));
    out[r * n + k] = 2 * s;
  }
}
const transpose = (m: Float64Array, n: number) => { const t = new Float64Array(n * n); for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) t[j * n + i] = m[i * n + j]!; return t; };

/** pHash of an RGBA image as 16 hex characters, as str(imagehash.phash(img)). */
export function phash(rgba: ArrayLike<number>, W: number, H: number): string {
  const gray = new Uint8Array(W * H);
  for (let i = 0; i < W * H; i++) gray[i] = (rgba[i * 4]! * 19595 + rgba[i * 4 + 1]! * 38470 + rgba[i * 4 + 2]! * 7471 + 0x8000) >> 16;
  const n = 32, px = Float64Array.from(resizeGray(gray, W, H, n, n));
  const a = new Float64Array(n * n); dctRows(transpose(px, n), n, a); // along axis 0 (columns)
  const b = new Float64Array(n * n); dctRows(transpose(a, n), n, b); // then along axis 1 (rows)
  const low: number[] = [];
  for (let r = 0; r < 8; r++) for (let c = 0; c < 8; c++) low.push(b[r * n + c]!);
  const sorted = [...low].sort((x, y) => x - y), med = (sorted[31]! + sorted[32]!) / 2;
  let hex = "";
  for (let i = 0; i < 64; i += 4) hex += ((+(low[i]! > med) << 3) | (+(low[i + 1]! > med) << 2) | (+(low[i + 2]! > med) << 1) | +(low[i + 3]! > med)).toString(16);
  return hex;
}
