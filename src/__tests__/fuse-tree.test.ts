// Copyright (c) Argento Computing Inc. All rights reserved. See LICENSE.

/**
 * fuseTree() (tree/1) end to end against a fake boundary that hands out a
 * slot with its floor (enclave v9) and mints the proof from the body it
 * receives, so the returned proof verifies for real. Every proof is read by
 * verifyTreeMember and every export by verifyExport, from the original and
 * from the committed bytes; every refusal is checked for what it did NOT
 * send. completeExport runs against a fake site serving a synthetic floor
 * header, Base ceiling and Ethereum settlement, all of which verify.
 *
 * The proofs here are stub-signed, so verifyExport's attestation claim is
 * FALSE ("no aws-nitro attestation") and its verdict FALSE for that reason
 * alone; every test states every other claim.
 */

import { describe, test } from "node:test";
import * as assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { sha256 } from "@noble/hashes/sha256";
import {
  KNOWN_TREE_SPEC_HASHES,
  LEAF_AS_IS,
  MAX_TREE_LEAVES,
  TREE_METADATA_KEY,
  base64ToBytes,
  bytesEqual,
  bytesToBase64,
  bytesToHex,
  committedBytesFor,
  computeProofHash,
  computeSlotCommitment2,
  currentTreeSpecHash,
  decodeTreeLeaves,
  encodeTreeLeaves,
  fuseAttribution,
  getPlacement,
  parseTreeRootDocument,
  treeAttribution,
  treeLeafHash,
  verifyExport,
  verifyTreeLeaves,
  verifyTreeMember,
} from "@mikeargento/bitgraph-verify";
import type { BitGraphExport, ExportVerifyResult } from "@mikeargento/bitgraph-verify";
import { utf8 } from "./audit-fixtures.js";
import { fuseTree, fuseSet, FuseError, MAX_FUSE_BYTES, treePlacementFor, trailerBytesFor } from "../fuse.js";
import type { FuseTreeMember, FuseTreeProgress, FuseTreeResult } from "../fuse.js";
import { buildMemberExport, buildOwnerExport, completeExport, fetchFloorHeader, floorFromHeader, namesByLeaf } from "../export.js";
import { BASE_TEST_CHAIN, FLOOR_NUMBER, FLOOR_TIME, allocates, boundaryTransport, chainWorld, commits, floorBlock, makeBoundary, mintFromBody, siteFetcher } from "./tree-fixtures.js";
import type { Boundary, CommitBody } from "./tree-fixtures.js";

const FIX = fileURLToPath(new URL("../../src/__tests__/fuse-fixtures/", import.meta.url));
const fixture = (name: string) => new Uint8Array(readFileSync(FIX + name));
const text = fixture("original.txt");
const png = fixture("image.png");
const note = utf8("a plain note for the tree\n");
const fourth = utf8("a fourth member\n");
const stranger = utf8("never in any tree\n");
const SPEC_B64 = KNOWN_TREE_SPEC_HASHES[KNOWN_TREE_SPEC_HASHES.length - 1]!;
const urlSafe = (s: string) => s.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

/** The five-member tree: every placement, one as is. */
const FIVE = (): FuseTreeMember[] => [
  { original: text, placement: "trailer/1", name: "original.txt" },
  { original: png, placement: "container/1", name: "image.png" },
  { original: note, name: "note.txt" },
  { original: fourth, placement: "trailer/1", name: "fourth.txt" },
  { original: utf8("recorded exactly as it is\n"), placement: "as-is", name: "big.bin" },
];
const originalOf = (members: FuseTreeMember[], i: number) => (members[i] as { original: Uint8Array }).original;

async function honestTree(members: FuseTreeMember[], extra: Parameters<typeof fuseTree>[1] = {}): Promise<{ b: Boundary; r: FuseTreeResult; calls: ReturnType<typeof boundaryTransport>["calls"] }> {
  const b = await makeBoundary();
  const { calls, transport } = boundaryTransport(b);
  const r = await fuseTree(members, { ...extra, transport });
  return { b, r, calls };
}

const claim = (r: ExportVerifyResult, id: string) => r.claims.find((c) => c.id === id);

/**
 * Every offline claim TRUE, except the attestation (a stub proof carries
 * none) and the claims named NOT_CARRIED; the verdict FALSE for the
 * attestation alone.
 */
function assertSound(r: ExportVerifyResult, notCarried: readonly string[], label: string): void {
  for (const c of r.claims.filter((x) => x.level === "offline")) {
    if (c.id === "attestation.signature") {
      assert.equal(c.result, "FALSE", `${label}: ${c.id}`);
      assert.match(c.detail, /no aws-nitro attestation/);
    } else if (notCarried.includes(c.id)) {
      assert.equal(c.result, "NOT_CARRIED", `${label}: ${c.id} ${c.detail}`);
    } else {
      assert.equal(c.result, "TRUE", `${label}: ${c.id} ${c.detail}`);
    }
  }
  for (const id of notCarried) assert.ok(claim(r, id), `${label}: claim ${id} is stated`);
  assert.equal(r.verdict, "FALSE", `${label}: the stub attestation is the one FALSE`);
  assert.deepEqual(r.reasons.filter((x) => !x.startsWith("confirmed.")), ["attestation.signature: the proof carries no aws-nitro attestation"], label);
}

const PENDING = ["ceiling.base", "ceiling.ethereum"] as const;

// ---------------------------------------------------------------------------
// The beats
// ---------------------------------------------------------------------------

