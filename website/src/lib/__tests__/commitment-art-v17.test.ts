// bitgraph-art/17 (2026-10-10), "Three" at 16:9 for the home page: version 16's rules, code and colours on a 1920 x 1080
// canvas. Pinned, property-checked over 500 codes (16:9 bounds included), the PNG's pixels are the SVG's rectangles, the
// image checks pass and fail as they should, version 16's bytes are untouched, and the proof page rebuilds both files
// from the proof alone.
import { test } from "node:test";
import * as assert from "node:assert/strict";
import { sha256 } from "@noble/hashes/sha256";
import { bytesToBase64, verifyFuse } from "@mikeargento/bitgraph-verify";
import { ART_ALGORITHM, ART_ALGORITHM_V15, ART_ALGORITHM_V16, ART_ALGORITHM_V17, ART_ALGORITHMS, artSize, checkArt, decodePng, makeArt, manifestJson, toBase64Url, toHex } from "../commitment-art.ts";
import { svgV16 } from "../commitment-art-v16.ts";
import {
  COLOURS_V17, THREE_SPEC_V17, V17_COPYRIGHT, V17_HEIGHT, V17_WIDTH, describeV17, planV17, readCommitmentV17, renderV17, svgFromPngV17, svgTextV17, svgV17, touchingV17,
} from "../commitment-art-v17.ts";
import { createArtImage, redrawRecordedArt, restoreArtImage } from "../art-position.ts";
import { makeStub } from "./tree1-helpers.ts";

const code = (s: string) => sha256(new TextEncoder().encode(s));
const C1 = code("bitgraph-art test commitment one");
const utf8 = (b: Uint8Array) => new TextDecoder("utf-8", { fatal: true }).decode(b);

// Pinned on first run (2026-10-10). A failure here means bitgraph-art/17 changed: make /18 instead.
const PINNED_SVG_V17 = "06c80064d5b8bd296a01481d4eb16b99154c22894a5275a0cc249e5af14c7972";
const PINNED_PNG_V17 = "75d87c4536300803ddd72168fdee9d10e60c0249707b142054571f0110821645";
// Version 16's own pins (commitment-art-v16.test.ts), repeated: version 17 shares its code, and must not move it.
const PINNED_SVG_V16 = "e322b1a099dccf4f07cdd836c7d92d7c8ae808446c62c828dbb04f971ff76752";
const PINNED_PNG_V16 = "6149eda29355c2d07f4b67d0821094884a976cb271e46a078faf0ed6c13f9185";

test("version 17 is pinned: this commitment's SVG and recorded PNG never change, and both image checks pass", async () => {
  const a = await makeArt(C1, ART_ALGORITHM_V17), b = await makeArt(C1, ART_ALGORITHM_V17);
  const svg = svgV17(C1);
  assert.equal(toHex(sha256(svg)), toHex(sha256(svgV17(C1))));
  assert.equal(toHex(sha256(a.png)), toHex(sha256(b.png)));
  assert.equal(toHex(sha256(svg)), PINNED_SVG_V17);
  assert.equal(toHex(sha256(a.png)), PINNED_PNG_V17);
  // the PNG carries the SVG byte for byte
  assert.deepEqual(svgFromPngV17(a.png), svg);
  assert.deepEqual(artSize(ART_ALGORITHM_V17), { width: 1920, height: 1080 });
  const r = await checkArt(a.png, C1);
  assert.equal(r.regenerated.result, "TRUE");
  assert.equal(r.strip.result, "TRUE");
  assert.match(r.strip.detail, /print SVG inside the file is the one drawn from the authenticated commitment/);
  const wrong = await checkArt(a.png, code("another code"));
  assert.equal(wrong.regenerated.result, "FALSE");
  assert.equal(wrong.strip.result, "FALSE");
});

test("version 16 is untouched by version 17: its pinned SVG and PNG, and a version 16 file fails as a version 17 one", async () => {
  const v16 = await makeArt(C1, ART_ALGORITHM_V16);
  assert.equal(toHex(sha256(svgV16(C1))), PINNED_SVG_V16);
  assert.equal(toHex(sha256(v16.png)), PINNED_PNG_V16);
  // the same commitment draws a different piece under each label (the stream is domain-separated by version)
  assert.notDeepEqual(planV17(C1).objects, (await makeArt(C1, ART_ALGORITHM_V16)).recipe.v16!.objects);
  // a version 16 SVG states a version 16 commitment, which version 17's reader does not take
  assert.equal(readCommitmentV17(svgV16(C1)), null);
});

