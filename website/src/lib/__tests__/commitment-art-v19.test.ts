// bitgraph-art/19 (2026-10-11), "Bridge" at 16:9: version 18's bridge on a 1920 x 1080 canvas, the silhouette redrawn wide,
// every draw from the commitment's labeled SHA-256 stream, integers only, the recorded PNG carrying its print SVG; /generate
// makes it. Pinned; versions 16, 17 and 18 untouched; the mask pinned and its parts checked (two legs and four struts a
// tower, continuous double cables re-derived exactly in BigInt, suspenders); the settings' distributions checked over 200
// codes; 200 codes property-checked under their own settings (30 of them drawn twice); the PNG is the SVG's rectangles;
// the image checks pass and fail as they should; the proof page rebuilds both files from the proof alone.
import { test } from "node:test";
import * as assert from "node:assert/strict";
import { sha256 } from "@noble/hashes/sha256";
import { bytesToBase64, verifyFuse } from "@mikeargento/bitgraph-verify";
import { ART_ALGORITHM, ART_ALGORITHM_V15, ART_ALGORITHM_V16, ART_ALGORITHM_V17, ART_ALGORITHM_V18, ART_ALGORITHMS, artSize, checkArt, decodePng, makeArt, manifestJson, toBase64Url, toHex } from "../commitment-art.ts";
import { svgV16 } from "../commitment-art-v16.ts";
import { svgV17 } from "../commitment-art-v17.ts";
import { PALETTES_V18, bridgeMaskV18, readCommitmentV18, svgV18 } from "../commitment-art-v18.ts";
import {
  ART_ALGORITHM_V19, CABLE_OFFSETS_V19, KIND_BRIDGE, KIND_FOOTING, KIND_SKY, KIND_WATER, PALETTES_V19, STRUTS_V19, TOWER_CENTERS_V19, V19_COPYRIGHT, V19_DECK_TOP, V19_FOOTING_LINE,
  V19_HEIGHT, V19_HORIZON, V19_SETTINGS_KEYWORD, V19_SETTING_RANGES, V19_WIDTH, bridgeMaskV19, cableMaskV19, describeV19, maskRectsV19, packV19, planV19, readCommitmentV19, renderV19,
  settingsTextV19, settingsV19, suspendersV19, svgFromPngV19, svgTextV19, svgV19, type V19Settings,
} from "../commitment-art-v19.ts";
import { createArtImage, redrawRecordedArt, restoreArtImage } from "../art-position.ts";
import { makeStub } from "./tree1-helpers.ts";

const code = (s: string) => sha256(new TextEncoder().encode(s));
const C1 = code("bitgraph-art test commitment one");
const utf8 = (b: Uint8Array) => new TextDecoder("utf-8", { fatal: true }).decode(b);
const W = 1920, H = 1080;

// Pinned 2026-10-11, before any piece was recorded. A failure here means bitgraph-art/19 changed: make /20 instead.
const PINNED_SVG_V19 = "aae83ec9e85bdb02a2dfc2519f959044382723ed689272f76bbafedca18baff9";
const PINNED_PNG_V19 = "a362e888187d5efbd7cb84ff0a0bb7a701df241a0fecd0def5b822897be6f444";
const PINNED_MASK_V19 = "08aa550e623c82bb92b9e6b65a89712484db7a526e08910353a959bb4d56bdad";
// Versions 16, 17 and 18's own pins (their tests), repeated: version 19 shares version 18's engine and writes their file.
const PINNED_SVG_V16 = "e322b1a099dccf4f07cdd836c7d92d7c8ae808446c62c828dbb04f971ff76752";
const PINNED_PNG_V16 = "6149eda29355c2d07f4b67d0821094884a976cb271e46a078faf0ed6c13f9185";
const PINNED_SVG_V17 = "06c80064d5b8bd296a01481d4eb16b99154c22894a5275a0cc249e5af14c7972";
const PINNED_PNG_V17 = "75d87c4536300803ddd72168fdee9d10e60c0249707b142054571f0110821645";
const PINNED_SVG_V18 = "9c43f7621a872f129e8c6d39672c2fef2cfac480c6583cccedfbfabc2a98ec48";
const PINNED_PNG_V18 = "71db0ede89dd7159b1b47e69c9bb376936550a35ab6b59adc7f4259b06b0ce1a";
const PINNED_MASK_V18 = "e33d85adab2288db77ab2696a1f180c68aab44f7016d95f81b8b02346e9bc1d2";

