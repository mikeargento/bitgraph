// bitgraph-art/11 (2026-10-08): ink portraits, square, the code in 256 reading pixels as versions 8 to 10
// carry it (with the centre snap, so a reading pixel is never a visible dot). Pinned, read back from the
// art alone, printable, fast, and the default.
import { test } from "node:test";
import * as assert from "node:assert/strict";
import { sha256 } from "@noble/hashes/sha256";
import { ART_ALGORITHM, ART_ALGORITHM_V11, ART_ALGORITHMS, artRecipe, artSize, checkArt, makeArt, recipeJson, toBase64Url, toHex } from "../commitment-art.ts";
import { PALETTES_V11, TWINS_V11, HAIR_NAMES_V11, EXPRESSION_NAMES_V11, GARMENT_NAMES_V11, PALETTE_NAMES_V11, decodeV11, planV11, renderV11, renderV11At, V11_HEIGHT, V11_WIDTH, type V11Plan } from "../commitment-art-v11.ts";
import { PRINTABLE, drawPrint, printSizeOf } from "../art-print.ts";

const code = (s: string) => sha256(new TextEncoder().encode(s));
const C1 = code("bitgraph-art test commitment one");

/** The composition rule: a palette, a person (an age, a pose, a hair silhouette, an expression, a neckline), every number an integer. */
function assertComposed(plan: V11Plan, name: string): void {
  assert.ok(plan.palette >= 0 && plan.palette < PALETTES_V11.length, `${name}: a palette`);
  assert.ok(plan.age >= 6 && plan.age <= 85, `${name}: an age, not ${plan.age}`);
  assert.ok(Math.abs(plan.yaw) <= 16384 * 72 / 360 + 1, `${name}: a turn within 72 degrees`);
  assert.ok(plan.hair >= 0 && plan.hair < HAIR_NAMES_V11.length, `${name}: a hair silhouette`);
  assert.ok(plan.expr >= 0 && plan.expr < EXPRESSION_NAMES_V11.length, `${name}: an expression`);
  assert.ok(plan.garment >= 0 && plan.garment < GARMENT_NAMES_V11.length, `${name}: a neckline`);
  assert.ok(plan.beard === 0 || plan.age > 18, `${name}: no facial hair on a child`);
  assert.ok(plan.age >= 13 || (plan.earring === 0 && plan.necklace === 0 && plan.ribbon === 0 && plan.lipDark === 0), `${name}: no details on a child`);
  assert.equal(nonIntegers(plan), 0, `${name}: every number in the plan is an integer`);
}
function nonIntegers(v: unknown): number {
  if (typeof v === "number") return Number.isInteger(v) ? 0 : 1;
  if (Array.isArray(v)) return v.reduce((n: number, x) => n + nonIntegers(x), 0);
  if (v && typeof v === "object") return Object.values(v).reduce((n: number, x) => n + nonIntegers(x), 0);
  return 0;
}

test("version 11 is pinned: this commitment's pixels and file never change, and both image checks pass", async () => {
  const a = await makeArt(C1, ART_ALGORITHM_V11), b = await makeArt(C1, ART_ALGORITHM_V11);
  assert.equal(toHex(sha256(a.png)), toHex(sha256(b.png)));
  // Pinned on first run (2026-10-08). A failure here means bitgraph-art/11 changed: make /12 instead.
  assert.equal(toHex(sha256(a.pixels)), PINNED_PIXELS_V11);
  assert.equal(toHex(sha256(a.png)), PINNED_PNG_V11);
  assert.equal(recipeJson(a.recipe), recipeJson(artRecipe(C1, ART_ALGORITHM_V11)));
  assert.deepEqual(artSize(ART_ALGORITHM_V11), { width: 1200, height: 1200 });
  const r = await checkArt(a.png, C1);
  assert.equal(r.regenerated.result, "TRUE");
  assert.equal(r.strip.result, "TRUE");
  assert.match(r.strip.detail, /the art reads/);
  const wrong = await checkArt(a.png, code("another code"));
  assert.equal(wrong.regenerated.result, "FALSE");
  assert.equal(wrong.strip.result, "FALSE");
});

test("version 11 is registered and is the default: a new image is drawn with it (2026-10-08)", () => {
  assert.ok(ART_ALGORITHMS.includes(ART_ALGORITHM_V11));
  assert.equal(ART_ALGORITHM, "bitgraph-art/11");
  assert.equal(artRecipe(C1, ART_ALGORITHM_V11).v11?.hair, planV11(C1).hair);
  assert.equal(artRecipe(C1).algorithm, "bitgraph-art/11");
});