describe("fuseTree(): one position, one tree", () => {
  test("1. a single file is a tree of one: one allocate, one commit, the body exactly, and every way to hand it over verifies", async () => {
    const { b, r, calls } = await honestTree([{ original: text, name: "original.txt" }], { keepCommitted: true });
    assert.equal(allocates(calls).length, 1);
    assert.equal(commits(calls).length, 1);
    const body = commits(calls)[0]!.body as Record<string, unknown>;
    assert.deepEqual(Object.keys(body), ["digests", "slotId", "slot", "chainId", "attribution", "metadata", "anchor"]);
    assert.deepEqual(body.attribution, { name: "bitgraph-fuse/2", title: "tree/1", message: SPEC_B64 });
    assert.deepEqual(body.attribution, treeAttribution(currentTreeSpecHash()));
    assert.deepEqual(body.metadata, { [TREE_METADATA_KEY]: bytesToHex(r.rootDocument) });
    assert.deepEqual(body.anchor, b.anchor, "the floor the allocation returned is named back");
    assert.deepEqual(body.digests, [{ digestB64: bytesToBase64(sha256(r.rootDocument)), hashAlg: "sha256" }]);
    const { slot: _s, slotId: _id, ...rest } = body;
    assert.ok(!JSON.stringify(rest).includes(b.slot.nonceB64), "the raw nonce rides only in the slot record and the slotId");

    assert.equal(r.count, 1);
    assert.equal(r.artifactDigestB64, r.proof.artifact.digestB64);
    assert.deepEqual(r.commitment, computeSlotCommitment2(b.slot, b.anchor.blockHash));
    assert.deepEqual(r.floor, b.anchor);
    assert.equal(r.specHashB64, SPEC_B64);
    assert.equal(r.recovered, false);
    assert.equal(r.rootDocumentEchoed, true);
    assert.equal(r.verification.category, "TREE_ROOT_VALID", r.verification.reason);
    const doc = parseTreeRootDocument(r.rootDocument)!;
    assert.equal(doc.count, 1);
    assert.deepEqual(doc.commitment, r.commitment);
    assert.equal(r.rootHex, bytesToHex(treeLeafHash(r.leaves[0]!)), "a tree of one: the root is the leaf's hash");

    const m = r.members[0]!;
    assert.equal(m.placement, "container/2", "plain text goes into the container by default");
    assert.equal(m.code, 0x03);
    assert.equal(m.leafIndex, 0);
    assert.equal(m.name, "original.txt");
    assert.equal(m.originDigestB64, bytesToBase64(sha256(text)));
    assert.deepEqual(m.committedBytes, committedBytesFor(0x03, text, r.commitment));
    assert.equal(m.artifactDigestB64, bytesToBase64(sha256(m.committedBytes!)));
    const ev = r.memberEvidence(0);
    assert.deepEqual({ index: ev.index, count: ev.count, path: ev.path }, { index: 0, count: 1, path: [] });

    const fromOrigin = await verifyTreeMember({ proof: r.proof, member: ev, bytes: text });
    assert.equal(fromOrigin.category, "TREE_MEMBER_FROM_ORIGIN", fromOrigin.reason);
    assert.equal(fromOrigin.floorCovers, "committed-bytes");
    const direct = await verifyTreeMember({ proof: r.proof, member: ev, bytes: m.committedBytes! });
    assert.equal(direct.category, "TREE_MEMBER_DIRECT", direct.reason);
    assert.equal((await verifyTreeMember({ proof: r.proof, member: ev })).category, "TREE_PATH_VALID");
    assert.equal((await verifyTreeMember({ proof: r.proof })).category, "TREE_ROOT_VALID");
  });

  test("2. five files across every placement: each member verifies from its original and from its committed bytes", async () => {
    const members = FIVE();
    const { r } = await honestTree(members, { keepCommitted: true });
    assert.equal(r.count, 5);
    assert.deepEqual(r.members.map((m) => m.placement), ["trailer/1", "container/1", "container/2", "trailer/1", "as-is"]);
    assert.deepEqual(r.members.map((m) => m.code), [0x01, 0x02, 0x03, 0x01, 0x00]);
    assert.deepEqual(new Set(r.members.map((m) => m.leafIndex)), new Set([0, 1, 2, 3, 4]));
    for (let k = 1; k < r.leaves.length; k++) assert.ok(bytesToHex(r.leaves[k - 1]!.artifact) < bytesToHex(r.leaves[k]!.artifact), "tree order");
    assert.deepEqual(verifyTreeLeaves(r.rootDocument, encodeTreeLeaves(r.leaves)), { ok: true, count: 5 });
    for (const m of r.members) {
      const ev = r.memberEvidence(m.index);
      assert.equal(ev.index, m.leafIndex);
      const original = originalOf(members, m.index);
      assert.deepEqual(m.committedBytes, committedBytesFor(m.code, original, r.commitment), `${m.name}: rebuilt by the verifier's own rule`);
      const a = await verifyTreeMember({ proof: r.proof, member: ev, bytes: original });
      const d = await verifyTreeMember({ proof: r.proof, member: ev, bytes: m.committedBytes! });
      if (m.code === LEAF_AS_IS) {
        assert.equal(a.category, "TREE_MEMBER_AS_IS", `${m.name}: ${a.reason}`);
        assert.equal(a.floorCovers, "none");
        assert.equal(m.artifactDigestB64, m.originDigestB64, "as is: the file is its own committed bytes");
      } else {
        assert.equal(a.category, "TREE_MEMBER_FROM_ORIGIN", `${m.name}: ${a.reason}`);
        assert.equal(d.category, "TREE_MEMBER_DIRECT", `${m.name}: ${d.reason}`);
      }
      assert.equal(a.member?.count, 5);
      // Another member's evidence never covers this file.
      const other = r.members.find((x) => x.index !== m.index)!;
      assert.ok(!["TREE_MEMBER_DIRECT", "TREE_MEMBER_FROM_ORIGIN", "TREE_MEMBER_AS_IS"].includes((await verifyTreeMember({ proof: r.proof, member: r.memberEvidence(other.index), bytes: original })).category));
    }
  });

  test("3. above the cap a file goes in as is: 256 MiB by default, maxFuseBytes when given; nothing bounds it from below", async () => {
    const jpegHead = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 0x10]);
    assert.equal(MAX_FUSE_BYTES, 256 * 1024 * 1024);
    assert.equal(treePlacementFor(MAX_FUSE_BYTES + 1, jpegHead), "as-is");
    assert.equal(treePlacementFor(MAX_FUSE_BYTES, jpegHead), "trailer/1");
    assert.equal(treePlacementFor(MAX_FUSE_BYTES, note), "container/2");
    assert.equal(treePlacementFor(41, note, 40), "as-is");

    const over = utf8("forty-one bytes of text, over the test cap\n");
    const under = utf8("ten bytes\n");
    const { r } = await honestTree([{ original: over, name: "over.txt" }, { original: under, name: "under.txt" }], { maxFuseBytes: 16 });
    assert.deepEqual(r.members.map((m) => m.placement), ["as-is", "container/2"]);
    const asIs = r.members[0]!;
    assert.equal(asIs.artifactDigestB64, bytesToBase64(sha256(over)));
    assert.deepEqual(r.leaves[asIs.leafIndex], { placement: 0, artifact: sha256(over), origin: sha256(over) });
    const v = await verifyTreeMember({ proof: r.proof, member: r.memberEvidence(0), bytes: over });
    assert.equal(v.category, "TREE_MEMBER_AS_IS", v.reason);
    assert.equal(v.floorCovers, "none");
    const e = await verifyExport(buildMemberExport(r, asIs.leafIndex), { bytes: over });
    assertSound(e, ["floor.header", ...PENDING], "as-is export");
    assert.match(claim(e, "bytes.floor")!.detail, /recorded as is: the file existed by the commit; nothing bounds it from below/);
  });

  test("4. a file over the real 256 MiB cap goes in as is by default, and its own bytes verify it", async () => {
    // One buffer of MAX_FUSE_BYTES + 1 bytes, released when the test ends. A JPEG head: below the cap it would take trailer/1.
    const big = new Uint8Array(MAX_FUSE_BYTES + 1);
    big.set([0xff, 0xd8, 0xff, 0xe0]);
    const { r } = await honestTree([{ original: big, name: "huge.jpg" }]);
    const m = r.members[0]!;
    assert.equal(m.placement, "as-is");
    assert.equal(m.code, LEAF_AS_IS);
    assert.equal(m.artifactDigestB64, m.originDigestB64);
    assert.ok(!("committedBytes" in m), "nothing kept, nothing built");
    const v = await verifyTreeMember({ proof: r.proof, member: r.memberEvidence(0), bytes: big });
    assert.equal(v.category, "TREE_MEMBER_AS_IS", v.reason);
  });

  test("5. the same original under two placements is two leaves; under one placement twice it is refused before any request", async () => {
    const members: FuseTreeMember[] = [{ original: text, placement: "trailer/1" }, { original: text, placement: "container/2" }, { original: text, placement: "as-is" }];
    const { r } = await honestTree(members, { keepCommitted: true });
    assert.equal(r.count, 3);
    assert.equal(new Set(r.members.map((m) => m.originDigestB64)).size, 1, "one origin");
    assert.equal(new Set(r.members.map((m) => m.artifactDigestB64)).size, 3, "three leaves");
    const want = ["TREE_MEMBER_FROM_ORIGIN", "TREE_MEMBER_FROM_ORIGIN", "TREE_MEMBER_AS_IS"];
    for (const m of r.members) {
      const v = await verifyTreeMember({ proof: r.proof, member: r.memberEvidence(m.index), bytes: text });
      assert.equal(v.category, want[m.index], `${m.placement}: ${v.reason}`);
      assert.equal((await verifyTreeMember({ proof: r.proof, member: r.memberEvidence(m.index), bytes: m.committedBytes! })).category, m.code === LEAF_AS_IS ? "TREE_MEMBER_AS_IS" : "TREE_MEMBER_DIRECT");
    }
    // The owner's export finds the file by its origin and proves it.
    assertSound(await verifyExport(buildOwnerExport(r), { bytes: text }), ["floor.header", ...PENDING], "owner, twice");

    const b = await makeBoundary();
    const { calls, transport } = boundaryTransport(b);
    await assert.rejects(
      fuseTree([{ original: text, placement: "trailer/1" }, { original: png }, { original: text, placement: "trailer/1" }], { transport }),
      (e: FuseError) => e.code === "bad-input" && /members 0 and 2 are the same original under the same placement \(trailer\/1\)/.test(e.message) && e.member === 2,
    );
    await assert.rejects(fuseTree([{ originDigest: sha256(note), placement: "as-is" }, { original: note, placement: "as-is" }], { transport }), (e: FuseError) => e.code === "bad-input" && /members 0 and 1/.test(e.message));
    assert.equal(calls.length, 0, "no slot was burned");
  });

  test("6. an allocation without a floor fails clearly: floor-missing, one allocate, nothing committed", async () => {
    const b = await makeBoundary();
    const { calls, transport } = boundaryTransport(b, { noFloor: true });
    await assert.rejects(fuseTree(FIVE(), { transport }), (e: unknown) => {
      assert.ok(e instanceof FuseError, String(e));
      assert.equal(e.code, "floor-missing");
      assert.match(e.message, /no floor anchor/);
      assert.match(e.message, /enclave v9/);
      assert.match(e.message, /nothing was committed/);
      assert.ok(!e.message.includes(b.slot.nonceB64));
      return true;
    });
    assert.equal(allocates(calls).length, 1);
    assert.equal(commits(calls).length, 0);
    // A malformed anchor is no floor either.
    const bad = boundaryTransport(b, { allocate: () => ({ status: 200, json: { slotId: b.slot.nonceB64, slot: b.slot, anchor: { counter: "1", blockNumber: 1, blockHash: "0xABC" } } }) });
    await assert.rejects(fuseTree([{ original: text }], { transport: bad.transport }), (e: FuseError) => e.code === "floor-missing");
    assert.equal(commits(bad.calls).length, 0);
  });

  test("7. members of every shape in one tree: bytes, loaded, a saved hash state, and as is by digest; each agrees with the bytes path", async () => {
    const b = await makeBoundary();
    const commitment = computeSlotCommitment2(b.slot, b.anchor.blockHash);
    // The scanner's trick: hash prefix and original once, finish with the suffix for the held commitment.
    const saved = (original: Uint8Array, placement: "trailer/1" | "container/2") => {
      const p = getPlacement(placement)!;
      const h = sha256.create();
      h.update(p.scanPrefix!(original.length)!);
      h.update(original);
      return ({ commitment: c }: { commitment: Uint8Array }) => {
        const copy = h.clone();
        copy.update(p.frame!({ originalSize: original.length, originDigest: sha256(original), commitment: c }).suffix);
        return copy.digest();
      };
    };
    let loads = 0;
    const order: string[] = [];
    const { calls, transport } = boundaryTransport(b);
    const wrapped = { ...transport, fetch: (async (url: string, init?: RequestInit) => { order.push(new URL(url).pathname); return transport.fetch(url, init); }) as typeof fetch };
    const members: FuseTreeMember[] = [
      { original: png, name: "bytes.png" },
      { load: () => { loads++; order.push("load"); return note; }, originDigest: sha256(note), placement: "container/2", name: "loaded.txt" },
      { originDigest: sha256(text), placement: "trailer/1", fusedDigest: saved(text, "trailer/1"), name: "hashed-trailer.txt" },
      { originDigest: sha256(fourth), placement: "container/2", fusedDigest: saved(fourth, "container/2"), name: "hashed-container.txt" },
      { originDigest: sha256(stranger), placement: "as-is", name: "as-is.bin" },
    ];
    const r = await fuseTree(members, { transport: wrapped });
    assert.equal(loads, 1);
    assert.ok(order.indexOf("load") > order.indexOf("/api/fuse/allocate") && order.indexOf("load") < order.indexOf("/api/fuse/commit"), "loaded after the slot is held, before the commit");
    assert.equal(commits(calls).length, 1);
    const originals = [png, note, text, fourth, stranger];
    const codes = [0x01, 0x03, 0x01, 0x03, 0x00];
    for (const m of r.members) {
      assert.equal(m.code, codes[m.index]);
      const want = m.code === LEAF_AS_IS ? sha256(originals[m.index]!) : sha256(committedBytesFor(m.code, originals[m.index]!, commitment));
      assert.equal(m.artifactDigestB64, bytesToBase64(want), `${m.name}: the oracle's digest`);
      assert.ok(!("committedBytes" in m));
      const v = await verifyTreeMember({ proof: r.proof, member: r.memberEvidence(m.index), bytes: originals[m.index]! });
      assert.equal(v.category, m.code === LEAF_AS_IS ? "TREE_MEMBER_AS_IS" : "TREE_MEMBER_FROM_ORIGIN", `${m.name}: ${v.reason}`);
    }
    // keepCommitted returns what passed through the core: bytes and loaded members, never a hashed member or an as-is digest.
    const kept = await fuseTree(members, { transport: boundaryTransport(b).transport, keepCommitted: true });
    assert.deepEqual(kept.members.map((m) => "committedBytes" in m), [true, true, false, false, false]);
    // trailerBytesFor is still the trailer's own suffix under commitment/2.
    assert.deepEqual(committedBytesFor(0x01, text, commitment).subarray(text.length), trailerBytesFor(commitment));
  });

  test("8. verifyMembers reads every member's committed bytes with the real verifier", async () => {
    const seen: FuseTreeProgress[] = [];
    const { r } = await honestTree(FIVE(), { verifyMembers: true, onProgress: (p) => seen.push({ ...p }) });
    for (const m of r.members) {
      assert.equal(m.verification?.category, m.code === LEAF_AS_IS ? "TREE_MEMBER_AS_IS" : "TREE_MEMBER_DIRECT", `${m.name}: ${m.verification?.reason}`);
      assert.equal(m.verification?.member?.index, m.leafIndex);
      assert.ok(!("committedBytes" in m), "held for the verifier, not returned without keepCommitted");
    }
    assert.deepEqual(seen.filter((p) => p.phase === "verify").map((p) => `${p.done}/${p.total}`), ["1/5", "2/5", "3/5", "4/5", "5/5"]);
  });

  test("9. progress: hash per member before the slot, a leaf per member after it, the tree, one commit; a throwing hook changes nothing", async () => {
    const seen: FuseTreeProgress[] = [];
    await honestTree(FIVE().slice(0, 3), { onProgress: (p) => seen.push({ ...p }) });
    assert.deepEqual(seen.map((p) => `${p.phase} ${p.done}/${p.total}`), ["hash 1/3", "hash 2/3", "hash 3/3", "fuse 1/3", "fuse 2/3", "fuse 3/3", "tree 0/1", "tree 1/1", "commit 0/1", "commit 1/1"]);
    let calls = 0;
    const { r } = await honestTree(FIVE().slice(0, 3), { onProgress: () => { calls++; throw new Error("a hook that throws"); } });
    assert.equal(r.count, 3);
    assert.equal(calls, 10);
  });

  test("10. an agency envelope passes through untouched, and is absent otherwise", async () => {
    const b = await makeBoundary();
    const a = boundaryTransport(b);
    await fuseTree([{ original: text }], { transport: a.transport, agency: { x: 1 } });
    assert.deepEqual((commits(a.calls)[0]!.body as { agency?: unknown }).agency, { x: 1 });
    const c = boundaryTransport(b);
    await fuseTree([{ original: text }], { transport: c.transport });
    assert.ok(!("agency" in (commits(c.calls)[0]!.body as object)));
  });
});

