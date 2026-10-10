// bitgraph-art/16 (2026-10-09), "Three": one flat ground in one of four colours, exactly three flat squares or rectangles
// in the other three, never touching. The recorded file is a PNG that carries the canonical print SVG byte for byte; both are pure
// functions of the commitment and both carry it. Pinned, property-checked over 500 codes, the PNG's pixels are the SVG's
// rectangles, the image checks pass and fail as they should, and the proof page rebuilds both files from the proof alone.
import { test } from "node:test";
import * as assert from "node:assert/strict";
import { sha256 } from "@noble/hashes/sha256";
import { bytesToBase64, verifyFuse } from "@mikeargento/bitgraph-verify";
import { ART_ALGORITHM, ART_ALGORITHM_V15, ART_ALGORITHMS, artSize, checkArt, decodePng, makeArt, manifestJson, toBase64Url, toHex } from "../commitment-art.ts";
import {
  ART_ALGORITHM_V16, COLOURS_V16, V16_COPYRIGHT, V16_SIZE, describeV16, planV16, readCommitmentV16, renderV16, svgFromPngV16, svgTextV16, svgV16, touchingV16,
} from "../commitment-art-v16.ts";
import { createArtImage, redrawRecordedArt, restoreArtImage } from "../art-position.ts";
import { makeStub } from "./tree1-helpers.ts";

const code = (s: string) => sha256(new TextEncoder().encode(s));
const C1 = code("bitgraph-art test commitment one");
const utf8 = (b: Uint8Array) => new TextDecoder("utf-8", { fatal: true }).decode(b);

// Pinned on first run (2026-10-09). A failure here means bitgraph-art/16 changed: make /17 instead.
const PINNED_SVG_V16 = "e322b1a099dccf4f07cdd836c7d92d7c8ae808446c62c828dbb04f971ff76752";
const PINNED_PNG_V16 = "6149eda29355c2d07f4b67d0821094884a976cb271e46a078faf0ed6c13f9185";

test("version 16 is pinned: this commitment's SVG and recorded PNG never change, and both image checks pass", async () => {
  const a = await makeArt(C1, ART_ALGORITHM_V16), b = await makeArt(C1, ART_ALGORITHM_V16);
  const svg = svgV16(C1);
  assert.equal(toHex(sha256(svg)), toHex(sha256(svgV16(C1))));
  assert.equal(toHex(sha256(a.png)), toHex(sha256(b.png)));
  assert.equal(toHex(sha256(svg)), PINNED_SVG_V16);
  assert.equal(toHex(sha256(a.png)), PINNED_PNG_V16);
  // the PNG carries the SVG byte for byte
  assert.deepEqual(svgFromPngV16(a.png), svg);
  assert.deepEqual(artSize(ART_ALGORITHM_V16), { width: 1800, height: 1800 });
  const r = await checkArt(a.png, C1);
  assert.equal(r.regenerated.result, "TRUE");
  assert.equal(r.strip.result, "TRUE");
  assert.match(r.strip.detail, /print SVG inside the file is the one drawn from the authenticated commitment/);
  const wrong = await checkArt(a.png, code("another code"));
  assert.equal(wrong.regenerated.result, "FALSE");
  assert.equal(wrong.strip.result, "FALSE");
});

test("version 16 is registered and is not the default: /painting still paints version 15", () => {
  assert.equal(ART_ALGORITHM_V16, "bitgraph-art/16");
  assert.ok(ART_ALGORITHMS.includes(ART_ALGORITHM_V16));
  assert.equal(ART_ALGORITHM, ART_ALGORITHM_V15);
});

test("the colours are exactly red #C8442C, yellow #E4A930, blue #244E7A and green #6B8E4E", () => {
  assert.deepEqual(COLOURS_V16.map((p) => [p.name, p.hex, [...p.rgb]]), [
    ["red", "#C8442C", [200, 68, 44]],
    ["yellow", "#E4A930", [228, 169, 48]],
    ["blue", "#244E7A", [36, 78, 122]],
    ["green", "#6B8E4E", [107, 142, 78]],
  ]);
  for (const p of COLOURS_V16) assert.equal(p.hex, "#" + p.rgb.map((v) => v.toString(16).toUpperCase().padStart(2, "0")).join(""));
});

/** The rectangles of a canonical SVG, read back from its text: [x, y, w, h, fill]. */
function rectsOf(svg: string): Array<[number, number, number, number, string]> {
  return [...svg.matchAll(/<rect x="(\d+)" y="(\d+)" width="(\d+)" height="(\d+)" fill="(#[0-9A-F]{6})"\/>/g)].map((m) => [Number(m[1]), Number(m[2]), Number(m[3]), Number(m[4]), m[5]!]);
}

