// Copyright (c) Argento Computing Inc. All rights reserved. See LICENSE.

import { test } from "node:test";
import assert from "node:assert/strict";
import { epochRef, pack, tag, unpack, phash, MAX_COUNTER } from "../trustmark/payload.ts";
import { align, signature, MATCH, GRID } from "../trustmark/align.ts";
import { parseRecord, looksLikePhoto, RECORD_FORMAT } from "../trustmark/record.ts";

// A real BitGraph's commit (position #18), and the pointer the reference implementation computes for its photo.
const EPOCH = "Dh0UvjQzP/ty1XU/Q/guOwdyORz+DbQLoRKjrla5gl8=";
const NONCE = "31UUc47YDdblMgMj3tHSBCJTNX9jo4BH4F22BcmGUvo=";
const PHASH = "e3e02edb649c62a5";

test("the pointer matches the reference implementation", async () => {
  const eref = await epochRef(EPOCH);
  assert.equal(eref, 47871);
  const t = await tag(NONCE, PHASH, eref, 18);
  assert.equal(t, 135922013);
  assert.equal(pack(eref, 18, t), "10111010111111110000000000000000000100101000000110100000000101011101");
  assert.deepEqual(unpack(pack(eref, 18, t)), { eref, counter: 18, tag: t });
});

test("the tag changes with the nonce, the fingerprint and the position", async () => {
  const eref = await epochRef(EPOCH), t = await tag(NONCE, PHASH, eref, 18);
  assert.notEqual(await tag("AAAAc47YDdblMgMj3tHSBCJTNX9jo4BH4F22BcmGUvo=", PHASH, eref, 18), t);
  assert.notEqual(await tag(NONCE, "e3e02edb649c62a4", eref, 18), t);
  assert.notEqual(await tag(NONCE, PHASH, eref, 19), t);
  assert.equal(pack(eref, MAX_COUNTER, 0).length, 68);
});

// a smooth, varied picture, with a crop and an unrelated one
function picture(w: number, h: number, seed: number): Uint8ClampedArray {
  const px = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const v = 128 + 60 * Math.sin((x / w) * 6.3 * (1 + seed) + seed) * Math.cos((y / h) * 4.1 * (2 - seed / 3)) + 40 * Math.sin(((x + 2 * y) / w) * 9 + seed * 2);
    const p = (y * w + x) * 4; px[p] = v; px[p + 1] = v * 0.9; px[p + 2] = 255 - v; px[p + 3] = 255;
  }
  return px;
}
function cropOf(px: Uint8ClampedArray, W: number, x: number, y: number, w: number, h: number) {
  const out = new Uint8ClampedArray(w * h * 4);
  for (let r = 0; r < h; r++) out.set(px.subarray(((y + r) * W + x) * 4, ((y + r) * W + x + w) * 4), r * w * 4);
  return out;
}

test("a cropped copy aligns to its original's signature, another picture does not", () => {
  const W = 480, H = 320, a = picture(W, H, 1), b = picture(W, H, 4);
  const sig = signature(a, W, H);
  assert.equal(sig.length, GRID * GRID);
  const whole = align(a, W, H, sig);
  assert.ok(whole.score > 0.99, `whole ${whole.score}`);
  const c = align(cropOf(a, W, 48, 32, 384, 256), 384, 256, sig);
  assert.ok(c.score >= MATCH, `crop ${c.score}`);
  assert.ok(Math.abs(c.window[0] - 0.1) < 0.03 && Math.abs(c.window[2] - 0.1) < 0.03, `window ${c.window}`);
  assert.ok(align(b, W, H, sig).score < MATCH, "another picture must not match");
});

test("fingerprint records are read strictly", () => {
  const enc = (o: unknown) => new TextEncoder().encode(JSON.stringify(o));
  const px = picture(64, 64, 2);
  const good = { format: RECORD_FORMAT, photo: "x".repeat(44), phash: phash(px, 64, 64), blocks: { grid: GRID, bits: 4, values: signature(px, 64, 64) } };
  assert.ok(parseRecord(enc(good)));
  assert.equal(parseRecord(enc({ ...good, format: "other" })), null);
  assert.equal(parseRecord(enc({ ...good, phash: "zz" })), null);
  assert.equal(parseRecord(enc({ ...good, blocks: { ...good.blocks, grid: 16 } })), null);
  assert.equal(parseRecord(new TextEncoder().encode("not json")), null);
  assert.ok(looksLikePhoto({ name: "IMG_0001.HEIC" }) && looksLikePhoto({ name: "a.jpg" }) && !looksLikePhoto({ name: "a.gif" }) && !looksLikePhoto({ name: "a.pdf" }));
});

test("graphics are told from photographs", async () => {
  const { isPhotographic } = await import("../trustmark/record.ts");
  const w = 200, h = 150;
  const flatArt = new Uint8ClampedArray(w * h * 4).map((_, i) => (i % 4 === 3 ? 255 : (Math.floor(i / 4 / w) < 75 ? 30 : 220)));
  assert.equal(isPhotographic({ rgba: flatArt, w, h }), false);
  let seed = 7;
  const noisy = new Uint8ClampedArray(w * h * 4).map((_, i) => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return i % 4 === 3 ? 255 : 100 + (seed % 40); });
  assert.equal(isPhotographic({ rgba: noisy, w, h }), true);
});
