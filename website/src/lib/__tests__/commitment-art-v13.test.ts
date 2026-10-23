// bitgraph-art/13 (2026-10-08): engraved portraits, square, 2400 x 2400: version 11's person for the same code
// (the same plan), engraved as version 12 with the shadow edge faded in lines, every outline traced sub-pixel and
// smoothed, the neck filleted into the shoulders; the code in 256 reading pixels as versions
// 8 to 12 carry it (with the centre snap). Pinned, read back from the art alone, printable, fast, no staircases;
// the default until version 14 (2026-10-08).
import { test } from "node:test";
import * as assert from "node:assert/strict";
import { sha256 } from "@noble/hashes/sha256";
import { ART_ALGORITHM, ART_ALGORITHM_V13, ART_ALGORITHMS, artRecipe, artSize, checkArt, makeArt, recipeJson, toBase64Url, toHex } from "../commitment-art.ts";
import { PALETTES_V13, TWINS_V13, HAIR_NAMES_V13, EXPRESSION_NAMES_V13, PALETTE_NAMES_V13, decodeV13, outlinesV13, planV13, pupilsV13, renderV13, renderV13At, V13_HEIGHT, V13_WIDTH } from "../commitment-art-v13.ts";
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

test("version 13 is pinned: this commitment's pixels and file never change, and both image checks pass", async () => {
  const a = await makeArt(C1, ART_ALGORITHM_V13), b = await makeArt(C1, ART_ALGORITHM_V13);
  assert.equal(toHex(sha256(a.png)), toHex(sha256(b.png)));
  // Pinned on first run (2026-10-08).
  // A failure here means bitgraph-art/13 changed: make /13 instead.
  assert.equal(toHex(sha256(a.pixels)), PINNED_PIXELS_V13);
  assert.equal(toHex(sha256(a.png)), PINNED_PNG_V13);
  assert.equal(recipeJson(a.recipe), recipeJson(artRecipe(C1, ART_ALGORITHM_V13)));
  assert.deepEqual(artSize(ART_ALGORITHM_V13), { width: 2400, height: 2400 });
  const r = await checkArt(a.png, C1);
  assert.equal(r.regenerated.result, "TRUE");
  assert.equal(r.strip.result, "TRUE");
  assert.match(r.strip.detail, /the art reads/);
  const wrong = await checkArt(a.png, code("another code"));
  assert.equal(wrong.regenerated.result, "FALSE");
  assert.equal(wrong.strip.result, "FALSE");
});

test("version 13 stays registered and redraws old records, and is no longer the default (version 14, 2026-10-08)", () => {
  assert.ok(ART_ALGORITHMS.includes(ART_ALGORITHM_V13));
  assert.notEqual(ART_ALGORITHM, "bitgraph-art/13");
  assert.equal(artRecipe(C1, ART_ALGORITHM_V13).v13?.hair, planV13(C1).hair);
});

test("version 13 draws version 11's person: the plan is integer-only and equal to version 11's for the same code", () => {
  for (let k = 0; k < 20; k++) {
    const c = code(`bitgraph-art/13 plan ${k}`), plan = planV13(c);
    assert.equal(nonIntegers(plan), 0, `code ${k}: every number in the plan is an integer`);
    assert.equal(JSON.stringify(plan), JSON.stringify(planV11(c)), `code ${k}: the same person as version 11`);
  }
});

test("version 13: the art alone spells the code for 40 codes; ink, sepia and sanguine occur and the dark ground never", () => {
  const cs = [new Uint8Array(32), new Uint8Array(32).fill(255), C1];
  for (let k = 0; cs.length < 40; k++) cs.push(code(`bitgraph-art/13 readback ${k}`));
  const palettes = new Set<number>();
  cs.forEach((c, i) => {
    const plan = planV13(c);
    palettes.add(plan.palette);
    const px = renderV13(plan, c);
    assert.equal(px.length, V13_WIDTH * V13_HEIGHT * 4);
    assert.deepEqual(decodeV13(px, V13_WIDTH, V13_HEIGHT), c, `code ${i} (${PALETTE_NAMES_V13[plan.palette]}, ${HAIR_NAMES_V13[plan.hair]}, ${EXPRESSION_NAMES_V13[plan.expr]}) reads back`);
  });
  assert.deepEqual([...palettes].sort(), [0, 1, 2], "ink, sepia and sanguine occur in 40, the dark ground never");
});

test("version 13: only the 256 reading pixels carry the code; two codes with the same plan differ nowhere else", () => {
  const plan = planV13(C1), a = renderV13(plan, new Uint8Array(32)), b = renderV13(plan, new Uint8Array(32).fill(255));
  let diff = 0;
  for (let i = 0; i < a.length; i += 4) if (a[i] !== b[i] || a[i + 1] !== b[i + 1] || a[i + 2] !== b[i + 2]) diff++;
  assert.equal(diff, 256);
});

