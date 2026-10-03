// Copyright (c) 2024-2026 Argento Computing Inc. Licensed under the MIT License. See LICENSE.

/**
 * tree/1: the leaf and root-document layouts, the tree, a member's evidence,
 * the owner's list, and verifyTreeMember's verdicts for every way a file can
 * be in or out of a tree. Negative cases first-class: every mutation of the
 * evidence or the bytes must fail with the right category.
 */

import { describe, test } from "node:test";
import * as assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { signAsync } from "@noble/ed25519";
import { sha256 } from "@noble/hashes/sha256";
import {
  LEAF_AS_IS,
  MAX_TREE_LEAVES,
  TREE_DOMAIN,
  TREE_METADATA_KEY,
  TREE_PLACEMENT_ID,
  buildTree,
  buildTreeMemberEvidence,
  buildTreeRootDocument,
  bytesEqual,
  bytesToBase64,
  bytesToHex,
  canonicalSlotBody,
  canonicalize,
  committedBytesFor,
  computeSlotCommitment2,
  decodeTreeLeaf,
  decodeTreeLeaves,
  encodeTreeLeaf,
  encodeTreeLeaves,
  fuseAttribution,
  leafFor,
  merkleLeafHash,
  MerkleTree,
  parseTreeMemberEvidence,
  parseTreeRootDocument,
  sortTreeLeaves,
  treeAttribution,
  treeLeafHash,
  treeRootFromMember,
  verifyTreeLeaves,
  verifyTreeMember,
} from "@mikeargento/bitgraph-verify";
import type { BitGraphProof, SlotAllocation, TreeLeaf, TreeMemberEvidence, Attribution } from "@mikeargento/bitgraph-verify";
import { makeKey, signBody, b64, utf8 } from "./audit-fixtures.js";
import type { ManualKey } from "./audit-fixtures.js";

const FIX = fileURLToPath(new URL("../../src/__tests__/fuse-fixtures/", import.meta.url));
const fixture = (name: string) => new Uint8Array(readFileSync(FIX + name));
const EPOCH = bytesToBase64(new Uint8Array(32).fill(0x7e));
const FLOOR_HASH = "0x" + "ab".repeat(32);
const SPEC = sha256(utf8("tree/1 test spec"));
const SPEC_B64 = bytesToBase64(SPEC);
const extraSpecHashes = [SPEC_B64];

async function allocateSlot(key: ManualKey, counter: string): Promise<SlotAllocation> {
  const body = { version: "bitgraph/slot/1" as const, nonceB64: b64(crypto.getRandomValues(new Uint8Array(32))), counter, epochId: EPOCH, publicKeyB64: key.publicKeyB64, chainId: "bitgraph:main" };
  return { ...body, signatureB64: b64(await signAsync(canonicalize(body), key.privateKey)) };
}

/** A tree/1 proof: the root document is the artifact, the floor block signed in commit.slotAnchor. */
async function mintTreeProof(o: { key: ManualKey; slot: SlotAllocation; commitCounter: string; rootDoc: Uint8Array; attribution?: Attribution; floorHash?: string; withMetadata?: boolean }): Promise<BitGraphProof> {
  const commit: BitGraphProof["commit"] = {
    nonceB64: o.slot.nonceB64,
    counter: o.commitCounter,
    epochId: o.slot.epochId,
    slotCounter: o.slot.counter,
    slotHashB64: b64(sha256(canonicalize(canonicalSlotBody(o.slot)))),
    slotAnchor: { counter: String(Number(o.slot.counter) - 1), blockNumber: 25_000_000, blockHash: o.floorHash ?? FLOOR_HASH },
  };
  (commit as unknown as Record<string, unknown>)["chainId"] = "bitgraph:main";
  const proof = await signBody(o.key, { hashAlg: "sha256", digestB64: b64(sha256(o.rootDoc)) }, commit, "test-measurement-tree1", { attribution: o.attribution ?? treeAttribution(SPEC) });
  proof.slotAllocation = o.slot;
  if (o.withMetadata !== false) proof.metadata = { [TREE_METADATA_KEY]: bytesToHex(o.rootDoc) };
  return proof;
}

interface Member { name: string; original: Uint8Array; code: number; committed: Uint8Array; leaf: TreeLeaf }

