// bitgraph-art/9 (Mike, 2026-10-07): five families layered in one picture, one of them leading, the code in
// 256 reading pixels as version 8 carries it. Pinned, read back from the art alone, printable, fast, and
// registered without becoming the default.
import { test } from "node:test";
import * as assert from "node:assert/strict";
import { sha256 } from "@noble/hashes/sha256";
import { ART_ALGORITHM, ART_ALGORITHM_V9, ART_ALGORITHMS, artRecipe, artSize, checkArt, makeArt, recipeJson, toBase64Url, toHex } from "../commitment-art.ts";
import { PALETTES_V9, TWINS_V9, decodeV9, planV9, renderV9, renderV9At, V9_HEIGHT, V9_WIDTH, type V9Plan } from "../commitment-art-v9.ts";
import { PRINTABLE, drawPrint, printSizeOf } from "../art-print.ts";

const code = (s: string) => sha256(new TextEncoder().encode(s));
const C1 = code("bitgraph-art test commitment one");
const FAMILIES = ["strata", "interference", "cut paper", "blocks", "ribbons"];

/** The composition rule: every family is in the plan, inside its bounds, and every number is an integer. */
function assertComposed(plan: V9Plan, name: string): void {
  assert.ok(plan.dominant >= 0 && plan.dominant <= 4, `${name}: a leading family`);
  assert.ok(plan.strata.bands.length >= 2 && plan.strata.bands.length <= 5, `${name}: 2 to 5 strata, not ${plan.strata.bands.length}`);
  assert.ok(plan.strata.bands.some((b) => b[7] !== 0), `${name}: an ink stratum`);
  assert.equal(plan.interference.families.length, 2, `${name}: two band families`);
  assert.ok(plan.interference.region[0]! >= 0 && plan.interference.region[0]! <= 2, `${name}: a bounded region`);
  assert.equal(plan.interference.table.length, 4);
  assert.ok(plan.paper.length >= 1 && plan.paper.length <= 3, `${name}: 1 to 3 paper shapes, not ${plan.paper.length}`);
  for (const sh of plan.paper) assert.ok(sh.radii.length === 256 || sh.points.length >= 6, `${name}: a shape has an outline`);
  const blocks = plan.blocks.ni * plan.blocks.nj;
  assert.ok(blocks >= 3 && blocks <= 9, `${name}: 3 to 9 blocks, not ${blocks}`);
  assert.equal(plan.blocks.heights.length, blocks);
  assert.ok(plan.blocks.heights.every((h) => h >= 1 && h <= 7), `${name}: blocks 1 to 7 levels high`);
  assert.ok(plan.ribbons.length >= 2 && plan.ribbons.length <= 5, `${name}: 2 to 5 ribbons, not ${plan.ribbons.length}`);
  for (const rb of plan.ribbons) assert.ok(rb.points.length >= 64 && rb.colour >= 1, `${name}: a ribbon is at least 32 steps long and inked`);
  assert.equal(nonIntegers(plan), 0, `${name}: every number in the plan is an integer`);
}
function nonIntegers(v: unknown): number {
  if (typeof v === "number") return Number.isInteger(v) ? 0 : 1;
  if (Array.isArray(v)) return v.reduce((n: number, x) => n + nonIntegers(x), 0);
  if (v && typeof v === "object") return Object.values(v).reduce((n: number, x) => n + nonIntegers(x), 0);
  return 0;
}

test("version 9 is pinned: this commitment's pixels and file never change, and both image checks pass", async () => {
  const a = await makeArt(C1, ART_ALGORITHM_V9), b = await makeArt(C1, ART_ALGORITHM_V9);
  assert.equal(toHex(sha256(a.png)), toHex(sha256(b.png)));
  // Pinned on first run (2026-10-07). A failure here means bitgraph-art/9 changed: make /10 instead.
  assert.equal(toHex(sha256(a.pixels)), PINNED_PIXELS_V9);
  assert.equal(toHex(sha256(a.png)), PINNED_PNG_V9);
  assert.equal(recipeJson(a.recipe), recipeJson(artRecipe(C1, ART_ALGORITHM_V9)));
  assert.deepEqual(artSize(ART_ALGORITHM_V9), { width: 1600, height: 1024 });
  const r = await checkArt(a.png, C1);
  assert.equal(r.regenerated.result, "TRUE");
  assert.equal(r.strip.result, "TRUE");
  assert.match(r.strip.detail, /the art reads/);
  const wrong = await checkArt(a.png, code("another code"));
  assert.equal(wrong.regenerated.result, "FALSE");
  assert.equal(wrong.strip.result, "FALSE");
});

test("version 9 is registered and is the default: a new image is drawn with it (Mike, 2026-10-07)", () => {
  assert.ok(ART_ALGORITHMS.includes(ART_ALGORITHM_V9));
  assert.equal(ART_ALGORITHM, "bitgraph-art/9");
  assert.equal(artRecipe(C1, ART_ALGORITHM_V9).v9?.dominant, planV9(C1).dominant);
});

