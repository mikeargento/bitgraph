// Copyright (c) 2024-2026 Mike Argento. Licensed under the MIT License. See LICENSE.

/**
 * BitGraph Sets, set/2: a Merkle root over the rows instead of the list.
 * The tree, the root document, a member's evidence, and the verifier's
 * verdicts for a member with its path, without it, and with a stolen one.
 */

import { describe, test } from "node:test";
import * as assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { signAsync } from "@noble/ed25519";
import { sha256 } from "@noble/hashes/sha256";
import {
  PLACEMENTS,
  SET_METADATA_KEY,
  SET_MEMBER_METADATA_KEY,
  SET2_PLACEMENT_ID,
  MAX_SET2_MEMBERS,
  MerkleTree,
  buildSetManifest,
  buildSetMemberProof,
  buildSetRoot,
  buildSetTree,
  bytesEqual,
  bytesToBase64,
  bytesToHex,
  canonicalSlotBody,
  canonicalize,
  computeSlotCommitment,
  fuseAttribution,
  getPlacement,
  hexToBytes,
  merkleLeafHash,
  merklePath,
  merkleRoot,
  merkleRootFromPath,
  parseSetManifest,
  parseSetMemberProof,
  parseSetRoot,
  setLeaf,
  setMemberPath,
  setRootFromMember,
  verifyFuse,
  verifyFuseMember,
} from "@mikeargento/bitgraph-verify";
import type { BitGraphProof, SlotAllocation, Attribution, SetMember, SetMemberProof } from "@mikeargento/bitgraph-verify";
import { makeKey, signBody, b64, utf8 } from "./audit-fixtures.js";
import type { ManualKey } from "./audit-fixtures.js";

const FIX = fileURLToPath(new URL("../../src/__tests__/fuse-fixtures/", import.meta.url));
const bytes = (name: string) => new Uint8Array(readFileSync(FIX + name));
const original = bytes("original.txt");
const png = bytes("image.png");
const dec = (b: Uint8Array) => new TextDecoder().decode(b);
const EPOCH = bytesToBase64(new Uint8Array(32).fill(0x5e));

async function allocateSlot(key: ManualKey, counter: string): Promise<SlotAllocation> {
  const body = { version: "bitgraph/slot/1" as const, nonceB64: b64(crypto.getRandomValues(new Uint8Array(32))), counter, epochId: EPOCH, publicKeyB64: key.publicKeyB64, chainId: "bitgraph:main" };
  return { ...body, signatureB64: b64(await signAsync(canonicalize(body), key.privateKey)) };
}

/** A set/2 proof: the root document is the artifact, set/2 the signed title, the slot consumed. */
async function mintRootProof(o: { key: ManualKey; slot: SlotAllocation; commitCounter: string; rootDoc: Uint8Array; withMetadata?: boolean; attribution?: Attribution | null; member?: SetMemberProof }): Promise<BitGraphProof> {
  const commit: BitGraphProof["commit"] = { nonceB64: o.slot.nonceB64, counter: o.commitCounter, epochId: o.slot.epochId, slotCounter: o.slot.counter, slotHashB64: b64(sha256(canonicalize(canonicalSlotBody(o.slot)))) };
  (commit as unknown as Record<string, unknown>)["chainId"] = "bitgraph:main";
  const attribution = o.attribution === undefined ? fuseAttribution(SET2_PLACEMENT_ID) : o.attribution;
  const proof = await signBody(o.key, { hashAlg: "sha256", digestB64: b64(sha256(o.rootDoc)) }, commit, "test-measurement-set2", attribution === null ? undefined : { attribution });
  proof.slotAllocation = o.slot;
  if (o.withMetadata !== false) proof.metadata = { [SET_METADATA_KEY]: JSON.parse(dec(o.rootDoc)) as Record<string, unknown>, ...(o.member !== undefined ? { [SET_MEMBER_METADATA_KEY]: o.member } : {}) };
  return proof;
}

