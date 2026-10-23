// bitgraph-art/14 (2026-10-08): version 13 with anatomical ears, ponytails that stay behind the neck and a narrower neck: version 11's
// person for the same code (the same plan), square, 2400 x 2400, the code in 256 reading pixels as versions 8 to 13
// carry it (with the centre snap). Pinned, read back from the art alone, printable, fast, no staircases, every pupil,
// ears that are not ovals and carry their structure, no ponytail in front of the neck or jaw, no pillar of a neck;
// the default until version 15 (2026-10-09).
import { test } from "node:test";
import * as assert from "node:assert/strict";
import { sha256 } from "@noble/hashes/sha256";
import { ART_ALGORITHM, ART_ALGORITHM_V14, ART_ALGORITHMS, artRecipe, artSize, checkArt, makeArt, recipeJson, toBase64Url, toHex } from "../commitment-art.ts";
import { PALETTES_V14, TWINS_V14, HAIR_NAMES_V14, EXPRESSION_NAMES_V14, PALETTE_NAMES_V14, decodeV14, earsV14, neckV14, outlinesV14, planV14, ponyV14, pupilsV14, renderV14, renderV14At, V14_HEIGHT, V14_WIDTH } from "../commitment-art-v14.ts";
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

test("version 14 is pinned: this commitment's pixels and file never change, and both image checks pass", async () => {
  const a = await makeArt(C1, ART_ALGORITHM_V14), b = await makeArt(C1, ART_ALGORITHM_V14);
  assert.equal(toHex(sha256(a.png)), toHex(sha256(b.png)));
  // Pinned on first run (2026-10-08).
  // A failure here means bitgraph-art/14 changed: make /15 instead.
  assert.equal(toHex(sha256(a.pixels)), PINNED_PIXELS_V14);
  assert.equal(toHex(sha256(a.png)), PINNED_PNG_V14);
  assert.equal(recipeJson(a.recipe), recipeJson(artRecipe(C1, ART_ALGORITHM_V14)));
  assert.deepEqual(artSize(ART_ALGORITHM_V14), { width: 2400, height: 2400 });
  const r = await checkArt(a.png, C1);
  assert.equal(r.regenerated.result, "TRUE");
  assert.equal(r.strip.result, "TRUE");
  assert.match(r.strip.detail, /the art reads/);
  const wrong = await checkArt(a.png, code("another code"));
  assert.equal(wrong.regenerated.result, "FALSE");
  assert.equal(wrong.strip.result, "FALSE");
});

test("version 14 is registered, and was the default until version 15 (2026-10-09)", () => {
  assert.ok(ART_ALGORITHMS.includes(ART_ALGORITHM_V14));
  assert.notEqual(ART_ALGORITHM, "bitgraph-art/14");
  assert.equal(artRecipe(C1, ART_ALGORITHM_V14).v14?.hair, planV14(C1).hair);
});

test("version 14 draws version 11's person: the plan is integer-only and equal to version 11's for the same code", () => {
  for (let k = 0; k < 20; k++) {
    const c = code(`bitgraph-art/14 plan ${k}`), plan = planV14(c);
    assert.equal(nonIntegers(plan), 0, `code ${k}: every number in the plan is an integer`);
    assert.equal(JSON.stringify(plan), JSON.stringify(planV11(c)), `code ${k}: the same person as version 11`);
  }
});

test("version 14: the art alone spells the code for 40 codes; ink, sepia and sanguine occur and the dark ground never", () => {
  const cs = [new Uint8Array(32), new Uint8Array(32).fill(255), C1];
  for (let k = 0; cs.length < 40; k++) cs.push(code(`bitgraph-art/14 readback ${k}`));
  const palettes = new Set<number>();
  cs.forEach((c, i) => {
    const plan = planV14(c);
    palettes.add(plan.palette);
    const px = renderV14(plan, c);
    assert.equal(px.length, V14_WIDTH * V14_HEIGHT * 4);
    assert.deepEqual(decodeV14(px, V14_WIDTH, V14_HEIGHT), c, `code ${i} (${PALETTE_NAMES_V14[plan.palette]}, ${HAIR_NAMES_V14[plan.hair]}, ${EXPRESSION_NAMES_V14[plan.expr]}) reads back`);
  });
  assert.deepEqual([...palettes].sort(), [0, 1, 2], "ink, sepia and sanguine occur in 40, the dark ground never");
});

