// bitgraph-art/18 (2026-10-10), "Bridge": a suspension bridge of packed flat rectangles on a 1200 square, every draw (the
// palette and every setting of the standalone generator, then the packing) from the commitment's labelled SHA-256 stream, integers
// only, the recorded PNG carrying its print SVG. Pinned; the mask is pinned and its parts checked (two legs and four struts
// a tower, continuous double cables, suspenders); the settings' distributions checked over 200 codes; 300 codes
// property-checked under their own settings (50 of them drawn twice); the PNG is the SVG's rectangles; the image checks
// pass and fail as they should; versions 16 and 17 are untouched; the proof page rebuilds both files from the proof alone.
import { test } from "node:test";
import * as assert from "node:assert/strict";
import { sha256 } from "@noble/hashes/sha256";
import { bytesToBase64, verifyFuse } from "@mikeargento/bitgraph-verify";
import { ART_ALGORITHM, ART_ALGORITHM_V15, ART_ALGORITHM_V16, ART_ALGORITHM_V17, ART_ALGORITHM_V19, ART_ALGORITHMS, artSize, checkArt, decodePng, makeArt, manifestJson, toBase64Url, toHex } from "../commitment-art.ts";
import { svgV16 } from "../commitment-art-v16.ts";
import { svgV17 } from "../commitment-art-v17.ts";
import {
  ART_ALGORITHM_V18, CABLE_OFFSETS_V18, KIND_BRIDGE, KIND_FOOTING, KIND_SKY, KIND_WATER, PALETTES_V18, TOWER_CENTERS_V18, V18_COPYRIGHT, V18_HEIGHT, V18_HORIZON, V18_WIDTH,
  V18_SETTINGS_KEYWORD, V18_SETTING_RANGES, bridgeMaskV18, cableMaskV18, describeV18, maskRectsV18, packV18, planV18, readCommitmentV18, renderV18, settingsTextV18, settingsV18,
  suspendersV18, svgFromPngV18, svgTextV18, svgV18, type V18Settings,
} from "../commitment-art-v18.ts";
import { createArtImage, redrawRecordedArt, restoreArtImage } from "../art-position.ts";
import { makeStub } from "./tree1-helpers.ts";

const code = (s: string) => sha256(new TextEncoder().encode(s));
const C1 = code("bitgraph-art test commitment one");
const utf8 = (b: Uint8Array) => new TextDecoder("utf-8", { fatal: true }).decode(b);
const G = 1200;

// Pinned 2026-10-10 (re-pinned the same night, before any piece was recorded, when every setting became per click). A
// failure here means bitgraph-art/18 changed: make /19 instead.
const PINNED_SVG_V18 = "9c43f7621a872f129e8c6d39672c2fef2cfac480c6583cccedfbfabc2a98ec48";
const PINNED_PNG_V18 = "71db0ede89dd7159b1b47e69c9bb376936550a35ab6b59adc7f4259b06b0ce1a";
const PINNED_MASK_V18 = "e33d85adab2288db77ab2696a1f180c68aab44f7016d95f81b8b02346e9bc1d2";
// Versions 16 and 17's own pins (their tests), repeated: version 18 writes their file, and must not move it.
const PINNED_SVG_V16 = "e322b1a099dccf4f07cdd836c7d92d7c8ae808446c62c828dbb04f971ff76752";
const PINNED_PNG_V16 = "6149eda29355c2d07f4b67d0821094884a976cb271e46a078faf0ed6c13f9185";
const PINNED_SVG_V17 = "06c80064d5b8bd296a01481d4eb16b99154c22894a5275a0cc249e5af14c7972";
const PINNED_PNG_V17 = "75d87c4536300803ddd72168fdee9d10e60c0249707b142054571f0110821645";