interface Fused { name: string; original: Uint8Array; placement: "trailer/1" | "container/1" | "container/2"; bytes: Uint8Array; row: SetMember }
function fuseWith(commitment: Uint8Array, original: Uint8Array, placement: Fused["placement"], name: string): Fused {
  const fused = getPlacement(placement)!.build({ original, commitment });
  return { name, original, placement, bytes: fused, row: { artifact: sha256(fused), origin: sha256(original), placement } };
}

/** A set/2 of five members across the three member placements, minted under a fresh slot. */
async function makeSet2() {
  const key = await makeKey();
  const slot = await allocateSlot(key, "40");
  const commitment = computeSlotCommitment(slot);
  const fused: Fused[] = [
    fuseWith(commitment, original, "trailer/1", "original.txt"),
    fuseWith(commitment, png, "container/1", "image.png"),
    fuseWith(commitment, utf8("a plain note for the tree\n"), "container/2", "note.txt"),
    fuseWith(commitment, utf8("a fourth member\n"), "trailer/1", "fourth.txt"),
    fuseWith(commitment, utf8("the fifth, in the new container\n"), "container/2", "fifth.txt"),
  ];
  const tree = buildSetTree(fused.map((f) => f.row));
  const rootDoc = buildSetRoot(commitment, tree.sorted.length, tree.root);
  const proof = await mintRootProof({ key, slot, commitCounter: "41", rootDoc });
  const evidenceOf = (f: Fused): SetMemberProof => {
    const k = tree.sorted.findIndex((r) => bytesEqual(r.artifact, f.row.artifact));
    return buildSetMemberProof(f.row, k, tree.sorted.length, tree.tree.path(k));
  };
  return { key, slot, commitment, fused, tree, rootDoc, proof, evidenceOf };
}

const leafInputs = ["", "00", "10", "2021", "3031", "40414243", "5051525354555657", "606162636465666768696a6b6c6d6e6f"].map((h) => hexToBytes(h) ?? new Uint8Array(0));

describe("the tree (RFC 6962)", () => {
  test("1. the RFC 6962 vectors: one leaf, and the eight-leaf root", () => {
    const hashes = leafInputs.map(merkleLeafHash);
    assert.equal(bytesToHex(merkleRoot(hashes.slice(0, 1))), "6e340b9cffb37a989ca544e6bb780a2c78901d3fb33738768511a30617afa01d");
    assert.equal(bytesToHex(merkleRoot(hashes)), "5dc9da79a70659a9ad559cb701ded9a2ab9d823aad2f4960cfe370eff4604328");
  });

  test("2. every path of every tree up to 40 leaves recomputes the root, through both the recursive and the memoized tree", () => {
    for (let n = 1; n <= 40; n++) {
      const hashes = Array.from({ length: n }, (_, i) => merkleLeafHash(utf8(`leaf ${i} of ${n}`)));
      const root = merkleRoot(hashes);
      const tree = new MerkleTree(hashes);
      assert.deepEqual(tree.root, root, `tree root n=${n}`);
      for (let i = 0; i < n; i++) {
        const path = merklePath(hashes, i);
        assert.deepEqual(tree.path(i), path, `path n=${n} i=${i}`);
        assert.ok(path.length <= (n === 1 ? 0 : Math.ceil(Math.log2(n))), `path length n=${n} i=${i}`);
        assert.deepEqual(merkleRootFromPath(hashes[i]!, i, n, path), root, `recompute n=${n} i=${i}`);
        // A different index, a different size, a truncated or extended path, or a changed node never reaches the root.
        if (n > 1) {
          const other = (i + 1) % n;
          assert.notDeepEqual(merkleRootFromPath(hashes[i]!, other, n, path), root, `wrong index n=${n} i=${i}`);
          assert.notDeepEqual(merkleRootFromPath(hashes[i]!, i, n, path.slice(0, -1)) ?? new Uint8Array(0), root, `short path n=${n} i=${i}`);
          const tampered = path.map((p, j) => (j === 0 ? new Uint8Array(p.map((b, x) => (x === 0 ? b ^ 1 : b))) : p));
          assert.notDeepEqual(merkleRootFromPath(hashes[i]!, i, n, tampered), root, `tampered node n=${n} i=${i}`);
        }
      }
      // A path says nothing about the tree's size on its own: the same
      // siblings can close a tree of another size to the same root (three
      // leaves and a fourth whose subtree hash equals the third leaf). The
      // size is committed in the root document and the verifier binds the
      // evidence's count to it before the path is read.
      assert.equal(merkleRootFromPath(hashes[0]!, n, n, []), null, "index out of range");
    }
  });

  test("3. 20,000 leaves: the memoized tree builds and every path verifies in well under a few seconds", () => {
    const n = 20_000;
    const hashes = Array.from({ length: n }, (_, i) => merkleLeafHash(utf8(`leaf ${i}`)));
    const t0 = performance.now();
    const tree = new MerkleTree(hashes);
    let ok = 0;
    for (let i = 0; i < n; i++) if (bytesEqual(merkleRootFromPath(hashes[i]!, i, n, tree.path(i))!, tree.root)) ok++;
    const sec = (performance.now() - t0) / 1000;
    assert.equal(ok, n);
    assert.ok(sec < 10, `took ${sec.toFixed(1)} s`);
  });
});