test("version 14: only the 256 reading pixels carry the code; two codes with the same plan differ nowhere else", () => {
  const plan = planV14(C1), a = renderV14(plan, new Uint8Array(32)), b = renderV14(plan, new Uint8Array(32).fill(255));
  let diff = 0;
  for (let i = 0; i < a.length; i += 4) if (a[i] !== b[i] || a[i + 1] !== b[i + 1] || a[i + 2] !== b[i + 2]) diff++;
  assert.equal(diff, 256);
});

test("version 14: four palettes of two colours, and no colour or twin is shared within or between them", () => {
  assert.equal(PALETTES_V14.length, 4);
  for (const p of PALETTES_V14) assert.equal(p.length, 2);
  const all = PALETTES_V14.flatMap((p, i) => [...p, ...TWINS_V14[i]!].map((c) => c.join(",")));
  assert.equal(new Set(all).size, all.length);
});

test("version 14's print drawing (1.5x, 3600 x 3600) is the same picture as the recorded one, and the print path serves it", async () => {
  const c = code("print v14"), plan = planV14(c), R = 1200;
  // the print is drawn at 3 x version 11's size, the recorded file at 2 x: compare both over version 11's pixel
  const a = renderV14(plan, c), b = renderV14At(plan, c, 3);
  let diff = 0;
  for (let y = 0; y < R; y++) for (let x = 0; x < R; x++) for (let ch = 0; ch < 3; ch++) {
    let s = 0, t = 0;
    for (let j = 0; j < 3; j++) for (let i = 0; i < 3; i++) s += b[((y * 3 + j) * 3600 + x * 3 + i) * 4 + ch]!;
    for (let j = 0; j < 2; j++) for (let i = 0; i < 2; i++) t += a[((y * 2 + j) * 2400 + x * 2 + i) * 4 + ch]!;
    diff += Math.abs(s / 9 - t / 4);
  }
  assert.ok(diff / (R * R * 3) < 2, `mean difference ${(diff / (R * R * 3)).toFixed(2)} of 255`);
  assert.ok(PRINTABLE.includes(ART_ALGORITHM_V14));
  assert.deepEqual(printSizeOf(ART_ALGORITHM_V14), { width: 3600, height: 3600 });
  const bytes = await drawPrint({ commitment: toBase64Url(c), counter: 12, digestB64: "x", algorithm: ART_ALGORITHM_V14 });
  assert.deepEqual([...bytes.subarray(0, 4)], [137, 80, 78, 71]);
  const text = new TextDecoder("latin1").decode(bytes.subarray(0, 4096));
  assert.ok(text.includes("bitgraph-art/14") && text.includes('"scale":1.5'), "the print note names the version and the scale");
  assert.ok(!text.includes(toBase64Url(c)), "the commitment is not carried");
});

test("version 14 draws fast: plan, drawing and the recorded file under 2 s at 2400 x 2400, whichever palette", async () => {
  // one code per palette, the first found scanning fixed seeds (about 0.9 s on an Apple M3)
  const seeds = new Map<number, Uint8Array>();
  for (let k = 0; seeds.size < 3; k++) { const c = code(`bitgraph-art/14 speed ${k}`); const p = planV14(c).palette; if (!seeds.has(p)) seeds.set(p, c); }
  for (const [p, c] of seeds) {
    const t0 = performance.now();
    await makeArt(c, ART_ALGORITHM_V14);
    const ms = performance.now() - t0;
    assert.ok(ms < 2000, `${PALETTE_NAMES_V14[p]}: ${ms.toFixed(0)} ms`);
  }
});

