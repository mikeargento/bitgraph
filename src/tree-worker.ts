// Copyright (c) 2024-2026 Argento Computing Inc. All rights reserved.
/**
 * One worker of buildTreeParallel (tree-parallel.ts): for each leaf range it is given (a node of the tree's own
 * RFC 6962 split), it writes every leaf hash, SHA-256(0x00 || 65-byte leaf), into the shared output and returns the
 * range's subtree root, SHA-256(0x01 || left || right) all the way up. The same hashing as the verifier's MerkleTree.
 */
// The bare name, not "node:...": a bundler's file tracer that reaches this script through tree-parallel's
// new URL("./tree-worker.js") handles a bare built-in and chokes on the node: form (Turbopack, 2026-10-17).
import { parentPort, workerData } from "worker_threads";
import { createHash } from "node:crypto";

const { leaves, out } = workerData as { leaves: SharedArrayBuffer; out: SharedArrayBuffer };
const L = new Uint8Array(leaves);
const O = new Uint8Array(out);
const LEAF = new Uint8Array([0x00]);
const NODE = new Uint8Array([0x01]);

function split(n: number): number {
  let k = 1;
  while (k * 2 < n) k *= 2;
  return k;
}

function subtree(lo: number, hi: number): Uint8Array {
  if (hi - lo === 1) return O.subarray(lo * 32, lo * 32 + 32);
  const k = split(hi - lo);
  const left = subtree(lo, lo + k);
  const right = subtree(lo + k, hi);
  return createHash("sha256").update(NODE).update(left).update(right).digest();
}

parentPort!.once("message", (blocks: Array<[number, number]>) => {
  const roots: Array<[number, number, Uint8Array]> = [];
  for (const [lo, hi] of blocks) {
    for (let i = lo; i < hi; i++) O.set(createHash("sha256").update(LEAF).update(L.subarray(i * 65, i * 65 + 65)).digest(), i * 32);
    if (hi - lo >= 2) roots.push([lo, hi, new Uint8Array(subtree(lo, hi))]);
  }
  parentPort!.postMessage(roots);
});
