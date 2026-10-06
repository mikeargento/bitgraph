// bitgraph-art/1 (Mike, 2026-10-05): the commitment is the only input, the pixels are the
// same everywhere, the strip spells the commitment, and a changed file or a different
// commitment is caught.
import { test } from "node:test";
import * as assert from "node:assert/strict";
import { sha256 } from "@noble/hashes/sha256";
import {
  ART_HEIGHT, ART_WIDTH, artRecipe, recipeJson, renderArt, decodeStrip, makeArt, decodePng, checkArt, toHex, toBase64Url,
} from "../commitment-art.ts";

const C1 = sha256(new TextEncoder().encode("bitgraph-art test commitment one"));
const C2 = sha256(new TextEncoder().encode("bitgraph-art test commitment two"));

test("the same commitment gives the same recipe and the same pixels, every time", () => {
  const a = renderArt(artRecipe(C1));
  const b = renderArt(artRecipe(C1));
  assert.equal(a.length, ART_WIDTH * ART_HEIGHT * 4);
  assert.equal(toHex(sha256(a)), toHex(sha256(b)));
  assert.equal(recipeJson(artRecipe(C1)), recipeJson(artRecipe(C1)));
});

test("version 1 is pinned: this commitment's recipe and pixels never change", () => {
  const r = artRecipe(C1);
  // Pinned on first run (2026-10-05). A failure here means bitgraph-art/1 changed: make /2 instead.
  assert.equal(toHex(sha256(new TextEncoder().encode(recipeJson(r)))), PINNED_RECIPE);
  assert.equal(toHex(sha256(renderArt(r))), PINNED_PIXELS);
});

test("a different commitment gives different art", () => {
  assert.notEqual(toHex(sha256(renderArt(artRecipe(C1)))), toHex(sha256(renderArt(artRecipe(C2)))));
});

test("the strip decodes to the full commitment, every bit", () => {
  for (const c of [C1, C2, new Uint8Array(32), new Uint8Array(32).fill(255)]) {
    const px = renderArt(artRecipe(c));
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
  assert.equal(d.width, ART_WIDTH);
  assert.equal(d.height, ART_HEIGHT);
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

const PINNED_RECIPE = "57ba907bc7a76ea0412c3e98f644605c984ca135e7497c1724fc5ae5382d1f2e";
const PINNED_PIXELS = "ee0c7ece9c8a74f1957b9bb975db3b61f09f296c77a8361bd6218eeabf6da0e3";