describe("the root document and a member's evidence", () => {
  const commitment = new Uint8Array(32).fill(7);
  // Hex with letters in it, so an uppercase variant is a real change.
  const root = new Uint8Array(32).fill(0xab);

  test("4. buildSetRoot / parseSetRoot round trip; anything not byte-equal to its own rebuild is refused", () => {
    const doc = buildSetRoot(commitment, 44_000, root);
    assert.equal(dec(doc), `{"count":44000,"placement":"set/2","root":{"algorithm":"sha256","digest":"${bytesToHex(root)}"},"slotCommitment":{"algorithm":"sha256","digest":"${bytesToHex(commitment)}"},"type":"bitgraph-fuse/1"}`);
    const parsed = parseSetRoot(doc)!;
    assert.deepEqual(parsed.commitment, commitment);
    assert.deepEqual(parsed.root, root);
    assert.equal(parsed.count, 44_000);
    for (const bad of [
      dec(doc).replace("}", " }"),
      dec(doc).replace('"set/2"', '"set/1"'),
      dec(doc).replace('"count":44000', '"count":0'),
      dec(doc).replace('"count":44000', `"count":${MAX_SET2_MEMBERS + 1}`),
      dec(doc).replace('"count":44000', '"count":44000,"extra":1'),
      dec(doc).replace(bytesToHex(root), bytesToHex(root).toUpperCase()),
    ]) assert.equal(parseSetRoot(utf8(bad)), null, bad.slice(0, 60));
    assert.throws(() => buildSetRoot(commitment, 0, root));
    assert.throws(() => buildSetRoot(commitment, MAX_SET2_MEMBERS + 1, root));
    assert.throws(() => buildSetRoot(new Uint8Array(31), 1, root));
  });

  test("5. a member's evidence round-trips, and a malformed one reads as null", () => {
    const rows: SetMember[] = [0, 1, 2].map((i) => ({ artifact: new Uint8Array(32).fill(10 + i), origin: new Uint8Array(32).fill(20 + i), placement: "trailer/1" }));
    const tree = buildSetTree(rows);
    const ev = buildSetMemberProof(tree.sorted[1]!, 1, 3, tree.tree.path(1));
    assert.equal(ev.placement, "set/2");
    assert.equal(ev.count, 3);
    assert.equal(ev.index, 1);
    const back = parseSetMemberProof(JSON.parse(JSON.stringify(ev)))!;
    assert.deepEqual(back.member, tree.sorted[1]);
    assert.deepEqual(back.path, tree.tree.path(1));
    assert.deepEqual(setRootFromMember(back.member, back.index, back.count, back.path), tree.root);
    for (const mutate of [
      (o: Record<string, unknown>) => { o["index"] = 3; },
      (o: Record<string, unknown>) => { o["count"] = 0; },
      (o: Record<string, unknown>) => { (o["path"] as string[])[0] = "zz"; },
      (o: Record<string, unknown>) => { o["placement"] = "set/1"; },
      (o: Record<string, unknown>) => { (o["member"] as Record<string, unknown>)["placement"] = "set/2"; },
      (o: Record<string, unknown>) => { o["extra"] = true; },
    ]) {
      const o = JSON.parse(JSON.stringify(ev)) as Record<string, unknown>;
      mutate(o);
      assert.equal(parseSetMemberProof(o), null);
    }
    assert.throws(() => buildSetMemberProof(rows[0]!, 3, 3, []));
  });

  test("6. set/2 resolves through getPlacement as Form C and is not in PLACEMENTS; the attribution carries no origin; a manifest refuses a set/2 row", () => {
    assert.deepEqual(PLACEMENTS.map((p) => p.id), ["trailer/1", "container/1", "container/2", "produced/1"]);
    const p = getPlacement("set/2")!;
    assert.equal(p.form, "C");
    assert.equal(p.byteExact, false);
    const doc = buildSetRoot(commitment, 3, root);
    assert.deepEqual(p.locate(doc)!.commitment, commitment);
    assert.equal(p.locate(utf8("{}")), null);
    assert.throws(() => p.build({ commitment }));
    assert.deepEqual(fuseAttribution("set/2"), { name: "bitgraph-fuse/1", title: "set/2" });
    assert.throws(() => fuseAttribution("set/2", commitment), /no single origin/);
    const row: SetMember = { artifact: new Uint8Array(32).fill(1), origin: new Uint8Array(32).fill(2), placement: "set/2" };
    assert.throws(() => buildSetManifest(commitment, [row]), /cannot list a set/);
    assert.throws(() => setLeaf(row));
    const okRow: SetMember = { ...row, placement: "trailer/1" };
    const manifest = buildSetManifest(commitment, [okRow]);
    assert.ok(parseSetManifest(manifest));
    assert.equal(parseSetManifest(utf8(dec(manifest).replace('"placement":"trailer/1"', '"placement":"set/2"'))), null);
  });
});