test("version 17 is registered and is not the default: /painting still paints version 15", () => {
  assert.equal(ART_ALGORITHM_V17, "bitgraph-art/17");
  assert.ok(ART_ALGORITHMS.includes(ART_ALGORITHM_V17));
  assert.equal(ART_ALGORITHM, ART_ALGORITHM_V15);
  assert.deepEqual([V17_WIDTH, V17_HEIGHT], [1920, 1080]);
  assert.equal(V17_WIDTH * 9, V17_HEIGHT * 16, "16:9");
});

test("the colours are version 16's: red #C8442C, yellow #E4A930, blue #244E7A and green #6B8E4E", () => {
  assert.deepEqual(COLOURS_V17.map((p) => [p.name, p.hex, [...p.rgb]]), [
    ["red", "#C8442C", [200, 68, 44]],
    ["yellow", "#E4A930", [228, 169, 48]],
    ["blue", "#244E7A", [36, 78, 122]],
    ["green", "#6B8E4E", [107, 142, 78]],
  ]);
});

/** The rectangles of a canonical SVG, read back from its text: [x, y, w, h, fill]. */
function rectsOf(svg: string): Array<[number, number, number, number, string]> {
  return [...svg.matchAll(/<rect x="(\d+)" y="(\d+)" width="(\d+)" height="(\d+)" fill="(#[0-9A-F]{6})"\/>/g)].map((m) => [Number(m[1]), Number(m[2]), Number(m[3]), Number(m[4]), m[5]!]);
}