test("version 18 is pinned: this commitment's SVG and recorded PNG never change, and both image checks pass", async () => {
  const a = await makeArt(C1, ART_ALGORITHM_V18);
  const svg = svgV18(C1);
  assert.equal(svgTextV18(packV18(C1), C1), utf8(svg), "a fresh packing writes the same SVG");
  assert.equal(toHex(sha256(a.png)), toHex(sha256((await makeArt(C1, ART_ALGORITHM_V18)).png)));
  assert.equal(toHex(sha256(svg)), PINNED_SVG_V18);
  assert.equal(toHex(sha256(a.png)), PINNED_PNG_V18);
  assert.deepEqual(svgFromPngV18(a.png), svg);
  assert.deepEqual(artSize(ART_ALGORITHM_V18), { width: 1200, height: 1200 });
  const r = await checkArt(a.png, C1);
  assert.equal(r.regenerated.result, "TRUE");
  assert.equal(r.strip.result, "TRUE");
  assert.match(r.strip.detail, /print SVG inside the file is the one drawn from the authenticated commitment/);
  const wrong = await checkArt(a.png, code("another code"));
  assert.equal(wrong.regenerated.result, "FALSE");
  assert.equal(wrong.strip.result, "FALSE");
});

test("versions 16 and 17 are untouched by version 18: their pinned SVGs and PNGs", async () => {
  assert.equal(toHex(sha256(svgV16(C1))), PINNED_SVG_V16);
  assert.equal(toHex(sha256((await makeArt(C1, ART_ALGORITHM_V16)).png)), PINNED_PNG_V16);
  assert.equal(toHex(sha256(svgV17(C1))), PINNED_SVG_V17);
  assert.equal(toHex(sha256((await makeArt(C1, ART_ALGORITHM_V17)).png)), PINNED_PNG_V17);
  assert.equal(readCommitmentV18(svgV16(C1)), null, "a version 16 SVG states no version 18 commitment");
});

test("version 18 is registered and is not the default", () => {
  assert.equal(ART_ALGORITHM_V18, "bitgraph-art/18");
  assert.ok(ART_ALGORITHMS.includes(ART_ALGORITHM_V18));
  assert.equal(ART_ALGORITHM, ART_ALGORITHM_V15);
  assert.deepEqual([V18_WIDTH, V18_HEIGHT], [1200, 1200]);
});

test("the five palettes are the presets: background, bridge, footing, sky, water", () => {
  assert.deepEqual(PALETTES_V18.map((p) => [p.name, [...p.colors]]), [
    ["International orange", ["#f5efe0", "#c0362c", "#b08d4a", "#8fb3c9", "#1d4e6b"]],
    ["Red and black", ["#ffffff", "#000000", "#000000", "#ee1c25", "#ee1c25"]],
    ["Night", ["#0d1b2a", "#f25c3b", "#c9a45c", "#2c4f7c", "#1b3a5c"]],
    ["Sunset", ["#fbe3c2", "#7a1f2b", "#4a2a1a", "#f08a24", "#3a2d6b"]],
    ["Fog", ["#ecebe6", "#b3341f", "#8a7a55", "#a3b0b5", "#55707d"]],
  ]);
});

/* ── The mask ─────────────────────────────────────────────────────────────────────────────────────────────────────── */

test("the mask is pinned, binary, the same object every call, and nothing of the bridge lies outside its parts", () => {
  const m = bridgeMaskV18();
  assert.equal(m, bridgeMaskV18());
  assert.equal(m.length, G * G);
  assert.ok(m.every((v) => v === 0 || v === 1));
  assert.equal(toHex(sha256(m)), PINNED_MASK_V18);
  // rebuilt from its parts: the rectangles, the two cables, the suspenders
  const re = new Uint8Array(G * G);
  const fill = (x0: number, y0: number, x1: number, y1: number) => { for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) re[y * G + x] = 1; };
  for (const [x0, y0, x1, y1] of maskRectsV18()) fill(x0, y0, x1, y1);
  for (const off of CABLE_OFFSETS_V18) cableMaskV18(off).forEach((v, i) => { if (v) re[i] = 1; });
  for (const { x, top } of suspendersV18()) fill(x - 2, top, x + 2, 667);
  assert.deepEqual(re, m);
  // the canvas edges and the sky's top are empty; below the horizon only piers, footings and slabs
  for (let x = 0; x < G; x++) for (const y of [0, 300, 900, 1199]) assert.equal(m[y * G + x], 0);
  for (let y = V18_HORIZON; y < G; y++) for (let x = 0; x < G; x++) {
    if (!m[y * G + x]) continue;
    assert.ok(TOWER_CENTERS_V18.some((cx) => Math.abs(x + 0.5 - cx) < 64 && y < 818), `(${x}, ${y}) under the deck belongs to a tower`);
  }
});

