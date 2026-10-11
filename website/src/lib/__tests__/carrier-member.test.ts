/**
 * The site's tree-member BitGraphed file (bitgraph-carrier/4, lib/carrier-member):
 * built from the file in hand (the original or the committed bytes) and the
 * evidence that placed it, for trees the site's own maker produced through
 * the stub boundary (tree1-helpers: a throwaway key, no network). The stub's
 * proofs carry no attestation, so a verifier's verdict on them is
 * UNDETERMINED (no image is established), never TRUE; every other claim
 * must hold, and the negative cases must be FALSE or refused before a block
 * is written.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { sha256 } from "@noble/hashes/sha256";
import { bytesToHex, verifyCarrier, type CarrierProof, type TreeMemberEvidence } from "@mikeargento/bitgraph-verify";
import { assembleMemberCarrier, memberCarrierFileName, memberCarrierFormat, memberCommittedBytes, type MemberCarrierParts } from "../carrier-member.ts";
import { parseCarrier, innerDigestMatches, CARRIER_VERSION_4 } from "../carrier.ts";
import { makeTree, type TreeInput } from "../fuse-tree-make.ts";
import { bindTree, type BoundTree } from "../fuse-tree.ts";
import { hashBlob } from "../scan-hash.ts";
import { makeStub, utf8, BASE_FLOOR_HEADER_HEX } from "./tree1-helpers.ts";

const PNG = (n: number) => new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, ...Array.from({ length: n }, (_, i) => (i * 7 + 3) & 0xff)]);
const JPEG = (n: number) => new Uint8Array([0xff, 0xd8, 0xff, 0xe0, ...Array.from({ length: n }, (_, i) => (i * 13 + 5) & 0xff)]);
const claim = (r: { claims: Array<{ id: string; result: string; detail: string }> }, id: string) => r.claims.find((c) => c.id === id);

async function scanned(name: string, bytes: Uint8Array, asIs = false): Promise<TreeInput> {
  const s = await hashBlob(new Blob([bytes.slice()]));
  return { file: new Blob([bytes.slice()]), name, digestB64: s.digestB64, placement: s.placement, state: s.state, ...(asIs ? { asIs: true } : {}) };
}

/** A tree the site's maker made over a Base floor, with the parts every BitGraphed file of it shares. */
async function siteTree(files: Array<{ name: string; bytes: Uint8Array; asIs?: boolean }>) {
  const stub = await makeStub({ baseFloor: true });
  const made = await makeTree(await Promise.all(files.map((f) => scanned(f.name, f.bytes, f.asIs))), { transport: { fetch: stub.fetch } });
  const bound = bindTree(made.proof);
  assert.ok(bound.ok, bound.ok ? "" : bound.reason);
  const tree = (bound as { tree: BoundTree }).tree;
  const parts: MemberCarrierParts = {
    proof: made.proof as unknown as CarrierProof,
    floor: { status: "present", basis: "base-header", header: BASE_FLOOR_HEADER_HEX },
    ceiling: { status: "none", basis: "hash-chain" },
    ceilingInTime: { status: "unfetched" },
  };
  const memberOf = (name: string) => {
    const m = made.members[files.findIndex((f) => f.name === name)]!;
    return { member: m, evidence: made.evidenceOf(m.leafIndex) as TreeMemberEvidence, bytes: files.find((f) => f.name === name)!.bytes };
  };
  return { made, tree, parts, memberOf };
}

