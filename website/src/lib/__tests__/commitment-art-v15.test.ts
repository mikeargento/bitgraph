// © 2026 Michael Argento. All rights reserved.
// bitgraph-art/15 (2026-10-09): an abstract oil painting, square, 1800 x 1800, integer-only, the code in 256 reading
// pixels by parity. Pinned, the plan integer-only, the code read back from the picture alone, only the reading pixels
// carry it, the print is the same painting, fast enough, the painter's own checks over 120 commitments; and the default.
import { test } from "node:test";
import * as assert from "node:assert/strict";
import { availableParallelism } from "node:os";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import { sha256 } from "@noble/hashes/sha256";
import { ART_ALGORITHM, ART_ALGORITHM_V15, ART_ALGORITHMS, artRecipe, artSize, makeArt, recipeJson } from "../commitment-art.ts";
import { PALETTES_V15, REF_PALETTE_NAMES_V15, STRATEGY_NAMES_V15, compositionNameV15, decodeV15, paletteNameV15, planV15, V15_HEIGHT, V15_WIDTH } from "../commitment-art-v15.ts";
import { PRINTABLE, printSizeOf } from "../art-print.ts";
import { deflateV15, filterRowsV15 } from "../png-deflate-v15.ts";
import { inflateSync } from "node:zlib";

const run = promisify(execFile);

const code = (s: string) => sha256(new TextEncoder().encode(s));
const C1 = code("bitgraph-art test commitment one");

function nonIntegers(v: unknown): number {
  if (typeof v === "number") return Number.isInteger(v) ? 0 : 1;
  if (Array.isArray(v)) return v.reduce((n: number, x) => n + nonIntegers(x), 0);
  if (v && typeof v === "object") return Object.values(v).reduce((n: number, x) => n + nonIntegers(x), 0);
  return 0;
}

/** The heavy work runs in a background child process (commitment-art-v15.child.ts): on macOS under `taskpolicy -b`
 *  (background work, on the efficiency cores only), elsewhere under `nice`, so the other test files' own timings are
 *  not disturbed. */
async function niced<T>(...args: string[]): Promise<T> {
  const child = fileURLToPath(new URL("./commitment-art-v15.child.ts", import.meta.url));
  const cmd = process.platform === "darwin" ? ["taskpolicy", "-b"] : ["nice", "-n", "19"];
  const { stdout } = await run(cmd[0]!, [...cmd.slice(1), process.execPath, child, ...args], { maxBuffer: 1 << 26 });
  return JSON.parse(stdout.trim().split("\n").pop()!) as T;
}
/** The same at full speed, once no other test file is still running (the sweep and the timing: a hundred and more
 *  paintings, and a measure of speed, neither of which should share the machine with another file's own timings). */
async function whenAlone<T>(...args: string[]): Promise<T> {
  await alone();
  const child = fileURLToPath(new URL("./commitment-art-v15.child.ts", import.meta.url));
  const { stdout } = await run(process.execPath, [child, ...args], { maxBuffer: 1 << 26 });
  return JSON.parse(stdout.trim().split("\n").pop()!) as T;
}
/** Wait (up to 20 minutes) until no other test file's process is running: each runs as its own node process. */
async function alone(): Promise<void> {
  for (let t = 0; t < 240; t++) {
    let others = 0;
    try {
      const { stdout } = await run("ps", ["-Ao", "command"], { maxBuffer: 1 << 24 });
      others = stdout.split("\n").filter((l) => l.includes("__tests__") && l.includes(".test.ts") && !l.includes("commitment-art-v15")).length;
    } catch { return; }
    if (others === 0) return;
    await new Promise((r) => setTimeout(r, 5000));
  }
}

test("version 15 is pinned: this commitment's pixels and file never change, and both image checks pass", async () => {
  const r = await niced<{ pixels: string; png: string; pngAgain: string; pngBytes: number; recipe: string; right: string[]; wrong: string[] }>("pinned");
  // Pinned on first run (2026-10-09); the file re-pinned the same day for version 15's own encoding (png-deflate-v15.ts),
  // the pixels unchanged.
  // A failure here means bitgraph-art/15 changed: make /16 instead.
  assert.equal(r.pixels, PINNED_PIXELS_V15);
  assert.equal(r.png, PINNED_PNG_V15);
  assert.equal(r.pngAgain, r.png, "the same file twice, the canvas weave built and then reused");
  assert.ok(r.pngBytes < 6_000_000, `the file is ${(r.pngBytes / 1e6).toFixed(2)} MB (4.72 when pinned; the fixed deflate of earlier versions made 7.96)`);
  assert.equal(r.recipe, ART_ALGORITHM_V15);
  assert.deepEqual(artSize(ART_ALGORITHM_V15), { width: 1800, height: 1800 });
  assert.equal(r.right[0], "TRUE");
  assert.equal(r.right[1], "TRUE");
  assert.match(r.right[2]!, /the art reads/);
  assert.deepEqual(r.wrong, ["FALSE", "FALSE"]);
});