test("each tower has two legs and four struts, a pier, footing and slab under it, and finials on top", () => {
  const m = bridgeMaskV18();
  const runs = (xs: boolean[]) => { const out: Array<[number, number]> = []; let start = -1; xs.forEach((v, i) => { if (v && start < 0) start = i; if (!v && start >= 0) { out.push([start, i]); start = -1; } }); if (start >= 0) out.push([start, xs.length]); return out; };
  for (const cx of TOWER_CENTERS_V18) {
    // full columns from 397 to 697 near the tower: exactly the two legs, 24 wide each
    const cols: boolean[] = [];
    for (let x = cx - 60; x < cx + 60; x++) { let full = true; for (let y = 397; y < 697; y++) if (!m[y * G + x]) { full = false; break; } cols.push(full); }
    assert.deepEqual(runs(cols).map(([a, b]) => [a + cx - 60, b + cx - 60]), [[cx - 39, cx - 15], [cx + 15, cx + 39]], `tower ${cx}: two legs`);
    // full rows between the legs, above the deck: exactly the four struts
    const rows: boolean[] = [];
    for (let y = 380; y < 667; y++) { let full = true; for (let x = cx - 15; x < cx + 15; x++) if (!m[y * G + x]) { full = false; break; } rows.push(full); }
    assert.deepEqual(runs(rows).map(([a, b]) => [a + 380, b + 380]), [[409, 427], [463, 481], [525, 545], [603, 621]], `tower ${cx}: four struts`);
    // piers to 787, footings to 811, the slab to 818, and the finials reach 379
    for (const x of [cx - 27, cx + 27]) { assert.equal(m[700 * G + x], 1); assert.equal(m[800 * G + x], 1); assert.equal(m[379 * G + x], 1); assert.equal(m[378 * G + x], 0); }
    assert.equal(m[815 * G + cx - 63], 1); assert.equal(m[815 * G + cx + 63], 1); assert.equal(m[818 * G + cx], 0);
  }
});

test("the cables: each one connected run from deck end to deck end, at least 7 pixels a column, doubled and crossing", () => {
  const m = bridgeMaskV18();
  const cables = CABLE_OFFSETS_V18.map((off) => cableMaskV18(off));
  for (const [k, c] of cables.entries()) {
    for (let i = 0; i < c.length; i++) if (c[i]) assert.equal(m[i], 1, "the cable is in the mask");
    for (let X = 48; X < 1152; X++) { let n = 0; for (let Y = 0; Y < G; Y++) n += c[Y * G + X]!; assert.ok(n >= 7, `cable ${k}, column ${X}: ${n} pixels`); }
    // one 4-connected component, holding both deck ends
    const seen = new Uint8Array(G * G);
    const start = 665 * G + 48;
    assert.equal(c[start], 1);
    const stack = [start]; seen[start] = 1; let count = 0;
    while (stack.length) {
      const i = stack.pop()!; count++;
      for (const j of [i - 1, i + 1, i - G, i + G]) if (j >= 0 && j < G * G && c[j] && !seen[j]) { seen[j] = 1; stack.push(j); }
    }
    assert.equal(count, c.reduce((a, b) => a + b, 0), `cable ${k} is one connected run`);
    assert.equal(seen[665 * G + 1151], 1, `cable ${k} reaches the far deck end`);
    // it rises to the saddles over the legs (y about 401) and sags to 663 mid-span
    const off = CABLE_OFFSETS_V18[k]!;
    for (const cx of TOWER_CENTERS_V18) assert.equal(c[401 * G + cx + off], 1);
    assert.equal(c[663 * G + 600 + off], 1);
  }
  // doubled: over most of the main span the two run apart; crossed: some columns hold both at once
  let apart = 0, together = 0;
  for (let X = 400; X < 800; X++) {
    let a = false, b = false, both = false;
    for (let Y = 380; Y < 700; Y++) { const i = Y * G + X; a ||= cables[0]![i] === 1; b ||= cables[1]![i] === 1; both ||= cables[0]![i] === 1 && cables[1]![i] === 1; }
    assert.ok(a && b);
    if (both) together++; else apart++;
  }
  assert.ok(apart > 300 && together > 0, `apart ${apart}, crossing ${together}`);
});