test("version 19 is pinned: this commitment's SVG and recorded PNG never change, and both image checks pass", async () => {
  const a = await makeArt(C1, ART_ALGORITHM_V19);
  const svg = svgV19(C1);
  assert.equal(svgTextV19(packV19(C1), C1), utf8(svg), "a fresh packing writes the same SVG");
  assert.equal(toHex(sha256(a.png)), toHex(sha256((await makeArt(C1, ART_ALGORITHM_V19)).png)));
  assert.equal(toHex(sha256(svg)), PINNED_SVG_V19);
  assert.equal(toHex(sha256(a.png)), PINNED_PNG_V19);
  assert.deepEqual(svgFromPngV19(a.png), svg);
  assert.deepEqual(artSize(ART_ALGORITHM_V19), { width: 1920, height: 1080 });
  const r = await checkArt(a.png, C1);
  assert.equal(r.regenerated.result, "TRUE");
  assert.equal(r.strip.result, "TRUE");
  assert.match(r.strip.detail, /print SVG inside the file is the one drawn from the authenticated commitment/);
  const wrong = await checkArt(a.png, code("another code"));
  assert.equal(wrong.regenerated.result, "FALSE");
  assert.equal(wrong.strip.result, "FALSE");
});

test("versions 16, 17 and 18 are untouched by version 19: their pinned SVGs, PNGs and version 18's mask", async () => {
  assert.equal(toHex(sha256(svgV16(C1))), PINNED_SVG_V16);
  assert.equal(toHex(sha256((await makeArt(C1, ART_ALGORITHM_V16)).png)), PINNED_PNG_V16);
  assert.equal(toHex(sha256(svgV17(C1))), PINNED_SVG_V17);
  assert.equal(toHex(sha256((await makeArt(C1, ART_ALGORITHM_V17)).png)), PINNED_PNG_V17);
  assert.equal(toHex(sha256(svgV18(C1))), PINNED_SVG_V18);
  assert.equal(toHex(sha256((await makeArt(C1, ART_ALGORITHM_V18)).png)), PINNED_PNG_V18);
  assert.equal(toHex(sha256(bridgeMaskV18())), PINNED_MASK_V18);
  // each version reads only its own metadata
  assert.equal(readCommitmentV19(svgV18(C1)), null, "a version 18 SVG states no version 19 commitment");
  assert.equal(readCommitmentV18(svgV19(C1)), null, "a version 19 SVG states no version 18 commitment");
  // the same commitment draws a different piece under each label
  assert.notEqual(toHex(sha256(svgV18(C1))), toHex(sha256(svgV19(C1))));
});

test("version 19 is registered, 1920 x 1080, and is not the default", () => {
  assert.equal(ART_ALGORITHM_V19, "bitgraph-art/19");
  assert.ok(ART_ALGORITHMS.includes(ART_ALGORITHM_V19));
  assert.equal(ART_ALGORITHM, ART_ALGORITHM_V15);
  assert.deepEqual([V19_WIDTH, V19_HEIGHT], [1920, 1080]);
});

test("the five palettes are version 18's presets", () => {
  assert.deepEqual(PALETTES_V19.map((p) => [p.name, [...p.colors]]), PALETTES_V18.map((p) => [p.name, [...p.colors]]));
  assert.equal(PALETTES_V19.length, 5);
});

/* ── The mask ─────────────────────────────────────────────────────────────────────────────────────────────────────── */

