// bitgraph-art/1 (Mike, 2026-10-05): the commitment is the only input, the pixels are the
// same everywhere, the strip spells the commitment, and a changed file or a different
// commitment is caught.
import { test } from "node:test";
import * as assert from "node:assert/strict";
import { sha256 } from "@noble/hashes/sha256";
import {
  ART_HEIGHT, ART_WIDTH, decodeArtV3, artSize, artRecipe, recipeJson, renderArt, decodeStrip, makeArt, decodePng, checkArt, toHex, toBase64Url,
} from "../commitment-art.ts";

const C1 = sha256(new TextEncoder().encode("bitgraph-art test commitment one"));
const C2 = sha256(new TextEncoder().encode("bitgraph-art test commitment two"));

test("the same commitment gives the same recipe and the same pixels, every time", () => {
  const a = renderArt(artRecipe(C1));
  const b = renderArt(artRecipe(C1));
  const size = artSize(artRecipe(C1).algorithm);
  assert.equal(a.length, size.width * size.height * 4);
  assert.equal(toHex(sha256(a)), toHex(sha256(b)));
  assert.equal(recipeJson(artRecipe(C1)), recipeJson(artRecipe(C1)));
});

test("version 1 is pinned: this commitment's recipe and pixels never change", () => {
  const r = artRecipe(C1, "bitgraph-art/1");
  // Pinned on first run (2026-10-05). A failure here means bitgraph-art/1 changed: make /2 instead.
  assert.equal(toHex(sha256(new TextEncoder().encode(recipeJson(r)))), PINNED_RECIPE);
  assert.equal(toHex(sha256(renderArt(r))), PINNED_PIXELS);
});

test("a different commitment gives different art", () => {
  assert.notEqual(toHex(sha256(renderArt(artRecipe(C1)))), toHex(sha256(renderArt(artRecipe(C2)))));
});

test("the strip (versions 1 and 2) decodes to the full commitment, every bit", () => {
  for (const c of [C1, C2, new Uint8Array(32), new Uint8Array(32).fill(255)]) {
    const px = renderArt(artRecipe(c, "bitgraph-art/2"));
    assert.deepEqual(decodeStrip(px, ART_WIDTH, ART_HEIGHT), c);
  }
});

test("only 32-byte commitments are accepted", () => {
  assert.throws(() => artRecipe(new Uint8Array(31)));
  assert.throws(() => artRecipe(new Uint8Array(33)));
});

test("the PNG round-trips to the canonical pixels and carries the commitment as base64url text", async () => {
  const art = await makeArt(C1);
  const d = await decodePng(art.png);
  assert.equal(d.width, art.manifest.width);
  assert.equal(d.height, art.manifest.height);
  assert.equal(toHex(sha256(d.rgba)), toHex(sha256(art.pixels)));
  const text = new TextDecoder("latin1").decode(art.png);
  assert.ok(text.includes(toBase64Url(C1)), "the base64url commitment is in the bytes, where findCommitment looks");
  assert.equal(JSON.parse(d.texts["bitgraph-art"]!).pixelsSha256, toHex(sha256(art.pixels)));
});

test("a genuine image passes both image checks against its commitment", async () => {
  const art = await makeArt(C1);
  const r = await checkArt(art.png, C1);
  assert.equal(r.regenerated.result, "TRUE");
  assert.equal(r.strip.result, "TRUE");
});

test("checked against a different (authenticated) commitment, both checks fail", async () => {
  const art = await makeArt(C1);
  const r = await checkArt(art.png, C2);
  assert.equal(r.regenerated.result, "FALSE");
  assert.equal(r.strip.result, "FALSE");
});

test("a manifest that claims another commitment does not change the result", async () => {
  // The checks use the commitment the proof authenticates, never the file's own claim.
  const art = await makeArt(C1);
  const forged = new TextEncoder().encode(new TextDecoder("latin1").decode(art.png).replace(toBase64Url(C1), toBase64Url(C2)));
  const r = await checkArt(forged, C2);
  assert.notEqual(r.regenerated.result, "TRUE");
});