test("the suspenders: every 18 from 58, none within 46 of a tower or shorter than 14, each hung from the higher cable", () => {
  const m = bridgeMaskV18();
  const s = suspendersV18();
  assert.ok(s.length >= 40, `${s.length} suspenders`);
  const cables = CABLE_OFFSETS_V18.map((off) => cableMaskV18(off));
  for (const { x, top } of s) {
    assert.equal((x - 58) % 18, 0);
    assert.ok(Math.abs(x - 332) >= 46 && Math.abs(x - 868) >= 46);
    assert.ok(667 - top >= 14);
    for (let y = top; y < 667; y++) for (let xx = x - 2; xx < x + 2; xx++) assert.equal(m[y * G + xx], 1);
    // its top touches a cable, and no cable pixel in its column lies above the band around it
    assert.ok(cables.some((c) => c[top * G + x] === 1 || c[(top + 1) * G + x] === 1), `suspender ${x} hangs from a cable`);
  }
  // all four spans carry some
  for (const [a, b] of [[48, 286], [378, 822], [914, 1152]]) assert.ok(s.some(({ x }) => x >= a && x < b), `span ${a}-${b}`);
});

/* ── The pieces ───────────────────────────────────────────────────────────────────────────────────────────────────── */

/** The rectangles of a canonical SVG, read back from its text: [x, y, w, h, fill]. */
function rectsOf(svg: string): Array<[number, number, number, number, string]> {
  return [...svg.matchAll(/<rect x="(\d+)" y="(\d+)" width="(\d+)" height="(\d+)" fill="(#[0-9a-f]{6})"\/>/g)].map((m) => [Number(m[1]), Number(m[2]), Number(m[3]), Number(m[4]), m[5]!]);
}