test("version 13: four palettes of two colours, and no colour or twin is shared within or between them", () => {
  assert.equal(PALETTES_V13.length, 4);
  for (const p of PALETTES_V13) assert.equal(p.length, 2);
  const all = PALETTES_V13.flatMap((p, i) => [...p, ...TWINS_V13[i]!].map((c) => c.join(",")));
  assert.equal(new Set(all).size, all.length);
});

test("version 13's print drawing (1.5x, 3600 x 3600) is the same picture as the recorded one, and the print path serves it", async () => {
  const c = code("print v13"), plan = planV13(c), R = 1200;
  // the print is drawn at 3 x version 11's size, the recorded file at 2 x: compare both over version 11's pixel
  const a = renderV13(plan, c), b = renderV13At(plan, c, 3);
  let diff = 0;
  for (let y = 0; y < R; y++) for (let x = 0; x < R; x++) for (let ch = 0; ch < 3; ch++) {
    let s = 0, t = 0;
    for (let j = 0; j < 3; j++) for (let i = 0; i < 3; i++) s += b[((y * 3 + j) * 3600 + x * 3 + i) * 4 + ch]!;
    for (let j = 0; j < 2; j++) for (let i = 0; i < 2; i++) t += a[((y * 2 + j) * 2400 + x * 2 + i) * 4 + ch]!;
    diff += Math.abs(s / 9 - t / 4);
  }
  assert.ok(diff / (R * R * 3) < 2, `mean difference ${(diff / (R * R * 3)).toFixed(2)} of 255`);
  assert.ok(PRINTABLE.includes(ART_ALGORITHM_V13));
  assert.deepEqual(printSizeOf(ART_ALGORITHM_V13), { width: 3600, height: 3600 });
  const bytes = await drawPrint({ commitment: toBase64Url(c), counter: 12, digestB64: "x", algorithm: ART_ALGORITHM_V13 });
  assert.deepEqual([...bytes.subarray(0, 4)], [137, 80, 78, 71]);
  const text = new TextDecoder("latin1").decode(bytes.subarray(0, 4096));
  assert.ok(text.includes("bitgraph-art/13") && text.includes('"scale":1.5'), "the print note names the version and the scale");
  assert.ok(!text.includes(toBase64Url(c)), "the commitment is not carried");
});

test("version 13 draws fast: plan, drawing and the recorded file under 2 s at 2400 x 2400, whichever palette", async () => {
  // one code per palette, the first found scanning fixed seeds (about 0.9 s on an Apple M3)
  const seeds = new Map<number, Uint8Array>();
  for (let k = 0; seeds.size < 3; k++) { const c = code(`bitgraph-art/13 speed ${k}`); const p = planV13(c).palette; if (!seeds.has(p)) seeds.set(p, c); }
  for (const [p, c] of seeds) {
    const t0 = performance.now();
    await makeArt(c, ART_ALGORITHM_V13);
    const ms = performance.now() - t0;
    assert.ok(ms < 2000, `${PALETTE_NAMES_V13[p]}: ${ms.toFixed(0)} ms`);
  }
});

test("version 13: every portrait has its pupils (200 codes): two whole discs within 45 degrees of frontal, at least one on every face", () => {
  // Measured 2026-10-08 on these 200 codes: before the eyes were drawn from their geometry, 63 portraits had no pupil
  // at all, 4 drew theirs as pixel stamps, and 41 of the 138 within 45 degrees lacked two; after, every frontal face
  // has two whole discs, every face at least one, and 6 far eyes past 45 degrees show a disc cut by the nose.
  let cut = 0;
  for (let i = 0; i < 200; i++) {
    const plan = planV13(code(`v13-eyes/${i}`)), deg = Math.abs((plan.yaw * 360) / 16384), p = pupilsV13(plan);
    assert.ok(p.length >= 1, `code ${i} (turned ${deg.toFixed(0)} degrees): at least one pupil`);
    assert.ok(p.every((x) => x === 1 || x === 2), `code ${i}: every pupil is a disc`);
    if (deg <= 45) assert.deepEqual(p, [1, 1], `code ${i} (turned ${deg.toFixed(0)} degrees): two whole pupils`);
    cut += p.filter((x) => x === 2).length;
  }
  assert.ok(cut <= 10, `${cut} pupils cut by something in front of them`);
});

