// Copyright (c) 2024-2026 Argento Computing Inc. Licensed under the MIT License. See LICENSE.

/**
 * Streaming verification (packages/verify/src/stream.ts): a file checked
 * against its leaf as a stream of chunks gives exactly the judgment the
 * in-memory path gives, over every placement, every chunking, both forms of
 * a file (its original, its committed bytes), the strangers and the lying
 * containers of the spec's negative vector, and a leaf that names the wrong
 * origin. Then a quarter-gigabyte stream that is never materialised shows
 * the memory stays flat.
 */

import { describe, test } from "node:test";
import * as assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { sha256 } from "@noble/hashes/sha256";
import {
  blobSource,
  buildTree,
  buildTreeMemberEvidence,
  buildTreeRootDocument,
  bytesSource,
  bytesToBase64,
  bytesToHex,
  currentTreeSpecHash,
  getPlacement,
  producerCommitment,
  streamLeafCheck,
  TREE_METADATA_KEY,
  treeAttribution,
  verifyExport,
  verifyTreeMember,
  type BitGraphProof,
  type ByteSource,
  type TreeVerifyResult,
} from "@mikeargento/bitgraph-verify";
import { makeBoundary, mintFromBody } from "./tree-fixtures.js";

const here = (rel: string) => fileURLToPath(new URL(rel, import.meta.url));
const TREE = JSON.parse(readFileSync(here("../../spec/vectors/tree-1.json"), "utf8")) as {
  files: Array<{ name: string; placementCode: number; originalHex: string; committedHex: string; evidence: unknown }>;
  tree: { rootDocumentHex: string };
};
const VEC = JSON.parse(readFileSync(here("../../spec/vectors/export-1.json"), "utf8")) as {
  memberExport: { proof: BitGraphProof; tree: { member: unknown } } & Record<string, unknown>;
  ownerExport: Record<string, unknown>;
  memberFileHex: string;
};
const NEG = JSON.parse(readFileSync(here("../../spec/vectors/tree-1-negative.json"), "utf8")) as {
  proof: BitGraphProof;
  rootDocumentHex: string;
  cases: Array<{ placement: string; file: string; bytesHex: string; evidence: unknown; expect: string }>;
};
const hex = (h: string) => Uint8Array.from(Buffer.from(h, "hex"));
const proof = VEC.memberExport.proof;
const rootDocument = hex(TREE.tree.rootDocumentHex);

/** A source that yields `bytes` in pieces of `n`, through a fresh iterator each time. */
function chunked(bytes: Uint8Array, n: number): ByteSource {
  return {
    size: bytes.length,
    async *stream() {
      for (let i = 0; i < bytes.length; i += n) yield bytes.subarray(i, Math.min(bytes.length, i + n));
    },
  };
}
const same = (a: TreeVerifyResult, b: TreeVerifyResult, label: string) => {
  assert.equal(a.category, b.category, `${label}: category`);
  assert.equal(a.floorCovers, b.floorCovers, `${label}: floorCovers`);
  assert.deepEqual(a.member, b.member, `${label}: member`);
};
const CHUNKS = [1, 7, 512, 513, 100_000];