async function makeTree(specs: Array<{ name: string; original: Uint8Array; code: number }>) {
  const key = await makeKey();
  const slot = await allocateSlot(key, "500");
  const commitment = computeSlotCommitment2(slot, FLOOR_HASH);
  const members: Member[] = specs.map((s) => {
    const { leaf, committed } = leafFor(s.code, s.original, commitment);
    return { ...s, leaf, committed };
  });
  const built = buildTree(members.map((m) => m.leaf));
  const rootDoc = buildTreeRootDocument(commitment, built.sorted.length, built.root);
  const proof = await mintTreeProof({ key, slot, commitCounter: "502", rootDoc });
  const evidenceOf = (m: Member): TreeMemberEvidence => {
    const k = built.sorted.findIndex((l) => bytesEqual(l.artifact, m.leaf.artifact));
    return buildTreeMemberEvidence(m.leaf, k, built.sorted.length, built.tree.path(k));
  };
  return { key, slot, commitment, members, built, rootDoc, proof, evidenceOf };
}

const FIVE = () => [
  { name: "original.txt", original: fixture("original.txt"), code: 0x01 },
  { name: "image.png", original: fixture("image.png"), code: 0x02 },
  { name: "note.txt", original: utf8("a plain note for the tree\n"), code: 0x03 },
  { name: "fourth.txt", original: utf8("a fourth member\n"), code: 0x01 },
  { name: "big.bin", original: utf8("recorded exactly as it is\n"), code: LEAF_AS_IS },
];

describe("tree/1 layouts", () => {
  test("the domain is 'bitgraph-tree/1' and one zero byte", () => {
    assert.equal(TREE_DOMAIN.length, 16);
    assert.equal(new TextDecoder().decode(TREE_DOMAIN.subarray(0, 15)), "bitgraph-tree/1");
    assert.equal(TREE_DOMAIN[15], 0);
  });

  test("a leaf is 65 bytes: placement, artifact, origin; decode is strict", () => {
    const leaf: TreeLeaf = { placement: 0x02, artifact: new Uint8Array(32).fill(1), origin: new Uint8Array(32).fill(2) };
    const b = encodeTreeLeaf(leaf);
    assert.equal(b.length, 65);
    assert.equal(b[0], 2);
    assert.deepEqual(b.subarray(1, 33), leaf.artifact);
    assert.deepEqual(b.subarray(33), leaf.origin);
    assert.deepEqual(decodeTreeLeaf(b), leaf);
    assert.equal(decodeTreeLeaf(b.subarray(0, 64)), null, "short");
    assert.equal(decodeTreeLeaf(new Uint8Array([0x04, ...b.subarray(1)])), null, "unregistered code");
    assert.equal(decodeTreeLeaf(new Uint8Array([0x00, ...b.subarray(1)])), null, "as-is with artifact != origin");
    assert.throws(() => encodeTreeLeaf({ placement: 0, artifact: leaf.artifact, origin: leaf.origin }), /same digest/);
    const asIs = encodeTreeLeaf({ placement: 0, artifact: leaf.artifact, origin: leaf.artifact });
    assert.ok(decodeTreeLeaf(asIs));
  });

  test("the root document is 84 bytes: domain, count u32 big-endian, root, commitment; parse is strict", () => {
    const c = new Uint8Array(32).fill(0xcc), r = new Uint8Array(32).fill(0xdd);
    const doc = buildTreeRootDocument(c, 258, r);
    assert.equal(doc.length, 84);
    assert.deepEqual(doc.subarray(0, 16), TREE_DOMAIN);
    assert.deepEqual([...doc.subarray(16, 20)], [0, 0, 1, 2]);
    assert.deepEqual(doc.subarray(20, 52), r);
    assert.deepEqual(doc.subarray(52, 84), c);
    assert.deepEqual(parseTreeRootDocument(doc), { count: 258, root: r, commitment: c });
    const zero = doc.slice(); zero.set([0, 0, 0, 0], 16);
    assert.equal(parseTreeRootDocument(zero), null, "count 0");
    const huge = doc.slice(); new DataView(huge.buffer).setUint32(16, MAX_TREE_LEAVES + 1);
    assert.equal(parseTreeRootDocument(huge), null, "count over the cap");
    const wrongDomain = doc.slice(); wrongDomain[0] = 0x42;
    assert.equal(parseTreeRootDocument(wrongDomain), null, "domain");
    assert.equal(parseTreeRootDocument(doc.subarray(0, 83)), null, "length");
    assert.throws(() => buildTreeRootDocument(c, 0, r));
  });

  test("leaves sort by artifact digest; duplicates, empty lists and bad leaves are refused", () => {
    const mk = (a: number, o = a) => ({ placement: 1, artifact: new Uint8Array(32).fill(a), origin: new Uint8Array(32).fill(o) });
    const sorted = sortTreeLeaves([mk(9), mk(3), mk(7)]);
    assert.deepEqual(sorted.map((l) => l.artifact[0]), [3, 7, 9]);
    assert.throws(() => sortTreeLeaves([mk(3), mk(3, 4)]), /duplicate/);
    assert.throws(() => sortTreeLeaves([]), /at least one/);
    // The same original under two placements: two leaves, two artifacts, allowed.
    const twice = sortTreeLeaves([mk(1, 5), mk(2, 5)]);
    assert.equal(twice.length, 2);
  });

  test("the member evidence parses strictly", () => {
    const leaf = { placement: 1, artifact: new Uint8Array(32).fill(0xab), origin: new Uint8Array(32).fill(0xcd) };
    const ev = buildTreeMemberEvidence(leaf, 0, 1, []);
    assert.deepEqual(ev, { index: 0, count: 1, leaf: bytesToHex(encodeTreeLeaf(leaf)), path: [] });
    assert.ok(parseTreeMemberEvidence(ev));
    assert.equal(parseTreeMemberEvidence({ ...ev, extra: 1 }), null, "extra key");
    assert.equal(parseTreeMemberEvidence({ ...ev, index: 1 }), null, "index out of range");
    assert.equal(parseTreeMemberEvidence({ ...ev, leaf: ev.leaf.toUpperCase() }), null, "uppercase hex");
    assert.equal(parseTreeMemberEvidence({ ...ev, path: ["00"] }), null, "short node");
    assert.equal(parseTreeMemberEvidence({ ...ev, count: 0 }), null, "count 0");
  });
});