test("500 codes: exactly three objects, inside the 16:9 canvas, never touching with the planned gap, the four colours only, canonical bytes", () => {
  const cs = [new Uint8Array(32), new Uint8Array(32).fill(255), C1];
  for (let k = 0; cs.length < 500; k++) cs.push(code(`bitgraph-art/17 property ${k}`));
  const hexes = new Set(COLOURS_V17.map((p) => p.hex));
  let squares = 0, objects = 0, wide = 0, tall = 0, coverage = 0;
  const grounds = new Set<number>(), gaps = new Set<number>(), objectColours = new Set<number>();
  const shared = { yes: 0 };
  cs.forEach((c, i) => {
    const plan = planV17(c);
    const svg = svgTextV17(plan, c);
    assert.equal(svg, utf8(svgV17(c)), `code ${i}: a second render is byte-identical`);
    assert.equal(JSON.stringify(plan), JSON.stringify(planV17(c)));
    const nums: number[] = [plan.background, plan.gap, plan.attempts, ...plan.objects.flatMap((o) => [o.x, o.y, o.w, o.h, o.colour])];
    assert.ok(nums.every(Number.isInteger), `code ${i}: integers only`);
    assert.ok(!/\d\.\d/.test(svg.slice(svg.indexOf("\n"))) && !svg.includes("\r") && !svg.includes("\t") && svg.endsWith("</svg>\n"), `code ${i}: canonical text`);
    assert.equal(svg.split("\n").length, 11, `code ${i}: one element a line`);
    assert.ok(svg.includes(`viewBox="0 0 1920 1080"`), `code ${i}: the 16:9 viewBox`);
    assert.ok(!svg.includes("stroke"), `code ${i}: no stroke`);
    assert.ok(svg.includes(`<desc>${V17_COPYRIGHT}</desc>`) && svg.includes(`<metadata>bitgraph-art/17 commitment ${toBase64Url(c)}</metadata>`));
    assert.deepEqual(readCommitmentV17(new TextEncoder().encode(svg)), c);
    const rects = rectsOf(svg);
    assert.equal(rects.length, 4, `code ${i}: the ground and exactly three objects`);
    assert.deepEqual(rects[0]!.slice(0, 4), [0, 0, 1920, 1080]);
    assert.equal(plan.objects.length, 3);
    grounds.add(plan.background); gaps.add(plan.gap);
    assert.ok(plan.gap >= 7 && plan.gap <= 90, `code ${i}: gap ${plan.gap}`);
    for (const [x, y, w, h, fill] of rects) {
      assert.ok(hexes.has(fill), `code ${i}: ${fill} is one of the four`);
      assert.ok(x >= 0 && y >= 0 && w > 0 && h > 0 && x + w <= 1920 && y + h <= 1080, `code ${i}: inside the 1920 x 1080 canvas`);
    }
    const ground = rects[0]![4];
    plan.objects.forEach((o, k) => {
      objects++;
      coverage += (o.w * o.h) / (1920 * 1080);
      const [x, y, w, h, fill] = rects[k + 1]!;
      assert.deepEqual([x, y, w, h, fill], [o.x, o.y, o.w, o.h, COLOURS_V17[o.colour]!.hex], `code ${i}: the SVG draws the plan`);
      assert.notEqual(fill, ground, `code ${i}: object ${k} is never the ground's colour`);
      assert.notEqual(o.colour, plan.background);
      objectColours.add(o.colour);
      // no shape is taller than the canvas allows: a square at most 509, a rectangle at most 803 of 1080
      assert.ok(o.h < 1080 && o.w < 1920);
      if (o.kind === "square") { squares++; assert.equal(o.w, o.h); assert.ok(o.w >= 54 && o.w <= 509); }
      else {
        assert.ok(Math.abs(o.w - o.h) >= THREE_SPEC_V17.nearSquare, `code ${i}: a rectangle is never nearly square`);
        assert.ok(o.w >= 43 && o.w <= 1429 && o.h >= 24 && o.h <= 803);
        if (o.w > o.h) wide++; else tall++;
      }
      for (let j = 0; j < k; j++) {
        const p = plan.objects[j]!;
        assert.ok(!touchingV17(o, p, plan.gap), `code ${i}: objects ${j} and ${k} keep the gap`);
        assert.ok(!touchingV17(o, p, 1), `code ${i}: objects ${j} and ${k} never touch`);
      }
    });
    if (new Set(plan.objects.map((o) => o.colour)).size < 3) shared.yes++;
  });
  const share = squares / objects;
  assert.ok(share > 0.28 && share < 0.5, `square share ${share}`);
  assert.ok(wide > 0 && tall > 0, "rectangles both wide and tall");
  // the three objects cover about what version 16's do (about a quarter of the canvas on average)
  const mean = coverage / cs.length;
  assert.ok(mean > 0.15 && mean < 0.35, `mean coverage ${mean}`);
  assert.equal(grounds.size, 4);
  assert.equal(objectColours.size, 4);
  assert.ok(gaps.size > 60);
  assert.ok(shared.yes > 0, "two objects may share a colour");
});

test("the PNG is the same picture: its pixels are the SVG's rectangles, its text carries the manifest, the copyright and the SVG", async () => {
  for (let k = 0; k < 6; k++) {
    const c = k === 0 ? C1 : code(`bitgraph-art/17 png ${k}`);
    const plan = planV17(c), svg = svgV17(c);
    const { png, manifest, recipe } = await makeArt(c, ART_ALGORITHM_V17);
    assert.deepEqual(recipe.v17, plan);
    assert.equal(recipe.v16, undefined);
    assert.equal(manifest.width, 1920); assert.equal(manifest.height, 1080);
    const d = await decodePng(png);
    assert.equal(d.width, 1920); assert.equal(d.height, 1080);
    assert.deepEqual(d.rgba, renderV17(plan));
    assert.equal(d.texts["bitgraph-art"], manifestJson(manifest));
    assert.equal(d.texts["Copyright"], V17_COPYRIGHT);
    assert.equal(JSON.parse(d.texts["bitgraph-art"]!).commitment, toBase64Url(c));
    assert.deepEqual(svgFromPngV17(png), svg);
    const px = new Uint8Array(1920 * 1080 * 4);
    for (const [x, y, w, h, fill] of rectsOf(utf8(svg))) {
      const rgb = [1, 3, 5].map((o) => parseInt(fill.slice(o, o + 2), 16));
      for (let yy = y; yy < y + h; yy++) for (let xx = x; xx < x + w; xx++) { const i = (yy * 1920 + xx) * 4; px[i] = rgb[0]!; px[i + 1] = rgb[1]!; px[i + 2] = rgb[2]!; px[i + 3] = 255; }
    }
    assert.ok(px.every((v, i) => v === d.rgba[i]), `code ${k}: SVG and PNG agree`);
    assert.ok(new TextDecoder("latin1").decode(png).includes(toBase64Url(c)));
    assert.ok(png.length < 100_000, `a flat piece is small (${png.length} bytes)`);
  }
});

