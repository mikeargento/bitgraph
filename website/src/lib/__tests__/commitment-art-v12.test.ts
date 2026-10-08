// bitgraph-art/12 (2026-10-08): engraved portraits, square, 2400 x 2400: version 11's person for the same
// code (the same plan), drawn denser with swelling lines and lost and found edges, the code in 256 reading
// pixels as versions 8 to 11 carry it (with the centre snap). Pinned, read back from the art alone,
// printable, fast, and the default.
import { test } from "node:test";
import * as assert from "node:assert/strict";
import { sha256 } from "@noble/hashes/sha256";
import { ART_ALGORITHM, ART_ALGORITHM_V12, ART_ALGORITHMS, artRecipe, artSize, checkArt, makeArt, recipeJson, toBase64Url, toHex } from "../commitment-art.ts";
import { PALETTES_V12, TWINS_V12, HAIR_NAMES_V12, EXPRESSION_NAMES_V12, PALETTE_NAMES_V12, decodeV12, planV12, renderV12, renderV12At, V12_HEIGHT, V12_WIDTH } from "../commitment-art-v12.ts";
import { planV11 } from "../commitment-art-v11.ts";
import { PRINTABLE, drawPrint, printSizeOf } from "../art-print.ts";

const code = (s: string) => sha256(new TextEncoder().encode(s));
const C1 = code("bitgraph-art test commitment one");

function nonIntegers(v: unknown): number {
  if (typeof v === "number") return Number.isInteger(v) ? 0 : 1;
  if (Array.isArray(v)) return v.reduce((n: number, x) => n + nonIntegers(x), 0);
  if (v && typeof v === "object") return Object.values(v).reduce((n: number, x) => n + nonIntegers(x), 0);
  return 0;
}

test("version 12 is pinned: this commitment's pixels and file never change, and both image checks pass", async () => {
  const a = await makeArt(C1, ART_ALGORITHM_V12), b = await makeArt(C1, ART_ALGORITHM_V12);
  assert.equal(toHex(sha256(a.png)), toHex(sha256(b.png)));
  // Pinned on first run (2026-10-08), re-pinned once for the detail pass before any record was drawn with it.
  // A failure here means bitgraph-art/12 changed: make /13 instead.
  assert.equal(toHex(sha256(a.pixels)), PINNED_PIXELS_V12);
  assert.equal(toHex(sha256(a.png)), PINNED_PNG_V12);
  assert.equal(recipeJson(a.recipe), recipeJson(artRecipe(C1, ART_ALGORITHM_V12)));
  assert.deepEqual(artSize(ART_ALGORITHM_V12), { width: 2400, height: 2400 });
  const r = await checkArt(a.png, C1);
  assert.equal(r.regenerated.result, "TRUE");
  assert.equal(r.strip.result, "TRUE");
  assert.match(r.strip.detail, /the art reads/);
  const wrong = await checkArt(a.png, code("another code"));
  assert.equal(wrong.regenerated.result, "FALSE");
  assert.equal(wrong.strip.result, "FALSE");
});

test("version 12 is registered and is the default: a new image is drawn with it (2026-10-08)", () => {
  assert.ok(ART_ALGORITHMS.includes(ART_ALGORITHM_V12));
  assert.equal(ART_ALGORITHM, "bitgraph-art/12");
  assert.equal(artRecipe(C1, ART_ALGORITHM_V12).v12?.hair, planV12(C1).hair);
  assert.equal(artRecipe(C1).algorithm, "bitgraph-art/12");
});

test("version 12 draws version 11's person: the plan is integer-only and equal to version 11's for the same code", () => {
  for (let k = 0; k < 20; k++) {
    const c = code(`bitgraph-art/12 plan ${k}`), plan = planV12(c);
    assert.equal(nonIntegers(plan), 0, `code ${k}: every number in the plan is an integer`);
    assert.equal(JSON.stringify(plan), JSON.stringify(planV11(c)), `code ${k}: the same person as version 11`);
  }
});