describe("a single file is a tree of one", () => {
  test("empty path, root = leaf hash, and every way to hand it over verifies", async () => {
    const t = await makeTree([{ name: "original.txt", original: fixture("original.txt"), code: 0x01 }]);
    assert.equal(t.built.sorted.length, 1);
    assert.deepEqual(t.built.root, treeLeafHash(t.members[0]!.leaf));
    assert.deepEqual(t.built.tree.path(0), []);
    const ev = t.evidenceOf(t.members[0]!);
    assert.deepEqual(ev.path, []);
    const fromOrigin = await verifyTreeMember({ proof: t.proof, bytes: t.members[0]!.original, member: ev, extraSpecHashes });
    assert.equal(fromOrigin.category, "TREE_MEMBER_FROM_ORIGIN", fromOrigin.reason);
    assert.equal(fromOrigin.floorCovers, "committed-bytes");
    const direct = await verifyTreeMember({ proof: t.proof, bytes: t.members[0]!.committed, member: ev, extraSpecHashes });
    assert.equal(direct.category, "TREE_MEMBER_DIRECT", direct.reason);
    const rootOnly = await verifyTreeMember({ proof: t.proof, extraSpecHashes });
    assert.equal(rootOnly.category, "TREE_ROOT_VALID", rootOnly.reason);
    assert.equal(rootOnly.tree?.count, 1);
    const pathOnly = await verifyTreeMember({ proof: t.proof, member: ev, extraSpecHashes });
    assert.equal(pathOnly.category, "TREE_PATH_VALID", pathOnly.reason);
  });

  test("an as-is single file: existed by only, no floor", async () => {
    const t = await makeTree([{ name: "huge.bin", original: utf8("as is\n"), code: LEAF_AS_IS }]);
    const r = await verifyTreeMember({ proof: t.proof, bytes: t.members[0]!.original, member: t.evidenceOf(t.members[0]!), extraSpecHashes });
    assert.equal(r.category, "TREE_MEMBER_AS_IS", r.reason);
    assert.equal(r.floorCovers, "none");
  });
});