test("version 14: every portrait has its pupils (200 codes): two whole discs within 45 degrees of frontal, at least one on every face", () => {
  // Version 13's test on the same 200 codes (version 14 changes nothing in the eyes). Measured 2026-10-08 on them: before the eyes were drawn from their geometry, 63 portraits had no pupil
  // at all, 4 drew theirs as pixel stamps, and 41 of the 138 within 45 degrees lacked two; after, every frontal face
  // has two whole discs, every face at least one, and 6 far eyes past 45 degrees show a disc cut by the nose.
  let cut = 0;
  for (let i = 0; i < 200; i++) {
    const plan = planV14(code(`v13-eyes/${i}`)), deg = Math.abs((plan.yaw * 360) / 16384), p = pupilsV14(plan);
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
 *   the pixel edges' midpoints, two passes of smoothing, as it draws them) 15.1; version 13's 0.02; version 14's
 *   0.038 (its ears drawn analytically, their field edges dropped; the narrower neck's curves). The bar: 1.0 over all ten, 2.0 for any one.
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

test("version 14: no staircased outlines (zigzags per 100 field pixels of outline under 1.0 over ten people, under 2.0 for each)", () => {
  let z = 0, c = 0;
  for (const seed of [9, 37, 21, 40, 138, 31, 27, 13, 161, 49]) {
    const r = staircase(outlinesV14(planV14(code(`v11/${seed}`))));
    assert.ok(r.cells > 500, `person ${seed}: the outlines are there (${r.cells.toFixed(0)} field pixels)`);
    assert.ok(r.per100 < 2, `person ${seed}: ${r.per100.toFixed(2)} zigzags per 100 field pixels`);
    z += (r.per100 * r.cells) / 100; c += r.cells;
  }
  assert.ok((100 * z) / c < 1, `${((100 * z) / c).toFixed(2)} zigzags per 100 field pixels over ten people`);
});

/**
 * The ear metric (version 14). For each ear, its outer contour as drawn, projected (every point of it, whether it shows
 * or not), and its own axis projected (the top of the rim to the foot of the lobe). Chords across the axis (square to
 * it on the page) at 400 slices along it; the ratio is the mean chord over the axis's top half to the mean over its
 * bottom half. An ellipse, and any view of a flat oval (an affine image of one), scores 1; the ear, wide at the top
 * and tapering to a lobe, more. Measured 2026-10-08 on the 200 codes below, ears at least half visible and at least
 * 12 px across: version 13's disc 0.24 to 3.6, median 1.01 (178 of 214 at or under 1.2; its spread is the disc's
 * flare seen edge-on); version 14 1.29 to 1.42, median 1.34 (227 ears, none at or under 1.2).
 */
function earRatio(o: number[], axis: number[]): number {
  const n = o.length >> 1, ax = axis[0]!, ay = axis[1]!, L = Math.hypot(axis[2]! - ax, axis[3]! - ay) || 1, ux = (axis[2]! - ax) / L, uy = (axis[3]! - ay) / L;
  const s: number[] = [], d: number[] = [];
  for (let i = 0; i < n; i++) { const dx = o[2 * i]! - ax, dy = o[2 * i + 1]! - ay; s.push(dx * ux + dy * uy); d.push(-dx * uy + dy * ux); }
  const smin = Math.min(...s), smax = Math.max(...s), mid = (smin + smax) / 2, K = 400;
  let top = 0, bot = 0;
  for (let k = 0; k < K; k++) {
    const sv = smin + ((k + 0.5) / K) * (smax - smin), xs: number[] = [];
    for (let i = 0; i < n; i++) { const j = (i + 1) % n; if ((s[i]! - sv) * (s[j]! - sv) < 0) xs.push(d[i]! + ((sv - s[i]!) / (s[j]! - s[i]!)) * (d[j]! - d[i]!)); }
    xs.sort((a, b) => a - b);
    let w = 0;
    for (let m = 0; m + 1 < xs.length; m += 2) w += xs[m + 1]! - xs[m]!;
    if (sv < mid) top += w; else bot += w;
  }
  return top / (bot || 1);
}

test("the ear metric scores an ellipse 1 at any view and a tapering shape above 1.2", () => {
  const ell: number[] = [], egg: number[] = [];
  for (let k = 0; k < 128; k++) {
    const a = (k * Math.PI) / 64, x = 300 * Math.cos(a), y = 500 * Math.sin(a);
    ell.push(1000 + x + 0.4 * y, 1000 + 0.6 * y); // an oval, sheared and squashed (a turned view)
    egg.push(1000 + x * (1 - 0.3 * Math.sin(a)), 1000 + y); // wider at the top (y < 0), narrower at the foot
  }
  assert.ok(Math.abs(earRatio(ell, [1200, 700, 800, 1300]) - 1) < 0.02, `an oval scores ${earRatio(ell, [1200, 700, 800, 1300]).toFixed(3)}`);
  assert.ok(earRatio(egg, [1000, 500, 1000, 1500]) > 1.2);
});

test("version 14: every visible ear is not an oval and carries its structure (200 codes)", () => {
  // An ear at least half of whose contour shows and at least 12 px across on the page: ratio above 1.2 (see earRatio).
  // An ear at least half showing and more than 120 px tall: its rim (the outer contour) and the rim's inner edge (the
  // helix's curl) drawn, and when its face is turned at least 0.4 toward the viewer (a three-quarter view or more), the concha's rim or the
  // tragus too.
  let ears = 0, tall = 0;
  for (let i = 0; i < 200; i++) {
    const plan = planV14(code(`v14-ears/${i}`));
    for (const e of earsV14(plan)) {
      const n = e.outline.length >> 1;
      if (e.visible * 2 < n) continue;
      const xs = e.outline.filter((_, k) => k % 2 === 0), ys = e.outline.filter((_, k) => k % 2 === 1);
      const L = Math.hypot(e.axis[2]! - e.axis[0]!, e.axis[3]! - e.axis[1]!), ux = (e.axis[2]! - e.axis[0]!) / L, uy = (e.axis[3]! - e.axis[1]!) / L;
      const across = (Math.max(...xs.map((x, k) => -x * uy + ys[k]! * ux)) - Math.min(...xs.map((x, k) => -x * uy + ys[k]! * ux))) / 16;
      const height = (Math.max(...xs.map((x, k) => x * ux + ys[k]! * uy)) - Math.min(...xs.map((x, k) => x * ux + ys[k]! * uy))) / 16;
      const at = `code ${i}, ear ${e.side}`;
      if (across >= 12) { ears++; assert.ok(earRatio(e.outline, e.axis) > 1.2, `${at}: ratio ${earRatio(e.outline, e.axis).toFixed(3)}`); }
      if (height > 120) {
        tall++;
        assert.ok((e.lines.outline ?? 0) > 0 && (e.lines.helix ?? 0) > 0, `${at}: the rim and its inner edge are drawn (${JSON.stringify(e.lines)})`);
        if (e.facing >= 0.4 * 65536) assert.ok((e.lines.concha ?? 0) + (e.lines.tragus ?? 0) > 0, `${at}: the concha or the tragus is drawn`);
      }
    }
  }
  assert.ok(ears > 150 && tall > 150, `${ears} ears measured, ${tall} tall enough for the structure`);
});

test("version 14: no ponytail lies in front of the neck or the jaw, but over one shoulder below the collarbone (200 codes)", () => {
  // Measured 2026-10-08 on these 200 codes (23 ponytails): version 14 0 pixels; version 13's tail over one shoulder,
  // put back into version 14 for the measure, 1,409 pixels on 4 of its 5 people (the strap down the side of the neck).
  let tails = 0, shown = 0;
  for (let i = 0; i < 200; i++) {
    const plan = planV14(code(`v14-pony/${i}`)), r = ponyV14(plan);
    if (!r.tail) continue;
    tails++; shown += r.tail;
    assert.equal(r.bad, 0, `code ${i} (${HAIR_NAMES_V14[plan.hair]}): ${r.bad} field pixels of tail in front of the neck or jaw`);
  }
  assert.ok(tails >= 10 && shown > 0, `${tails} ponytails seen`);
});

test("version 14: the neck is narrower than the jaw, never a pillar (200 codes, every face within 45 degrees of frontal)", () => {
  // Neck width just below the jaw over the face's width at the jaw angle. In the model (the neck's diameter just below
  // the chin over the face's width at the jaw angle, the measure the drawing sets): 0.55 to 0.82 for every face within
  // 45 degrees of frontal. On the page (field pixels: the median of the neck's runs in the six rows under the chin over
  // the head's run in the row of the jaw angle), checked where nothing covers either row (within 15 degrees of frontal,
  // no beard, no hair falling past the jaw, no turtleneck or high collar): 0.52 to 0.82.
  // Measured 2026-10-08 on these codes: version 13's model ratio 0.42 to 1.47, median 0.80, 62 of 142 faces over 0.82
  // (the pillar); version 14's 0.58 to 0.71, median 0.64; on the page 0.55 to 0.77 over the 25 uncovered faces.
  const falls = new Set([4, 5, 6, 7, 10, 11, 16]);
  let faces = 0, paged = 0;
  for (let i = 0; i < 200; i++) {
    const plan = planV14(code(`v14-neck/${i}`)), deg = Math.abs((plan.yaw * 360) / 16384);
    if (deg > 45) continue;
    const r = neckV14(plan);
    faces++;
    assert.ok(r.model >= 0.55 && r.model <= 0.82, `code ${i} (turned ${deg.toFixed(0)} degrees): model ratio ${r.model.toFixed(3)}`);
    if (deg <= 15 && plan.beard === 0 && !falls.has(plan.hair) && plan.garment !== 3 && plan.garment !== 10) {
      paged++;
      assert.ok(r.page >= 0.52 && r.page <= 0.82, `code ${i}: page ratio ${r.page.toFixed(3)}`);
    }
  }
  assert.ok(faces > 120 && paged >= 20, `${faces} faces, ${paged} measured on the page`);
});

const PINNED_PIXELS_V14 = "fbbea718af57fe5edcf2207ec9190b9eef5a7d966d8521dbf56d865e7ee2c55c";
const PINNED_PNG_V14 = "9aee554e56a53c1fb11efe46a5a8b18baa7a4ee116f88a930fa08573a309eeae";