test("version 15 is registered and is the default: a new image is drawn with it (2026-10-09)", () => {
  assert.ok(ART_ALGORITHMS.includes(ART_ALGORITHM_V15));
  assert.equal(ART_ALGORITHM, "bitgraph-art/15");
  assert.equal(artRecipe(C1).algorithm, "bitgraph-art/15");
  assert.equal(JSON.stringify(artRecipe(C1).v15), JSON.stringify(planV15(C1)));
  assert.equal(recipeJson(artRecipe(C1)), recipeJson(artRecipe(C1, ART_ALGORITHM_V15)));
});

test("version 15's plan is integer-only, a function of the commitment, and named in plain words", () => {
  const strategies = new Set<number>(), refs = new Set<number>();
  let harmonies = 0;
  for (let k = 0; k < 60; k++) {
    const c = code(`bitgraph-art/15 plan ${k}`), plan = planV15(c);
    assert.equal(nonIntegers(plan), 0, `code ${k}: every number in the plan is an integer`);
    assert.equal(JSON.stringify(plan), JSON.stringify(planV15(c)), `code ${k}: the same plan again`);
    assert.ok(STRATEGY_NAMES_V15.includes(compositionNameV15(plan)) && paletteNameV15(plan).length > 0);
    strategies.add(plan.strategy);
    if (plan.palette >= 0) refs.add(plan.palette); else harmonies++;
    assert.ok(plan.masses.length >= 3 && plan.opens.length >= 1 && plan.focal.length === 2, `code ${k}: masses, open space, two focal points`);
  }
  assert.equal(strategies.size, 8, "every composition strategy occurs in 60");
  assert.ok(refs.size >= 4 && harmonies >= 10, `${refs.size} reference palettes and ${harmonies} harmonies in 60`);
  assert.equal(PALETTES_V15.length, REF_PALETTE_NAMES_V15.length);
});

test("version 15: only the 256 reading pixels carry the code; two codes with the same plan differ nowhere else", async () => {
  const r = await niced<{ length: number; diff: number; most: number; readA: string; readB: string; other: null }>("code");
  assert.equal(r.length, V15_WIDTH * V15_HEIGHT * 4);
  assert.equal(r.diff, 256);
  assert.equal(r.most, 1, "a reading pixel is its painted colour or one level away in one channel");
  assert.equal(r.readA, "00".repeat(32));
  assert.equal(r.readB, "ff".repeat(32));
  assert.equal(r.other, null, "another size is not a version 15 picture");
  // and the decoder on its own: parity per reading pixel
  const px = new Uint8Array(V15_WIDTH * V15_HEIGHT * 4);
  assert.deepEqual(decodeV15(px, V15_WIDTH, V15_HEIGHT), new Uint8Array(32));
});

test("version 15 redraws at another scale as the same painting, and the print is the recorded size", async () => {
  // At a reduced scale (the 1200 px layout, 1 x) the painting is the recorded scale's score laid again: compared over
  // 600 x 600 cells (3 x 3 recorded pixels, 2 x 2 of the smaller drawing), the mean difference stays small. The print is
  // drawn at the recorded size (V15_PRINT_LAYOUT_SCALE): a larger one needs the whole larger canvas in memory.
  const r = await niced<{ smallLength: number; mean: number; width: number; height: number; note: string | null; manifest: string | null; carries: boolean }>("print");
  assert.equal(r.smallLength, 1200 * 1200 * 4);
  assert.ok(r.mean < PRINT_PARITY_MAX, `mean difference ${r.mean.toFixed(2)} of 255`);
  assert.ok(PRINTABLE.includes(ART_ALGORITHM_V15));
  assert.deepEqual(printSizeOf(ART_ALGORITHM_V15), { width: 1800, height: 1800 });
  assert.equal(r.width, 1800);
  assert.equal(r.height, 1800);
  assert.ok(r.note!.includes("bitgraph-art/15"), "the print note names the version");
  assert.equal(r.manifest, null, "no manifest: it never passes for the recorded image");
  assert.equal(r.carries, false, "the commitment is not carried");
});

test("version 15's file encoding: zlib reads back every byte, any filter and any data, and it is smaller than stored", () => {
  // png-deflate-v15.ts against node's own inflate: a painting's rows, flat runs, noise, and the empty and tiny cases
  const rnd = (n: number, seed: number) => { const b = new Uint8Array(n); let x = seed; for (let i = 0; i < n; i++) { x = (Math.imul(x, 1103515245) + 12345) >>> 0; b[i] = x >>> 24; } return b; };
  const flat = new Uint8Array(300_000).fill(7), runs = Uint8Array.from({ length: 200_000 }, (_, i) => (i >> 9) & 3);
  for (const raw of [new Uint8Array(0), Uint8Array.of(1), Uint8Array.of(1, 2, 3, 1, 2, 3, 1, 2, 3), flat, runs, rnd(100_000, 1), rnd(70_000, 2)]) {
    assert.deepEqual(new Uint8Array(inflateSync(deflateV15(raw))), raw);
  }
  assert.ok(deflateV15(flat).length < 2000 && deflateV15(runs).length < 20_000);
  // the filters: a gradient image picks a predicting filter and reads back exactly through decoding the filters
  const w = 64, h = 32, px = new Uint8Array(w * h * 4);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { const i = (y * w + x) * 4; px[i] = x * 3; px[i + 1] = y * 5; px[i + 2] = (x + y) & 255; px[i + 3] = 255; }
  const rows = filterRowsV15(px, w, h);
  assert.equal(rows.length, h * (w * 3 + 1));
  assert.ok(rows[w * 3 + 1]! !== 0, "a row of a gradient takes a predicting filter");
});