/**
 * The staircase metric (version 13). Each outline is resampled at half a field pixel (32 raster units; a field pixel
 * is 64, four recorded pixels); the heading is taken over one field pixel, and the turn at a sample is the change
 * from the field pixel before it to the one after. A kink is a run of samples turning more than 10 degrees the
 * same way (one event per run, at its sharpest); a zigzag is a kink followed within three field pixels by a kink
 * the other way. A pixel staircase is exactly that, a run of alternating turns at the field's own scale; a smooth
 * curve turns one way and gently. The score is zigzags per 100 field pixels of outline.
 *   Measured over the ten people below (2026-10-08): version 12's outlines (its stamps joined over the dual grid at
 *   the pixel edges' midpoints, two passes of smoothing, as it draws them) 15.1; version 13's 0.02. The bar: 1.0 over
 *   all ten, 2.0 for any one.
 */
function staircase(lines: number[][]): { per100: number; cells: number } {
  const C = 64, step = C / 2, TH = (10 * Math.PI) / 180;
  let cells = 0, zig = 0;
  for (const pts of lines) {
    const n = pts.length >> 1;
    if (n < 2) continue;
    const rs: number[] = [pts[0]!, pts[1]!];
    let acc = 0, px = pts[0]!, py = pts[1]!;
    for (let i = 1; i < n; i++) {
      const x = pts[2 * i]!, y = pts[2 * i + 1]!;
      let dx = x - px, dy = y - py, L = Math.hypot(dx, dy);
      while (acc + L >= step) {
        const t = (step - acc) / L;
        px += dx * t; py += dy * t; rs.push(px, py);
        dx = x - px; dy = y - py; L = Math.hypot(dx, dy); acc = 0;
      }
      acc += L; px = x; py = y;
    }
    const m = rs.length >> 1;
    cells += (m - 1) / 2;
    const head = (a: number, b: number) => Math.atan2(rs[2 * b + 1]! - rs[2 * a + 1]!, rs[2 * b]! - rs[2 * a]!);
    const kinks: Array<[number, number]> = [];
    let runSign = 0, runBest = 0, runAt = -1;
    for (let i = 2; i + 2 < m; i++) {
      let d = head(i, i + 2) - head(i - 2, i);
      while (d > Math.PI) d -= 2 * Math.PI;
      while (d < -Math.PI) d += 2 * Math.PI;
      const sgn = Math.abs(d) > TH ? Math.sign(d) : 0;
      if (sgn !== runSign) { if (runSign) kinks.push([runAt, runSign]); runSign = sgn; runBest = 0; }
      if (sgn && Math.abs(d) > runBest) { runBest = Math.abs(d); runAt = i; }
    }
    if (runSign) kinks.push([runAt, runSign]);
    for (let k = 0; k + 1 < kinks.length; k++) if (kinks[k + 1]![1] !== kinks[k]![1] && kinks[k + 1]![0] - kinks[k]![0] <= 6) zig++;
  }
  return { per100: cells ? (100 * zig) / cells : 0, cells };
}

test("the staircase metric flags a pixel staircase and passes a smooth curve", () => {
  const stairs: number[] = [];
  for (let k = 0; k < 40; k++) stairs.push(k * 64 * 3, k * 64, (k + 1) * 64 * 3, k * 64); // runs of three field pixels, one up
  const circle: number[] = [];
  for (let k = 0; k <= 200; k++) circle.push(5000 + Math.round(3000 * Math.cos((k * Math.PI) / 100)), 5000 + Math.round(3000 * Math.sin((k * Math.PI) / 100)));
  assert.ok(staircase([stairs]).per100 > 20, `a staircase scores ${staircase([stairs]).per100.toFixed(1)}`);
  assert.equal(staircase([circle]).per100, 0);
});

test("version 13: no staircased outlines (zigzags per 100 field pixels of outline under 1.0 over ten people, under 2.0 for each)", () => {
  let z = 0, c = 0;
  for (const seed of [9, 37, 21, 40, 138, 31, 27, 13, 161, 49]) {
    const r = staircase(outlinesV13(planV13(code(`v11/${seed}`))));
    assert.ok(r.cells > 500, `person ${seed}: the outlines are there (${r.cells.toFixed(0)} field pixels)`);
    assert.ok(r.per100 < 2, `person ${seed}: ${r.per100.toFixed(2)} zigzags per 100 field pixels`);
    z += (r.per100 * r.cells) / 100; c += r.cells;
  }
  assert.ok((100 * z) / c < 1, `${((100 * z) / c).toFixed(2)} zigzags per 100 field pixels over ten people`);
});

const PINNED_PIXELS_V13 = "e92cdc16d3c571fa7a66dcf1e8cbddb235eaec6e2e3ec5dc3a5bb67481e4d7d5";
const PINNED_PNG_V13 = "1681369ca879200a6ecdf1a8ee05c2a1512cde879feda6b06ab49f508f3ac0e3";
