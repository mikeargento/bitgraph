// Copyright (c) Argento Computing Inc. All rights reserved. See LICENSE.

/**
 * BitGraph A of a photo, made the way every drop is made (a tree whose first leaf is the latest Base block), with the
 * photo's fingerprint record and Content Credentials beside it: the first half of its BitGraphed file
 * (components/bitgraphed-view), which goes straight on to the watermark and BitGraph B in the same run.
 */

import { cacheArtifactToIDB } from "@/lib/file-cache";
import { baseBlockFileText, memberBlocks, memberOf, parseDigestRootText, withMember } from "@/lib/tree-member";
import { bindOne, digestOf, hashLeaves, latestBaseBlock, postTreeMembers, sortedLeaves, treeFromLeaves, type MerkleTree as PluginTree, type Proof } from "@/lib/plugins";
import { C2PA_SUFFIX, MAX_MANIFEST_BYTES, manifestStoreOf } from "./c2pa-leaf.ts";
import { MAX_FINGERPRINTED, RECORD_SUFFIX, decodeOnce, isPhotographic, looksLikePhoto, recordBytes, recordFile } from "./record.ts";

const toUrlSafe = (b64: string) => b64.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

/** The fingerprint record of each photo in a drop (lib/trustmark/record.ts), for the photos this browser can open, up to
 *  MAX_FINGERPRINTED; a record already in the drop (a folder dropped again with its records) is not made twice. */
export async function fingerprintRecords(files: File[], leaves: Array<[string, string, string]>, onProgress?: (n: number, of: number) => void): Promise<Array<[string, string, string]>> {
  const names = new Set(files.map((f) => f.webkitRelativePath || f.name));
  const photos = files.map((f, i) => ({ f, digest: leaves[i]![2], name: f.webkitRelativePath || f.name }))
    .filter((p) => looksLikePhoto(p.f) && !p.name.endsWith(RECORD_SUFFIX) && !names.has(`${p.name}${RECORD_SUFFIX}`));
  if (photos.length === 0 || photos.length > MAX_FINGERPRINTED) return [];
  const made: Array<{ file: File; name: string }> = [];
  let n = 0;
  for (const p of photos) {
    const img = await decodeOnce(p.f);
    // graphics are recorded as they are: the pointer shows on them (isPhotographic)
    if (img && isPhotographic(img)) {
      made.push({ file: recordFile(p.name, recordBytes(p.digest, img)), name: `${p.name}${RECORD_SUFFIX}` });
      // its Content Credentials, when it carries them, beside it (lib/trustmark/c2pa-leaf.ts)
      const store = manifestStoreOf(new Uint8Array(await p.f.arrayBuffer()));
      if (store && store.length <= MAX_MANIFEST_BYTES) made.push({ file: new File([store as BlobPart], `${p.name}${C2PA_SUFFIX}`, { type: "application/c2pa" }), name: `${p.name}${C2PA_SUFFIX}` });
    }
    n++;
    if (onProgress && (n % 10 === 0 || n === photos.length)) onProgress(n, photos.length);
  }
  // the leaf's name is the photo's path in the drop plus the suffix (a File's own name cannot hold the path)
  return (await hashLeaves(made.map((m) => m.file))).map((l, i) => [made[i]!.name, l[1], l[2]]);
}

/**
 * The floor tree these files were already recorded in (2026-10-20), found through the first file's own index entry: the
 * entry carries base-block.json, so the tree is rebuilt around it and accepted only when its root is the one the proof
 * binds. Null when the files are not such a tree (or not all of it).
 */
export async function recordedTreeOf(fileLeaves: Array<[string, string, string]>): Promise<{ proof: Proof; tree: PluginTree; rootText: string; floorFile: string } | null> {
  const first = fileLeaves[0];
  if (!first) return null;
  const res = await fetch(`/api/proofs/${toUrlSafe(first[2])}`).catch(() => null);
  if (!res?.ok) return null;
  const body = (await res.json().catch(() => null)) as { proofs?: Array<{ proof: Proof; kind?: string }> } | null;
  for (const x of body?.proofs ?? []) {
    const m = memberOf(x.proof);
    if (x.kind !== "recorded" || !m?.floor || m.files !== fileLeaves.length + 1) continue;
    const [floorLeaf] = await hashLeaves([new File([m.floor.file], "base-block.json")]);
    const t = await treeFromLeaves([floorLeaf!, ...fileLeaves]);
    if (t.tree.root === parseDigestRootText(m.rootText)?.root) return { proof: x.proof, tree: t.tree, rootText: t.rootText, floorFile: m.floor.file };
  }
  return null;
}


/**
 * BitGraph A of one photo: its member proof, from a tree already on the ledger when this photo (with its fingerprint)
 * was recorded before, else a new one. The photo is left in this browser's file cache for its proof page.
 */
export async function makePhotoBitGraph(photo: File, onStep?: (s: string) => void): Promise<{ proof: Proof; already: boolean }> {
  onStep?.("Hashing the photo…");
  const dropped = await hashLeaves([photo]);
  const records = await fingerprintRecords([photo], dropped);
  const fileLeaves = sortedLeaves([...dropped, ...records]);
  const digest = dropped[0]![2];
  void cacheArtifactToIDB(photo, digest).catch(() => {});
  const found = (await recordedTreeOf(fileLeaves)) ?? (records.length ? await recordedTreeOf(sortedLeaves(dropped)) : null);
  if (found) return { proof: found.proof, already: true };
  onStep?.("Making BitGraph A…");
  const floorFile = baseBlockFileText(await latestBaseBlock());
  const [floorLeaf] = await hashLeaves([new File([floorFile], "base-block.json", { type: "application/json" })]);
  const t = await treeFromLeaves([floorLeaf!, ...fileLeaves]);
  const rootDigest = await digestOf(new TextEncoder().encode(t.rootText));
  const b = await bindOne(rootDigest, { ceiling: true, floorLeaf: true });
  const blocks = memberBlocks(t.tree, t.rootText, floorFile);
  // indexed before B is made, so the watermark can find this photo's fingerprint in A's tree
  await postTreeMembers({ rootDigestB64: rootDigest, epochId: String(b.commit!.epochId), counter: String(b.commit!.counter), rootText: t.rootText, ...(blocks[0]?.floor ? { floor: blocks[0].floor } : {}) },
    t.tree.leaves.map((l, i) => ({ digestB64: l[2], index: i, path: blocks[i]!.path }))).catch(() => 0);
  const i = t.tree.leaves.findIndex((l) => l[2] === digest);
  return { proof: withMember(b as Record<string, unknown>, blocks[i]!) as Proof, already: false };
}
