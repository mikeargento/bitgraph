// bitgraph-art/10 (2026-10-08): a flow field with collision avoidance, the code in 256 reading pixels as
// versions 8 and 9 carry it. Pinned, read back from the art alone, printable, fast; the default until version 11 (2026-10-08).
import { test } from "node:test";
import * as assert from "node:assert/strict";
import { sha256 } from "@noble/hashes/sha256";
import { ART_ALGORITHM, ART_ALGORITHM_V10, ART_ALGORITHMS, artRecipe, artSize, checkArt, makeArt, recipeJson, toBase64Url, toHex } from "../commitment-art.ts";
import { PALETTES_V10, TWINS_V10, STYLE_NAMES_V10, DENSITY_NAMES_V10, decodeV10, planV10, renderV10, renderV10At, V10_HEIGHT, V10_WIDTH, type V10Plan } from "../commitment-art-v10.ts";
import { PRINTABLE, drawPrint, printSizeOf } from "../art-print.ts";

const code = (s: string) => sha256(new TextEncoder().encode(s));
const C1 = code("bitgraph-art test commitment one");

/** The composition rule: a style, a density mode, hundreds of inked segments of mixed widths, every number an integer. */
function assertComposed(plan: V10Plan, name: string): void {
  assert.ok(plan.style >= 0 && plan.style <= 3, `${name}: a style`);
  assert.ok(plan.density >= 0 && plan.density <= 2, `${name}: a density mode`);
  assert.ok(plan.segments.length >= 500 && plan.segments.length <= 2500, `${name}: hundreds of segments, not ${plan.segments.length}`);
  assert.ok(plan.segments.some((g) => g.width >= 320) && plan.segments.some((g) => g.width < 32), `${name}: wide bands and hairlines`);
  for (const g of plan.segments) assert.ok(g.points.length >= 4 && g.colour >= 1 && g.colour <= 6 && g.tint >= 4 && g.tint <= 11, `${name}: a segment is walked, inked and tinted`);
  assert.equal(nonIntegers(plan), 0, `${name}: every number in the plan is an integer`);
}
function nonIntegers(v: unknown): number {
  if (typeof v === "number") return Number.isInteger(v) ? 0 : 1;
  if (Array.isArray(v)) return v.reduce((n: number, x) => n + nonIntegers(x), 0);
  if (v && typeof v === "object") return Object.values(v).reduce((n: number, x) => n + nonIntegers(x), 0);
  return 0;
}

test("version 10 is pinned: this commitment's pixels and file never change, and both image checks pass", async () => {
  const a = await makeArt(C1, ART_ALGORITHM_V10), b = await makeArt(C1, ART_ALGORITHM_V10);
  assert.equal(toHex(sha256(a.png)), toHex(sha256(b.png)));
  // Pinned on first run (2026-10-08). A failure here means bitgraph-art/10 changed: make /11 instead.
  assert.equal(toHex(sha256(a.pixels)), PINNED_PIXELS_V10);
  assert.equal(toHex(sha256(a.png)), PINNED_PNG_V10);
  assert.equal(recipeJson(a.recipe), recipeJson(artRecipe(C1, ART_ALGORITHM_V10)));
  assert.deepEqual(artSize(ART_ALGORITHM_V10), { width: 1600, height: 1024 });
  const r = await checkArt(a.png, C1);
  assert.equal(r.regenerated.result, "TRUE");
  assert.equal(r.strip.result, "TRUE");
  assert.match(r.strip.detail, /the art reads/);
  const wrong = await checkArt(a.png, code("another code"));
  assert.equal(wrong.regenerated.result, "FALSE");
  assert.equal(wrong.strip.result, "FALSE");
});

test("version 10 stays registered and redraws old records, and is no longer the default (version 11, 2026-10-08)", () => {
  assert.ok(ART_ALGORITHMS.includes(ART_ALGORITHM_V10));
  assert.notEqual(ART_ALGORITHM, "bitgraph-art/10");
  assert.equal(artRecipe(C1, ART_ALGORITHM_V10).v10?.style, planV10(C1).style);
});