// ---------------------------------------------------------------------------
// Refusals
// ---------------------------------------------------------------------------

describe("fuseTree(): refusals", () => {
  test("11. bad input is refused before any request, naming the member", async () => {
    const b = await makeBoundary();
    const { calls, transport } = boundaryTransport(b);
    const refuse = async (members: unknown, re: RegExp, code = "bad-input", opts: Record<string, unknown> = {}) =>
      assert.rejects(fuseTree(members as FuseTreeMember[], { transport, ...opts }), (e: unknown) => {
        assert.ok(e instanceof FuseError, `not a FuseError: ${String(e)}`);
        assert.equal(e.code, code, e.message);
        assert.match(e.message, re);
        return true;
      });
    await refuse([], /at least one member/);
    const same: FuseTreeMember = { original: text };
    await refuse(new Array<FuseTreeMember>(MAX_TREE_LEAVES + 1).fill(same), /at most 1000000 members \(got 1000001\)/);
    await refuse([{ original: text }, null], /^member 1: original must be a Uint8Array/);
    await refuse([{ original: "text" }], /^member 0: original must be a Uint8Array/);
    await refuse([{ original: text, placement: "produced/1" }], /^member 0: produced\/1 is not a tree placement/);
    await refuse([{ original: text, placement: "set/2" }], /^member 0: set\/2 is not a tree placement/);
    await refuse([{ original: text, placement: "xmp/9" }], /^member 0: placement "xmp\/9" is not registered/, "bad-placement");
    await refuse([{ original: text, placement: "as-is", builder: () => text }], /^member 0: an as-is member takes no builder/);
    await refuse([{ load: () => text, originDigest: sha256(text), placement: "as-is" }], /^member 0: an as-is member is given by its bytes or its originDigest alone/);
    await refuse([{ fusedDigest: () => sha256(text), originDigest: sha256(text), placement: "as-is" }], /^member 0: an as-is member is given by its bytes or its originDigest alone/);
    await refuse([{ placement: "as-is", originDigest: new Uint8Array(31) }], /^member 0: an as-is member names its originDigest, 32 bytes/);
    await refuse([{ load: () => text, originDigest: sha256(text) }], /^member 0: a loaded member names its placement/);
    await refuse([{ originDigest: sha256(text), placement: "trailer/1", fusedDigest: () => sha256(text) }], /^member 0: a hashed member cannot be verified in full/, "bad-input", { verifyMembers: true });
    await refuse([{ originDigest: sha256(text), placement: "as-is" }], /^member 0: an as-is member given by its digest cannot be verified in full/, "bad-input", { verifyMembers: true });
    await refuse([{ original: text }], /maxFuseBytes must be a non-negative number/, "bad-input", { maxFuseBytes: -1 });
    assert.equal(calls.length, 0, "no slot was burned by any refusal");
  });

  test("12. a bad member after the slot is held burns the slot and commits nothing", async () => {
    const b = await makeBoundary();
    const cases: Array<[FuseTreeMember[], string, RegExp]> = [
      [[{ original: text }, { original: png, placement: "trailer/1", builder: () => png }], "commitment-missing", /^member 1: the fused bytes do not carry the trailer\/1 commitment/],
      [[{ original: text, placement: "trailer/1", builder: ({ commitment }) => committedBytesFor(0x01, note, commitment) }], "builder-failed", /^member 0: the committed bytes embed an origin that is not the member's original/],
      [[{ original: text, builder: () => { throw new Error("disk full"); } }], "builder-failed", /^member 0: the builder threw: disk full/],
      [[{ load: () => note, originDigest: sha256(text), placement: "trailer/1" }], "bad-input", /^member 0: originDigest is not the SHA-256 of the loaded bytes/],
      [[{ load: () => { throw new Error("gone"); }, originDigest: sha256(text), placement: "trailer/1" }], "load-failed", /^member 0: load threw: gone/],
      [[{ originDigest: sha256(text), placement: "trailer/1", fusedDigest: () => new Uint8Array(31) }], "builder-failed", /^member 0: fusedDigest must return a 32-byte digest/],
    ];
    for (const [members, code, re] of cases) {
      const { calls, transport } = boundaryTransport(b);
      await assert.rejects(fuseTree(members, { transport }), (e: FuseError) => e.code === code && re.test(e.message) && /nothing was committed|slot will expire/.test(e.message), `${code} ${re}`);
      assert.equal(allocates(calls).length, 1);
      assert.equal(commits(calls).length, 0, `${code}: nothing committed`);
    }
  });
});

// ---------------------------------------------------------------------------
// The boundary
// ---------------------------------------------------------------------------

describe("fuseTree(): the boundary", () => {
  test("13. a lost commit response is read back by the root document's digest and matched on the held slot; never re-allocated", async () => {
    const b = await makeBoundary();
    const other = await makeBoundary("900");
    let sent: CommitBody | null = null;
    const first = boundaryTransport(b, { commit: (_c, body) => { sent = body; return { status: 200, json: { proof: null } }; } });
    await assert.rejects(fuseTree([{ original: text }], { transport: first.transport }), (e: FuseError) => e.code === "commit-refused");
    // Same slot, same commitment, same tree: the body the boundary would have minted from.
    const real = await mintFromBody(b, sent!);
    const decoy = await mintFromBody(b, sent!, { slot: other.slot });
    const { calls, transport } = boundaryTransport(b, {
      commit: () => { throw new Error("socket hang up"); },
      lookup: () => ({ status: 200, json: { proofs: [{ proof: decoy }, { proof: real }] } }),
    });
    const r = await fuseTree([{ original: text }], { transport });
    assert.equal(r.recovered, true);
    assert.deepEqual(r.proof, real);
    assert.equal(allocates(calls).length, 1);
    const lookup = calls.find((c) => c.path.startsWith("/api/proofs/"))!;
    assert.ok(lookup.path.includes(urlSafe(r.artifactDigestB64)), lookup.path);
  });

  test("14. a proof under another slot, another floor, another marker or another digest is never called a tree", async () => {
    const b = await makeBoundary();
    const other = await makeBoundary("900");
    const otherFloor = { ...b.anchor, blockHash: floorBlock(FLOOR_NUMBER, FLOOR_TIME + 12).hash };
    const cases: Array<[string, Parameters<typeof boundaryTransport>[1], RegExp]> = [
      ["slot", { mint: { slot: other.slot } }, /slot-mismatch|different slot/],
      ["floor", { mint: { slotAnchor: otherFloor } }, /INVALID_SLOT_COMMITMENT/],
      ["marker", { mint: { attribution: fuseAttribution("set/2", undefined, 2) } }, /NOT_TREE/],
      ["fuse/1", { mint: { attribution: { name: "bitgraph-fuse/1", title: "tree/1", message: SPEC_B64 } } }, /INVALID_TREE_MARKER/],
      ["spec", { mint: { attribution: { name: "bitgraph-fuse/2", title: "tree/1", message: bytesToBase64(sha256(utf8("another spec"))) } } }, /UNKNOWN_SPEC/],
    ];
    for (const [label, o, re] of cases) {
      const { transport } = boundaryTransport(b, o);
      await assert.rejects(fuseTree([{ original: text }], { transport }), (e: FuseError) => (e.code === "verification-failed" || e.code === "slot-mismatch") && re.test(`${e.code} ${e.message}`), label);
    }
    const digest = boundaryTransport(b, { commit: async (_c, body) => ({ status: 200, json: { proof: await mintFromBody(b, { ...body, digests: [{ digestB64: bytesToBase64(sha256(stranger)), hashAlg: "sha256" }] }) } }) });
    await assert.rejects(fuseTree([{ original: text }], { transport: digest.transport }), (e: FuseError) => e.code === "verification-failed" && /INVALID_TREE_ROOT/.test(e.message));
  });

  test("15. the echo: absent is normal (and every export still verifies), different is refused", async () => {
    const b = await makeBoundary();
    const quiet = boundaryTransport(b, { mint: { withMetadata: false } });
    const r = await fuseTree(FIVE(), { transport: quiet.transport });
    assert.equal(r.rootDocumentEchoed, false);
    assert.equal(r.proof.metadata, undefined);
    assert.equal(r.verification.category, "TREE_ROOT_VALID");
    assertSound(await verifyExport(buildMemberExport(r, r.members[0]!.leafIndex), { bytes: text }), ["floor.header", ...PENDING], "no echo");
    const wrong = { [TREE_METADATA_KEY]: bytesToHex(r.rootDocument).replace(/.$/, (c) => (c === "0" ? "1" : "0")) };
    const loud = boundaryTransport(b, { mint: { metadata: wrong } });
    await assert.rejects(fuseTree(FIVE(), { transport: loud.transport }), (e: FuseError) => e.code === "verification-failed" && /echoes a root document/.test(e.message));
    const junk = boundaryTransport(b, { mint: { metadata: { [TREE_METADATA_KEY]: "not hex" } } });
    await assert.rejects(fuseTree(FIVE(), { transport: junk.transport }), (e: FuseError) => e.code === "verification-failed");
  });

  test("16. fuse() and fuseSet() still make what they made: superseded, not removed", async () => {
    const b = await makeBoundary();
    const r = await fuseSet([{ original: text, placement: "trailer/1" }, { original: png, placement: "container/1" }], { transport: boundaryTransport(b).transport });
    assert.equal(r.set, "set/1");
    assert.equal(r.verification.category, "FUSED_DIRECT");
    assert.equal(r.proof.attribution?.name, "bitgraph-fuse/2", "a floor in hand makes a fuse/2 set");
  });
});

// ---------------------------------------------------------------------------
// export/1
// ---------------------------------------------------------------------------

describe("export/1 from fuseTree", () => {
  test("17. a member's export holds every claim (bar the stub attestation) from the original and from the committed bytes; a stranger's file is not the member", async () => {
    const members = FIVE();
    const { b, r } = await honestTree(members, { keepCommitted: true });
    const floor = floorFromHeader(r.proof, b.floor.headerHex)!;
    assert.deepEqual(floor, { blockNumber: FLOOR_NUMBER, blockHash: b.anchor.blockHash, header: b.floor.headerHex });
    for (const m of r.members) {
      const exp = buildMemberExport(r, m.leafIndex, { floor });
      assert.deepEqual(Object.keys(exp), ["format", "spec", "proof", "tree", "floor", "ceiling", "settlement"]);
      assert.equal(exp.spec, SPEC_B64);
      assert.deepEqual(exp.ceiling, { status: "pending" });
      assert.deepEqual(exp.settlement, { status: "pending" });
      assert.deepEqual(exp.tree.member, r.memberEvidence(m.index));
      assert.equal(exp.tree.leaves, undefined, "a member's export lists no other leaf");
      // Through JSON, as a file would travel.
      const travelled = JSON.parse(JSON.stringify(exp)) as BitGraphExport;
      for (const bytes of [originalOf(members, m.index), m.committedBytes!]) {
        const v = await verifyExport(travelled, { bytes });
        assertSound(v, PENDING, `${m.name}`);
        assert.equal(v.member?.index, m.leafIndex);
        assert.deepEqual(v.times.floor, { blockNumber: FLOOR_NUMBER, blockHash: b.anchor.blockHash, blockTimestamp: FLOOR_TIME });
        // The reading is written only for a verdict that is not FALSE; a stub proof's is the attestation's.
        assert.equal(v.reading, "Something in this export contradicts the proof; see the failed claims.");
      }
      const s = await verifyExport(travelled, { bytes: stranger });
      assert.equal(claim(s, "bytes.member")?.result, "FALSE");
      const none = await verifyExport(travelled);
      assert.equal(claim(none, "bytes.member")?.result, "NOT_CARRIED");
      assert.equal(claim(none, "tree.member")?.result, "TRUE");
    }
    // Without the floor header the floor claim is not carried; everything else holds.
    assertSound(await verifyExport(buildMemberExport(r, 0), { bytes: r.members.find((m) => m.leafIndex === 0)!.committedBytes! }), ["floor.header", ...PENDING], "no floor header");
  });

  test("18. the owner's export: every leaf and its name; each member is found by its own bytes; a reordered list is refused", async () => {
    const members = FIVE();
    const { r } = await honestTree(members);
    const names = namesByLeaf(r);
    assert.deepEqual([...names].sort(), ["big.bin", "fourth.txt", "image.png", "note.txt", "original.txt"]);
    const exp = buildOwnerExport(r, { names });
    assert.equal(exp.tree.member, undefined);
    const list = base64ToBytes(exp.tree.leaves!)!;
    assert.equal(list.length, 5 * 65);
    assert.deepEqual(decodeTreeLeaves(list), r.leaves);
    assert.deepEqual(exp.tree.names, names);
    for (const m of r.members) {
      const v = await verifyExport(exp, { bytes: originalOf(members, m.index) });
      assertSound(v, ["floor.header", ...PENDING], `owner ${m.name}`);
      assert.equal(claim(v, "tree.leaves")?.result, "TRUE");
      assert.equal(v.member?.index, m.leafIndex);
      assert.equal(exp.tree.names![m.leafIndex], m.name);
    }
    const s = await verifyExport(exp, { bytes: stranger });
    assert.equal(claim(s, "tree.member")?.result, "NOT_CARRIED");
    assert.match(claim(s, "tree.member")!.detail, /not in the owner's list/);
    const swapped = list.slice();
    swapped.set(list.subarray(0, 65), 65);
    swapped.set(list.subarray(65, 130), 0);
    const reordered = await verifyExport({ ...exp, tree: { ...exp.tree, leaves: bytesToBase64(swapped) } }, { bytes: text });
    assert.equal(claim(reordered, "tree.leaves")?.result, "FALSE");
  });

  test("19. the builders never write an export that contradicts itself", async () => {
    const { r } = await honestTree(FIVE());
    assert.throws(() => buildMemberExport(r, 5), RangeError);
    assert.throws(() => buildMemberExport(r, -1), RangeError);
    assert.throws(() => buildMemberExport({ ...r, rootDocument: r.rootDocument.slice(0, 83) }, 0), /not 84 bytes/);
    const other = r.rootDocument.slice();
    other[30]! ^= 1;
    assert.throws(() => buildMemberExport({ ...r, rootDocument: other }, 0), /does not hash to the proof's signed artifact digest/);
    assert.throws(() => buildOwnerExport({ ...r, leaves: r.leaves.slice(1) }), /states 5 leaves; 4 were given/);
    assert.throws(() => buildOwnerExport({ ...r, leaves: [r.leaves[1]!, r.leaves[0]!, ...r.leaves.slice(2)] }), /do not make the committed tree/);
    assert.throws(() => buildOwnerExport(r, { names: ["a"] }), /one string per leaf/);
    // Without a prebuilt tree the path is computed from the leaves.
    const { tree: _t, ...bare } = r;
    assert.deepEqual(buildMemberExport(bare, 2).tree.member, buildMemberExport(r, 2).tree.member);
  });
});

// ---------------------------------------------------------------------------
// completeExport
// ---------------------------------------------------------------------------

describe("completeExport()", () => {
  const witnessOf = (b: Boundary) => ({ status: 200, json: { version: "bitgraph-anchor-witness/1", headerRlpHex: b.floor.headerHex, blockNumber: FLOOR_NUMBER, blockHash: b.anchor.blockHash } });

  test("20. the floor, the ceiling and the settlement from the site's read routes, each verified; verifyExport then states all three times", async () => {
    const members = FIVE();
    const { b, r } = await honestTree(members);
    const world = chainWorld(r.proof);
    const site = siteFetcher({ witness: witnessOf(b), ceiling: { status: 200, json: world.sidecar }, settlement: { status: 200, json: world.settlement } });
    const m = r.members[2]!;
    const made = buildMemberExport(r, m.leafIndex);
    const done = await completeExport(made, site.fetch, { writerAddress: world.writer, baseChainId: BASE_TEST_CHAIN });
    assert.deepEqual(done.notes, []);
    assert.equal(done.changed, true);
    assert.deepEqual([done.floor, done.ceiling, done.settlement], ["present", "present", "present"]);
    assert.deepEqual(site.seen, [
      `/api/proofs/witness?block=${FLOOR_NUMBER}&hash=${encodeURIComponent(b.anchor.blockHash)}`,
      `/api/ceilings/${encodeURIComponent(urlSafe(computeProofHash(r.proof)))}`,
      `/api/ceilings/settlement/${world.baseBlock}`,
    ]);
    assert.deepEqual(made.ceiling, { status: "pending" }, "the input is not changed in place");
    const pins = { ceilingWriter: world.writer, baseChainId: BASE_TEST_CHAIN };
    const v = await verifyExport(JSON.parse(JSON.stringify(done.export)), { bytes: originalOf(members, m.index), pins });
    assertSound(v, [], "complete");
    assert.deepEqual(v.times.floor, { blockNumber: FLOOR_NUMBER, blockHash: b.anchor.blockHash, blockTimestamp: FLOOR_TIME });
    assert.deepEqual(v.times.ceilingBase, { blockNumber: world.baseBlock, blockHash: world.sidecar.anchor!.blockHash, blockTimestamp: world.baseTime, chainId: BASE_TEST_CHAIN, provisional: true });
    assert.deepEqual(v.times.ceilingEthereum, { chainId: 1, blockNumber: world.ethBlock, blockHash: world.settlement.ethereum.blockHash, blockTimestamp: world.ethTime });
    assert.ok(v.times.floor!.blockTimestamp < v.times.ceilingBase!.blockTimestamp && v.times.ceilingBase!.blockTimestamp < v.times.ceilingEthereum!.blockTimestamp, "floor, then Base, then Ethereum");
    assert.equal(claim(v, "ceiling.base")?.restsOn.includes(`Base block ${world.baseBlock}`), true);
    assert.match(claim(v, "ceiling.ethereum")!.detail, new RegExp(`Ethereum block ${world.ethBlock}`));
    // Confirmed: nodes that say the blocks are the chains' own make the Base time final.
    const lookups = {
      ethereumBlockHash: async (n: number) => (n === FLOOR_NUMBER ? b.anchor.blockHash : n === world.ethBlock ? world.settlement.ethereum.blockHash : null),
      baseBlockHash: async (n: number) => (n === world.baseBlock ? world.sidecar.anchor!.blockHash : null),
    };
    const confirmed = await verifyExport(done.export, { bytes: originalOf(members, m.index), pins, lookups });
    assert.deepEqual(confirmed.claims.filter((c) => c.level === "confirmed").map((c) => [c.id, c.result]), [["confirmed.floor", "TRUE"], ["confirmed.ceiling.base", "TRUE"], ["confirmed.ceiling.ethereum", "TRUE"]]);
    assert.equal(confirmed.times.ceilingBase?.provisional, false);
    // An owner's export completes the same way.
    const owner = await completeExport(buildOwnerExport(r, { names: namesByLeaf(r) }), site.fetch, { writerAddress: world.writer, baseChainId: BASE_TEST_CHAIN });
    assertSound(await verifyExport(owner.export, { bytes: text, pins }), [], "owner complete");
    assert.deepEqual(owner.export.tree.names, namesByLeaf(r));
  });

  test("21. pending stays pending, and says how far it got: no ceiling yet, a ceiling with no transaction, a settlement not yet posted", async () => {
    const { b, r } = await honestTree([{ original: text }]);
    const world = chainWorld(r.proof);
    const opts = { writerAddress: world.writer, baseChainId: BASE_TEST_CHAIN };
    const none = await completeExport(buildMemberExport(r, 0), siteFetcher({ witness: witnessOf(b) }).fetch, opts);
    assert.deepEqual([none.floor, none.ceiling, none.settlement], ["present", "pending", "pending"]);
    assert.deepEqual(none.export.ceiling, { status: "pending" });
    assert.deepEqual(none.export.settlement, { status: "pending" });
    assert.deepEqual(none.notes, []);
    const queued = await completeExport(buildMemberExport(r, 0), siteFetcher({ ceiling: { status: 200, json: world.pendingSidecar } }).fetch, opts);
    assert.deepEqual([queued.floor, queued.ceiling, queued.settlement], ["absent", "pending", "pending"]);
    assert.match(queued.notes.join(" "), /the witness route answered 404/);
    for (const settlement of [undefined, { status: 200, json: { status: "pending" } }]) {
      const s = siteFetcher({ witness: witnessOf(b), ceiling: { status: 200, json: world.sidecar }, ...(settlement ? { settlement } : {}) });
      const half = await completeExport(buildMemberExport(r, 0), s.fetch, opts);
      assert.deepEqual([half.floor, half.ceiling, half.settlement], ["present", "present", "pending"]);
      assert.deepEqual(half.export.settlement, { status: "pending", baseBlock: world.baseBlock }, "the pending settlement names the Base block it waits for");
      // A second pass with nothing new changes nothing.
      const again = await completeExport(half.export, s.fetch, opts);
      assert.equal(again.changed, false);
      // A pending export verifies, its two ceilings not carried.
      assertSound(await verifyExport(half.export, { bytes: text, pins: { ceilingWriter: world.writer, baseChainId: BASE_TEST_CHAIN } }), ["ceiling.ethereum"], "half");
    }
  });

  test("22. evidence that does not verify is never embedded; nothing present is overwritten; a site that cannot be reached is stated", async () => {
    const { b, r } = await honestTree([{ original: text }]);
    const world = chainWorld(r.proof);
    const opts = { writerAddress: world.writer, baseChainId: BASE_TEST_CHAIN };
    const otherBlock = floorBlock(FLOOR_NUMBER + 1, FLOOR_TIME);
    const lies = siteFetcher({
      witness: { status: 200, json: { headerRlpHex: otherBlock.headerHex } },
      ceiling: { status: 200, json: { ...world.sidecar, root: "0x" + "00".repeat(32) } },
    });
    const l = await completeExport(buildMemberExport(r, 0), lies.fetch, opts);
    assert.deepEqual([l.floor, l.ceiling, l.settlement], ["absent", "pending", "pending"]);
    assert.match(l.notes.join(" | "), /not the floor block the proof signs; not embedded/);
    assert.match(l.notes.join(" | "), /ceiling: the sidecar the site served does not verify \(merkle: .*\); not embedded/);
    assert.equal(l.export.floor, null);
    // The default writer is BitGraph's own: a sidecar from any other is refused.
    const strangerWriter = await completeExport(buildMemberExport(r, 0), siteFetcher({ ceiling: { status: 200, json: world.sidecar } }).fetch, {});
    assert.match(strangerWriter.notes.join(" "), /not the declared writer|chain/);
    assert.equal(strangerWriter.ceiling, "pending");
    // A settlement for another Base block is not this ceiling's.
    const elsewhere = structuredClone(world.settlement);
    elsewhere.base.blockNumber += 1;
    const mis = await completeExport(buildMemberExport(r, 0), siteFetcher({ ceiling: { status: 200, json: world.sidecar }, settlement: { status: 200, json: elsewhere } }).fetch, opts);
    assert.equal(mis.settlement, "pending");
    assert.match(mis.notes.join(" "), /settlement: .*not embedded/);
    // Complete already: no request at all.
    const full = await completeExport(buildMemberExport(r, 0), siteFetcher({ witness: witnessOf(b), ceiling: { status: 200, json: world.sidecar }, settlement: { status: 200, json: world.settlement } }).fetch, opts);
    const quiet = siteFetcher({});
    const again = await completeExport(full.export, quiet.fetch, opts);
    assert.deepEqual(quiet.seen, []);
    assert.equal(again.changed, false);
    assert.deepEqual(again.export, full.export);
    // A site that cannot be reached: stated, nothing invented.
    const down = await completeExport(buildMemberExport(r, 0), (async () => { throw new Error("ECONNREFUSED"); }) as unknown as typeof fetch, opts);
    assert.deepEqual([down.floor, down.ceiling, down.settlement], ["absent", "pending", "pending"]);
    assert.match(down.notes.join(" "), /ECONNREFUSED/);
    await assert.rejects(completeExport({ format: "bitgraph-export/0" } as unknown as BitGraphExport, quiet.fetch), /not a bitgraph-export\/1/);
  });

  test("23. the floor header from the ceiling sidecar when the witness route has none; fetchFloorHeader checks what it gets", async () => {
    const { b, r } = await honestTree([{ original: text }]);
    const world = chainWorld(r.proof, b.floor.headerHex);
    const done = await completeExport(buildMemberExport(r, 0), siteFetcher({ ceiling: { status: 200, json: world.sidecar } }).fetch, { writerAddress: world.writer, baseChainId: BASE_TEST_CHAIN });
    assert.equal(done.floor, "present");
    assert.equal(done.export.floor?.header, b.floor.headerHex);
    assert.deepEqual(await fetchFloorHeader(r.proof, siteFetcher({ witness: witnessOf(b) }).fetch), { blockNumber: FLOOR_NUMBER, blockHash: b.anchor.blockHash, header: b.floor.headerHex });
    assert.equal(await fetchFloorHeader(r.proof, siteFetcher({ witness: { status: 200, json: { headerRlpHex: floorBlock(FLOOR_NUMBER + 1).headerHex } } }).fetch), null);
    assert.equal(await fetchFloorHeader(r.proof, siteFetcher({}).fetch), null);
    const enveloped = await fetchFloorHeader(r.proof, siteFetcher({ witness: { status: 200, json: { witness: { headerRlpHex: b.floor.headerHex } } } }).fetch);
    assert.equal(enveloped?.header, b.floor.headerHex);
    const unfloored = structuredClone(r.proof);
    delete unfloored.commit.slotAnchor;
    const quiet = siteFetcher({ witness: witnessOf(b) });
    assert.equal(await fetchFloorHeader(unfloored, quiet.fetch), null);
    assert.deepEqual(quiet.seen, [], "a proof that signs no floor asks for none");
    assert.equal(floorFromHeader(r.proof, "0xzz"), null);
  });
});

describe("wiring", () => {
  test("24. the core index exports the tree producer and the export builders beside the superseded fuse and fuseSet", () => {
    const index = readFileSync(fileURLToPath(new URL("../../src/index.ts", import.meta.url)), "utf8");
    for (const name of ["fuseTree", "MAX_FUSE_BYTES", "treePlacementFor"]) assert.match(index, new RegExp(`export \\{[^}]*\\b${name}\\b[^}]*\\} from "\\./fuse\\.js"`), name);
    for (const name of ["buildMemberExport", "buildOwnerExport", "completeExport", "fetchFloorHeader", "namesByLeaf"]) assert.match(index, new RegExp(`export \\{[^}]*\\b${name}\\b[^}]*\\} from "\\./export\\.js"`), name);
    assert.match(index, /export \{[^}]*\bfuse\b[^}]*\bfuseSet\b[^}]*\} from "\.\/fuse\.js"/);
    // The cap is the site's own: the drop box and every other producer split as is from placed at the same size.
    const site = readFileSync(fileURLToPath(new URL("../../website/src/lib/fuse-placement.ts", import.meta.url)), "utf8");
    assert.match(site, /export const MAX_FUSE_BYTES = 256 \* 1024 \* 1024;/);
    const src = readFileSync(fileURLToPath(new URL("../../src/fuse.ts", import.meta.url)), "utf8") + readFileSync(fileURLToPath(new URL("../../src/export.ts", import.meta.url)), "utf8");
    assert.ok(!src.includes("\u2014"), "no em dashes");
  });
});