test("the mask is pinned, binary, the same object every call, and nothing of the bridge lies outside its parts", () => {
  const m = bridgeMaskV19();
  assert.equal(m, bridgeMaskV19());
  assert.equal(m.length, W * H);
  assert.ok(m.every((v) => v === 0 || v === 1));
  assert.equal(toHex(sha256(m)), PINNED_MASK_V19);
  // rebuilt from its parts: the rectangles, the two cables, the suspenders
  const re = new Uint8Array(W * H);
  const fill = (x0: number, y0: number, x1: number, y1: number) => { for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) re[y * W + x] = 1; };
  for (const [x0, y0, x1, y1] of maskRectsV19()) fill(x0, y0, x1, y1);
  for (const off of CABLE_OFFSETS_V19) cableMaskV19(off).forEach((v, i) => { if (v) re[i] = 1; });
  for (const { x, top } of suspendersV19()) fill(x - 2, top, x + 2, V19_DECK_TOP);
  assert.deepEqual(re, m);
  // the canvas edges, the sky's top and the water's foot are empty; the deck reaches nearly edge to edge (80 to 1840)
  for (let x = 0; x < W; x++) for (const y of [0, 200, 850, 1079]) assert.equal(m[y * W + x], 0);
  for (let y = 0; y < H; y++) for (const x of [0, 70, 1850, 1919]) assert.equal(m[y * W + x], 0);
  for (const x of [80, 960, 1839]) assert.equal(m[610 * W + x], 1, `the deck at x = ${x}`);
  assert.equal(m[610 * W + 79], 0); assert.equal(m[610 * W + 1840], 0);
  // below the horizon only piers, footings and slabs
  for (let y = V19_HORIZON; y < H; y++) for (let x = 0; x < W; x++) {
    if (!m[y * W + x]) continue;
    assert.ok(TOWER_CENTERS_V19.some((cx) => Math.abs(x + 0.5 - cx) < 75 && y < 781), `(${x}, ${y}) under the deck belongs to a tower`);
  }
  // the bridge's extent: finials at 269, slabs to 781; sky above it and water below it both have room
  let top = H, bottom = 0;
  for (let i = 0; i < m.length; i++) if (m[i]) { const y = (i / W) | 0; if (y < top) top = y; if (y > bottom) bottom = y; }
  assert.deepEqual([top, bottom], [269, 780]);
  assert.ok(top >= 0.24 * H && H - bottom - 1 >= 0.27 * H);
});

test("each tower has two legs and four struts, a pier, footing and slab under it, and finials on top", () => {
  const m = bridgeMaskV19();
  const runs = (xs: boolean[]) => { const out: Array<[number, number]> = []; let start = -1; xs.forEach((v, i) => { if (v && start < 0) start = i; if (!v && start >= 0) { out.push([start, i]); start = -1; } }); if (start >= 0) out.push([start, xs.length]); return out; };
  for (const cx of TOWER_CENTERS_V19) {
    // full columns from 290 to 640 near the tower: exactly the two legs, 28 wide each
    const cols: boolean[] = [];
    for (let x = cx - 70; x < cx + 70; x++) { let full = true; for (let y = 290; y < 640; y++) if (!m[y * W + x]) { full = false; break; } cols.push(full); }
    assert.deepEqual(runs(cols).map(([a, b]) => [a + cx - 70, b + cx - 70]), [[cx - 46, cx - 18], [cx + 18, cx + 46]], `tower ${cx}: two legs`);
    // full rows between the legs, above the deck: exactly the four struts
    const rows: boolean[] = [];
    for (let y = 270; y < V19_DECK_TOP; y++) { let full = true; for (let x = cx - 18; x < cx + 18; x++) if (!m[y * W + x]) { full = false; break; } rows.push(full); }
    assert.deepEqual(runs(rows).map(([a, b]) => [a + 270, b + 270]), STRUTS_V19.map(([a, b]) => [a, b]), `tower ${cx}: four struts`);
    // piers to 745, footings to 773, the slab to 781, and the finials reach 269
    for (const x of [cx - 32, cx + 32]) { assert.equal(m[700 * W + x], 1); assert.equal(m[760 * W + x], 1); assert.equal(m[269 * W + x], 1); assert.equal(m[268 * W + x], 0); }
    assert.equal(m[778 * W + cx - 74], 1); assert.equal(m[778 * W + cx + 74], 1); assert.equal(m[781 * W + cx], 0);
    // the footing line is the piers' foot
    assert.equal(V19_FOOTING_LINE, 745);
  }
});

