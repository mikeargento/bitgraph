// Copyright (c) Argento Computing Inc. All rights reserved. See LICENSE.

/**
 * Pixel Seal, Meta's open-source image watermark (videoseal, MIT), marking and reading in plain TypeScript around ONNX
 * Runtime. It carries the same 68-bit pointer as TrustMark (payload.ts) and is far fainter: it hides in texture and
 * edges, scaled by a model of what the eye can see (JND), and leaves smooth skies and skin almost untouched.
 *
 * Follows videoseal's Python implementation (Videoseal.embed / detect, JND attenuation "jnd_1_1"):
 *   mark: resize to 256x256 (bilinear, antialiased), run the embedder on the luma (Y) with the 256-bit message,
 *         upsample the pattern to full size (bilinear, align_corners=false), multiply it by the JND heatmap of the
 *         full-size photo and add 0.2 of it to every channel.
 *   read: resize to 256x256, run the extractor, threshold its 256 bit logits at zero.
 *
 * The 256-bit message is (version 4 | payload 68 | BCH(22, 285) ECC 176 | spare 8), XORed with a fixed mask so that
 * no pointer is all zeros or all ones. Up to 22 wrong bits are corrected; in 20,000 random words none decoded.
 */

import { resizeRGB, type Bch, type Ort, type OrtSession } from "./tm.ts";

const RES = 256;
const SCALE = 0.2;
const VERSION = "0001";
const DATA_BITS = 72; // version + payload
const ECC_T = 22, ECC_POLY = 285, ECC_BITS = 8 * ECC_T;
const MASK = "8eed3d9b5bef3913023708974876b3d29ead33f4de9eaf67b73cd93e8016b466";
const MASK_BITS = Array.from(MASK, (h) => parseInt(h, 16).toString(2).padStart(4, "0")).join("");

export interface PsMarkEnv { ort: Ort; embedder: OrtSession; bch: Bch }
export interface PsReadEnv { ort: Ort; extractor: OrtSession; bch: Bch }
export type PsReading = { present: false } | { present: true; payload: string; bitflips: number };

const masked = (bits: string) => Array.from(bits, (b, i) => (b === MASK_BITS[i] ? "0" : "1")).join("");

/** The 256-bit message for a 68-bit payload string. */
export function message(payload: string, bch: Bch): string {
  if (!/^[01]{68}$/.test(payload)) throw new Error("payload must be 68 bits");
  const data = VERSION + payload;
  const ecc = bch.BCH_Encode(bch.BCH(ECC_T, ECC_POLY), data.split("").map((b) => b === "1"));
  const eccBits = Array.from(ecc).map((v) => v.toString(2).padStart(8, "0")).join("").slice(0, ECC_BITS);
  return masked((data + eccBits).padEnd(RES, "0"));
}

/** The payload in 256 read bits, or null. */
export function decodeMessage(bits: string, bch: Bch): { payload: string; bitflips: number } | null {
  const w = Array.from(masked(bits), (b) => b === "1");
  const r = bch.BCH_Decode(bch.BCH(ECC_T, ECC_POLY), w.slice(0, DATA_BITS), w.slice(DATA_BITS, DATA_BITS + ECC_BITS));
  if (!r.valid) return null;
  const data = r.data_binary.slice(0, DATA_BITS);
  return data.startsWith(VERSION) ? { payload: data.slice(VERSION.length), bitflips: r.bitflips } : null;
}

function rgbOf(rgba: ArrayLike<number>): Uint8ClampedArray {
  const n = rgba.length / 4, out = new Uint8ClampedArray(n * 3);
  for (let i = 0; i < n; i++) { out[i * 3] = rgba[i * 4]!; out[i * 3 + 1] = rgba[i * 4 + 1]!; out[i * 3 + 2] = rgba[i * 4 + 2]!; }
  return out;
}

/** The luma of interleaved pixels (3 or 4 bytes each) on the 0-255 scale, as videoseal's RGB-to-YUV first row. */
function luma(px: ArrayLike<number>, n: number, stride: number): Float32Array {
  const y = new Float32Array(n);
  for (let i = 0; i < n; i++) y[i] = 0.299 * px[i * stride]! + 0.587 * px[i * stride + 1]! + 0.114 * px[i * stride + 2]!;
  return y;
}

/**
 * The JND heatmap ("jnd_1_1"): how much each pixel can change unseen, from luminance adaptation (a 5x5 weighted mean
 * of the luma) and contrast masking (Sobel gradient magnitude), both zero-padded, on the 0-1 scale.
 */
