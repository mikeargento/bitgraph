// Copyright (c) Argento Computing Inc. All rights reserved. See LICENSE.

/**
 * One file as one BitGraph, the way Make binds a single file: the tree [base-block.json, the file] (lib/plugins.ts), its
 * root bound with floorLeaf (so app/api/commit binds no separate floor in front of it), and both leaves indexed under
 * their own hashes (app/api/tree-members). The file is then looked up by its own SHA-256 like a file bound alone, and
 * its proof page shows the floor the tree holds.
 *
 * Explicit .ts specifiers so node's test runner loads it.
 */
import { bindOne, digestOf, hashLeaves, latestBaseBlock, postTreeMembers, treeFromLeaves, type Proof } from "./plugins.ts";
import { baseBlockFileText, memberBlocks, withMember } from "./tree-member.ts";

/** Several files as one BitGraph, the way Make binds a drop: the tree [base-block.json, ...files], one bind, every leaf
 *  indexed. Each file's proof carries its own member block; digests are the files' own, in order. */
export async function bindFiles(items: Array<{ name: string; bytes: Uint8Array; type: string }>): Promise<{ proofs: Proof[]; digests: string[] }> {
  if (items.length === 0) return { proofs: [], digests: [] };
  const floorFile = baseBlockFileText(await latestBaseBlock());
  const leaves = await hashLeaves([new File([floorFile], "base-block.json", { type: "application/json" }), ...items.map((it) => new File([it.bytes.slice()], it.name, { type: it.type }))]);
  const { tree, rootText } = await treeFromLeaves(leaves);
  const rootDigest = await digestOf(new TextEncoder().encode(rootText));
  const p = await bindOne(rootDigest, { ceiling: true, floorLeaf: true });
  const blocks = memberBlocks(tree, rootText, floorFile);
  await postTreeMembers({ rootDigestB64: rootDigest, epochId: String(p.commit!.epochId), counter: String(p.commit!.counter), rootText, floor: blocks[0]!.floor! },
    tree.leaves.map((l, i) => ({ digestB64: l[2], index: i, path: blocks[i]!.path })));
  return { proofs: items.map((_, i) => withMember(p, blocks[i + 1]!) as Proof), digests: items.map((_, i) => leaves[i + 1]![2]) };
}

/** The root's proof with the file's member block, as the index keeps it under the file's hash; digestB64 is the file's. */
export async function bindFile(name: string, bytes: Uint8Array, type: string): Promise<{ proof: Proof; digestB64: string }> {
  const { proofs, digests } = await bindFiles([{ name, bytes, type }]);
  return { proof: proofs[0]!, digestB64: digests[0]! };
}