describe("a tree of five, across every placement", () => {
  test("every member verifies from its original and from its committed bytes", async () => {
    const t = await makeTree(FIVE());
    for (const m of t.members) {
      const ev = t.evidenceOf(m);
      const a = await verifyTreeMember({ proof: t.proof, bytes: m.original, member: ev, extraSpecHashes });
      const b = await verifyTreeMember({ proof: t.proof, bytes: m.committed, member: ev, extraSpecHashes });
      if (m.code === LEAF_AS_IS) {
        assert.equal(a.category, "TREE_MEMBER_AS_IS", `${m.name}: ${a.reason}`);
        assert.equal(b.category, "TREE_MEMBER_AS_IS", `${m.name}: ${b.reason}`);
      } else {
        assert.equal(a.category, "TREE_MEMBER_FROM_ORIGIN", `${m.name}: ${a.reason}`);
        assert.equal(b.category, "TREE_MEMBER_DIRECT", `${m.name}: ${b.reason}`);
      }
      assert.equal(a.member?.count, 5);
    }
  });

  test("the root document travels in the proof's metadata or beside it; never trusted unbound", async () => {
    const t = await makeTree(FIVE());
    const m = t.members[0]!;
    const noMeta = { ...t.proof, metadata: undefined } as unknown as BitGraphProof;
    const r1 = await verifyTreeMember({ proof: noMeta, bytes: m.original, member: t.evidenceOf(m), extraSpecHashes });
    assert.equal(r1.category, "INVALID_TREE_ROOT");
    const r2 = await verifyTreeMember({ proof: noMeta, bytes: m.original, member: t.evidenceOf(m), rootDocument: t.rootDoc, extraSpecHashes });
    assert.equal(r2.category, "TREE_MEMBER_FROM_ORIGIN", r2.reason);
    const forged = t.rootDoc.slice(); forged[30]! ^= 1;
    const r3 = await verifyTreeMember({ proof: t.proof, bytes: m.original, member: t.evidenceOf(m), rootDocument: forged, extraSpecHashes });
    assert.equal(r3.category, "INVALID_TREE_ROOT");
  });

  test("every mutation of the evidence fails as a path failure", async () => {
    const t = await makeTree(FIVE());
    const m = t.members[1]!;
    const ev = t.evidenceOf(m);
    const flipLeaf = { ...ev, leaf: ev.leaf.slice(0, 10) + (ev.leaf[10] === "0" ? "1" : "0") + ev.leaf.slice(11) };
    const wrongIndex = { ...ev, index: (ev.index + 1) % ev.count };
    const wrongCount = { ...ev, count: ev.count + 1 };
    const shortPath = { ...ev, path: ev.path.slice(0, -1) };
    const longPath = { ...ev, path: [...ev.path, "00".repeat(32)] };
    const flippedNode = { ...ev, path: ev.path.map((p, i) => (i === 0 ? (p[0] === "0" ? "1" : "0") + p.slice(1) : p)) };
    const otherCode = { ...ev, leaf: "03" + ev.leaf.slice(2) };
    for (const [label, bad] of Object.entries({ flipLeaf, wrongIndex, wrongCount, shortPath, longPath, flippedNode, otherCode })) {
      const r = await verifyTreeMember({ proof: t.proof, bytes: m.original, member: bad, extraSpecHashes });
      assert.equal(r.category, "INVALID_TREE_PATH", `${label}: ${r.category} ${r.reason}`);
    }
  });

  test("a file that is not the leaf: NO_MATCH, or UNPROVEN when it carries this position's commitment", async () => {
    const t = await makeTree(FIVE());
    const ev = t.evidenceOf(t.members[0]!);
    const stranger = await verifyTreeMember({ proof: t.proof, bytes: utf8("never in any tree"), member: ev, extraSpecHashes });
    assert.equal(stranger.category, "NO_MATCH");
    // The 51st file: someone reads the commitment off a member and staples it to new content.
    const stapled = committedBytesFor(0x01, utf8("new content, old commitment"), t.commitment);
    const s = await verifyTreeMember({ proof: t.proof, bytes: stapled, member: ev, extraSpecHashes });
    assert.equal(s.category, "TREE_MEMBERSHIP_UNPROVEN");
    const s2 = await verifyTreeMember({ proof: t.proof, bytes: stapled, extraSpecHashes });
    assert.equal(s2.category, "TREE_MEMBERSHIP_UNPROVEN");
    // Another member's evidence does not cover this member.
    const other = await verifyTreeMember({ proof: t.proof, bytes: t.members[2]!.original, member: ev, extraSpecHashes });
    assert.notEqual(other.category, "TREE_MEMBER_FROM_ORIGIN");
  });

  test("an original whose leaf claims a placement it was not built with: RECONSTRUCTION_MISMATCH is impossible to dodge", async () => {
    const key = await makeKey();
    const slot = await allocateSlot(key, "600");
    const commitment = computeSlotCommitment2(slot, FLOOR_HASH);
    const original = utf8("committed by trailer, listed as container");
    const trailer = committedBytesFor(0x01, original, commitment);
    // A leaf naming container/1 but carrying the trailer's artifact digest.
    const lying: TreeLeaf = { placement: 0x02, artifact: sha256(trailer), origin: sha256(original) };
    const built = buildTree([lying]);
    const rootDoc = buildTreeRootDocument(commitment, 1, built.root);
    const proof = await mintTreeProof({ key, slot, commitCounter: "601", rootDoc });
    const ev = buildTreeMemberEvidence(lying, 0, 1, []);
    const r = await verifyTreeMember({ proof, bytes: original, member: ev, extraSpecHashes });
    assert.equal(r.category, "RECONSTRUCTION_MISMATCH");
    const d = await verifyTreeMember({ proof, bytes: trailer, member: ev, extraSpecHashes });
    assert.equal(d.category, "INVALID_SLOT_COMMITMENT", "a container/1 locate cannot find a commitment in trailer bytes");
  });
});