export function jnd(L: Float32Array, W: number, H: number): Float32Array {
  const at = (x: number, y: number) => (x < 0 || y < 0 || x >= W || y >= H ? 0 : L[y * W + x]!);
  const out = new Float32Array(W * H);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    // [[1,1,1,1,1],[1,2,2,2,1],[1,2,0,2,1],[1,2,2,2,1],[1,1,1,1,1]] / 32
    let s = 0;
    for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) {
      if (dx === 0 && dy === 0) continue;
      s += (Math.abs(dx) === 2 || Math.abs(dy) === 2 ? 1 : 2) * at(x + dx, y + dy);
    }
    let la = s / 32;
    la = la <= 127 ? 17 * (1 - Math.sqrt(la / 127 + 1e-5)) : (3 / 128) * (la - 127) + 3;
    const tl = at(x - 1, y - 1), t = at(x, y - 1), tr = at(x + 1, y - 1), l = at(x - 1, y), r = at(x + 1, y), bl = at(x - 1, y + 1), b = at(x, y + 1), br = at(x + 1, y + 1);
    const gx = -tl + tr - 2 * l + 2 * r - bl + br, gy = tl + 2 * t + tr - bl - 2 * b - br;
    let cm = Math.sqrt(gx * gx + gy * gy);
    cm = 0.117 * ((16 * cm ** 2.4) / (cm * cm + 26 * 26));
    out[y * W + x] = Math.max(la + cm - 0.3 * Math.min(la, cm), 0) / 255;
  }
  return out;
}

/** Mark an image. Returns a new RGBA array of the same size. */
export async function mark(rgba: Uint8ClampedArray, W: number, H: number, payload: string, env: PsMarkEnv): Promise<Uint8ClampedArray> {
  const small = resizeRGB(rgbOf(rgba), W, H, RES, RES), y = luma(small, RES * RES, 3);
  for (let i = 0; i < y.length; i++) y[i]! /= 255;
  const msg = Float32Array.from(message(payload, env.bch), Number);
  const result = await env.embedder.run({
    y: new env.ort.Tensor("float32", y, [1, 1, RES, RES]),
    msg: new env.ort.Tensor("float32", msg, [1, RES]),
  });
  const pat = result.pattern!.data;
  const hmap = jnd(luma(rgba, W * H, 4), W, H);
  const out = new Uint8ClampedArray(rgba.length), sx = RES / W, sy = RES / H;
  for (let yy = 0; yy < H; yy++) {
    const fy = Math.max((yy + 0.5) * sy - 0.5, 0), y0 = Math.floor(fy), y1 = Math.min(y0 + 1, RES - 1), ly = fy - y0;
    for (let x = 0; x < W; x++) {
      const fx = Math.max((x + 0.5) * sx - 0.5, 0), x0 = Math.floor(fx), x1 = Math.min(x0 + 1, RES - 1), lx = fx - x0;
      const up = (1 - ly) * ((1 - lx) * pat[y0 * RES + x0]! + lx * pat[y0 * RES + x1]!) + ly * ((1 - lx) * pat[y1 * RES + x0]! + lx * pat[y1 * RES + x1]!);
      const d = 255 * SCALE * hmap[yy * W + x]! * up, p = (yy * W + x) * 4;
      out[p] = Math.round(rgba[p]! + d); out[p + 1] = Math.round(rgba[p + 1]! + d); out[p + 2] = Math.round(rgba[p + 2]! + d);
      out[p + 3] = rgba[p + 3]!;
    }
  }
  return out;
}

/** Read a mark. */
export async function read(rgba: Uint8ClampedArray, W: number, H: number, env: PsReadEnv): Promise<PsReading> {
  const small = resizeRGB(rgbOf(rgba), W, H, RES, RES), plane = RES * RES, img = new Float32Array(3 * plane);
  for (let i = 0; i < plane; i++) for (let c = 0; c < 3; c++) img[c * plane + i] = small[i * 3 + c]! / 255;
  const result = await env.extractor.run({ image: new env.ort.Tensor("float32", img, [1, 3, RES, RES]) });
  const logits = result.logits!.data;
  let bits = "";
  for (let i = 1; i <= RES; i++) bits += logits[i]! > 0 ? "1" : "0";
  const r = decodeMessage(bits, env.bch);
  return r ? { present: true, ...r } : { present: false };
}