describe("streaming verification equals the in-memory path", () => {
  test("every file of the vector tree, as original and as committed bytes, at every chunking", async () => {
    for (const f of TREE.files) {
      for (const which of ["originalHex", "committedHex"] as const) {
        const bytes = hex(f[which]);
        const inMemory = await verifyTreeMember({ proof, member: f.evidence, rootDocument, bytes });
        assert.ok(inMemory.category.startsWith("TREE_MEMBER"), `${f.name} ${which}: ${inMemory.category}`);
        for (const n of CHUNKS) {
          const streamed = await verifyTreeMember({ proof, member: f.evidence, rootDocument, source: chunked(bytes, n) });
          same(streamed, inMemory, `${f.name} ${which} in chunks of ${n}`);
        }
        same(await verifyTreeMember({ proof, member: f.evidence, rootDocument, source: bytesSource(bytes) }), inMemory, `${f.name} ${which} bytesSource`);
        same(await verifyTreeMember({ proof, member: f.evidence, rootDocument, source: blobSource(new Blob([bytes])) }), inMemory, `${f.name} ${which} blobSource`);
      }
    }
  });

  test("a stranger, another member's committed bytes, and no evidence at all", async () => {
    const a = TREE.files.find((f) => f.placementCode === 0x01)!;
    const b = TREE.files.find((f) => f.placementCode === 0x03)!;
    const stranger = new TextEncoder().encode("not in this tree\n");
    for (const n of CHUNKS) {
      const s1 = await verifyTreeMember({ proof, member: a.evidence, rootDocument, source: chunked(stranger, n) });
      same(s1, await verifyTreeMember({ proof, member: a.evidence, rootDocument, bytes: stranger }), `stranger ${n}`);
      assert.equal(s1.category, "NO_MATCH");
      // b's committed bytes carry this position's commitment but are not a's leaf.
      const s2 = await verifyTreeMember({ proof, member: a.evidence, rootDocument, source: chunked(hex(b.committedHex), n) });
      same(s2, await verifyTreeMember({ proof, member: a.evidence, rootDocument, bytes: hex(b.committedHex) }), `other member ${n}`);
      assert.equal(s2.category, "TREE_MEMBERSHIP_UNPROVEN");
      // No evidence: the bytes decide between unproven membership and no match.
      const s3 = await verifyTreeMember({ proof, rootDocument, source: chunked(hex(b.committedHex), n) });
      assert.equal(s3.category, "TREE_MEMBERSHIP_UNPROVEN");
      const s4 = await verifyTreeMember({ proof, rootDocument, source: chunked(stranger, n) });
      assert.equal(s4.category, "NO_MATCH");
    }
  });

  test("the negative vector: lying containers fail the same way streamed", async () => {
    const rd = hex(NEG.rootDocumentHex);
    for (const c of NEG.cases) {
      for (const n of [1, 1000]) {
        const r = await verifyTreeMember({ proof: NEG.proof, member: c.evidence, rootDocument: rd, source: chunked(hex(c.bytesHex), n) });
        assert.equal(r.category, c.expect, `${c.placement}, ${c.file}, chunks of ${n}`);
      }
    }
  });

  test("a leaf that names another origin over an honest container: INVALID_ORIGIN, streamed or not", async () => {
    for (const [id, code] of [["container/1", 0x02], ["container/2", 0x03]] as const) {
      const b = await makeBoundary("800");
      const { commitment } = producerCommitment(b.slot, b.anchor);
      const inside = new TextEncoder().encode("the honest archive's own original\n");
      const archive = getPlacement(id)!.build({ original: inside, commitment });
      const leaf = { placement: code, artifact: sha256(archive), origin: sha256(new TextEncoder().encode("a different origin the leaf names\n")) };
      const built = buildTree([leaf]);
      const rd = buildTreeRootDocument(commitment, 1, built.root);
      const p = await mintFromBody(b, {
        digests: [{ digestB64: bytesToBase64(sha256(rd)), hashAlg: "sha256" }],
        slotId: b.slot.nonceB64,
        slot: b.slot,
        chainId: "bitgraph:main",
        attribution: treeAttribution(currentTreeSpecHash()),
        metadata: { [TREE_METADATA_KEY]: bytesToHex(rd) },
        anchor: b.anchor,
      });
      const member = buildTreeMemberEvidence(built.sorted[0]!, 0, 1, built.tree.path(0));
      const inMemory = await verifyTreeMember({ proof: p, member, rootDocument: rd, bytes: archive });
      assert.equal(inMemory.category, "INVALID_ORIGIN", id);
      for (const n of [1, 300, 4096]) same(await verifyTreeMember({ proof: p, member, rootDocument: rd, source: chunked(archive, n) }), inMemory, `${id} chunks of ${n}`);
    }
  });

  test("verifyExport with a source: the member's export and the owner's, claim for claim", async () => {
    const results = (r: Awaited<ReturnType<typeof verifyExport>>) => r.claims.map((c) => `${c.id}=${c.result}|${c.detail}`);
    for (const f of TREE.files) {
      for (const which of ["originalHex", "committedHex"] as const) {
        const bytes = hex(f[which]);
        const owner = await verifyExport(VEC.ownerExport, { bytes });
        const ownerStreamed = await verifyExport(VEC.ownerExport, { source: chunked(bytes, 512) });
        assert.deepEqual(results(ownerStreamed), results(owner), `owner, ${f.name} ${which}`);
        assert.deepEqual(ownerStreamed.member, owner.member);
      }
    }
    const file = hex(VEC.memberFileHex);
    const member = await verifyExport(VEC.memberExport, { bytes: file });
    const memberStreamed = await verifyExport(VEC.memberExport, { source: chunked(file, 3) });
    assert.deepEqual(results(memberStreamed), results(member));
    assert.equal(memberStreamed.verdict, member.verdict);
  });

  test("streamLeafCheck refuses a source whose length disagrees with its size", async () => {
    const bytes = hex(TREE.files[0]!.originalHex);
    const commitment = new Uint8Array(32).fill(1);
    const short: ByteSource = { size: bytes.length + 1, stream: chunked(bytes, 4).stream };
    await assert.rejects(streamLeafCheck(short, { placement: null, commitment, origin: null }), /yielded \d+ bytes; its size says/);
    const long: ByteSource = { size: bytes.length - 1, stream: chunked(bytes, 4).stream };
    await assert.rejects(streamLeafCheck(long, { placement: null, commitment, origin: null }), /more bytes than its size/);
  });
});

