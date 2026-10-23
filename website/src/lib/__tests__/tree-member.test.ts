// A file of a tree found by its own hash (lib/tree-member.ts): every member's block checks against the proof that binds
// the root's text, for trees of every shape; nothing else does.
import { test } from "node:test";
import { strict as assert } from "node:assert";
import { sha256 } from "@noble/hashes/sha256";
import { buildTree } from "../plugins.ts";
import { DIGEST_TREE_FORMAT, checkMember, digestRootText, memberBlocks, memberOf, parseDigestRootText, withMember } from "../tree-member.ts";

const b64 = (u: Uint8Array) => Buffer.from(u).toString("base64");
const filesOf = (n: number) => Array.from({ length: n }, (_, i) => new File([`file ${i} of ${n}\n`], `f${i}.txt`));
const proofFor = (rootText: string) => ({ artifact: { digestB64: b64(sha256(new TextEncoder().encode(rootText))) }, commit: { counter: "14", epochId: "E" } });

test("new trees take each file's SHA-256 as leaf data and name the format in the bound text", async () => {
  const files = filesOf(5);
  const { tree, rootText } = await buildTree(files);
  assert.equal(tree.format, DIGEST_TREE_FORMAT);
  assert.equal(rootText, digestRootText(5, tree.root));
  assert.deepEqual(parseDigestRootText(rootText), { files: 5, root: tree.root });
  for (let i = 0; i < 5; i++) assert.equal(tree.leaves[i]![2], b64(sha256(new Uint8Array(await files[i]!.arrayBuffer()))));
});

test("every member checks by its hash alone, for odd and even trees", async () => {
  for (const n of [1, 2, 3, 5, 7, 8, 13, 100, 1203]) {
    const files = filesOf(n);
    const { tree, rootText } = await buildTree(files);
    const proof = proofFor(rootText);
    const blocks = memberBlocks(tree, rootText);
    for (let i = 0; i < n; i++) {
      const stored = withMember(proof, blocks[i]!);
      assert.ok(memberOf(stored), `n=${n} i=${i} parses`);
      assert.ok(checkMember(stored, tree.leaves[i]![2]), `n=${n} i=${i} checks`);
      assert.ok(checkMember(stored, tree.leaves[i]![2].replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "")), "url-safe hash checks too");
    }
  }
});

test("a block proves only its own file, at its own index, under its own root", async () => {
  const files = filesOf(7);
  const { tree, rootText } = await buildTree(files);
  const proof = proofFor(rootText);
  const blocks = memberBlocks(tree, rootText);
  const d = (i: number) => tree.leaves[i]![2];
  assert.equal(checkMember(withMember(proof, blocks[0]!), d(1)), false, "another file's hash");
  assert.equal(checkMember(withMember(proof, { ...blocks[0]!, index: 2 }), d(0)), false, "another index");
  assert.equal(checkMember(withMember(proof, { ...blocks[0]!, index: 7 }), d(0)), false, "index past the end");
  assert.equal(checkMember(withMember(proofFor("other text"), blocks[0]!), d(0)), false, "a proof of other bytes");
  const otherRoot = digestRootText(7, "0".repeat(64));
  assert.equal(checkMember(withMember(proofFor(otherRoot), { ...blocks[0]!, rootText: otherRoot }), d(0)), false, "a root the path does not reach");
  assert.equal(checkMember(withMember(proof, { ...blocks[0]!, files: 8 }), d(0)), false, "a count the text does not name");
  assert.equal(checkMember(proof, d(0)), false, "no block at all");
  assert.equal(checkMember(withMember(proof, { ...blocks[0]!, path: "!!" }), d(0)), false, "a path that is not base64");
});

test("the same files make the same tree, whatever order they are dropped in", async () => {
  const { hashLeaves, treeFromLeaves, sortedLeaves } = await import("../plugins.ts");
  const files = filesOf(37);
  const shuffled = [...files].reverse().sort((a, b) => (a.name.length % 3) - (b.name.length % 3));
  const one = await buildTree(files), two = await buildTree(shuffled);
  assert.equal(one.tree.root, two.tree.root);
  assert.equal(one.rootText, two.rootText);
  // The order a browser read them in still builds its own tree (trees made before 2026-10-20 kept it).
  const asDropped = await treeFromLeaves(await hashLeaves(shuffled));
  assert.notEqual(asDropped.tree.root, one.tree.root);
  assert.equal((await treeFromLeaves(sortedLeaves(await hashLeaves(shuffled)))).tree.root, one.tree.root);
});

test("a tree's floor leaf, base-block.json, is checked into the bound root; a changed or foreign floor is not", async () => {
  const { hashLeaves, treeFromLeaves, sortedLeaves } = await import("../plugins.ts");
  const { baseBlockFileText, checkFloor } = await import("../tree-member.ts");
  const block = { chain: "base-mainnet", chainId: 8453, number: 52875700, hash: "0x" + "ab".repeat(32), timestamp: 1792540747 };
  const floorFile = baseBlockFileText(block);
  for (const n of [1, 2, 7]) {
    const files = filesOf(n);
    const [floorLeaf] = await hashLeaves([new File([floorFile], "base-block.json")]);
    const { tree, rootText } = await treeFromLeaves([floorLeaf!, ...sortedLeaves(await hashLeaves(files))]);
    const proof = proofFor(rootText);
    const blocks = memberBlocks(tree, rootText, floorFile);
    for (let i = 0; i < tree.files; i++) {
      const stored = withMember(proof, blocks[i]!);
      assert.ok(checkMember(stored, tree.leaves[i]![2]), `n=${n} i=${i} member`);
      assert.deepEqual(checkFloor(stored), block, `n=${n} i=${i} floor`);
    }
    const m = blocks[1]!;
    assert.equal(checkFloor(withMember(proof, { ...m, floor: { ...m.floor!, file: floorFile.replace("52875700", "52875701") } })), null, "a changed block");
    assert.equal(checkFloor(withMember(proofFor(digestRootText(tree.files, "0".repeat(64))), m)), null, "another tree's root");
    assert.equal(checkFloor(withMember(proof, { ...m, floor: undefined })), null, "no floor");
  }
});
