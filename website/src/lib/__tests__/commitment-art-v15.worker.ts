// © 2026 Michael Argento. All rights reserved.
// A worker thread for the bitgraph-art/15 tests: paints the commitments it is given (the recorded picture, with its
// code) and returns, for each, whether the code reads back from the pixels alone, the painter's measures, and a
// 16 x 16 thumbnail of the lit picture. The tests paint a hundred and more of them, so they share them out.
import { parentPort, workerData } from "node:worker_threads";
import { planV15, renderV15Measured, decodeV15, V15_WIDTH, V15_HEIGHT } from "../commitment-art-v15.ts";

const codes = (workerData as { codes: string[] }).codes;
for (const hex of codes) {
  const c = Uint8Array.from(Buffer.from(hex, "hex"));
  const plan = planV15(c);
  const t0 = performance.now();
  const { px, measures } = renderV15Measured(plan, c);
  const ms = performance.now() - t0;
  const read = decodeV15(px, V15_WIDTH, V15_HEIGHT);
  const thumb: number[] = [], cell = (k: number): number => Math.floor((k * V15_WIDTH) / 16);
  for (let ty = 0; ty < 16; ty++) for (let tx = 0; tx < 16; tx++) {
    const s = [0, 0, 0]; let n = 0;
    for (let y = cell(ty); y < cell(ty + 1); y++) for (let x = cell(tx); x < cell(tx + 1); x++) { const i = (y * V15_WIDTH + x) * 4; s[0] += px[i]!; s[1] += px[i + 1]!; s[2] += px[i + 2]!; n++; }
    thumb.push(Math.round(s[0]! / n), Math.round(s[1]! / n), Math.round(s[2]! / n));
  }
  parentPort!.postMessage({ hex, read: read ? Buffer.from(read).toString("hex") : null, measures, thumb, strategy: plan.strategy, ms, height: V15_HEIGHT });
}