test("version 9: the art alone spells the code for 40 codes; every plan holds all five families, each leads somewhere, both moods occur", () => {
  const cs = [new Uint8Array(32), new Uint8Array(32).fill(255), C1];
  for (let k = 0; cs.length < 40; k++) cs.push(code(`bitgraph-art/9 readback ${k}`));
  const leading = new Set<number>(), moods = new Set<number>();
  cs.forEach((c, i) => {
    const plan = planV9(c);
    assertComposed(plan, `code ${i}`);
    assert.equal(JSON.stringify(planV9(c)), JSON.stringify(plan), "the same code plans the same picture");
    leading.add(plan.dominant);
    moods.add(plan.loud);
    const px = renderV9(plan, c);
    assert.equal(px.length, V9_WIDTH * V9_HEIGHT * 4);
    assert.deepEqual(decodeV9(px, V9_WIDTH, V9_HEIGHT), c, `code ${i} (${FAMILIES[plan.dominant]} leading) reads back`);
  });
  assert.deepEqual([...leading].sort(), [0, 1, 2, 3, 4], "every family leads at least once in 40");
  assert.deepEqual([...moods].sort(), [0, 1]);
});

test("version 9: only the 256 reading pixels carry the code; two codes with the same plan differ nowhere else", () => {
  const plan = planV9(C1), a = renderV9(plan, new Uint8Array(32)), b = renderV9(plan, new Uint8Array(32).fill(255));
  let diff = 0;
  for (let i = 0; i < a.length; i += 4) if (a[i] !== b[i] || a[i + 1] !== b[i + 1] || a[i + 2] !== b[i + 2]) diff++;
  assert.equal(diff, 256);
});

test("version 9: eleven palettes, and no colour or twin is shared within or between them", () => {
  assert.equal(PALETTES_V9.length, 11);
  const all = PALETTES_V9.flatMap((p, i) => [...p, ...TWINS_V9[i]!].map((c) => c.join(",")));
  assert.equal(new Set(all).size, all.length);
});

test("version 9's print drawing (3x, 4800 x 3072) is the same picture as the recorded one, and the print path serves it", async () => {
  const c = code("print v9"), plan = planV9(c), S = 3;
  const a = renderV9(plan, c), b = renderV9At(plan, c, S), W = 1600 * S;
  let diff = 0;
  for (let y = 0; y < 1024; y++) for (let x = 0; x < 1600; x++) for (let ch = 0; ch < 3; ch++) {
    let s = 0;
    for (let j = 0; j < S; j++) for (let i = 0; i < S; i++) s += b[((y * S + j) * W + x * S + i) * 4 + ch]!;
    diff += Math.abs(s / (S * S) - a[(y * 1600 + x) * 4 + ch]!);
  }
  assert.ok(diff / (1600 * 1024 * 3) < 2, `mean difference ${(diff / (1600 * 1024 * 3)).toFixed(2)} of 255`);
  assert.ok(PRINTABLE.includes(ART_ALGORITHM_V9));
  assert.deepEqual(printSizeOf(ART_ALGORITHM_V9), { width: 4800, height: 3072 });
  const bytes = await drawPrint({ commitment: toBase64Url(c), counter: 9, digestB64: "x", algorithm: ART_ALGORITHM_V9 });
  assert.deepEqual([...bytes.subarray(0, 4)], [137, 80, 78, 71]);
  const text = new TextDecoder("latin1").decode(bytes.subarray(0, 4096));
  assert.ok(text.includes("bitgraph-art/9") && text.includes('"scale":3'), "the print note names the version and the scale");
  assert.ok(!text.includes(toBase64Url(c)), "the commitment is not carried");
});

test("version 9 draws fast: under 1.5 s at the recorded size, whichever family leads", () => {
  // one code per leading family, the first found scanning fixed seeds
  const seeds = new Map<number, Uint8Array>();
  for (let k = 0; seeds.size < 5; k++) { const c = code(`bitgraph-art/9 speed ${k}`); const d = planV9(c).dominant; if (!seeds.has(d)) seeds.set(d, c); }
  for (const [d, c] of seeds) {
    const t0 = performance.now();
    renderV9(planV9(c), c);
    const ms = performance.now() - t0;
    assert.ok(ms < 1500, `${FAMILIES[d]} leading: ${ms.toFixed(0)} ms`);
  }
});

const PINNED_PIXELS_V9 = "f5af30e4bec5d4118ca857348b19f06b68b6af32c98d2dfc3f3c88da9a7d82fd";
const PINNED_PNG_V9 = "e2179ee0a3153e038c1e4bc12c37ccaf7c10cf342e47f55e8501abb149e38dc7";
