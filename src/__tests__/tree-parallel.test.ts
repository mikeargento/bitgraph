// Copyright (c) 2024-2026 Argento Computing Inc. All rights reserved.
/**
 * buildTreeParallel is buildTree on every core: the same sorted leaves, leaf hashes, root and paths, at sizes around
 * the parallel threshold and the workers' range boundaries.
 */
import { test } from "node:test";
import { strict as assert } from "node:assert";
import { randomBytes } from "node:crypto";
import { buildTree, type TreeLeaf } from "@mikeargento/bitgraph-verify";
import { buildTreeParallel, PARALLEL_TREE_MIN } from "../tree-parallel.js";

const leavesOf = (n: number): TreeLeaf[] => Array.from({ length: n }, () => ({ placement: 0x03, artifact: randomBytes(32), origin: randomBytes(32) }));
const eq = (a: Uint8Array, b: Uint8Array) => Buffer.from(a).equals(Buffer.from(b));

for (const n of [3, PARALLEL_TREE_MIN, PARALLEL_TREE_MIN + 1, 65_537, 131_073]) {
  test(`buildTreeParallel matches buildTree at ${n} leaves`, async () => {
    const leaves = leavesOf(n);
    const a = await buildTreeParallel(leaves);
    const b = buildTree(leaves);
    assert.ok(eq(a.root, b.root), "same root");
    assert.ok(a.sorted.every((l, i) => l === b.sorted[i]), "same order");
    assert.ok(a.leafHashes.every((h, i) => eq(h, b.leafHashes[i]!)), "same leaf hashes");
    for (const i of [0, 1, n >> 1, n - 2, n - 1]) {
      const p = a.tree.path(i), q = b.tree.path(i);
      assert.equal(p.length, q.length);
      assert.ok(p.every((x, j) => eq(x, q[j]!)), `same path for leaf ${i}`);
    }
  });
}

test("buildTreeParallel refuses a duplicate artifact, as buildTree does", async () => {
  const leaves = leavesOf(PARALLEL_TREE_MIN + 5);
  leaves[7] = { ...leaves[7]!, artifact: leaves[3]!.artifact };
  await assert.rejects(buildTreeParallel(leaves), /duplicate leaf artifact/);
});