test("the cables: the integer rule re-derived exactly (BigInt) from the header, one connected run from deck end to deck end, at least 8 pixels a column, doubled and crossing", () => {
  const m = bridgeMaskV19();
  const cables = CABLE_OFFSETS_V19.map((off) => cableMaskV19(off));
  const SAFE = BigInt(Number.MAX_SAFE_INTEGER);
  for (const [k, c] of cables.entries()) {
    const off = CABLE_OFFSETS_V19[k]!;
    // the header's rule, in exact integers: every product the engine forms stays below 2^53
    const xa = 532 + off, xb = 1388 + off;
    const want = new Uint8Array(W * H);
    for (let X = 80; X < 1840; X++) {
      const main = X >= xa && X < xb;
      const [Y0, A, x0, L] = main ? [601, 307, 960 + off, 428] : X < xa ? [603, 309, 80, xa - 80] : [603, 309, 1840, 1840 - xb];
      const t = BigInt(2 * X + 1 - 2 * x0), Q = 4n * BigInt(L) * BigInt(L), N = BigInt(Y0) * Q - BigInt(A) * t * t;
      const rhs = 64n * (Q * Q + 16n * BigInt(A) * BigInt(A) * t * t);
      assert.ok(rhs < SAFE && N > 0n);
      // every row within 40 of the curve (E grows with the distance, so none further can qualify)
      const yr = Number(N / Q);
      for (let Y = yr - 40; Y <= yr + 40; Y++) {
        const E = BigInt(2 * Y + 1) * Q - 2n * N;
        if (E * E <= rhs) { want[Y * W + X] = 1; assert.ok(E * E < SAFE); }
      }
      // the engine's search band (12 rows either side of the curve's row) holds every cable pixel, its products below 2^53
      const yc = N / Q;
      for (const Y of [yc - 12n, yc + 12n]) { const E = (2n * Y + 1n) * Q - 2n * N; assert.ok(E * E < SAFE); assert.ok(E * E > rhs, `column ${X}: the band is wide enough`); }
    }
    for (const ex of [80, 1840]) for (let X = ex - 6; X <= ex + 6; X++) for (let Y = 597; Y <= 609; Y++) {
      const dx = 2 * X + 1 - 2 * ex, dy = 2 * Y + 1 - 1206;
      if (dx * dx + dy * dy <= 64) want[Y * W + X] = 1;
    }
    assert.deepEqual(c, want, `cable ${k}: the engine draws the header's rule exactly`);
    for (let i = 0; i < c.length; i++) if (c[i]) assert.equal(m[i], 1, "the cable is in the mask");
    for (let X = 80; X < 1840; X++) { let n = 0; for (let Y = 0; Y < H; Y++) n += c[Y * W + X]!; assert.ok(n >= 8, `cable ${k}, column ${X}: ${n} pixels`); }
    // one 4-connected component, holding both deck ends
    const seen = new Uint8Array(W * H);
    const start = 603 * W + 80;
    assert.equal(c[start], 1);
    const stack = [start]; seen[start] = 1; let count = 0;
    while (stack.length) {
      const i = stack.pop()!; count++;
      const x = i % W;
      for (const j of [x > 0 ? i - 1 : -1, x < W - 1 ? i + 1 : -1, i - W, i + W]) if (j >= 0 && j < W * H && c[j] && !seen[j]) { seen[j] = 1; stack.push(j); }
    }
    assert.equal(count, c.reduce((a, b) => a + b, 0), `cable ${k} is one connected run`);
    assert.equal(seen[603 * W + 1839], 1, `cable ${k} reaches the far deck end`);
    // it rises to the saddles over the legs (y 294) and sags to 601 mid-span
    for (const cx of TOWER_CENTERS_V19) assert.equal(c[294 * W + cx + off], 1);
    assert.equal(c[601 * W + 960 + off], 1);
  }
  // doubled: over most of the main span the two run apart; crossed: some columns hold both at once
  let apart = 0, together = 0;
  for (let X = 620; X < 1300; X++) {
    let a = false, b = false, both = false;
    for (let Y = 280; Y < 640; Y++) { const i = Y * W + X; a ||= cables[0]![i] === 1; b ||= cables[1]![i] === 1; both ||= cables[0]![i] === 1 && cables[1]![i] === 1; }
    assert.ok(a && b);
    if (both) together++; else apart++;
  }
  assert.ok(apart > 500 && together > 0, `apart ${apart}, crossing ${together}`);
});

test("the suspenders: every 21 from 92, none within 54 of a tower or shorter than 16, each hung from the higher cable", () => {
  const m = bridgeMaskV19();
  const s = suspendersV19();
  assert.ok(s.length >= 55, `${s.length} suspenders`);
  const cables = CABLE_OFFSETS_V19.map((off) => cableMaskV19(off));
  for (const { x, top } of s) {
    assert.equal((x - 92) % 21, 0);
    assert.ok(Math.abs(x - 532) >= 54 && Math.abs(x - 1388) >= 54);
    assert.ok(V19_DECK_TOP - top >= 16);
    for (let y = top; y < V19_DECK_TOP; y++) for (let xx = x - 2; xx < x + 2; xx++) assert.equal(m[y * W + xx], 1);
    assert.ok(cables.some((c) => c[top * W + x] === 1 || c[(top + 1) * W + x] === 1), `suspender ${x} hangs from a cable`);
  }
  // all three spans carry some
  for (const [a, b] of [[80, 478], [586, 1334], [1442, 1840]]) assert.ok(s.some(({ x }) => x >= a && x < b), `span ${a}-${b}`);
});