/**
 * The painter's checks (the sketch's sweep, its thresholds), over 120 commitments painted by worker threads in a child
 * process once no other test file is running; each check fails on under 1 percent of them (at most one in 120), and every picture reads back its code from
 * its pixels alone.
 *   mud          more than 22 percent of the painted area low-saturation mid-value grey-brown
 *   empty        open space more than its target + 0.17
 *   overload     open space under 0.22
 *   monotony     the 3rd to 97th percentile value range under 0.42, or under 25 percent of the painted area saturated
 *   edge focal   the primary focal point within 0.08 of an edge
 *   duplicate    the mean absolute difference of two 16 x 16 thumbnails under 9 (of 255)
 */
test("version 15: the painter's checks over 120 commitments, each under 1 percent, and the code reads back from every picture", async () => {
  const N = 120, W = Math.max(1, Math.min(6, availableParallelism() - 2));
  type Row = { hex: string; read: string | null; measures: { open: number; mud: number; valueRange: number; saturatedShare: number; focalEdge: number; openTarget: number }; thumb: number[] };
  const rows = await whenAlone<Row[]>("sweep", String(N), String(W));
  assert.equal(rows.length, N);
  for (const r of rows) assert.equal(r.read, r.hex, `${r.hex.slice(0, 12)}: the code reads back from the picture alone`);
  const fails = { mud: 0, empty: 0, overload: 0, monotony: 0, edgeFocal: 0, duplicate: 0 };
  for (const r of rows) {
    const m = r.measures;
    if (m.mud > 220) fails.mud++;
    if (m.open > m.openTarget + 170) fails.empty++;
    if (m.open < 220) fails.overload++;
    if (m.valueRange < 42 || m.saturatedShare < 250) fails.monotony++;
    if (m.focalEdge < 80) fails.edgeFocal++;
  }
  const dup = new Set<number>();
  for (let i = 0; i < N; i++) for (let j = i + 1; j < N; j++) {
    let d = 0;
    for (let k = 0; k < 768; k++) d += Math.abs(rows[i]!.thumb[k]! - rows[j]!.thumb[k]!);
    if (d / 768 < 9) dup.add(j);
  }
  fails.duplicate = dup.size;
  for (const [k, n] of Object.entries(fails)) assert.ok(n * 100 < N, `${k}: ${n} of ${N} (${JSON.stringify(fails)})`);
});

test("version 15 paints fast enough: plan, painting and the recorded file, median under 6 s at 1800 x 1800", async () => {
  // Last in this file, when no other test file is running. The main thread's CPU time over ten fixed
  // codes, the canvas weaves built first (built once per weave and kept). Measured on an Apple M3 alone (2026-10-09):
  // these ten about 5.6 s median (the painting 4.7 s, its file 0.87 s), 3.5 to 9.8 s; over thirty codes the median is
  // about 6 s and the heaviest (many rounds of the density loop, as the sketch's own heaviest) about 13 s.
  await alone();
  for (const k of [0, 1, 2]) await makeArt(code(`bitgraph-art/15 weave ${k}`), ART_ALGORITHM_V15);
  const ms: number[] = [];
  for (let k = 0; k < 10; k++) {
    const t0 = process.cpuUsage();
    await makeArt(sha256(new TextEncoder().encode(`v15 bench ${k}`)), ART_ALGORITHM_V15);
    const t = process.cpuUsage(t0);
    ms.push((t.user + t.system) / 1000);
  }
  ms.sort((x, y) => x - y);
  const median = (ms[4]! + ms[5]!) / 2;
  assert.ok(median < 6000, `median ${median.toFixed(0)} ms (${ms.map((v) => v.toFixed(0)).join(", ")})`);
  assert.ok(ms[9]! < 20000, `the heaviest ${ms[9]!.toFixed(0)} ms`);
});

const PINNED_PIXELS_V15 = "32643f0756c73ab5a0197a55f765f86cffb47e9dfed079f48f41f460c0097420";
const PINNED_PNG_V15 = "4bef6a1de9648c7db46fed1e1d318e0883a8af186c36d11239cca08981c700f3";
/** Measured 2026-10-09 on this code: 7.3 (the bristle streaks and the wet mixing differ pixel by pixel between scales; the marks do not). */
const PRINT_PARITY_MAX = 10;
