// Copyright (c) 2024-2026 Argento Computing Inc. All rights reserved.
/**
 * buildTree on every core (2026-10-12, the million-file benchmark: the single-threaded build was about 6 of the 11.65
 * seconds between a position opening and its proof). The leaves are sorted here, exactly as buildTree sorts them;
 * workers hash disjoint ranges of them, each range a node of the tree's own split, and return those subtree roots;
 * MerkleTree then joins them. The root, the order and every path are the verifier's own: a tree smaller than
 * PARALLEL_TREE_MIN, or a runtime without worker threads, takes buildTree itself.
 */
import { Worker } from "node:worker_threads";
import { availableParallelism, cpus } from "node:os";
import { buildTree, sortTreeLeaves, MerkleTree, type BuiltTree, type TreeLeaf } from "@mikeargento/bitgraph-verify";

/** Below this many leaves the workers cost more than they save. */
export const PARALLEL_TREE_MIN = 50_000;

function split(n: number): number {
  let k = 1;
  while (k * 2 < n) k *= 2;
  return k;
}

export async function buildTreeParallel(leaves: readonly TreeLeaf[], threads?: number): Promise<BuiltTree> {
  const cores = threads ?? Math.min(8, typeof availableParallelism === "function" ? availableParallelism() : cpus().length);
  if (leaves.length < PARALLEL_TREE_MIN || cores < 2) return buildTree(leaves);
  const sorted = sortTreeLeaves(leaves);
  const n = sorted.length;

  const leafBuf = new SharedArrayBuffer(n * 65);
  const L = new Uint8Array(leafBuf);
  for (let i = 0; i < n; i++) {
    const l = sorted[i]!;
    const o = i * 65;
    L[o] = l.placement;
    L.set(l.artifact, o + 1);
    L.set(l.origin, o + 33);
  }
  const outBuf = new SharedArrayBuffer(n * 32);

  // Ranges: the nodes of the tree's own split no larger than C, a few per core so the load evens out.
  const C = Math.max(4096, 2 ** Math.ceil(Math.log2(n / (cores * 4))));
  const blocks: Array<[number, number]> = [];
  const walk = (lo: number, hi: number): void => {
    if (hi - lo <= C) { blocks.push([lo, hi]); return; }
    const k = split(hi - lo);
    walk(lo, lo + k);
    walk(lo + k, hi);
  };
  walk(0, n);
  const shares: Array<Array<[number, number]>> = Array.from({ length: cores }, () => []);
  const load = new Array<number>(cores).fill(0);
  for (const b of [...blocks].sort((x, y) => (y[1] - y[0]) - (x[1] - x[0]))) {
    let w = 0;
    for (let i = 1; i < cores; i++) if (load[i]! < load[w]!) w = i;
    shares[w]!.push(b);
    load[w]! += b[1] - b[0];
  }

  const roots = await Promise.all(
    shares.filter((s) => s.length > 0).map(
      (share) =>
        new Promise<Array<[number, number, Uint8Array]>>((resolve, reject) => {
          const worker = new Worker(new URL("./tree-worker.js", import.meta.url), { workerData: { leaves: leafBuf, out: outBuf } });
          worker.once("message", (r: Array<[number, number, Uint8Array]>) => { resolve(r); void worker.terminate(); });
          worker.once("error", reject);
          worker.postMessage(share);
        }),
    ),
  );

  // Leaf hashes into an ordinary buffer: some consumers (WebCrypto among them) refuse views of shared memory.
  const hashes = new Uint8Array(n * 32);
  hashes.set(new Uint8Array(outBuf));
  const leafHashes = new Array<Uint8Array>(n);
  for (let i = 0; i < n; i++) leafHashes[i] = hashes.subarray(i * 32, i * 32 + 32);
  const known = roots.flat().map(([lo, hi, hash]) => ({ lo, hi, hash }));
  const tree = new MerkleTree(leafHashes, known);
  return { sorted, leafHashes, root: tree.root, tree };
}