test("a wrong or damaged SVG reads no commitment; a description names the ground and the shapes", async () => {
  const svg = svgV17(C1);
  const { png } = await makeArt(C1, ART_ALGORITHM_V17);
  const other = svgV17(code("another code"));
  const at = new TextDecoder("latin1").decode(png).indexOf("<?xml");
  const swapped = png.slice(); swapped.set(other.subarray(0, svg.length), at);
  assert.equal((await checkArt(swapped, C1)).strip.result, "FALSE");
  assert.equal(svgFromPngV17(new Uint8Array([1, 2, 3])), null);
  assert.equal(readCommitmentV17(svg.slice(0, 200)), null);
  assert.equal(readCommitmentV17(new Uint8Array([0xff, 0xfe])), null);
  assert.match(describeV17(planV17(C1)), /^(red|yellow|blue|green) ground, /);
  assert.throws(() => planV17(new Uint8Array(31)));
});

/* ── Redraw from the proof (art-position.ts), against the stub boundary the tree/1 and painting tests use ───────────── */

test("one click on home (or /generate): recorded in its position as a 16:9 PNG the verifier finds the commitment in; the proof page rebuilds the PNG and its SVG byte for byte", async () => {
  const stub = await makeStub();
  const made = await createArtImage({ transport: { fetch: stub.fetch }, algorithm: ART_ALGORITHM_V17 });
  assert.equal(made.manifest.algorithm, ART_ALGORITHM_V17);
  assert.deepEqual([made.manifest.width, made.manifest.height], [1920, 1080]);
  assert.equal(stub.commits.length, 1);
  assert.equal((stub.commits[0]!.digests as Array<{ digestB64: string }>)[0]!.digestB64, bytesToBase64(sha256(made.png)));
  assert.equal((await verifyFuse({ proof: made.proof, bytes: made.png })).category, "CARRIED_INLINE");
  assert.equal(made.checks.regenerated.result, "TRUE");
  assert.equal(made.checks.strip.result, "TRUE");
  const c = Uint8Array.from(atob(made.position.commitment.replace(/-/g, "+").replace(/_/g, "/") + "="), (x) => x.charCodeAt(0));
  assert.deepEqual(svgFromPngV17(made.png), svgV17(c));

  // the proof page: the proof alone gives back the recorded PNG, and the SVG inside it
  const tried: Array<string | null> = [];
  const r = await redrawRecordedArt(made.proof, { onTry: (a) => tried.push(a) });
  assert.ok(r);
  assert.equal(r!.algorithm, ART_ALGORITHM_V17);
  assert.equal(tried[0], ART_ALGORITHM_V17, "version 17 is tried first, before any other is drawn");
  assert.equal(bytesToBase64(sha256(r!.png)), made.digestB64);
  assert.deepEqual(svgFromPngV17(r!.png), svgV17(c));
  // coming back to /?p=<digest>
  const back = await restoreArtImage(made.proof);
  assert.ok(back);
  assert.equal(back!.digestB64, made.digestB64);
  assert.equal(back!.manifest.algorithm, ART_ALGORITHM_V17);
  assert.equal(back!.checks.strip.result, "TRUE");
  // a record signed before version 17 existed is never tried as one (the date version 16's test uses, so no painting is drawn)
  const seen: Array<string | null> = [];
  assert.equal(await redrawRecordedArt(made.proof, { recordedMs: Date.UTC(2026, 9, 8), onTry: (a) => seen.push(a) }), null);
  assert.ok(!seen.includes(ART_ALGORITHM_V17));
});