test("the formats that can carry a block: trailer-safe images, a container's tar, PDF, ZIP, MP4; not text, SVG or JSON kept as is", () => {
  assert.deepEqual(memberCarrierFormat(PNG(40), "trailer/1"), { ok: true, kind: "trailer-safe" });
  assert.deepEqual(memberCarrierFormat(JPEG(40), "as-is"), { ok: true, kind: "trailer-safe" });
  assert.deepEqual(memberCarrierFormat(utf8("plain text, any placement in a container"), "container/2"), { ok: true, kind: "tar" });
  assert.deepEqual(memberCarrierFormat(utf8("%PDF-1.7\n..."), "as-is"), { ok: true, kind: "pdf" });
  assert.deepEqual(memberCarrierFormat(new Uint8Array([0x50, 0x4b, 0x03, 0x04, 0, 0]), "as-is"), { ok: true, kind: "zip" });
  assert.deepEqual(memberCarrierFormat(new Uint8Array([0, 0, 0, 0x18, 0x66, 0x74, 0x79, 0x70, 0x69, 0x73, 0x6f, 0x6d]), "as-is"), { ok: true, kind: "mp4" });
  for (const text of ["<svg xmlns=\"http://www.w3.org/2000/svg\"/>", "{\"json\": true}", "plain text\n", "<!doctype html>"]) {
    const r = memberCarrierFormat(utf8(text), "as-is");
    assert.equal(r.ok, false, text);
    assert.match((r as { reason: string }).reason, /travels with its export instead/);
    assert.doesNotMatch((r as { reason: string }).reason, /[–—]/, "no em or en dash in words a visitor reads");
  }
  // HEIC is ISO base media too, but untested with a trailing block: not offered.
  assert.equal(memberCarrierFormat(new Uint8Array([0, 0, 0, 0x18, 0x66, 0x74, 0x79, 0x70, 0x68, 0x65, 0x69, 0x63]), "as-is").ok, false);
});

test("names: the extension stays, a container leaf is named as the tar it is", () => {
  assert.equal(memberCarrierFileName("photo.jpg", "trailer/1"), "photo.bitgraph.jpg");
  assert.equal(memberCarrierFileName("photo.jpg", "as-is"), "photo.bitgraph.jpg");
  assert.equal(memberCarrierFileName("notes.txt", "container/2"), "notes.txt.bitgraph.tar");
  assert.equal(memberCarrierFileName("notes.fused.tar", "container/2"), "notes.fused.bitgraph.tar");
  assert.equal(memberCarrierFileName("README", "as-is"), "README.bitgraph");
});

test("a single-member tree (container/2): the file built from the original verifies, its bytes the leaf's", async () => {
  const original = utf8("a note, recorded alone as a tree of one\n");
  const t = await siteTree([{ name: "note.txt", bytes: original }]);
  const { evidence } = t.memberOf("note.txt");
  const built = await assembleMemberCarrier({ fileBytes: original, fileName: "note.txt", proof: t.made.proof, rootDocument: t.tree.rootDocument, commitment: t.tree.commitment, evidence, parts: t.parts });
  assert.equal(built.placement, "container/2");
  assert.equal(built.fileName, "note.txt.bitgraph.tar");
  assert.equal(built.floorCovers, "content");
  const p = parseCarrier(built.bytes);
  assert.equal(p.kind, "carrier");
  if (p.kind !== "carrier") return;
  assert.equal(p.payload.carrier, CARRIER_VERSION_4);
  assert.equal(innerDigestMatches(p.inner, p.payload), true, "the site's own copy of the format reads it");
  assert.equal(bytesToHex(sha256(p.inner)), evidence.leaf.slice(2, 66), "the bytes before the block are the leaf's committed bytes");
  const r = await verifyCarrier(built.bytes);
  assert.notEqual(r.verdict, "FALSE", r.reasons.join("; "));
  for (const id of ["spec.pin", "tree.root", "tree.member", "bytes.digest", "proof.fused", "proof.signature", "floor.binding", "floor.header"]) assert.equal(claim(r, id)?.result, "TRUE", `${id}: ${claim(r, id)?.detail}`);
  assert.equal(r.verdict, "UNDETERMINED", "the stub's proof carries no attestation: no image is established");
  // The committed bytes in hand build the same file.
  const again = await assembleMemberCarrier({ fileBytes: p.inner.slice(), fileName: "note.txt", proof: t.made.proof, rootDocument: t.tree.rootDocument, commitment: t.tree.commitment, evidence, parts: t.parts });
  assert.equal(bytesToHex(again.bytes), bytesToHex(built.bytes));
});