test("the settings: every one in its slider's range, spread across it, sparse ghost bridges about 1 in 5 and dense ones most often (200 codes)", () => {
  const n = 200;
  const all: Array<{ palette: number; settings: V18Settings }> = [];
  for (let k = 0; k < n; k++) all.push(settingsV18(code(`bitgraph-art/18 settings ${k}`)));
  for (const { palette, settings } of all) {
    assert.ok(Number.isInteger(palette) && palette >= 0 && palette < 5);
    for (const [key, [lo, hi]] of Object.entries(V18_SETTING_RANGES)) {
      const v = settings[key as keyof V18Settings];
      assert.ok(Number.isInteger(v) && v >= lo && v <= hi, `${key} ${v} in ${lo} to ${hi}`);
    }
    assert.equal(settings.fieldMax % 10, 0, "the field's largest side moves in tens, as the page's slider does");
  }
  const share = (f: (s: V18Settings) => boolean) => all.filter((a) => f(a.settings)).length / n;
  const sparse = share((s) => s.detail <= 3), dense = share((s) => s.detail >= 5);
  assert.ok(sparse >= 0.12 && sparse <= 0.3, `sparse (detail 2 or 3) ${sparse}`);
  assert.ok(dense >= 0.5, `dense (detail 5 or 6) ${dense}`);
  assert.ok(share((s) => s.detail === 2) > 0 && share((s) => s.detail === 6) > share((s) => s.detail === 4));
  const values = (key: keyof V18Settings) => new Set(all.map((a) => a.settings[key]));
  assert.deepEqual([...values("detail")].sort(), [2, 3, 4, 5, 6]);
  assert.deepEqual([...values("bridgeGap")].sort(), [1, 2, 3, 4, 5]);
  assert.ok(share((s) => s.bridgeGap === 1) > share((s) => s.bridgeGap === 5), "tight bridge gaps most often");
  const spans: Array<[keyof V18Settings, number, number]> = [["fieldGapOffset", 1, 9], ["buffer", 3, 13], ["margin", 12, 52], ["bars", 20, 80], ["bridgeMax", 50, 130], ["fieldMax", 200, 460]];
  for (const [key, low, high] of spans) {
    assert.ok(share((s) => s[key] <= low) > 0 && share((s) => s[key] >= high) > 0, `${key} reaches both ends`);
    assert.ok(values(key).size >= 8, `${key} takes many values`);
  }
  assert.equal(new Set(all.map((a) => a.palette)).size, 5, "every palette");
});