test("one changed pixel is caught; a corrupted byte is caught", async () => {
  const art = await makeArt(C1);
  const d = await decodePng(art.png);
  const px = d.rgba.slice();
  const i = (500 * ART_WIDTH + 500) * 4;
  px[i] = px[i]! ^ 1;
  const { encodeArtPng, artManifest } = await import("../commitment-art.ts");
  const altered = await encodeArtPng(px, artManifest(artRecipe(C1), px));
  const r = await checkArt(altered, C1);
  assert.equal(r.regenerated.result, "FALSE");
  assert.match(r.regenerated.detail, /\(500, 500\)/);

  const broken = art.png.slice();
  broken[broken.length - 20] = broken[broken.length - 20]! ^ 0xff; // inside IDAT or its CRC
  const r2 = await checkArt(broken, C1);
  assert.equal(r2.regenerated.result, "FALSE");
});

test("bytes after IEND (a carrier's proof block) do not change the pixels read", async () => {
  const art = await makeArt(C1);
  const withTail = new Uint8Array(art.png.length + 40);
  withTail.set(art.png, 0);
  withTail.fill(7, art.png.length);
  const r = await checkArt(withTail, C1);
  assert.equal(r.regenerated.result, "TRUE");
});

test("version 2 is pinned too, and differs from version 1 for the same commitment", () => {
  const r = artRecipe(C1, "bitgraph-art/2");
  // Pinned on first run (2026-10-06). A failure here means bitgraph-art/2 changed: make /3 instead.
  assert.equal(toHex(sha256(new TextEncoder().encode(recipeJson(r)))), PINNED_RECIPE_V2);
  assert.equal(toHex(sha256(renderArt(r))), PINNED_PIXELS_V2);
  assert.notEqual(toHex(sha256(renderArt(r))), PINNED_PIXELS);
});

test("version 2 smooths edges: some pixels are blends of two palette colours", () => {
  const v1 = renderArt(artRecipe(C1, "bitgraph-art/1"));
  const v2 = renderArt(artRecipe(C1, "bitgraph-art/2"));
  const colours = (px: Uint8Array) => { const s = new Set<number>(); for (let i = 0; i < px.length; i += 4) s.add((px[i]! << 16) | (px[i + 1]! << 8) | px[i + 2]!); return s.size; };
  assert.ok(colours(v1) <= 7, "version 1 uses only palette colours and the strip");
  assert.ok(colours(v2) > 20, "version 2 has blended edge pixels");
});

test("an image made with version 1 still verifies, and is not mistaken for version 2", async () => {
  const art = await makeArt(C1, "bitgraph-art/1");
  const r = await checkArt(art.png, C1);
  assert.equal(r.regenerated.result, "TRUE");
  assert.match(r.regenerated.detail, /bitgraph-art\/1/);
});

test("a version 2 file is a pure function of its commitment: same bytes every time, pinned, standard zlib", async () => {
  const a = await makeArt(C1, "bitgraph-art/2");
  const b = await makeArt(C1, "bitgraph-art/2");
  assert.equal(toHex(sha256(a.png)), toHex(sha256(b.png)));
  // Pinned on first run (2026-10-06). A failure here means the version 2 file changed: make /3 instead.
  assert.equal(toHex(sha256(a.png)), "1ec1f49a5e040df293c2103774b8e10a7dd8c75cfbfd5b98a0b1ab6cb59f138b");
  // Any standard inflate reads it: node's zlib, not this module's decoder.
  const { inflateSync } = await import("node:zlib");
  const d = await decodePng(a.png);
  assert.equal(toHex(sha256(d.rgba)), toHex(sha256(a.pixels)));
  let at = 8, idat: Uint8Array[] = [];
  for (;;) { const len = new DataView(a.png.buffer, a.png.byteOffset + at).getUint32(0); const type = new TextDecoder().decode(a.png.subarray(at + 4, at + 8)); if (type === "IDAT") idat.push(a.png.subarray(at + 8, at + 8 + len)); if (type === "IEND") break; at += 12 + len; }
  const raw = inflateSync(Buffer.concat(idat.map((x) => Buffer.from(x))));
  assert.equal(raw.length, ART_HEIGHT * (1 + ART_WIDTH * 3));
});