/* ── The pieces ───────────────────────────────────────────────────────────────────────────────────────────────────── */

/** The rectangles of a canonical SVG, read back from its text: [x, y, w, h, fill]. */
function rectsOf(svg: string): Array<[number, number, number, number, string]> {
  return [...svg.matchAll(/<rect x="(\d+)" y="(\d+)" width="(\d+)" height="(\d+)" fill="(#[0-9a-f]{6})"\/>/g)].map((m) => [Number(m[1]), Number(m[2]), Number(m[3]), Number(m[4]), m[5]!]);
}

test("the settings: every one in its range, spread across it, sparse ghost bridges about 1 in 5 and dense ones most often (200 codes)", () => {
  const n = 200;
  const all: Array<{ palette: number; settings: V19Settings }> = [];
  for (let k = 0; k < n; k++) all.push(settingsV19(code(`bitgraph-art/19 settings ${k}`)));
  for (const { palette, settings } of all) {
    assert.ok(Number.isInteger(palette) && palette >= 0 && palette < 5);
    for (const [key, [lo, hi]] of Object.entries(V19_SETTING_RANGES)) {
      const v = settings[key as keyof V19Settings];
      assert.ok(Number.isInteger(v) && v >= lo && v <= hi, `${key} ${v} in ${lo} to ${hi}`);
    }
    assert.equal(settings.fieldMax % 10, 0, "the field's largest side moves in tens");
  }
  const share = (f: (s: V19Settings) => boolean) => all.filter((a) => f(a.settings)).length / n;
  const sparse = share((s) => s.detail <= 3), dense = share((s) => s.detail >= 5);
  assert.ok(sparse >= 0.12 && sparse <= 0.3, `sparse (detail 2 or 3) ${sparse}`);
  assert.ok(dense >= 0.5, `dense (detail 5 or 6) ${dense}`);
  assert.ok(share((s) => s.detail === 2) > 0 && share((s) => s.detail === 6) > share((s) => s.detail === 4));
  const values = (key: keyof V19Settings) => new Set(all.map((a) => a.settings[key]));
  assert.deepEqual([...values("detail")].sort(), [2, 3, 4, 5, 6]);
  assert.deepEqual([...values("bridgeGap")].sort(), [1, 2, 3, 4, 5]);
  assert.ok(share((s) => s.bridgeGap === 1) > share((s) => s.bridgeGap === 5), "tight bridge gaps most often");
  const spans: Array<[keyof V19Settings, number, number]> = [["fieldGapOffset", 1, 10], ["buffer", 3, 15], ["margin", 14, 62], ["bars", 20, 80], ["bridgeMax", 58, 152], ["fieldMax", 240, 550]];
  for (const [key, low, high] of spans) {
    assert.ok(share((s) => s[key] <= low) > 0 && share((s) => s[key] >= high) > 0, `${key} reaches both ends`);
    assert.ok(values(key).size >= 8, `${key} takes many values`);
  }
  assert.equal(new Set(all.map((a) => a.palette)).size, 5, "every palette");
});