test("500 codes: exactly three objects, inside the canvas, never touching with the planned gap, the four colours only, canonical bytes", () => {
  const cs = [new Uint8Array(32), new Uint8Array(32).fill(255), C1];
  for (let k = 0; cs.length < 500; k++) cs.push(code(`bitgraph-art/16 property ${k}`));
  const hexes = new Set(COLOURS_V16.map((p) => p.hex));
  let squares = 0, objects = 0;
  const grounds = new Set<number>(), gaps = new Set<number>(), objectColours = new Set<number>();
  const shared = { yes: 0 };
  cs.forEach((c, i) => {
    const plan = planV16(c);
    const svg = svgTextV16(plan, c);
    // byte-identical on a second render, and the plan holds integers only
    assert.equal(svg, utf8(svgV16(c)), `code ${i}: a second render is byte-identical`);
    assert.equal(JSON.stringify(plan), JSON.stringify(planV16(c)));
    const nums: number[] = [plan.background, plan.gap, plan.attempts, ...plan.objects.flatMap((o) => [o.x, o.y, o.w, o.h, o.colour])];
    assert.ok(nums.every(Number.isInteger), `code ${i}: integers only`);
    // canonical text: no floats, no CR, no tabs, LF line ends with a final LF, ASCII except the copyright sign
    assert.ok(!/\d\.\d/.test(svg.slice(svg.indexOf("\n"))) && !svg.includes("\r") && !svg.includes("\t") && svg.endsWith("</svg>\n"), `code ${i}: canonical text`);
    assert.equal(svg.split("\n").length, 11, `code ${i}: one element a line`);
    assert.ok(svg.includes(`<desc>${V16_COPYRIGHT}</desc>`) && svg.includes(`<metadata>bitgraph-art/16 commitment ${toBase64Url(c)}</metadata>`));
    // the commitment is in the bytes as base64url text, and reads back
    assert.deepEqual(readCommitmentV16(new TextEncoder().encode(svg)), c);
    const rects = rectsOf(svg);
    assert.equal(rects.length, 4, `code ${i}: the ground and exactly three objects`);
    assert.deepEqual(rects[0]!.slice(0, 4), [0, 0, V16_SIZE, V16_SIZE]);
    assert.equal(plan.objects.length, 3);
    grounds.add(plan.background); gaps.add(plan.gap);
    assert.ok(plan.gap >= 12 && plan.gap <= 151, `code ${i}: gap ${plan.gap}`);
    for (const [x, y, w, h, fill] of rects) {
      assert.ok(hexes.has(fill), `code ${i}: ${fill} is one of the four`);
      assert.ok(x >= 0 && y >= 0 && w > 0 && h > 0 && x + w <= V16_SIZE && y + h <= V16_SIZE, `code ${i}: inside the canvas`);
    }
    const ground = rects[0]![4];
    plan.objects.forEach((o, k) => {
      objects++;
      const [x, y, w, h, fill] = rects[k + 1]!;
      assert.deepEqual([x, y, w, h, fill], [o.x, o.y, o.w, o.h, COLOURS_V16[o.colour]!.hex], `code ${i}: the SVG draws the plan`);
      assert.notEqual(fill, ground, `code ${i}: object ${k} is never the ground's colour`);
      assert.notEqual(o.colour, plan.background);
      objectColours.add(o.colour);
      if (o.kind === "square") { squares++; assert.equal(o.w, o.h); assert.ok(o.w >= 90 && o.w <= 849); }
      else { assert.ok(Math.abs(o.w - o.h) >= 40, `code ${i}: a rectangle is never nearly square`); assert.ok(o.w >= 40 && o.w <= 1339 && o.h >= 40 && o.h <= 1339); }
      for (let j = 0; j < k; j++) {
        const p = plan.objects[j]!;
        assert.ok(!touchingV16(o, p, plan.gap), `code ${i}: objects ${j} and ${k} keep the gap`);
        assert.ok(!touchingV16(o, p, 1), `code ${i}: objects ${j} and ${k} never touch`);
      }
    });
    if (new Set(plan.objects.map((o) => o.colour)).size < 3) shared.yes++;
  });
  // the distribution the sketch had: about a third squares (a bit more, as nearly square rectangles are redrawn), every ground and every object colour
  const share = squares / objects;
  assert.ok(share > 0.28 && share < 0.5, `square share ${share}`);
  assert.equal(grounds.size, 4);
  assert.equal(objectColours.size, 4);
  assert.ok(gaps.size > 100);
  assert.ok(shared.yes > 0, "two objects may share a colour");
});