// ── Version 3: the art spells the commitment ──────────────────────────────────────────
test("version 3: the code reads back from the art alone, for many commitments", () => {
  for (let k = 0; k < 12; k++) {
    const c = sha256(new TextEncoder().encode(`bitgraph-art/3 readback ${k}`));
    const px = renderArt(artRecipe(c, "bitgraph-art/3"));
    const { width, height } = artSize("bitgraph-art/3");
    assert.equal(px.length, width * height * 4);
    assert.deepEqual(decodeArtV3(px, width, height), c);
  }
  for (const c of [new Uint8Array(32), new Uint8Array(32).fill(255)]) {
    assert.deepEqual(decodeArtV3(renderArt(artRecipe(c, "bitgraph-art/3")), 1024, 1024), c);
  }
});

test("version 3: one changed bit anywhere gives a different picture", () => {
  const c = sha256(new TextEncoder().encode("bitgraph-art/3 flip"));
  const base = toHex(sha256(renderArt(artRecipe(c, "bitgraph-art/3"))));
  for (const bit of [0, 6, 7, 100, 251, 252, 254, 255]) {
    const d = c.slice();
    d[bit >> 3] = d[bit >> 3]! ^ (1 << (7 - (bit & 7)));
    assert.notEqual(toHex(sha256(renderArt(artRecipe(d, "bitgraph-art/3")))), base, `bit ${bit}`);
  }
});

test("version 3: all 128 cell looks are distinct in every palette, and every frame names its palette", () => {
  // Spell every code 0..127 in every palette and read it back: a look equal to another would read
  // back as the other, so a clean round trip for all of them is the distinctness proof.
  const setBit = (c: Uint8Array, i: number, v: number) => { if (v) c[i >> 3] = c[i >> 3]! | (1 << (7 - (i & 7))); };
  for (let palette = 0; palette < 8; palette++) {
    for (let chunk = 0; chunk < 4; chunk++) {
      const c = new Uint8Array(32);
      for (let k = 0; k < 36; k++) { const code = (chunk * 36 + k) % 128; for (let b = 0; b < 7; b++) setBit(c, 7 * k + b, (code >> (6 - b)) & 1); }
      setBit(c, 252, (palette >> 2) & 1); setBit(c, 253, (palette >> 1) & 1); setBit(c, 254, palette & 1); setBit(c, 255, chunk & 1);
      assert.deepEqual(decodeArtV3(renderArt(artRecipe(c, "bitgraph-art/3")), 1024, 1024), c, `palette ${palette}, chunk ${chunk}`);
    }
  }
});

test("version 3 is pinned, and its file is a pure function of the commitment", async () => {
  const a = await makeArt(C1, "bitgraph-art/3");
  const b = await makeArt(C1, "bitgraph-art/3");
  assert.equal(toHex(sha256(a.png)), toHex(sha256(b.png)));
  assert.equal(toHex(sha256(a.pixels)), PINNED_PIXELS_V3);
  const r = await checkArt(a.png, C1);
  assert.equal(r.regenerated.result, "TRUE");
  assert.equal(r.strip.result, "TRUE");
  assert.match(r.strip.detail, /the art reads/);
});

const PINNED_PIXELS_V3 = "f3eb607003d241f8fa6608c2616a5d0ebf0e5b4cb5c3f0ebd66ec3ef25919dc6";
const PINNED_RECIPE_V2 = "bed07f7098cb5820302060c4716bbdb9e142513e1095dfa73cae3f98c4576b31";
const PINNED_PIXELS_V2 = "529f41e977edf3f34ec839f10c0b60bc310b747c707bff9979ef3feed795366f";
const PINNED_RECIPE = "57ba907bc7a76ea0412c3e98f644605c984ca135e7497c1724fc5ae5382d1f2e";
const PINNED_PIXELS = "ee0c7ece9c8a74f1957b9bb975db3b61f09f296c77a8361bd6218eeabf6da0e3";