test("version 11: the art alone spells the code for 40 codes; every palette, every expression and at least six hair silhouettes occur", () => {
  const cs = [new Uint8Array(32), new Uint8Array(32).fill(255), C1];
  for (let k = 0; cs.length < 40; k++) cs.push(code(`bitgraph-art/11 readback ${k}`));
  const palettes = new Set<number>(), exprs = new Set<number>(), hairs = new Set<number>();
  cs.forEach((c, i) => {
    const plan = planV11(c);
    assertComposed(plan, `code ${i}`);
    assert.equal(JSON.stringify(planV11(c)), JSON.stringify(plan), "the same code plans the same person");
    palettes.add(plan.palette); exprs.add(plan.expr); hairs.add(plan.hair);
    const px = renderV11(plan, c);
    assert.equal(px.length, V11_WIDTH * V11_HEIGHT * 4);
    assert.deepEqual(decodeV11(px, V11_WIDTH, V11_HEIGHT), c, `code ${i} (${PALETTE_NAMES_V11[plan.palette]}, ${HAIR_NAMES_V11[plan.hair]}, ${EXPRESSION_NAMES_V11[plan.expr]}) reads back`);
  });
  assert.deepEqual([...palettes].sort(), [0, 1, 2, 3], "every palette occurs in 40");
  assert.deepEqual([...exprs].sort(), [0, 1, 2], "every expression occurs in 40");
  assert.ok(hairs.size >= 6, `at least six hair silhouettes in 40, not ${hairs.size}`);
});

test("version 11: only the 256 reading pixels carry the code; two codes with the same plan differ nowhere else", () => {
  const plan = planV11(C1), a = renderV11(plan, new Uint8Array(32)), b = renderV11(plan, new Uint8Array(32).fill(255));
  let diff = 0;
  for (let i = 0; i < a.length; i += 4) if (a[i] !== b[i] || a[i + 1] !== b[i + 1] || a[i + 2] !== b[i + 2]) diff++;
  assert.equal(diff, 256);
});

test("version 11: four palettes of two colours, and no colour or twin is shared within or between them", () => {
  assert.equal(PALETTES_V11.length, 4);
  for (const p of PALETTES_V11) assert.equal(p.length, 2);
  const all = PALETTES_V11.flatMap((p, i) => [...p, ...TWINS_V11[i]!].map((c) => c.join(",")));
  assert.equal(new Set(all).size, all.length);
});

test("version 11's print drawing (3x, 3600 x 3600) is the same picture as the recorded one, and the print path serves it", async () => {
  const c = code("print v11"), plan = planV11(c), S = 3;
  const a = renderV11(plan, c), b = renderV11At(plan, c, S), W = 1200 * S;
  let diff = 0;
  for (let y = 0; y < 1200; y++) for (let x = 0; x < 1200; x++) for (let ch = 0; ch < 3; ch++) {
    let s = 0;
    for (let j = 0; j < S; j++) for (let i = 0; i < S; i++) s += b[((y * S + j) * W + x * S + i) * 4 + ch]!;
    diff += Math.abs(s / (S * S) - a[(y * 1200 + x) * 4 + ch]!);
  }
  assert.ok(diff / (1200 * 1200 * 3) < 2, `mean difference ${(diff / (1200 * 1200 * 3)).toFixed(2)} of 255`);
  assert.ok(PRINTABLE.includes(ART_ALGORITHM_V11));
  assert.deepEqual(printSizeOf(ART_ALGORITHM_V11), { width: 3600, height: 3600 });
  const bytes = await drawPrint({ commitment: toBase64Url(c), counter: 11, digestB64: "x", algorithm: ART_ALGORITHM_V11 });
  assert.deepEqual([...bytes.subarray(0, 4)], [137, 80, 78, 71]);
  const text = new TextDecoder("latin1").decode(bytes.subarray(0, 4096));
  assert.ok(text.includes("bitgraph-art/11") && text.includes('"scale":3'), "the print note names the version and the scale");
  assert.ok(!text.includes(toBase64Url(c)), "the commitment is not carried");
});

test("version 11 draws fast: under 1.5 s at the recorded size, whichever palette", () => {
  // one code per palette, the first found scanning fixed seeds
  const seeds = new Map<number, Uint8Array>();
  for (let k = 0; seeds.size < 4; k++) { const c = code(`bitgraph-art/11 speed ${k}`); const p = planV11(c).palette; if (!seeds.has(p)) seeds.set(p, c); }
  for (const [p, c] of seeds) {
    const t0 = performance.now();
    renderV11(planV11(c), c);
    const ms = performance.now() - t0;
    assert.ok(ms < 1500, `${PALETTE_NAMES_V11[p]}: ${ms.toFixed(0)} ms`);
  }
});

const PINNED_PIXELS_V11 = "5480623acf9acbd0104672b7adc21dbd71028d5e7b4ce1aaeb3e80a24050de17";
const PINNED_PNG_V11 = "fbef359c7019ad6a85ad7c52a14493777467761841c215c41d5a7164e4cab8fc";
