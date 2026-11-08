// Copyright (c) Argento Computing Inc. All rights reserved. See LICENSE.

/**
 * Files as BitGraphs, the way Make binds them: one file is bound alone, its own SHA-256 the proof's content hash
 * (2026-10-31); several are one tree, its root bound and each leaf indexed under its own hash (app/api/tree-members).
 * Either way a file is looked up by its own SHA-256, and its time is its proof's attested time.
 *
 * Explicit .ts specifiers so node's test runner loads it.
 */
import { bindOne, digestOf, hashLeaves, postTreeMembers, treeFromLeaves, type Proof } from "./plugins.ts";
import { memberBlocks, withMember } from "./tree-member.ts";

/** Several files as one BitGraph, the way Make binds a drop: the tree of the files, one bind, every leaf indexed. Each
 *  file's proof carries its own member block; digests are the files' own, in order. */
export async function bindFiles(items: Array<{ name: string; bytes: Uint8Array; type: string }>): Promise<{ proofs: Proof[]; digests: string[] }> {
  if (items.length === 0) return { proofs: [], digests: [] };
  const leaves = await hashLeaves(items.map((it) => new File([it.bytes.slice()], it.name, { type: it.type })));
  const { tree, rootText } = await treeFromLeaves(leaves);
  const rootDigest = await digestOf(new TextEncoder().encode(rootText));
  const p = await bindOne(rootDigest);
  const blocks = memberBlocks(tree, rootText);
  await postTreeMembers({ rootDigestB64: rootDigest, epochId: String(p.commit!.epochId), counter: String(p.commit!.counter), rootText },
    tree.leaves.map((l, i) => ({ digestB64: l[2], index: i, path: blocks[i]!.path })));
  // The tree's leaves are in its own order; each file finds its block by its own hash.
  const at = (d: string) => tree.leaves.findIndex((l) => l[2] === d);
  return { proofs: leaves.map((l) => withMember(p, blocks[at(l[2])]!) as Proof), digests: leaves.map((l) => l[2]) };
}

/** One file as one BitGraph of its own SHA-256 (2026-10-31): no tree of one. digestB64 is the file's, and the proof's. */
export async function bindFile(_name: string, bytes: Uint8Array, _type: string): Promise<{ proof: Proof; digestB64: string }> {
  const digestB64 = await digestOf(bytes);
  return { proof: await bindOne(digestB64), digestB64 };
}
