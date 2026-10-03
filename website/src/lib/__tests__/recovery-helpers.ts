// Shared pieces for the recovery suites (recovery, recovery-store,
// recovery-queue): the spec's export vector as a minted tree, a second tree
// built here with the verify package's own producers, a server in memory,
// and a fetch that routes to it. Nothing here touches the network or S3.
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import {
  TREE_METADATA_KEY,
  base64ToBytes,
  bytesEqual,
  bytesToBase64,
  bytesToHex,
  buildTree,
  buildTreeRootDocument,
  encodeTreeLeaves,
  hexToBytes,
  leafFor,
  treeAttribution,
  type BitGraphProof,
  type TreeLeaf,
} from "@mikeargento/bitgraph-verify";
import { handleRecoveryList, handleRecoveryPost, type MemoryRecoveryStore } from "../recovery-store.ts";
import { parsePostResults, type RecoveryTransport } from "../recovery-queue.ts";
import type { FetchLike } from "../recovery.ts";

export const utf8 = (s: string): Uint8Array => new TextEncoder().encode(s);
export const sha256 = (b: Uint8Array): Uint8Array => new Uint8Array(createHash("sha256").update(b).digest());

export interface TestTree {
  proof: BitGraphProof;
  rootDocument: Uint8Array;
  leavesBytes: Uint8Array;
  names: string[];
  count: number;
}

/**
 * The spec's export/1 vector (spec/vectors/export-1.json): a tree/1 proof of
 * five files signed with the published TEST key, the owner's list and names,
 * and hello.txt's bytes. Read fresh on every call: the vector is regenerated
 * whenever SPEC.md changes, so nothing here pins its hashes.
 */
export function vectorTree(): TestTree & { memberFile: Uint8Array; specHash: string } {
  const v = JSON.parse(readFileSync(new URL("../../../../spec/vectors/export-1.json", import.meta.url), "utf8"));
  const owner = v.ownerExport;
  const rootDocument = hexToBytes(owner.tree.rootDocument)!;
  const leavesBytes = base64ToBytes(owner.tree.leaves)!;
  return {
    proof: owner.proof as BitGraphProof,
    rootDocument,
    leavesBytes,
    names: owner.tree.names as string[],
    count: leavesBytes.length / 65,
    memberFile: hexToBytes(v.memberFileHex)!,
    specHash: owner.proof.attribution.message as string,
  };
}

export const EPOCH = bytesToBase64(new Uint8Array(32).fill(0x5a));

/**
 * A tree/1 proof built here: real leaves (verify's leafFor), a real root
 * document, an unsigned proof with the tree/1 marker and a position. Enough
 * for everything recovery checks before a write (it never checks a
 * signature: a forged proof's entries land under its own proof hash, where
 * they cannot touch anyone else's), not enough to pass verifyTreeMember.
 */
export function syntheticTree(files: Array<{ name: string; original: Uint8Array; code: number }>, counter: string): TestTree & { sorted: TreeLeaf[]; commitment: Uint8Array } {
  const commitment = sha256(utf8(`a test commitment for position ${counter}`));
  const made = files.map((f) => ({ ...f, ...leafFor(f.code, f.original, commitment) }));
  const built = buildTree(made.map((m) => m.leaf));
  const rootDocument = buildTreeRootDocument(commitment, built.sorted.length, built.root);
  const proof = {
    version: "bitgraph/1",
    artifact: { hashAlg: "sha256", digestB64: bytesToBase64(sha256(rootDocument)) },
    commit: { nonceB64: bytesToBase64(sha256(utf8(`nonce ${counter}`))), counter, epochId: EPOCH, slotCounter: String(Number(counter) - 1) },
    signer: { publicKeyB64: bytesToBase64(new Uint8Array(32).fill(7)), signatureB64: bytesToBase64(new Uint8Array(64).fill(9)) },
    environment: { enforcement: "stub", measurement: "test-measurement" },
    attribution: treeAttribution(sha256(utf8("a test spec"))),
    metadata: { [TREE_METADATA_KEY]: bytesToHex(rootDocument) },
  } as unknown as BitGraphProof;
  const names = built.sorted.map((l) => made.find((m) => bytesEqual(m.leaf.artifact, l.artifact))!.name);
  return { proof, rootDocument, leavesBytes: encodeTreeLeaves(built.sorted), names, count: built.sorted.length, sorted: built.sorted, commitment };
}

const quiet = { sleep: async () => {}, log: () => {} };

/** The client's transport, wired straight to the route's handler over a store in memory. */
export function serverTransport(store: MemoryRecoveryStore, seen?: { requests: number; entries: number }): RecoveryTransport {
  return {
    async post(entries) {
      if (seen) {
        seen.requests++;
        seen.entries += entries.length;
      }
      const r = await handleRecoveryPost(JSON.stringify({ entries }), store, quiet);
      if (r.status !== 200) throw new Error(`HTTP ${r.status}: ${JSON.stringify(r.body)}`);
      return parsePostResults(r.body, entries);
    },
  };
}

/**
 * fetch for the lookups: GET /api/recovery/<address> through the route's
 * handler (with `limit` forced when given, to exercise paging), and
 * GET /api/proofs/<digest> answering from `proofs`.
 */
export function fakeFetch(store: MemoryRecoveryStore, opts: { limit?: number; proofs?: BitGraphProof[]; status?: number; calls?: string[] } = {}): FetchLike {
  return async (input: string) => {
    opts.calls?.push(input);
    if (opts.status !== undefined) return new Response(JSON.stringify({ error: "down" }), { status: opts.status });
    const url = new URL(input, "https://bitgraph.test");
    const rec = /^\/api\/recovery\/([^/]+)$/.exec(url.pathname);
    if (rec) {
      const q = new URLSearchParams(url.search);
      if (opts.limit !== undefined) q.set("limit", String(opts.limit));
      const r = await handleRecoveryList(rec[1]!, q, store);
      return new Response(JSON.stringify(r.body), { status: r.status, headers: { "content-type": "application/json" } });
    }
    const pr = /^\/api\/proofs\/([^/]+)$/.exec(url.pathname);
    if (pr) {
      const want = pr[1]!;
      const proofs = (opts.proofs ?? []).filter((p) => p.artifact.digestB64.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "") === want);
      return new Response(JSON.stringify({ proofs: proofs.map((proof) => ({ proof, writeTime: null, kind: "recorded" })) }), { status: 200 });
    }
    return new Response("not found", { status: 404 });
  };
}