test("version 12: the art alone spells the code for 40 codes; ink, sepia and sanguine occur and the dark ground never", () => {
  const cs = [new Uint8Array(32), new Uint8Array(32).fill(255), C1];
  for (let k = 0; cs.length < 40; k++) cs.push(code(`bitgraph-art/12 readback ${k}`));
  const palettes = new Set<number>();
  cs.forEach((c, i) => {
    const plan = planV12(c);
    palettes.add(plan.palette);
    const px = renderV12(plan, c);
    assert.equal(px.length, V12_WIDTH * V12_HEIGHT * 4);
    assert.deepEqual(decodeV12(px, V12_WIDTH, V12_HEIGHT), c, `code ${i} (${PALETTE_NAMES_V12[plan.palette]}, ${HAIR_NAMES_V12[plan.hair]}, ${EXPRESSION_NAMES_V12[plan.expr]}) reads back`);
  });
  assert.deepEqual([...palettes].sort(), [0, 1, 2], "ink, sepia and sanguine occur in 40, the dark ground never");
});

test("version 12: only the 256 reading pixels carry the code; two codes with the same plan differ nowhere else", () => {
  const plan = planV12(C1), a = renderV12(plan, new Uint8Array(32)), b = renderV12(plan, new Uint8Array(32).fill(255));
  let diff = 0;
  for (let i = 0; i < a.length; i += 4) if (a[i] !== b[i] || a[i + 1] !== b[i + 1] || a[i + 2] !== b[i + 2]) diff++;
  assert.equal(diff, 256);
});

test("version 12: four palettes of two colours, and no colour or twin is shared within or between them", () => {
  assert.equal(PALETTES_V12.length, 4);
  for (const p of PALETTES_V12) assert.equal(p.length, 2);
  const all = PALETTES_V12.flatMap((p, i) => [...p, ...TWINS_V12[i]!].map((c) => c.join(",")));
  assert.equal(new Set(all).size, all.length);
});

test("version 12's print drawing (1.5x, 3600 x 3600) is the same picture as the recorded one, and the print path serves it", async () => {
  const c = code("print v12"), plan = planV12(c), R = 1200;
  // the print is drawn at 3 x version 11's size, the recorded file at 2 x: compare both over version 11's pixel
  const a = renderV12(plan, c), b = renderV12At(plan, c, 3);
  let diff = 0;
  for (let y = 0; y < R; y++) for (let x = 0; x < R; x++) for (let ch = 0; ch < 3; ch++) {
    let s = 0, t = 0;
    for (let j = 0; j < 3; j++) for (let i = 0; i < 3; i++) s += b[((y * 3 + j) * 3600 + x * 3 + i) * 4 + ch]!;
    for (let j = 0; j < 2; j++) for (let i = 0; i < 2; i++) t += a[((y * 2 + j) * 2400 + x * 2 + i) * 4 + ch]!;
    diff += Math.abs(s / 9 - t / 4);
  }
  assert.ok(diff / (R * R * 3) < 2, `mean difference ${(diff / (R * R * 3)).toFixed(2)} of 255`);
  assert.ok(PRINTABLE.includes(ART_ALGORITHM_V12));
  assert.deepEqual(printSizeOf(ART_ALGORITHM_V12), { width: 3600, height: 3600 });
  const bytes = await drawPrint({ commitment: toBase64Url(c), counter: 12, digestB64: "x", algorithm: ART_ALGORITHM_V12 });
  assert.deepEqual([...bytes.subarray(0, 4)], [137, 80, 78, 71]);
  const text = new TextDecoder("latin1").decode(bytes.subarray(0, 4096));
  assert.ok(text.includes("bitgraph-art/12") && text.includes('"scale":1.5'), "the print note names the version and the scale");
  assert.ok(!text.includes(toBase64Url(c)), "the commitment is not carried");
});

test("version 12 draws fast: plan, drawing and the recorded file under 2 s at 2400 x 2400, whichever palette", async () => {
  // one code per palette, the first found scanning fixed seeds (about 0.8 s on an Apple M3)
  const seeds = new Map<number, Uint8Array>();
  for (let k = 0; seeds.size < 3; k++) { const c = code(`bitgraph-art/12 speed ${k}`); const p = planV12(c).palette; if (!seeds.has(p)) seeds.set(p, c); }
  for (const [p, c] of seeds) {
    const t0 = performance.now();
    await makeArt(c, ART_ALGORITHM_V12);
    const ms = performance.now() - t0;
    assert.ok(ms < 2000, `${PALETTE_NAMES_V12[p]}: ${ms.toFixed(0)} ms`);
  }
});

const PINNED_PIXELS_V12 = "3da43996b614d9cd5629eab0d69ee5cae10c4a93a4a7c25c2f6e2cc14863a6be";
const PINNED_PNG_V12 = "392c2e12f2033e4c8084f6f93d11abd1815e02a99317d791518c044eabf41357";