describe("streaming verification at size", () => {
  /** A deterministic quarter-gigabyte that is never held whole: 1 MiB pieces of a fixed pattern. */
  const PIECE = 1 << 20;
  const TOTAL = 256 * PIECE;
  const piece = new Uint8Array(PIECE);
  for (let i = 0; i < PIECE; i++) piece[i] = (i * 31 + 7) & 0xff;
  const big: ByteSource = {
    size: TOTAL,
    async *stream() {
      for (let i = 0; i < TOTAL / PIECE; i++) yield piece;
    },
  };

  test("a 256 MiB original and its committed bytes verify from a stream in flat memory", async () => {
    const b = await makeBoundary("900");
    const { commitment } = producerCommitment(b.slot, b.anchor);
    // The leaf, computed here with a plain incremental hasher: SHA-256(original) and SHA-256(original || trailer).
    const trailer = getPlacement("trailer/1")!.frame!({ originalSize: TOTAL, originDigest: new Uint8Array(32), commitment }).suffix;
    const o = sha256.create();
    const c = sha256.create();
    for await (const chunk of big.stream()) { o.update(chunk); c.update(chunk); }
    c.update(trailer);
    const leaf = { placement: 0x01, artifact: c.digest(), origin: o.digest() };
    const built = buildTree([leaf]);
    const rd = buildTreeRootDocument(commitment, 1, built.root);
    const p = await mintFromBody(b, {
      digests: [{ digestB64: bytesToBase64(sha256(rd)), hashAlg: "sha256" }],
      slotId: b.slot.nonceB64,
      slot: b.slot,
      chainId: "bitgraph:main",
      attribution: treeAttribution(currentTreeSpecHash()),
      metadata: { [TREE_METADATA_KEY]: bytesToHex(rd) },
      anchor: b.anchor,
    });
    const member = buildTreeMemberEvidence(built.sorted[0]!, 0, 1, built.tree.path(0));

    const before = process.memoryUsage().heapUsed;
    const fromOrigin = await verifyTreeMember({ proof: p, member, rootDocument: rd, source: big });
    assert.equal(fromOrigin.category, "TREE_MEMBER_FROM_ORIGIN", fromOrigin.reason);
    assert.equal(fromOrigin.floorCovers, "content");
    // The committed bytes: the same stream with the 48-byte trailer after it.
    const committed: ByteSource = {
      size: TOTAL + trailer.length,
      async *stream() {
        yield* big.stream();
        yield trailer;
      },
    };
    const direct = await verifyTreeMember({ proof: p, member, rootDocument: rd, source: committed });
    assert.equal(direct.category, "TREE_MEMBER_DIRECT", direct.reason);
    const grew = (process.memoryUsage().heapUsed - before) / (1 << 20);
    assert.ok(grew < 96, `heap grew ${grew.toFixed(0)} MiB while verifying 256 MiB twice; streaming must not hold the file`);
  });
});