test("300 codes under their own settings: no overlaps, the gaps kept, bridge inside the mask, field clear of it by the buffer, never across the horizon, inside the margin, sizes within the largest, colors by position, integers only; 50 drawn twice, byte for byte; sparse settings draw sparse bridges", () => {
  const cs = [new Uint8Array(32), new Uint8Array(32).fill(255), C1];
  for (let k = 0; cs.length < 300; k++) cs.push(code(`bitgraph-art/18 property ${k}`));
  const mask = bridgeMaskV18();
  // the mask's summed-area table, to ask how much bridge lies in a box
  const W = G + 1, sat = new Int32Array(W * W);
  for (let y = 1; y <= G; y++) { let row = 0; for (let x = 1; x <= G; x++) { row += mask[(y - 1) * G + (x - 1)]!; sat[y * W + x] = sat[(y - 1) * W + x]! + row; } }
  const bridgeIn = (x0: number, y0: number, x1: number, y1: number) => {
    x0 = Math.max(0, x0); y0 = Math.max(0, y0); x1 = Math.min(G, x1); y1 = Math.min(G, y1);
    return sat[y1 * W + x1]! - sat[y0 * W + x1]! - sat[y1 * W + x0]! + sat[y0 * W + x0]!;
  };
  const palettes = new Set<number>();
  let minRects = Infinity, maxRects = 0;
  const bridgeCount: Record<string, number[]> = { sparse: [], dense: [] };
  const occ = new Uint8Array(G * G);
  cs.forEach((c, i) => {
    const plan = planV18(c);
    const svg = svgTextV18(plan, c);
    const t = plan.settings;
    assert.deepEqual({ palette: plan.palette, settings: t }, settingsV18(c), `code ${i}: the plan's settings are the stream's first draws`);
    // drawn twice (the first 50): packed afresh (not the memo), the same plan and the same SVG bytes
    if (i < 50) {
      const again = packV18(c);
      assert.equal(JSON.stringify(again), JSON.stringify(plan), `code ${i}: a second packing is identical`);
      assert.equal(svgTextV18(again, c), svg, `code ${i}: a second render is byte-identical`);
    }
    assert.ok(Number.isInteger(plan.palette) && plan.palette >= 0 && plan.palette < 5);
    palettes.add(plan.palette);
    const pal = PALETTES_V18[plan.palette]!.colors;
    assert.ok(plan.rects.every(Number.isInteger) && Object.values(t).every(Number.isInteger), `code ${i}: integers only`);
    assert.equal(plan.rects.length % 5, 0);
    const n = plan.rects.length / 5;
    minRects = Math.min(minRects, n); maxRects = Math.max(maxRects, n);
    // the SVG: canonical, the background then every rectangle in order, coloured by its kind, nothing else
    assert.ok(!/\d\.\d/.test(svg.slice(svg.indexOf("\n"))) && !svg.includes("\r") && !svg.includes("\t") && svg.endsWith("</svg>\n"), `code ${i}: canonical text`);
    assert.ok(svg.includes(`viewBox="0 0 1200 1200"`) && svg.includes(`shape-rendering="crispEdges"`) && !svg.includes("stroke"));
    assert.ok(svg.includes(`<desc>${V18_COPYRIGHT}</desc>`) && svg.includes(`<metadata>bitgraph-art/18 commitment ${toBase64Url(c)}; ${settingsTextV18(plan)}</metadata>`));
    assert.deepEqual(readCommitmentV18(new TextEncoder().encode(svg)), c);
    const rects = rectsOf(svg);
    assert.equal(rects.length, n + 1);
    assert.equal(svg.split("\n").length, n + 8, `code ${i}: one element a line`);
    assert.deepEqual(rects[0], [0, 0, 1200, 1200, pal[0]]);

    occ.fill(0);
    let bridge = 0, field = 0;
    for (let k = 0; k < n; k++) {
      const [x, y, w, h, kind] = plan.rects.slice(5 * k, 5 * k + 5) as [number, number, number, number, number];
      assert.deepEqual(rects[k + 1], [x, y, w, h, pal[kind + 1]], `code ${i}: the SVG draws the plan`);
      assert.ok(w >= 2 && h >= 2 && x >= 0 && y >= 0 && x + w <= G && y + h <= G, `code ${i} rect ${k}: inside the canvas, at least 2 a side`);
      const isBridge = kind === KIND_BRIDGE || kind === KIND_FOOTING;
      if (isBridge) {
        bridge++;
        assert.equal(bridgeIn(x, y, x + w, y + h), w * h, `code ${i} rect ${k}: fully inside the mask`);
        assert.equal(kind, 2 * y + h > 1574 ? KIND_FOOTING : KIND_BRIDGE, `code ${i} rect ${k}: footing below 787`);
        assert.ok(w <= t.bridgeMax && h <= t.bridgeMax, `code ${i} rect ${k}: within the largest bridge rectangle`);
      } else {
        field++;
        assert.ok(kind === KIND_SKY || kind === KIND_WATER);
        assert.equal(bridgeIn(x - t.buffer, y - t.buffer, x + w + t.buffer, y + h + t.buffer), 0, `code ${i} rect ${k}: clear of the mask by the buffer`);
        assert.ok(w <= t.fieldMax && h <= t.fieldMax, `code ${i} rect ${k}: within the largest field rectangle`);
        assert.ok(y + h <= V18_HORIZON || y >= V18_HORIZON, `code ${i} rect ${k}: never across the horizon`);
        assert.equal(kind, y + h <= V18_HORIZON ? KIND_SKY : KIND_WATER, `code ${i} rect ${k}: sky above, water below`);
        assert.ok(x >= t.margin && y >= t.margin && x + w <= G - t.margin && y + h <= G - t.margin, `code ${i} rect ${k}: within the edge margin`);
      }
      // the gap to every rectangle placed before it (the bridge gap in the bridge, plus the offset in the field): so no two ever overlap
      const gap = isBridge ? t.bridgeGap : t.bridgeGap + t.fieldGapOffset;
      for (let yy = Math.max(0, y - gap); yy < Math.min(G, y + h + gap); yy++) {
        const r = yy * G;
        for (let xx = Math.max(0, x - gap); xx < Math.min(G, x + w + gap); xx++) if (occ[r + xx]) assert.fail(`code ${i} rect ${k}: within ${gap} of an earlier rectangle at (${xx}, ${yy})`);
      }
      for (let yy = y; yy < y + h; yy++) occ.fill(1, yy * G + x, yy * G + x + w);
    }
    // the bridge is packed first, then the field
    assert.ok(plan.rects.slice(0, 5 * bridge).every((v, j) => j % 5 !== 4 || v === KIND_BRIDGE || v === KIND_FOOTING));
    assert.ok(bridge >= 50 && field >= 50, `code ${i}: ${bridge} bridge and ${field} field rectangles`);
    if (t.detail <= 3) bridgeCount.sparse!.push(bridge);
    if (t.detail === 6) bridgeCount.dense!.push(bridge);
  });
  assert.equal(palettes.size, 5, "every palette is drawn");
  assert.ok(minRects > 200 && maxRects < 20000, `${minRects} to ${maxRects} rectangles`);
  // the ghosts are drawn: sparse settings give far fewer bridge rectangles than dense ones
  const mean = (a: number[]) => a.reduce((x, y) => x + y, 0) / a.length;
  assert.ok(bridgeCount.sparse!.length > 20 && bridgeCount.dense!.length > 60);
  assert.ok(mean(bridgeCount.sparse!) < 0.5 * mean(bridgeCount.dense!), `sparse ${mean(bridgeCount.sparse!)} vs dense ${mean(bridgeCount.dense!)} bridge rectangles`);
});