describe("the signed marker and the commitment", () => {
  test("an unknown spec, a missing spec, a fuse/1 marker, or a non-tree title are refused", async () => {
    const t = await makeTree(FIVE());
    const m = t.members[0]!;
    const ev = t.evidenceOf(m);
    const unknown = await verifyTreeMember({ proof: t.proof, bytes: m.original, member: ev });
    assert.equal(unknown.category, "UNKNOWN_SPEC");
    const noSpec = await mintTreeProof({ key: t.key, slot: t.slot, commitCounter: "503", rootDoc: t.rootDoc, attribution: { name: "bitgraph-fuse/2", title: TREE_PLACEMENT_ID } });
    assert.equal((await verifyTreeMember({ proof: noSpec, bytes: m.original, member: ev, extraSpecHashes })).category, "INVALID_TREE_MARKER");
    const v1 = await mintTreeProof({ key: t.key, slot: t.slot, commitCounter: "503", rootDoc: t.rootDoc, attribution: { name: "bitgraph-fuse/1", title: TREE_PLACEMENT_ID, message: SPEC_B64 } });
    assert.equal((await verifyTreeMember({ proof: v1, bytes: m.original, member: ev, extraSpecHashes })).category, "INVALID_TREE_MARKER");
    const set2 = await mintTreeProof({ key: t.key, slot: t.slot, commitCounter: "503", rootDoc: t.rootDoc, attribution: fuseAttribution("set/2", undefined, 2) });
    assert.equal((await verifyTreeMember({ proof: set2, bytes: m.original, member: ev, extraSpecHashes })).category, "NOT_TREE");
  });

  test("a proof whose signed floor block differs: the root document's commitment no longer matches", async () => {
    const t = await makeTree(FIVE());
    const otherFloor = await mintTreeProof({ key: t.key, slot: t.slot, commitCounter: "503", rootDoc: t.rootDoc, floorHash: "0x" + "cd".repeat(32) });
    const r = await verifyTreeMember({ proof: otherFloor, bytes: t.members[0]!.original, member: t.evidenceOf(t.members[0]!), extraSpecHashes });
    assert.equal(r.category, "INVALID_SLOT_COMMITMENT");
  });

  test("a tampered signature fails before anything else is read", async () => {
    const t = await makeTree(FIVE());
    const bad = JSON.parse(JSON.stringify(t.proof)) as BitGraphProof;
    bad.artifact.digestB64 = bytesToBase64(new Uint8Array(32));
    const r = await verifyTreeMember({ proof: bad, bytes: t.members[0]!.original, member: t.evidenceOf(t.members[0]!), extraSpecHashes });
    assert.equal(r.category, "INVALID_UNDERLYING_PROOF");
  });
});

