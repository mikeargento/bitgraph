// The high resolution download (Mike, 2026-10-06): the recorded version 6 image redrawn at four times
// the size. It must be the same picture (averaged back down, it matches the recorded pixels), a
// readable PNG at 4096 x 4096, and never a file that passes for the recorded one.
import { test } from "node:test";
import * as assert from "node:assert/strict";
import { sha256 } from "@noble/hashes/sha256";
import { decodePng, makeArt, toBase64Url, ART_ALGORITHM_V6 } from "../commitment-art.ts";
import { planV6, renderV6, renderV6At } from "../commitment-art-v6.ts";
import { drawPrint, PRINT_SCALE, PRINT_SIZE } from "../art-print.ts";

const code = (s: string) => sha256(new TextEncoder().encode(s));

test("the 4x drawing is the same picture: averaged back to 1024 it matches the recorded pixels", () => {
  // one calm, one loud with glitch strips
  const seeds = ["print calm", "hires 7"];
  for (const seed of seeds) {
    const c = code(seed), plan = planV6(c);
    const a = renderV6(plan, c), b = renderV6At(plan, c, PRINT_SCALE), S = PRINT_SCALE, W = 1024 * S;
    let diff = 0;
    for (let y = 0; y < 1024; y++) for (let x = 0; x < 1024; x++) for (let ch = 0; ch < 3; ch++) {
      let s = 0;
      for (let j = 0; j < S; j++) for (let i = 0; i < S; i++) s += b[((y * S + j) * W + x * S + i) * 4 + ch]!;
      diff += Math.abs(s / (S * S) - a[(y * 1024 + x) * 4 + ch]!);
    }
    assert.ok(diff / (1024 * 1024 * 3) < 2, `${seed}: mean difference ${(diff / (1024 * 1024 * 3)).toFixed(2)} of 255`);
  }
  assert.equal(planV6(code("hires 7")).glitch.length > 0, true, "the loud case has glitch strips");
});

test("the print file is a 4096 x 4096 PNG that says what it is and is not the recorded file", async () => {
  const c = code("print file");
  const recorded = await makeArt(c, ART_ALGORITHM_V6);
  const digestB64 = Buffer.from(sha256(recorded.png)).toString("base64");
  const bytes = await drawPrint({ commitment: toBase64Url(c), counter: 1234, digestB64 });
  const d = await decodePng(bytes);
  assert.equal(d.width, PRINT_SIZE);
  assert.equal(d.height, PRINT_SIZE);
  assert.match(d.texts["bitgraph-art-print"]!, /BitGraph #1234/);
  assert.ok(d.texts["bitgraph-art-print"]!.includes(digestB64));
  assert.equal(d.texts["bitgraph-art"], undefined, "no manifest: it never passes for the recorded image");
  assert.ok(!new TextDecoder("latin1").decode(bytes).includes(toBase64Url(c)), "the commitment is not carried");
  // the decoded pixels are the drawing
  const px = renderV6At(planV6(c), c, PRINT_SCALE);
  for (const k of [0, 12345, 5_000_000, PRINT_SIZE * PRINT_SIZE - 1]) assert.deepEqual([...d.rgba.subarray(4 * k, 4 * k + 3)], [...px.subarray(4 * k, 4 * k + 3)]);
});

test("version 7's print drawing is the same picture: averaged back to 1024 it matches the recorded pixels", async () => {
  const { planV7, renderV7, renderV7At } = await import("../commitment-art-v7.ts");
  const c = code("print v7"), plan = planV7(c);
  const a = renderV7(plan, c), b = renderV7At(plan, c, PRINT_SCALE), S = PRINT_SCALE, W = 1024 * S;
  let diff = 0;
  for (let y = 0; y < 1024; y++) for (let x = 0; x < 1024; x++) for (let ch = 0; ch < 3; ch++) {
    let s = 0;
    for (let j = 0; j < S; j++) for (let i = 0; i < S; i++) s += b[((y * S + j) * W + x * S + i) * 4 + ch]!;
    diff += Math.abs(s / (S * S) - a[(y * 1024 + x) * 4 + ch]!);
  }
  assert.ok(diff / (1024 * 1024 * 3) < 2, `mean difference ${(diff / (1024 * 1024 * 3)).toFixed(2)} of 255`);
});

test("version 8's print drawing (3x, 4800 x 3072) is the same picture as the recorded one", async () => {
  const { planV8, renderV8, renderV8At } = await import("../commitment-art-v8.ts");
  const c = code("print v8"), plan = planV8(c), S = 3;
  const a = renderV8(plan, c), b = renderV8At(plan, c, S), W = 1600 * S;
  let diff = 0;
  for (let y = 0; y < 1024; y++) for (let x = 0; x < 1600; x++) for (let ch = 0; ch < 3; ch++) {
    let s = 0;
    for (let j = 0; j < S; j++) for (let i = 0; i < S; i++) s += b[((y * S + j) * W + x * S + i) * 4 + ch]!;
    diff += Math.abs(s / (S * S) - a[(y * 1600 + x) * 4 + ch]!);
  }
  assert.ok(diff / (1600 * 1024 * 3) < 2, `mean difference ${(diff / (1600 * 1024 * 3)).toFixed(2)} of 255`);
});