test("the PNG is the same picture: its pixels are the SVG's rectangles, its text carries the manifest, the copyright and the SVG", async () => {
  for (let k = 0; k < 3; k++) {
    const c = k === 0 ? C1 : code(`bitgraph-art/18 png ${k}`);
    const plan = planV18(c), svg = svgV18(c);
    const { png, manifest, recipe } = await makeArt(c, ART_ALGORITHM_V18);
    assert.deepEqual(recipe.v18, plan);
    assert.equal(recipe.v16, undefined); assert.equal(recipe.v17, undefined);
    assert.equal(manifest.width, 1200); assert.equal(manifest.height, 1200);
    const d = await decodePng(png);
    assert.equal(d.width, 1200); assert.equal(d.height, 1200);
    assert.deepEqual(d.rgba, renderV18(plan));
    assert.equal(d.texts["bitgraph-art"], manifestJson(manifest));
    assert.equal(d.texts["Copyright"], V18_COPYRIGHT);
    assert.equal(d.texts[V18_SETTINGS_KEYWORD], settingsTextV18(plan), "the PNG states the settings drawn");
    assert.equal(JSON.parse(d.texts["bitgraph-art"]!).commitment, toBase64Url(c));
    assert.deepEqual(svgFromPngV18(png), svg);
    const px = new Uint8Array(G * G * 4);
    for (const [x, y, w, h, fill] of rectsOf(utf8(svg))) {
      const rgb = [1, 3, 5].map((o) => parseInt(fill.slice(o, o + 2), 16));
      for (let yy = y; yy < y + h; yy++) for (let xx = x; xx < x + w; xx++) { const i = (yy * G + xx) * 4; px[i] = rgb[0]!; px[i + 1] = rgb[1]!; px[i + 2] = rgb[2]!; px[i + 3] = 255; }
    }
    assert.ok(px.every((v, i) => v === d.rgba[i]), `code ${k}: SVG and PNG agree`);
    // flat colours only: every pixel is one of the palette's
    const allowed = new Set(PALETTES_V18[plan.palette]!.colors.map((h) => h.slice(1)));
    for (let i = 0; i < d.rgba.length; i += 4) {
      const h = [d.rgba[i]!, d.rgba[i + 1]!, d.rgba[i + 2]!].map((v) => v.toString(16).padStart(2, "0")).join("");
      if (!allowed.has(h)) assert.fail(`code ${k}: pixel ${i / 4} is ${h}, not a palette colour`);
    }
    assert.ok(new TextDecoder("latin1").decode(png).includes(toBase64Url(c)));
  }
});