describe("the owner's list", () => {
  test("round trips, rebuilds the root, and is the only check of order and uniqueness", async () => {
    const t = await makeTree(FIVE());
    const bytes = encodeTreeLeaves(t.built.sorted);
    assert.equal(bytes.length, 5 * 65);
    assert.deepEqual(decodeTreeLeaves(bytes), t.built.sorted);
    assert.deepEqual(verifyTreeLeaves(t.rootDoc, bytes), { ok: true, count: 5 });
    // Swap two leaves: same set, wrong order.
    const swapped = bytes.slice();
    swapped.set(bytes.subarray(0, 65), 65);
    swapped.set(bytes.subarray(65, 130), 0);
    assert.equal(verifyTreeLeaves(t.rootDoc, swapped).ok, false);
    assert.match(verifyTreeLeaves(t.rootDoc, bytes.subarray(0, 4 * 65)).reason ?? "", /states 5/);
  });

  test("Sol's finding: a member path of an unsorted, duplicated tree still verifies; only the whole list catches it", async () => {
    const key = await makeKey();
    const slot = await allocateSlot(key, "700");
    const commitment = computeSlotCommitment2(slot, FLOOR_HASH);
    const a = leafFor(0x01, utf8("A"), commitment).leaf;
    const b = leafFor(0x01, utf8("B"), commitment).leaf;
    // Built by hand, not through buildTree: out of order and with a duplicate.
    const leaves = [b, a, a];
    const hashes = leaves.map(treeLeafHash);
    const tree = new MerkleTree(hashes);
    const rootDoc = buildTreeRootDocument(commitment, 3, tree.root);
    const proof = await mintTreeProof({ key, slot, commitCounter: "701", rootDoc });
    const ev = buildTreeMemberEvidence(b, 0, 3, tree.path(0));
    const r = await verifyTreeMember({ proof, bytes: utf8("B"), member: ev, extraSpecHashes });
    assert.equal(r.category, "TREE_MEMBER_FROM_ORIGIN", "a path proves membership, not the order of the others");
    const list = verifyTreeLeaves(rootDoc, encodeTreeLeavesUnchecked(leaves));
    assert.equal(list.ok, false);
  });
});

function encodeTreeLeavesUnchecked(leaves: TreeLeaf[]): Uint8Array {
  const out = new Uint8Array(leaves.length * 65);
  leaves.forEach((l, i) => out.set(encodeTreeLeaf(l), i * 65));
  return out;
}

describe("scale", () => {
  test("100,000 leaves: build, every 997th path verifies, and the owner's list is 6.5 MB", () => {
    const commitment = new Uint8Array(32).fill(9);
    const leaves: TreeLeaf[] = [];
    for (let i = 0; i < 100_000; i++) {
      const origin = sha256(utf8(`file ${i}`));
      leaves.push({ placement: 0x01, artifact: sha256(utf8(`committed ${i}`)), origin });
    }
    const t0 = performance.now();
    const built = buildTree(leaves);
    const rootDoc = buildTreeRootDocument(commitment, built.sorted.length, built.root);
    for (let k = 0; k < built.sorted.length; k += 997) {
      const reached = treeRootFromMember(built.sorted[k]!, k, built.sorted.length, built.tree.path(k));
      assert.ok(reached && bytesEqual(reached, built.root), `path ${k}`);
    }
    const list = encodeTreeLeaves(built.sorted);
    assert.equal(list.length, 6_500_000);
    assert.equal(verifyTreeLeaves(rootDoc, list).ok, true);
    const sec = (performance.now() - t0) / 1000;
    assert.ok(sec < 30, `took ${sec.toFixed(1)} s`);
    assert.ok(built.tree.path(0).length <= 17);
    // A maximum-depth member's evidence, compact JSON.
    const ev = buildTreeMemberEvidence(built.sorted[0]!, 0, built.sorted.length, built.tree.path(0));
    assert.ok(JSON.stringify(ev).length < 1600, `member evidence ${JSON.stringify(ev).length} bytes`);
  });
});

describe("the leaf hash is RFC 6962's", () => {
  test("leaf hash = SHA-256(0x00 || 65-byte leaf)", () => {
    const leaf = { placement: 1, artifact: new Uint8Array(32).fill(1), origin: new Uint8Array(32).fill(2) };
    const manual = sha256(new Uint8Array([0, ...encodeTreeLeaf(leaf)]));
    assert.deepEqual(treeLeafHash(leaf), manual);
    assert.deepEqual(merkleLeafHash(encodeTreeLeaf(leaf)), manual);
  });
});
