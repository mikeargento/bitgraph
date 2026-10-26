// Copyright (c) Argento Computing Inc. All rights reserved. See LICENSE.

/**
 * TrustMark (variant Q, BCH_4: 68 data bits), Adobe's open-source watermark, marking and reading in plain
 * TypeScript around ONNX Runtime. Images are RGBA byte arrays; resizing is done here rather than by a canvas, so
 * every browser produces the same pixels.
 *
 * Follows Adobe TrustMark's Python implementation (trustmark.py, encode / subimage_decode):
 *   mark: resize the cover to 256x256 (PIL bilinear), run the encoder with the 100-bit packet, take the residual
 *         (clamped stego minus cover), remove its per-channel mean, upsample it to full size (bilinear,
 *         align_corners=false) and add it to the full-size cover.
 *   read: resize to 245x245 (PIL bilinear), run the decoder, threshold at zero, BCH-decode.
 * The 100-bit packet is data (68) | BCH(4, 137) ECC (28) | version "0010".
 */

const ENC_RES = 256;
const DEC_RES = 245;
const DATA_BITS = 68;
const ECC_BITS = 28;
const VERSION = "0010";
const ASPECT_LIMIT = 2.0;

export interface OrtTensor { data: ArrayLike<number> }
export interface OrtSession { run(feeds: Record<string, unknown>): Promise<Record<string, OrtTensor>> }
export interface Ort {
  Tensor: new (type: "float32", data: Float32Array, dims: number[]) => unknown;
  InferenceSession: { create(model: Uint8Array | string, options?: Record<string, unknown>): Promise<OrtSession> };
  env: { wasm: { wasmPaths?: string } };
}
/** Adobe's BCH library (bch_ecc.js, MIT). */
export interface Bch {
  BCH(t: number, poly: number): unknown;
  BCH_Encode(engine: unknown, data: boolean[]): ArrayLike<number>;
  BCH_Decode(engine: unknown, data: boolean[], ecc: boolean[]): { bitflips: number; valid: boolean; data_binary: string };
}
export interface MarkEnv { ort: Ort; encoder: OrtSession; bch: Bch }
export interface ReadEnv { ort: Ort; decoder: OrtSession; bch: Bch }
export type Reading = { present: false } | { present: true; payload: string; bitflips: number };

/** The 100-bit packet for a 68-bit payload string. */
export function packet(payload: string, bch: Bch): string {
  if (!/^[01]{68}$/.test(payload)) throw new Error("payload must be 68 bits");
  const ecc = bch.BCH_Encode(bch.BCH(4, 137), payload.split("").map((b) => b === "1"));
  const eccBits = Array.from(ecc).map((v) => v.toString(2).padStart(8, "0")).join("").slice(0, ECC_BITS);
  return payload + eccBits + VERSION;
}

// PIL's bilinear resample (ImagingResample): a triangle filter widened by the scale when shrinking, horizontal pass
// then vertical pass, rounded to 8 bits between passes.
function coefficients(inSize: number, outSize: number) {
  const scale = inSize / outSize, filterscale = Math.max(scale, 1), out: Array<{ xmin: number; w: number[] }> = [];
  for (let i = 0; i < outSize; i++) {
    const center = (i + 0.5) * scale;
    const xmin = Math.max(Math.trunc(center - filterscale + 0.5), 0), xmax = Math.min(Math.trunc(center + filterscale + 0.5), inSize);
    const w: number[] = [];
    let total = 0;
    for (let x = xmin; x < xmax; x++) { const t = Math.abs((x - center + 0.5) / filterscale), k = t < 1 ? 1 - t : 0; w.push(k); total += k; }
    out.push({ xmin, w: w.map((k) => (total ? k / total : 0)) });
  }
  return out;
}

/** Resize interleaved RGB bytes (3 per pixel) the way PIL's Image.resize(..., BILINEAR) does. */
export function resizeRGB(src: ArrayLike<number>, W: number, H: number, w: number, h: number): Uint8ClampedArray {
  const cx = coefficients(W, w), cy = coefficients(H, h), tmp = new Uint8ClampedArray(w * H * 3);
  for (let y = 0; y < H; y++) for (let i = 0; i < w; i++) {
    const { xmin, w: k } = cx[i]!;
    let r = 0, g = 0, b = 0;
    for (let j = 0; j < k.length; j++) { const p = (y * W + xmin + j) * 3; r += src[p]! * k[j]!; g += src[p + 1]! * k[j]!; b += src[p + 2]! * k[j]!; }
    const q = (y * w + i) * 3; tmp[q] = Math.round(r); tmp[q + 1] = Math.round(g); tmp[q + 2] = Math.round(b);
  }
  const out = new Uint8ClampedArray(w * h * 3);
  for (let i = 0; i < h; i++) for (let x = 0; x < w; x++) {
    const { xmin, w: k } = cy[i]!;
    let r = 0, g = 0, b = 0;
    for (let j = 0; j < k.length; j++) { const p = ((xmin + j) * w + x) * 3; r += tmp[p]! * k[j]!; g += tmp[p + 1]! * k[j]!; b += tmp[p + 2]! * k[j]!; }
    const q = (i * w + x) * 3; out[q] = Math.round(r); out[q + 1] = Math.round(g); out[q + 2] = Math.round(b);
  }
  return out;
}