test("a wrong or damaged SVG reads no commitment; a description names the palette and the count", async () => {
  const svg = svgV18(C1);
  const { png } = await makeArt(C1, ART_ALGORITHM_V18);
  const other = svgV18(code("another code"));
  const at = new TextDecoder("latin1").decode(png).indexOf("<?xml");
  const swapped = png.slice(); swapped.set(other.subarray(0, 4000), at + 1000);
  assert.equal((await checkArt(swapped, C1)).strip.result, "FALSE");
  assert.equal(svgFromPngV18(new Uint8Array([1, 2, 3])), null);
  assert.equal(readCommitmentV18(svg.slice(0, 200)), null);
  assert.equal(readCommitmentV18(new Uint8Array([0xff, 0xfe])), null);
  assert.match(describeV18(planV18(C1)), /^(International orange|Red and black|Night|Sunset|Fog), detail [2-6], [\d,]+ rectangles$/);
  assert.throws(() => planV18(new Uint8Array(31)));
  assert.throws(() => packV18(new Uint8Array(33)));
});

/* ── Redraw from the proof (art-position.ts), against the stub boundary the tree/1 and Three tests use ───────────── */

test("one click on /bridge: recorded in its position as a PNG the verifier finds the commitment in; the proof page rebuilds the PNG and its SVG byte for byte", async () => {
  const stub = await makeStub();
  const made = await createArtImage({ transport: { fetch: stub.fetch }, algorithm: ART_ALGORITHM_V18 });
  assert.equal(made.manifest.algorithm, ART_ALGORITHM_V18);
  assert.deepEqual([made.manifest.width, made.manifest.height], [1200, 1200]);
  assert.equal(stub.commits.length, 1);
  assert.equal((stub.commits[0]!.digests as Array<{ digestB64: string }>)[0]!.digestB64, bytesToBase64(sha256(made.png)));
  assert.equal((await verifyFuse({ proof: made.proof, bytes: made.png })).category, "CARRIED_INLINE");
  assert.equal(made.checks.regenerated.result, "TRUE");
  assert.equal(made.checks.strip.result, "TRUE");
  const c = Uint8Array.from(atob(made.position.commitment.replace(/-/g, "+").replace(/_/g, "/") + "="), (x) => x.charCodeAt(0));
  assert.deepEqual(svgFromPngV18(made.png), svgV18(c));

  // the proof page: the proof alone gives back the recorded PNG, packed afresh (another code clears the memo first)
  planV18(code("clear the memo"));
  const tried: Array<string | null> = [];
  const r = await redrawRecordedArt(made.proof, { onTry: (a) => tried.push(a) });
  assert.ok(r);
  assert.equal(r!.algorithm, ART_ALGORITHM_V18);
  // since 2026-10-11 the 16:9 bridge (version 19, /generate's) is tried before the square one
  assert.deepEqual(tried.filter((a) => a !== null), [ART_ALGORITHM_V17, ART_ALGORITHM_V16, ART_ALGORITHM_V19, ART_ALGORITHM_V18], "the two quick Threes, then the bridges, and no painting");
  assert.equal(bytesToBase64(sha256(r!.png)), made.digestB64);
  assert.deepEqual(svgFromPngV18(r!.png), svgV18(c));
  // coming back to /bridge?p=<digest>
  planV18(code("clear the memo again"));
  const back = await restoreArtImage(made.proof);
  assert.ok(back);
  assert.equal(back!.digestB64, made.digestB64);
  assert.equal(back!.manifest.algorithm, ART_ALGORITHM_V18);
  assert.equal(back!.checks.regenerated.result, "TRUE");
  assert.equal(back!.checks.strip.result, "TRUE");
  // a record signed before version 18 existed is never tried as one
  const seen: Array<string | null> = [];
  assert.equal(await redrawRecordedArt(made.proof, { recordedMs: Date.UTC(2026, 9, 8), onTry: (a) => seen.push(a) }), null);
  assert.ok(!seen.includes(ART_ALGORITHM_V18));
});