describe("verifyFuseMember for a set/2 member", () => {
  test("7. every member: direct with its evidence, from its original with its evidence, and with the evidence riding under proof.metadata", async () => {
    const s = await makeSet2();
    for (const f of s.fused) {
      const ev = s.evidenceOf(f);
      const direct = await verifyFuseMember({ proof: s.proof, bytes: f.bytes, member: ev });
      assert.equal(direct.category, "SET_MEMBER_DIRECT", `${f.name}: ${direct.reason}`);
      assert.equal(direct.set!.kind, "set/2");
      assert.equal(direct.set!.memberCount, 5);
      assert.equal(direct.set!.memberSource, "argument");
      assert.equal(direct.set!.treeRootB64, bytesToBase64(s.tree.root));
      assert.equal(direct.set!.member!.index, ev.index);
      assert.equal(direct.placement, f.placement);
      assert.ok(direct.statements.some((t) => t.includes(`member ${ev.index + 1} of 5`)), direct.statements.join(" | "));
      assert.ok(direct.statements.some((t) => t.includes("recompute the committed root")));
      const fromOrigin = await verifyFuseMember({ proof: s.proof, bytes: f.original, member: ev });
      assert.equal(fromOrigin.category, "SET_MEMBER_FROM_ORIGIN", `${f.name}: ${fromOrigin.reason}`);
      assert.equal(fromOrigin.set!.member!.index, ev.index);
      const riding = await mintRootProof({ key: s.key, slot: s.slot, commitCounter: "41", rootDoc: s.rootDoc, member: ev });
      const viaMetadata = await verifyFuseMember({ proof: riding, bytes: f.bytes });
      assert.equal(viaMetadata.category, "SET_MEMBER_DIRECT");
      assert.equal(viaMetadata.set!.memberSource, "metadata");
    }
    // The root document itself is not a member; verifyFuse answers for it.
    const self = await verifyFuseMember({ proof: s.proof, bytes: s.rootDoc });
    assert.equal(self.category, "NO_MATCH");
    assert.match(self.reason ?? "", /root document itself/);
    const asFuse = await verifyFuse({ proof: s.proof, bytes: s.rootDoc });
    assert.equal(asFuse.category, "FUSED_DIRECT");
    assert.equal(asFuse.placement, "set/2");
  });

  test("8. without evidence the floor still shows but membership does not: SET_MEMBERSHIP_UNPROVEN for a member's own bytes and for the 51st file alike; an original without evidence is NO_MATCH", async () => {
    const s = await makeSet2();
    const own = await verifyFuseMember({ proof: s.proof, bytes: s.fused[0]!.bytes });
    assert.equal(own.category, "SET_MEMBERSHIP_UNPROVEN");
    assert.deepEqual(own.statements, []);
    assert.match(own.reason ?? "", /made after that slot existed/);
    assert.match(own.reason ?? "", /no member evidence/);
    assert.equal(own.set!.kind, "set/2");
    assert.equal(own.set!.member, null);
    const stray = getPlacement("trailer/1")!.build({ original: utf8("the 51st file\n"), commitment: s.commitment });
    const strayVerdict = await verifyFuseMember({ proof: s.proof, bytes: stray });
    assert.equal(strayVerdict.category, "SET_MEMBERSHIP_UNPROVEN");
    const plain = await verifyFuseMember({ proof: s.proof, bytes: s.fused[0]!.original });
    assert.equal(plain.category, "NO_MATCH");
    const foreign = getPlacement("trailer/1")!.build({ original: utf8("x\n"), commitment: new Uint8Array(32).fill(3) });
    assert.equal((await verifyFuseMember({ proof: s.proof, bytes: foreign })).category, "NO_MATCH");
  });

  test("9. a stolen path: the 51st file with a real member's evidence is INVALID_SET_PATH, as are a forged node, a wrong count, and evidence for another set", async () => {
    const s = await makeSet2();
    const ev = s.evidenceOf(s.fused[2]!);
    const stray = getPlacement("container/2")!.build({ original: utf8("the 51st file\n"), commitment: s.commitment });
    const stolen = await verifyFuseMember({ proof: s.proof, bytes: stray, member: ev });
    assert.equal(stolen.category, "INVALID_SET_PATH");
    assert.match(stolen.reason ?? "", /describes a different member/);
    assert.deepEqual(stolen.statements, []);
    const forged = JSON.parse(JSON.stringify(ev)) as SetMemberProof;
    if (forged.path.length > 0) forged.path[0] = forged.path[0]!.replace(/^[0-9a-f]/, (c) => (c === "a" ? "b" : "a"));
    else forged.index = 0;
    const forgedVerdict = await verifyFuseMember({ proof: s.proof, bytes: s.fused[2]!.bytes, member: forged });
    assert.equal(forgedVerdict.category, "INVALID_SET_PATH");
    const wrongCount = { ...JSON.parse(JSON.stringify(ev)), count: 6 } as SetMemberProof;
    assert.equal((await verifyFuseMember({ proof: s.proof, bytes: s.fused[2]!.bytes, member: wrongCount })).category, "INVALID_SET_PATH");
    const other = await makeSet2();
    const otherEv = other.evidenceOf(other.fused[2]!);
    assert.equal((await verifyFuseMember({ proof: s.proof, bytes: s.fused[2]!.bytes, member: otherEv })).category, "INVALID_SET_PATH");
    assert.equal((await verifyFuseMember({ proof: s.proof, bytes: s.fused[2]!.bytes, member: { nonsense: true } })).category, "INVALID_SET_PATH");
  });

  test("10. the root document is bound before any row: a wrong commitment, a stripped document, or a set/1 title over a root document are refused", async () => {
    const s = await makeSet2();
    const ev = s.evidenceOf(s.fused[0]!);
    const otherSlot = await allocateSlot(s.key, "50");
    const wrongDoc = buildSetRoot(computeSlotCommitment(otherSlot), 5, s.tree.root);
    const wrongCommitment = await mintRootProof({ key: s.key, slot: s.slot, commitCounter: "41", rootDoc: wrongDoc });
    assert.equal((await verifyFuseMember({ proof: wrongCommitment, bytes: s.fused[0]!.bytes, member: ev })).category, "INVALID_SLOT_COMMITMENT");
    const stripped = await mintRootProof({ key: s.key, slot: s.slot, commitCounter: "41", rootDoc: s.rootDoc, withMetadata: false });
    const noDoc = await verifyFuseMember({ proof: stripped, bytes: s.fused[0]!.bytes, member: ev });
    assert.equal(noDoc.category, "INVALID_SET_MANIFEST");
    assert.match(noDoc.reason ?? "", /root document/);
    const explicit = await verifyFuseMember({ proof: stripped, bytes: s.fused[0]!.bytes, member: ev, manifest: s.rootDoc });
    assert.equal(explicit.category, "SET_MEMBER_DIRECT", "explicit root document bytes bind a stripped proof");
    const asSet1 = await mintRootProof({ key: s.key, slot: s.slot, commitCounter: "41", rootDoc: s.rootDoc, attribution: fuseAttribution("set/1") });
    assert.equal((await verifyFuseMember({ proof: asSet1, bytes: s.fused[0]!.bytes, member: ev })).category, "INVALID_SET_MANIFEST");
    const tampered = JSON.parse(JSON.stringify(s.proof)) as BitGraphProof;
    (tampered.metadata![SET_METADATA_KEY] as Record<string, unknown>)["count"] = 6;
    assert.equal((await verifyFuseMember({ proof: tampered, bytes: s.fused[0]!.bytes, member: ev })).category, "INVALID_SET_MANIFEST");
  });

  test("11. an unregistered row placement in valid evidence is UNDETERMINED_PLACEMENT: the path proves the row, the bytes cannot be read", async () => {
    const key = await makeKey();
    const slot = await allocateSlot(key, "60");
    const commitment = computeSlotCommitment(slot);
    const real = fuseWith(commitment, original, "trailer/1", "a");
    const odd: SetMember = { artifact: new Uint8Array(32).fill(5), origin: sha256(utf8("odd")), placement: "xmp/9" };
    const tree = buildSetTree([real.row, odd]);
    const proof = await mintRootProof({ key, slot, commitCounter: "61", rootDoc: buildSetRoot(commitment, 2, tree.root) });
    const k = tree.sorted.findIndex((r) => r.placement === "xmp/9");
    const ev = buildSetMemberProof(odd, k, 2, tree.tree.path(k));
    // Bytes that hash to the odd row's artifact cannot exist here; a direct hit is not constructible, so the from-origin path reports the unregistered placement.
    const v = await verifyFuseMember({ proof, bytes: utf8("odd"), member: ev });
    assert.equal(v.category, "UNDETERMINED_PLACEMENT");
    const good = await verifyFuseMember({ proof, bytes: real.bytes, member: buildSetMemberProof(real.row, 1 - k, 2, tree.tree.path(1 - k)) });
    assert.equal(good.category, "SET_MEMBER_DIRECT");
  });

  test("12. paths from the tree helpers agree with the verifier: setMemberPath, setLeaf, setRootFromMember", async () => {
    const s = await makeSet2();
    for (let k = 0; k < s.tree.sorted.length; k++) {
      const row = s.tree.sorted[k]!;
      const path = setMemberPath(s.tree.tree, k);
      assert.deepEqual(merkleRootFromPath(setLeaf(row), k, 5, path), s.tree.root);
      assert.deepEqual(setRootFromMember(row, k, 5, path), s.tree.root);
    }
  });
});