test("200 codes under their own settings: no overlaps, the gaps kept, bridge inside the mask, field clear of it by the buffer, never across the horizon, inside the margin, sizes within the largest, colors by position, integers only; 30 drawn twice, byte for byte; sparse settings draw sparse bridges", () => {
  const cs = [new Uint8Array(32), new Uint8Array(32).fill(255), C1];
  for (let k = 0; cs.length < 200; k++) cs.push(code(`bitgraph-art/19 property ${k}`));
  const mask = bridgeMaskV19();
  const SW = W + 1, sat = new Int32Array(SW * (H + 1));
  for (let y = 1; y <= H; y++) { let row = 0; for (let x = 1; x <= W; x++) { row += mask[(y - 1) * W + (x - 1)]!; sat[y * SW + x] = sat[(y - 1) * SW + x]! + row; } }
  const bridgeIn = (x0: number, y0: number, x1: number, y1: number) => {
    x0 = Math.max(0, x0); y0 = Math.max(0, y0); x1 = Math.min(W, x1); y1 = Math.min(H, y1);
    return sat[y1 * SW + x1]! - sat[y0 * SW + x1]! - sat[y1 * SW + x0]! + sat[y0 * SW + x0]!;
  };
  const palettes = new Set<number>();
  let minRects = Infinity, maxRects = 0;
  const bridgeCount: Record<string, number[]> = { sparse: [], dense: [] };
  const occ = new Uint8Array(W * H);
  cs.forEach((c, i) => {
    const plan = planV19(c);
    const svg = svgTextV19(plan, c);
    const t = plan.settings;
    assert.deepEqual({ palette: plan.palette, settings: t }, settingsV19(c), `code ${i}: the plan's settings are the stream's first draws`);
    if (i < 30) {
      const again = packV19(c);
      assert.equal(JSON.stringify(again), JSON.stringify(plan), `code ${i}: a second packing is identical`);
      assert.equal(svgTextV19(again, c), svg, `code ${i}: a second render is byte-identical`);
    }
    palettes.add(plan.palette);
    const pal = PALETTES_V19[plan.palette]!.colors;
    assert.ok(plan.rects.every(Number.isInteger) && Object.values(t).every(Number.isInteger), `code ${i}: integers only`);
    assert.equal(plan.rects.length % 5, 0);
    const n = plan.rects.length / 5;
    minRects = Math.min(minRects, n); maxRects = Math.max(maxRects, n);
    assert.ok(!/\d\.\d/.test(svg.slice(svg.indexOf("\n"))) && !svg.includes("\r") && !svg.includes("\t") && svg.endsWith("</svg>\n"), `code ${i}: canonical text`);
    assert.ok(svg.includes(`viewBox="0 0 1920 1080"`) && svg.includes(`shape-rendering="crispEdges"`) && !svg.includes("stroke"));
    assert.ok(svg.includes(`<desc>${V19_COPYRIGHT}</desc>`) && svg.includes(`<metadata>bitgraph-art/19 commitment ${toBase64Url(c)}; ${settingsTextV19(plan)}</metadata>`));
    assert.deepEqual(readCommitmentV19(new TextEncoder().encode(svg)), c);
    const rects = rectsOf(svg);
    assert.equal(rects.length, n + 1);
    assert.equal(svg.split("\n").length, n + 8, `code ${i}: one element a line`);
    assert.deepEqual(rects[0], [0, 0, 1920, 1080, pal[0]]);

    occ.fill(0);
    let bridge = 0, field = 0;
    for (let k = 0; k < n; k++) {
      const [x, y, w, h, kind] = plan.rects.slice(5 * k, 5 * k + 5) as [number, number, number, number, number];
      assert.deepEqual(rects[k + 1], [x, y, w, h, pal[kind + 1]], `code ${i}: the SVG draws the plan`);
      assert.ok(w >= 2 && h >= 2 && x >= 0 && y >= 0 && x + w <= W && y + h <= H, `code ${i} rect ${k}: inside the canvas, at least 2 a side`);
      const isBridge = kind === KIND_BRIDGE || kind === KIND_FOOTING;
      if (isBridge) {
        bridge++;
        assert.equal(bridgeIn(x, y, x + w, y + h), w * h, `code ${i} rect ${k}: fully inside the mask`);
        assert.equal(kind, 2 * y + h > 2 * V19_FOOTING_LINE ? KIND_FOOTING : KIND_BRIDGE, `code ${i} rect ${k}: footing below 745`);
        assert.ok(w <= t.bridgeMax && h <= t.bridgeMax, `code ${i} rect ${k}: within the largest bridge rectangle`);
      } else {
        field++;
        assert.ok(kind === KIND_SKY || kind === KIND_WATER);
        assert.equal(bridgeIn(x - t.buffer, y - t.buffer, x + w + t.buffer, y + h + t.buffer), 0, `code ${i} rect ${k}: clear of the mask by the buffer`);
        assert.ok(w <= t.fieldMax && h <= t.fieldMax, `code ${i} rect ${k}: within the largest field rectangle`);
        assert.ok(y + h <= V19_HORIZON || y >= V19_HORIZON, `code ${i} rect ${k}: never across the horizon`);
        assert.equal(kind, y + h <= V19_HORIZON ? KIND_SKY : KIND_WATER, `code ${i} rect ${k}: sky above, water below`);
        assert.ok(x >= t.margin && y >= t.margin && x + w <= W - t.margin && y + h <= H - t.margin, `code ${i} rect ${k}: within the edge margin`);
      }
      const gap = isBridge ? t.bridgeGap : t.bridgeGap + t.fieldGapOffset;
      for (let yy = Math.max(0, y - gap); yy < Math.min(H, y + h + gap); yy++) {
        const r = yy * W;
        for (let xx = Math.max(0, x - gap); xx < Math.min(W, x + w + gap); xx++) if (occ[r + xx]) assert.fail(`code ${i} rect ${k}: within ${gap} of an earlier rectangle at (${xx}, ${yy})`);
      }
      for (let yy = y; yy < y + h; yy++) occ.fill(1, yy * W + x, yy * W + x + w);
    }
    assert.ok(plan.rects.slice(0, 5 * bridge).every((v, j) => j % 5 !== 4 || v === KIND_BRIDGE || v === KIND_FOOTING), `code ${i}: the bridge is packed first`);
    assert.ok(bridge >= 50 && field >= 50, `code ${i}: ${bridge} bridge and ${field} field rectangles`);
    if (t.detail <= 3) bridgeCount.sparse!.push(bridge);
    if (t.detail === 6) bridgeCount.dense!.push(bridge);
  });
  assert.equal(palettes.size, 5, "every palette is drawn");
  assert.ok(minRects > 200 && maxRects < 30000, `${minRects} to ${maxRects} rectangles`);
  const mean = (a: number[]) => a.reduce((x, y) => x + y, 0) / a.length;
  assert.ok(bridgeCount.sparse!.length > 15 && bridgeCount.dense!.length > 40);
  assert.ok(mean(bridgeCount.sparse!) < 0.5 * mean(bridgeCount.dense!), `sparse ${mean(bridgeCount.sparse!)} vs dense ${mean(bridgeCount.dense!)} bridge rectangles`);
});

