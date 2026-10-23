// Copyright (c) 2024-2026 Argento Computing Inc. Licensed under the MIT License. See LICENSE.

/**
 * A stand-in for the tree pipeline: no slot, no boundary, an unsigned proof,
 * but a real tree over real leaves and a real root document whose hash is
 * the proof's digest, so the exports the server writes from it are
 * consistent and parse. Files named in `asIs` go in as is.
 */

import { createHash } from "node:crypto";
import { buildTree, buildTreeRootDocument, bytesToBase64, bytesToHex, currentTreeSpecHash, encodeTreeLeaves, leafCodeOf, treeAttribution, type TreeLeaf } from "@mikeargento/bitgraph-verify";
import type { ScannedFile, TreeSummary } from "@mikeargento/bitgraph-sdk";

const sha = (b: string | Uint8Array) => new Uint8Array(createHash("sha256").update(b).digest());

export function fakeTree(files: readonly ScannedFile[], opts: { counter: string; epochId: string; asIs?: ReadonlySet<string> }): TreeSummary {
  const asIs = (f: ScannedFile) => opts.asIs?.has(f.digestB64) === true;
  const leaves: TreeLeaf[] = files.map((f) => {
    const origin = Uint8Array.from(Buffer.from(f.digestB64, "base64"));
    return asIs(f) ? { placement: 0, artifact: origin, origin } : { placement: leafCodeOf(f.placement)!, artifact: sha("fused:" + f.digestB64), origin };
  });
  const built = buildTree(leaves);
  const rootDocument = buildTreeRootDocument(sha("commitment"), built.sorted.length, built.root);
  const digestB64 = bytesToBase64(sha(rootDocument));
  const leafIndex = (l: TreeLeaf) => built.sorted.findIndex((s) => Buffer.from(s.artifact).equals(Buffer.from(l.artifact)));
  return {
    proof: { version: "bitgraph/1", artifact: { hashAlg: "sha256", digestB64 }, commit: { counter: opts.counter, epochId: opts.epochId }, attribution: treeAttribution(currentTreeSpecHash()) },
    rootDocumentHex: bytesToHex(rootDocument),
    artifactDigestB64: digestB64,
    count: files.length,
    leavesB64: bytesToBase64(encodeTreeLeaves(built.sorted)),
    floor: { counter: "1", blockNumber: 25_000_000, blockHash: "0x" + "ab".repeat(32) },
    recovered: false,
    rootDocumentEchoed: true,
    members: files.map((f, index) => ({
      index,
      leafIndex: leafIndex(leaves[index]!),
      placement: asIs(f) ? "as-is" : f.placement,
      originDigestB64: f.digestB64,
      artifactDigestB64: bytesToBase64(leaves[index]!.artifact),
    })),
  };
}