test("a multi-member tree: each member gets its own file (placed photo, placed text, a photo kept as is)", async () => {
  const files = [
    { name: "a.png", bytes: PNG(300) },
    { name: "b.txt", bytes: utf8("the second member\n") },
    { name: "c.jpg", bytes: JPEG(200), asIs: true },
  ];
  const t = await siteTree(files);
  assert.equal(t.tree.count, 3);
  const want: Record<string, { placement: string; name: string; covers: string }> = {
    "a.png": { placement: "trailer/1", name: "a.bitgraph.png", covers: "content" },
    "b.txt": { placement: "container/2", name: "b.txt.bitgraph.tar", covers: "content" },
    "c.jpg": { placement: "as-is", name: "c.bitgraph.jpg", covers: "record" },
  };
  for (const f of files) {
    const { evidence } = t.memberOf(f.name);
    const built = await assembleMemberCarrier({ fileBytes: f.bytes, fileName: f.name, proof: t.made.proof, rootDocument: t.tree.rootDocument, commitment: t.tree.commitment, evidence, parts: t.parts });
    assert.equal(built.placement, want[f.name]!.placement, f.name);
    assert.equal(built.fileName, want[f.name]!.name);
    assert.equal(built.floorCovers, want[f.name]!.covers);
    const r = await verifyCarrier(built.bytes);
    assert.notEqual(r.verdict, "FALSE", `${f.name}: ${r.reasons.join("; ")}`);
    assert.equal(r.member?.index, evidence.index);
    assert.equal(r.member?.count, 3);
    assert.equal(claim(r, "proof.fused")?.result, f.asIs ? "NOT_CARRIED" : "TRUE", f.name);
    if (f.name === "a.png") assert.deepEqual([...built.bytes.subarray(0, 8)], [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], "a BitGraphed PNG still opens as a PNG");
  }
});

test("refused before a block is written: the wrong file, another member's evidence, a kind of file a block would break", async () => {
  const files = [{ name: "a.png", bytes: PNG(120) }, { name: "b.svg", bytes: utf8("<svg xmlns=\"http://www.w3.org/2000/svg\"/>"), asIs: true }];
  const t = await siteTree(files);
  const a = t.memberOf("a.png"), b = t.memberOf("b.svg");
  const base = { proof: t.made.proof, rootDocument: t.tree.rootDocument, commitment: t.tree.commitment, parts: t.parts };
  await assert.rejects(assembleMemberCarrier({ ...base, fileBytes: PNG(121), fileName: "a.png", evidence: a.evidence }), /not the tree member its evidence names/);
  await assert.rejects(assembleMemberCarrier({ ...base, fileBytes: a.bytes, fileName: "a.png", evidence: b.evidence }), /not the tree member its evidence names/);
  await assert.rejects(assembleMemberCarrier({ ...base, fileBytes: b.bytes, fileName: "b.svg", evidence: b.evidence }), /a proof block after its end would break its kind of file/);
  const bent: TreeMemberEvidence = { ...a.evidence, path: a.evidence.path.map((h) => (h[0] === "0" ? "1" : "0") + h.slice(1)) };
  await assert.rejects(assembleMemberCarrier({ ...base, fileBytes: a.bytes, fileName: "a.png", evidence: bent }), /does not verify against this proof/);
  // The committed bytes come only from the file and the leaf: an original kept as is is its own committed bytes, a stranger is none.
  assert.equal(memberCommittedBytes(PNG(5), a.evidence, t.tree.commitment), null);
  assert.equal(bytesToHex(memberCommittedBytes(b.bytes, b.evidence, t.tree.commitment)!), bytesToHex(b.bytes));
});