test("the PNG is the same picture: its pixels are the SVG's rectangles, its text carries the manifest, the copyright and the SVG", async () => {
  for (let k = 0; k < 6; k++) {
    const c = k === 0 ? C1 : code(`bitgraph-art/16 png ${k}`);
    const plan = planV16(c), svg = svgV16(c);
    const { png, manifest, recipe } = await makeArt(c, ART_ALGORITHM_V16);
    assert.deepEqual(recipe.v16, plan);
    const d = await decodePng(png);
    assert.equal(d.width, V16_SIZE); assert.equal(d.height, V16_SIZE);
    assert.deepEqual(d.rgba, renderV16(plan));
    assert.equal(d.texts["bitgraph-art"], manifestJson(manifest));
    assert.equal(d.texts["Copyright"], V16_COPYRIGHT);
    assert.equal(JSON.parse(d.texts["bitgraph-art"]!).commitment, toBase64Url(c));
    assert.deepEqual(svgFromPngV16(png), svg);
    // the pixels, painted from the SVG's own text, match the PNG pixel for pixel
    const px = new Uint8Array(V16_SIZE * V16_SIZE * 4);
    for (const [x, y, w, h, fill] of rectsOf(utf8(svg))) {
      const rgb = [1, 3, 5].map((o) => parseInt(fill.slice(o, o + 2), 16));
      for (let yy = y; yy < y + h; yy++) for (let xx = x; xx < x + w; xx++) { const i = (yy * V16_SIZE + xx) * 4; px[i] = rgb[0]!; px[i + 1] = rgb[1]!; px[i + 2] = rgb[2]!; px[i + 3] = 255; }
    }
    assert.ok(px.every((v, i) => v === d.rgba[i]), `code ${k}: SVG and PNG agree`);
    // the commitment is in the PNG's bytes as base64url text too
    assert.ok(new TextDecoder("latin1").decode(png).includes(toBase64Url(c)));
    assert.ok(png.length < 100_000, `a flat piece is small (${png.length} bytes)`);
  }
});

test("a wrong or damaged SVG reads no commitment; a description names the ground and the shapes", async () => {
  const svg = svgV16(C1);
  // a PNG whose print SVG was swapped for another code's fails the SVG check, though its pixels are untouched
  const { png } = await makeArt(C1, ART_ALGORITHM_V16);
  const other = svgV16(code("another code"));
  const at = new TextDecoder("latin1").decode(png).indexOf("<?xml");
  const swapped = png.slice(); swapped.set(other.subarray(0, svg.length), at); // the other SVG's bytes over this one's (the pixels untouched)
  assert.equal((await checkArt(swapped, C1)).strip.result, "FALSE");
  assert.equal(svgFromPngV16(new Uint8Array([1, 2, 3])), null);
  assert.equal(readCommitmentV16(svg.slice(0, 200)), null);
  assert.equal(readCommitmentV16(new Uint8Array([0xff, 0xfe])), null);
  assert.match(describeV16(planV16(C1)), /^(red|yellow|blue|green) ground, /);
  assert.throws(() => planV16(new Uint8Array(31)));
});

/* ── Redraw from the proof (art-position.ts), against the stub boundary the tree/1 and painting tests use ───────────── */

test("one click on /three: recorded in its position as a PNG the verifier finds the commitment in; the proof page rebuilds the PNG and its SVG byte for byte", async () => {
  const stub = await makeStub();
  const made = await createArtImage({ transport: { fetch: stub.fetch }, algorithm: ART_ALGORITHM_V16 });
  assert.equal(made.manifest.algorithm, ART_ALGORITHM_V16);
  assert.equal(stub.commits.length, 1);
  assert.equal((stub.commits[0]!.digests as Array<{ digestB64: string }>)[0]!.digestB64, bytesToBase64(sha256(made.png)));
  assert.equal((await verifyFuse({ proof: made.proof, bytes: made.png })).category, "CARRIED_INLINE");
  assert.equal(made.checks.regenerated.result, "TRUE");
  assert.equal(made.checks.strip.result, "TRUE");
  const c = Uint8Array.from(atob(made.position.commitment.replace(/-/g, "+").replace(/_/g, "/") + "="), (x) => x.charCodeAt(0));
  assert.deepEqual(svgFromPngV16(made.png), svgV16(c));

  // the proof page: the proof alone gives back the recorded PNG, and the SVG inside it
  const tried: Array<string | null> = [];
  const r = await redrawRecordedArt(made.proof, { onTry: (a) => tried.push(a) });
  assert.ok(r);
  assert.equal(r!.algorithm, ART_ALGORITHM_V16);
  assert.equal(tried[0], ART_ALGORITHM_V16, "version 16 is tried first, before any painting is drawn");
  assert.equal(bytesToBase64(sha256(r!.png)), made.digestB64);
  assert.deepEqual(svgFromPngV16(r!.png), svgV16(c));
  // coming back to /generate?p=<digest>
  const back = await restoreArtImage(made.proof);
  assert.ok(back);
  assert.equal(back!.digestB64, made.digestB64);
  assert.equal(back!.manifest.algorithm, ART_ALGORITHM_V16);
  assert.equal(back!.checks.strip.result, "TRUE");
  // a record signed before version 16 existed is never tried as one, so it rebuilds nothing
  const seen: Array<string | null> = [];
  assert.equal(await redrawRecordedArt(made.proof, { recordedMs: Date.UTC(2026, 9, 8), onTry: (a) => seen.push(a) }), null);
  assert.ok(!seen.includes(ART_ALGORITHM_V16));
});