function rgbaToRgb(rgba: ArrayLike<number>): Uint8ClampedArray {
  const n = rgba.length / 4, out = new Uint8ClampedArray(n * 3);
  for (let i = 0; i < n; i++) { out[i * 3] = rgba[i * 4]!; out[i * 3 + 1] = rgba[i * 4 + 1]!; out[i * 3 + 2] = rgba[i * 4 + 2]!; }
  return out;
}

/** Interleaved RGB bytes to NCHW float32 in [-1, 1], as transforms.ToTensor() * 2 - 1. */
function toTensorData(rgb: ArrayLike<number>, w: number, h: number): Float32Array {
  const plane = w * h, out = new Float32Array(3 * plane);
  for (let i = 0; i < plane; i++) for (let c = 0; c < 3; c++) out[c * plane + i] = (rgb[i * 3 + c]! / 255) * 2 - 1;
  return out;
}

export const aspectOk = (W: number, H: number) => Math.max(W, H) / Math.min(W, H) <= ASPECT_LIMIT;

/** Mark an image. Returns a new RGBA array of the same size. */
export async function mark(rgba: Uint8ClampedArray, W: number, H: number, payload: string, env: MarkEnv): Promise<Uint8ClampedArray> {
  if (!aspectOk(W, H)) throw new Error("images wider or taller than 2:1 cannot carry the pointer");
  const cover = toTensorData(resizeRGB(rgbaToRgb(rgba), W, H, ENC_RES, ENC_RES), ENC_RES, ENC_RES);
  const secret = Float32Array.from(packet(payload, env.bch).split(""), Number);
  const result = await env.encoder.run({
    cover: new env.ort.Tensor("float32", cover, [1, 3, ENC_RES, ENC_RES]),
    secret: new env.ort.Tensor("float32", secret, [1, 100]),
  });
  const stego = result.stego!.data, plane = ENC_RES * ENC_RES;
  // residual = clamp(stego, -1, 1) - cover, with each channel's mean removed
  const res = new Float32Array(3 * plane);
  for (let c = 0; c < 3; c++) {
    let sum = 0;
    for (let i = 0; i < plane; i++) { const v = Math.min(1, Math.max(-1, stego[c * plane + i]!)) - cover[c * plane + i]!; res[c * plane + i] = v; sum += v; }
    const mean = sum / plane;
    for (let i = 0; i < plane; i++) res[c * plane + i]! -= mean;
  }
  // upsample the residual to W x H (torch bilinear, align_corners=false) and add it to the full-size cover
  const out = new Uint8ClampedArray(rgba.length), sx = ENC_RES / W, sy = ENC_RES / H;
  for (let y = 0; y < H; y++) {
    const fy = Math.max((y + 0.5) * sy - 0.5, 0), y0 = Math.floor(fy), y1 = Math.min(y0 + 1, ENC_RES - 1), ly = fy - y0;
    for (let x = 0; x < W; x++) {
      const fx = Math.max((x + 0.5) * sx - 0.5, 0), x0 = Math.floor(fx), x1 = Math.min(x0 + 1, ENC_RES - 1), lx = fx - x0;
      const p = (y * W + x) * 4;
      for (let c = 0; c < 3; c++) {
        const base = c * plane;
        const r = (1 - ly) * ((1 - lx) * res[base + y0 * ENC_RES + x0]! + lx * res[base + y0 * ENC_RES + x1]!)
                + ly * ((1 - lx) * res[base + y1 * ENC_RES + x0]! + lx * res[base + y1 * ENC_RES + x1]!);
        const v = Math.min(1, Math.max(-1, r + rgba[p + c]! / 127.5 - 1));
        out[p + c] = Math.trunc(v * 127.5 + 127.5);
      }
      out[p + 3] = rgba[p + 3]!;
    }
  }
  return out;
}

/** Read a mark. */
export async function read(rgba: Uint8ClampedArray, W: number, H: number, env: ReadEnv): Promise<Reading> {
  if (!aspectOk(W, H)) return { present: false };
  const img = toTensorData(resizeRGB(rgbaToRgb(rgba), W, H, DEC_RES, DEC_RES), DEC_RES, DEC_RES);
  const result = await env.decoder.run({ image: new env.ort.Tensor("float32", img, [1, 3, DEC_RES, DEC_RES]) });
  const bits = Array.from(result.logits!.data, (v) => v > 0);
  if (bits.slice(-2).map((b) => (b ? "1" : "0")).join("") !== VERSION.slice(-2)) return { present: false };
  const r = env.bch.BCH_Decode(env.bch.BCH(4, 137), bits.slice(0, DATA_BITS), bits.slice(DATA_BITS, DATA_BITS + ECC_BITS));
  return r.valid ? { present: true, payload: r.data_binary.slice(0, DATA_BITS), bitflips: r.bitflips } : { present: false };
}
