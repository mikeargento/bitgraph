// © 2026 Michael Argento. All rights reserved.
// The bitgraph-art/15 tests' heavy work, run as a background child process (commitment-art-v15.test.ts starts it under
// `taskpolicy -b` on macOS, `nice` elsewhere), so painting a hundred and more pictures uses spare CPU and never slows the
// other test files' own timings.
// Prints one JSON line. Tasks:
//   pinned          the pinned commitment's pixels and file hashes, and both image checks for it and for a wrong code
//   code            two codes sharing one plan: how many pixels differ, by how much, and what each reads back as
//   print           the reduced-scale redrawing against the recorded picture, and the print file's header and note
//   sweep <N> <W>   N commitments painted by W worker threads: read back, measures, thumbnails
import { Worker } from "node:worker_threads";
import { sha256 } from "@noble/hashes/sha256";
import { ART_ALGORITHM_V15, checkArt, decodePng, makeArt, toBase64Url, toHex } from "../commitment-art.ts";
import { decodeV15, planV15, renderV15, renderV15At, V15_HEIGHT, V15_WIDTH } from "../commitment-art-v15.ts";
import { drawPrint } from "../art-print.ts";

const code = (s: string) => sha256(new TextEncoder().encode(s));
const C1 = code("bitgraph-art test commitment one");
const task = process.argv[2];
let out: unknown;
if (task === "pinned") {
  const a = await makeArt(C1, ART_ALGORITHM_V15), b = await makeArt(C1, ART_ALGORITHM_V15);
  const right = await checkArt(a.png, C1), wrong = await checkArt(a.png, code("another code"));
  out = { pixels: toHex(sha256(a.pixels)), png: toHex(sha256(a.png)), pngAgain: toHex(sha256(b.png)), pngBytes: a.png.length, recipe: a.recipe.algorithm, right: [right.regenerated.result, right.strip.result, right.strip.detail], wrong: [wrong.regenerated.result, wrong.strip.result] };
} else if (task === "code") {
  const plan = planV15(C1), zeros = new Uint8Array(32), ones = new Uint8Array(32).fill(255);
  const a = renderV15(plan, zeros), b = renderV15(plan, ones);
  let diff = 0, most = 0;
  for (let i = 0; i < a.length; i += 4) { const d = Math.abs(a[i]! - b[i]!) + Math.abs(a[i + 1]! - b[i + 1]!) + Math.abs(a[i + 2]! - b[i + 2]!); if (d) { diff++; most = Math.max(most, d); } }
  const hex = (x: Uint8Array | null) => (x ? toHex(x) : null);
  out = { length: a.length, diff, most, readA: hex(decodeV15(a, V15_WIDTH, V15_HEIGHT)), readB: hex(decodeV15(b, V15_WIDTH, V15_HEIGHT)), other: decodeV15(a, 1200, 1200) };
} else if (task === "print") {
  const plan = planV15(C1), a = renderV15(plan, C1), b = renderV15At(plan, C1, 1);
  let diff = 0;
  for (let y = 0; y < 600; y++) for (let x = 0; x < 600; x++) for (let ch = 0; ch < 3; ch++) {
    let s = 0, t = 0;
    for (let j = 0; j < 3; j++) for (let i = 0; i < 3; i++) s += a[((y * 3 + j) * 1800 + x * 3 + i) * 4 + ch]!;
    for (let j = 0; j < 2; j++) for (let i = 0; i < 2; i++) t += b[((y * 2 + j) * 1200 + x * 2 + i) * 4 + ch]!;
    diff += Math.abs(s / 9 - t / 4);
  }
  const bytes = await drawPrint({ commitment: toBase64Url(C1), counter: 15, digestB64: "x", algorithm: ART_ALGORITHM_V15 });
  const d = await decodePng(bytes);
  out = { smallLength: b.length, mean: diff / (600 * 600 * 3), width: d.width, height: d.height, note: d.texts["bitgraph-art-print"] ?? null, manifest: d.texts["bitgraph-art"] ?? null, carries: new TextDecoder("latin1").decode(bytes.subarray(0, 4096)).includes(toBase64Url(C1)) };
} else if (task === "sweep") {
  const N = Number(process.argv[3]), W = Number(process.argv[4]);
  const codes = [new Uint8Array(32), new Uint8Array(32).fill(255)];
  for (let k = 0; codes.length < N; k++) codes.push(code(`bitgraph-art/15 sweep ${k}`));
  const hex = codes.map((c) => Buffer.from(c).toString("hex"));
  const rows: unknown[] = [];
  await Promise.all(Array.from({ length: W }, (_, w) => new Promise<void>((resolve, reject) => {
    const wk = new Worker(new URL("./commitment-art-v15.worker.ts", import.meta.url), { workerData: { codes: hex.filter((_, i) => i % W === w) } });
    wk.on("message", (m) => rows.push(m));
    wk.on("error", reject);
    wk.on("exit", (c) => (c === 0 ? resolve() : reject(new Error(`worker exit ${c}`))));
  })));
  out = rows;
} else throw new Error(`unknown task ${task}`);
process.stdout.write(JSON.stringify(out) + "\n");