test("the PNG is the same picture: its pixels are the SVG's rectangles, its text carries the manifest, the copyright, the settings and the SVG", async () => {
  for (let k = 0; k < 3; k++) {
    const c = k === 0 ? C1 : code(`bitgraph-art/19 png ${k}`);
    const plan = planV19(c), svg = svgV19(c);
    const { png, manifest, recipe } = await makeArt(c, ART_ALGORITHM_V19);
    assert.deepEqual(recipe.v19, plan);
    assert.equal(recipe.v18, undefined); assert.equal(recipe.v17, undefined);
    assert.equal(manifest.width, 1920); assert.equal(manifest.height, 1080);
    const d = await decodePng(png);
    assert.equal(d.width, 1920); assert.equal(d.height, 1080);
    assert.deepEqual(d.rgba, renderV19(plan));
    assert.equal(d.texts["bitgraph-art"], manifestJson(manifest));
    assert.equal(d.texts["Copyright"], V19_COPYRIGHT);
    assert.equal(d.texts[V19_SETTINGS_KEYWORD], settingsTextV19(plan), "the PNG states the settings drawn");
    assert.equal(JSON.parse(d.texts["bitgraph-art"]!).commitment, toBase64Url(c));
    assert.deepEqual(svgFromPngV19(png), svg);
    const px = new Uint8Array(W * H * 4);
    for (const [x, y, w, h, fill] of rectsOf(utf8(svg))) {
      const rgb = [1, 3, 5].map((o) => parseInt(fill.slice(o, o + 2), 16));
      for (let yy = y; yy < y + h; yy++) for (let xx = x; xx < x + w; xx++) { const i = (yy * W + xx) * 4; px[i] = rgb[0]!; px[i + 1] = rgb[1]!; px[i + 2] = rgb[2]!; px[i + 3] = 255; }
    }
    assert.ok(px.every((v, i) => v === d.rgba[i]), `code ${k}: SVG and PNG agree`);
    const allowed = new Set(PALETTES_V19[plan.palette]!.colors.map((h) => h.slice(1)));
    for (let i = 0; i < d.rgba.length; i += 4) {
      const h = [d.rgba[i]!, d.rgba[i + 1]!, d.rgba[i + 2]!].map((v) => v.toString(16).padStart(2, "0")).join("");
      if (!allowed.has(h)) assert.fail(`code ${k}: pixel ${i / 4} is ${h}, not a palette color`);
    }
    assert.ok(new TextDecoder("latin1").decode(png).includes(toBase64Url(c)));
  }
});

