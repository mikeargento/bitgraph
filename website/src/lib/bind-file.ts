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

/** The root's proof with the file's member block, as the index keeps it under the file's hash; digestB64 is the file's. */
export async function bindFile(name: string, bytes: Uint8Array, type: string): Promise<{ proof: Proof; digestB64: string }> {
  const floorFile = baseBlockFileText(await latestBaseBlock());
  const leaves = await hashLeaves([new File([floorFile], "base-block.json", { type: "application/json" }), new File([bytes.slice()], name, { type })]);
  const { tree, rootText } = await treeFromLeaves(leaves);
  const rootDigest = await digestOf(new TextEncoder().encode(rootText));
  const p = await bindOne(rootDigest, { ceiling: true, floorLeaf: true });
  const blocks = memberBlocks(tree, rootText, floorFile);
  await postTreeMembers({ rootDigestB64: rootDigest, epochId: String(p.commit!.epochId), counter: String(p.commit!.counter), rootText, floor: blocks[0]!.floor! },
    tree.leaves.map((l, i) => ({ digestB64: l[2], index: i, path: blocks[i]!.path })));
  return { proof: withMember(p, blocks[1]!) as Proof, digestB64: leaves[1]![2] };
}