test("version 10: the art alone spells the code for 40 codes; every style and every density mode occurs", () => {
  const cs = [new Uint8Array(32), new Uint8Array(32).fill(255), C1];
  for (let k = 0; cs.length < 40; k++) cs.push(code(`bitgraph-art/10 readback ${k}`));
  const styles = new Set<number>(), modes = new Set<number>();
  cs.forEach((c, i) => {
    const plan = planV10(c);
    assertComposed(plan, `code ${i}`);
    assert.equal(JSON.stringify(planV10(c)), JSON.stringify(plan), "the same code plans the same picture");
    styles.add(plan.style);
    modes.add(plan.density);
    const px = renderV10(plan, c);
    assert.equal(px.length, V10_WIDTH * V10_HEIGHT * 4);
    assert.deepEqual(decodeV10(px, V10_WIDTH, V10_HEIGHT), c, `code ${i} (${STYLE_NAMES_V10[plan.style]}, ${DENSITY_NAMES_V10[plan.density]}) reads back`);
  });
  assert.deepEqual([...styles].sort(), [0, 1, 2, 3], "every style occurs in 40");
  assert.deepEqual([...modes].sort(), [0, 1, 2], "every density mode occurs in 40");
});

test("version 10: only the 256 reading pixels carry the code; two codes with the same plan differ nowhere else", () => {
  const plan = planV10(C1), a = renderV10(plan, new Uint8Array(32)), b = renderV10(plan, new Uint8Array(32).fill(255));
  let diff = 0;
  for (let i = 0; i < a.length; i += 4) if (a[i] !== b[i] || a[i + 1] !== b[i + 1] || a[i + 2] !== b[i + 2]) diff++;
  assert.equal(diff, 256);
});

test("version 10: seven palettes of seven colours, and no colour or twin is shared within or between them", () => {
  assert.equal(PALETTES_V10.length, 7);
  for (const p of PALETTES_V10) assert.equal(p.length, 7);
  const all = PALETTES_V10.flatMap((p, i) => [...p, ...TWINS_V10[i]!].map((c) => c.join(",")));
  assert.equal(new Set(all).size, all.length);
});

test("version 10's print drawing (3x, 4800 x 3072) is the same picture as the recorded one, and the print path serves it", async () => {
  const c = code("print v10"), plan = planV10(c), S = 3;
  const a = renderV10(plan, c), b = renderV10At(plan, c, S), W = 1600 * S;
  let diff = 0;
  for (let y = 0; y < 1024; y++) for (let x = 0; x < 1600; x++) for (let ch = 0; ch < 3; ch++) {
    let s = 0;
    for (let j = 0; j < S; j++) for (let i = 0; i < S; i++) s += b[((y * S + j) * W + x * S + i) * 4 + ch]!;
    diff += Math.abs(s / (S * S) - a[(y * 1600 + x) * 4 + ch]!);
  }
  assert.ok(diff / (1600 * 1024 * 3) < 2, `mean difference ${(diff / (1600 * 1024 * 3)).toFixed(2)} of 255`);
  assert.ok(PRINTABLE.includes(ART_ALGORITHM_V10));
  assert.deepEqual(printSizeOf(ART_ALGORITHM_V10), { width: 4800, height: 3072 });
  const bytes = await drawPrint({ commitment: toBase64Url(c), counter: 10, digestB64: "x", algorithm: ART_ALGORITHM_V10 });
  assert.deepEqual([...bytes.subarray(0, 4)], [137, 80, 78, 71]);
  const text = new TextDecoder("latin1").decode(bytes.subarray(0, 4096));
  assert.ok(text.includes("bitgraph-art/10") && text.includes('"scale":3'), "the print note names the version and the scale");
  assert.ok(!text.includes(toBase64Url(c)), "the commitment is not carried");
});

test("version 10 draws fast: under 1.5 s at the recorded size, whichever style", () => {
  // one code per style, the first found scanning fixed seeds
  const seeds = new Map<number, Uint8Array>();
  for (let k = 0; seeds.size < 4; k++) { const c = code(`bitgraph-art/10 speed ${k}`); const st = planV10(c).style; if (!seeds.has(st)) seeds.set(st, c); }
  for (const [st, c] of seeds) {
    const t0 = performance.now();
    renderV10(planV10(c), c);
    const ms = performance.now() - t0;
    assert.ok(ms < 1500, `${STYLE_NAMES_V10[st]}: ${ms.toFixed(0)} ms`);
  }
});

const PINNED_PIXELS_V10 = "d293305c88ee0e41b958c21ba3d9b5353163265603356d95083599da4cc69683";
const PINNED_PNG_V10 = "c1a34137833bec1cd92413ba0daf71e06a97f31a0a4115b5aee70d29878f20cf";