test("a wrong or damaged SVG reads no commitment; a version 18 file is not a version 19 one; a description names the palette and the count", async () => {
  const svg = svgV19(C1);
  const { png } = await makeArt(C1, ART_ALGORITHM_V19);
  const other = svgV19(code("another code"));
  const at = new TextDecoder("latin1").decode(png).indexOf("<?xml");
  const swapped = png.slice(); swapped.set(other.subarray(0, 4000), at + 1000);
  assert.equal((await checkArt(swapped, C1)).strip.result, "FALSE");
  assert.equal(svgFromPngV19(new Uint8Array([1, 2, 3])), null);
  assert.equal(readCommitmentV19(svg.slice(0, 200)), null);
  assert.equal(readCommitmentV19(new Uint8Array([0xff, 0xfe])), null);
  // a version 18 PNG checked against its commitment passes as version 18, never as 19 (the manifest names its version)
  const v18 = await makeArt(C1, ART_ALGORITHM_V18);
  assert.match((await checkArt(v18.png, C1)).regenerated.detail, /bitgraph-art\/18/);
  assert.match(describeV19(planV19(C1)), /^(International orange|Red and black|Night|Sunset|Fog), detail [2-6], [\d,]+ rectangles$/);
  assert.throws(() => planV19(new Uint8Array(31)));
  assert.throws(() => packV19(new Uint8Array(33)));
});

/* ── Redraw from the proof (art-position.ts), against the stub boundary the tree/1 and Three tests use ───────────── */

test("one click on /generate: recorded in its position as a PNG the verifier finds the commitment in; the proof page rebuilds the PNG and its SVG byte for byte", async () => {
  const stub = await makeStub();
  const made = await createArtImage({ transport: { fetch: stub.fetch }, algorithm: ART_ALGORITHM_V19 });
  assert.equal(made.manifest.algorithm, ART_ALGORITHM_V19);
  assert.deepEqual([made.manifest.width, made.manifest.height], [1920, 1080]);
  assert.equal(stub.commits.length, 1);
  assert.equal((stub.commits[0]!.digests as Array<{ digestB64: string }>)[0]!.digestB64, bytesToBase64(sha256(made.png)));
  assert.equal((await verifyFuse({ proof: made.proof, bytes: made.png })).category, "CARRIED_INLINE");
  assert.equal(made.checks.regenerated.result, "TRUE");
  assert.equal(made.checks.strip.result, "TRUE");
  const c = Uint8Array.from(atob(made.position.commitment.replace(/-/g, "+").replace(/_/g, "/") + "="), (x) => x.charCodeAt(0));
  assert.deepEqual(svgFromPngV19(made.png), svgV19(c));

  // the proof page: the proof alone gives back the recorded PNG, packed afresh (another code clears the memo first)
  planV19(code("clear the memo"));
  const tried: Array<string | null> = [];
  const r = await redrawRecordedArt(made.proof, { onTry: (a) => tried.push(a) });
  assert.ok(r);
  assert.equal(r!.algorithm, ART_ALGORITHM_V19);
  assert.deepEqual(tried.filter((a) => a !== null), [ART_ALGORITHM_V17, ART_ALGORITHM_V16, ART_ALGORITHM_V19], "the two quick Threes, then the 16:9 bridge, before the square bridge or any painting");
  assert.equal(bytesToBase64(sha256(r!.png)), made.digestB64);
  assert.deepEqual(svgFromPngV19(r!.png), svgV19(c));
  // coming back to /generate?p=<digest>
  planV19(code("clear the memo again"));
  const back = await restoreArtImage(made.proof);
  assert.ok(back);
  assert.equal(back!.digestB64, made.digestB64);
  assert.equal(back!.manifest.algorithm, ART_ALGORITHM_V19);
  assert.equal(back!.checks.regenerated.result, "TRUE");
  assert.equal(back!.checks.strip.result, "TRUE");
  // a record signed before version 19 existed is never tried as one (the date version 16's test uses, so no painting is drawn)
  const seen: Array<string | null> = [];
  assert.equal(await redrawRecordedArt(made.proof, { recordedMs: Date.UTC(2026, 9, 8), onTry: (a) => seen.push(a) }), null);
  assert.ok(!seen.includes(ART_ALGORITHM_V19));
});
