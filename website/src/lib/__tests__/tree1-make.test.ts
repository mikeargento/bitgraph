/**
 * tree/1 making on the site, end to end and offline: the real maker
 * (fuse-tree-make.ts) against a stub boundary that runs the real commit-route
 * checks, then every member read back with the published verifier, then the
 * exports a holder keeps (one file's and the owner's) built with the real
 * export builder and checked with verifyExport. Negative cases included: no
 * floor, a changed file, a lost reply, a boundary that rewrites the root.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  LEAF_AS_IS,
  bytesToHex,
  committedBytesFor,
  decodeTreeLeaves,
  verifyExport,
  verifyTreeLeaves,
  verifyTreeMember,
  type BitGraphProof,
} from "@mikeargento/bitgraph-verify";
import { makeTree, planTrees, SITE_MAX_TREE_LEAVES, type TreeInput } from "../fuse-tree-make.ts";
import { bindTree, buildTreeExport, fetchTreeEvidence, fetchSpecFor, memberTree, ownerTree, treeOfOneEvidence, TREE_KEY } from "../fuse-tree.ts";
import { hashBlob } from "../scan-hash.ts";
import { makeStub, unreadable, utf8, digestB64, SPEC_BYTES } from "./tree1-helpers.ts";

const JPEG = (n: number) => new Uint8Array([0xff, 0xd8, 0xff, 0xe0, ...Array.from({ length: n }, (_, i) => (i * 13 + 5) & 0xff)]);
const PNG = (n: number) => new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, ...Array.from({ length: n }, (_, i) => (i * 7 + 3) & 0xff)]);

/** An input the way the camera hands one over: digest, and the scan's placement and state when it has them. */
async function scanned(name: string, bytes: Uint8Array, withState = true): Promise<TreeInput> {
  const blob = new Blob([bytes.slice()]);
  if (!withState) return { file: blob, name, digestB64: digestB64(bytes), placement: null, state: null };
  const s = await hashBlob(blob);
  assert.equal(s.digestB64, digestB64(bytes));
  return { file: blob, name, digestB64: s.digestB64, placement: s.placement, state: s.state };
}

const claim = (r: { claims: Array<{ id: string; result: string }> }, id: string) => r.claims.find((c) => c.id === id)?.result;

test("one file is a tree of one: one allocation, one commit, the root is its leaf, and the file alone shows it", async () => {
  const stub = await makeStub();
  const original = utf8("a single file, a tree of one\n");
  const made = await makeTree([await scanned("note.txt", original)], { transport: { fetch: stub.fetch } });
  assert.deepEqual(stub.calls.filter((p) => p.startsWith("/api/fuse/")), ["/api/fuse/allocate", "/api/fuse/commit"]);
  assert.equal(made.count, 1);
  assert.equal(made.members.length, 1);
  assert.equal(made.members[0]!.placement, "container/2", "text goes in a container, the original first");
  assert.equal(made.evidenceOf(made.members[0]!.leafIndex).path.length, 0);
  assert.equal(made.echoed, true);
  // The commit the route saw: the tree/1 marker, the root document, the floor the commitment bound.
  const body = stub.commits[0]!;
  assert.deepEqual(body.attribution, made.proof.attribution);
  assert.deepEqual(body.metadata, { [TREE_KEY]: bytesToHex(made.rootDocument) });
  assert.equal((body.anchor as { blockHash: string }).blockHash, stub.floor.blockHash);
  // A verifier reads it from the original and from the committed bytes.
  const fromOrigin = await verifyTreeMember({ proof: made.proof, bytes: original, member: made.evidenceOf(made.members[0]!.leafIndex) });
  assert.equal(fromOrigin.category, "TREE_MEMBER_FROM_ORIGIN", fromOrigin.reason);
  const bound = bindTree(made.proof);
  assert.ok(bound.ok, bound.ok ? "" : bound.reason);
  const committed = committedBytesFor(0x03, original, bound.tree.commitment);
  assert.equal((await verifyTreeMember({ proof: made.proof, bytes: committed, member: made.evidenceOf(made.members[0]!.leafIndex) })).category, "TREE_MEMBER_DIRECT");
  // A tree of one needs no evidence beyond the file: the page rebuilds it from either form.
  assert.deepEqual(await treeOfOneEvidence(bound.tree, original), made.evidenceOf(made.members[0]!.leafIndex));
  assert.deepEqual(await treeOfOneEvidence(bound.tree, committed), made.evidenceOf(made.members[0]!.leafIndex));
  assert.equal(await treeOfOneEvidence(bound.tree, utf8("a different file\n")), null);
});

test("files across the placements: a saved state is finished, an unscanned file is placed from its bytes, an old scan's container/1 is decided again (never made new), a file over the cap is a leaf as is and is never read, a duplicate is one leaf", async () => {
  const stub = await makeStub();
  const jpeg = JPEG(4000);
  const png = PNG(70);
  const text = utf8("plain text, scanned\n");
  const pdf = utf8("%PDF-1.7\nnot scanned, so its placement comes from its bytes\n");
  const old = utf8("placed by a scan that still said container/1\n");
  const big = unreadable(4096);
  const bigDigest = digestB64(utf8("pretend these are the 4096 bytes of a file over the cap"));
  const inputs: TreeInput[] = [
    await scanned("photo.jpg", jpeg),
    await scanned("icon.png", png),
    await scanned("notes.txt", text),
    await scanned("paper.pdf", pdf, false),
    { file: new Blob([old.slice()]), name: "old.txt", digestB64: digestB64(old), placement: "container/1", state: null },
    { file: big, name: "video.mov", digestB64: bigDigest, placement: null, state: null },
    await scanned("photo copy.jpg", jpeg),
  ];
  const phases = new Set<string>();
  const made = await makeTree(inputs, { transport: { fetch: stub.fetch }, maxFuseBytes: 4096 - 1, onProgress: (p) => phases.add(p.phase) });
  assert.deepEqual([...phases].sort(), ["commit", "fuse", "hash", "tree", "verify"]);
  assert.equal(made.count, 6, "seven inputs, six distinct files");
  assert.equal(made.members.length, 7);
  assert.deepEqual(made.members.map((m) => m.placement), ["trailer/1", "trailer/1", "container/2", "container/2", "container/2", "as-is", "trailer/1"]);
  assert.deepEqual(made.members.map((m) => m.code), [0x01, 0x01, 0x03, 0x03, 0x03, 0x00, 0x01], "container/1 (0x02) is never made");
  assert.equal(made.members[0]!.leafIndex, made.members[6]!.leafIndex, "the same bytes twice are one leaf");
  const asIs = made.members[5]!;
  assert.equal(asIs.code, LEAF_AS_IS);
  assert.equal(asIs.artifactDigestB64, bigDigest, "an as-is leaf's artifact is the file's own digest");
  // The list the owner keeps rebuilds the committed root, sorted and unique.
  const bound = bindTree(made.proof);
  assert.ok(bound.ok);
  assert.deepEqual(verifyTreeLeaves(bound.tree.rootDocument, made.leavesBytes), { ok: true, count: 6 });
  assert.equal(decodeTreeLeaves(made.leavesBytes)!.length, 6);
  assert.deepEqual(made.names.slice().sort(), ["icon.png", "notes.txt", "old.txt", "paper.pdf", "photo.jpg", "video.mov"]);
  // Every member read or finished verifies from its original with its own evidence.
  const originals = [jpeg, png, text, pdf, old];
  for (let i = 0; i < originals.length; i++) {
    const r = await verifyTreeMember({ proof: made.proof, bytes: originals[i]!, member: made.evidenceOf(made.members[i]!.leafIndex) });
    assert.equal(r.category, "TREE_MEMBER_FROM_ORIGIN", `${inputs[i]!.name}: ${r.reason}`);
    assert.equal(r.floorCovers, "content");
  }
  // Another member's evidence does not cover a file.
  const wrong = await verifyTreeMember({ proof: made.proof, bytes: png, member: made.evidenceOf(made.members[0]!.leafIndex) });
  assert.notEqual(wrong.category, "TREE_MEMBER_FROM_ORIGIN");
});

test("as is over the cap: a tree of one large file is made without reading it, and verifies as is with no floor", async () => {
  const stub = await makeStub();
  const bytes = utf8("the whole file, kept exactly as it is\n");
  const made = await makeTree([{ file: unreadable(bytes.length), name: "huge.bin", digestB64: digestB64(bytes), placement: null, state: null }], { transport: { fetch: stub.fetch }, maxFuseBytes: 8 });
  assert.equal(made.members[0]!.code, LEAF_AS_IS);
  const r = await verifyTreeMember({ proof: made.proof, bytes, member: made.evidenceOf(made.members[0]!.leafIndex) });
  assert.equal(r.category, "TREE_MEMBER_AS_IS", r.reason);
  assert.equal(r.floorCovers, "record");
  // The file alone rebuilds its leaf, kept as is.
  const bound = bindTree(made.proof);
  assert.ok(bound.ok);
  assert.deepEqual(await treeOfOneEvidence(bound.tree, bytes), made.evidenceOf(0));
});

test("a photo made alone is a trailer/1 tree of one, and the photo alone shows it", async () => {
  const stub = await makeStub();
  const photo = JPEG(2000);
  const made = await makeTree([await scanned("photo.jpg", photo)], { transport: { fetch: stub.fetch } });
  assert.equal(made.members[0]!.placement, "trailer/1");
  const bound = bindTree(made.proof);
  assert.ok(bound.ok);
  const ev = await treeOfOneEvidence(bound.tree, photo);
  assert.deepEqual(ev, made.evidenceOf(0));
  assert.equal((await verifyTreeMember({ proof: made.proof, bytes: photo, member: ev })).category, "TREE_MEMBER_FROM_ORIGIN");
});

test("no floor with the position, a file that changed after its scan, and a boundary that rewrites the root document: refused, and nothing is called made", async () => {
  const noFloor = await makeStub({ noAnchor: true });
  await assert.rejects(makeTree([await scanned("a.txt", utf8("a"))], { transport: { fetch: noFloor.fetch } }), (e: { code?: string; message?: string }) => e.code === "allocate-failed" && /floor/.test(e.message ?? ""));
  assert.equal(noFloor.commits.length, 0);

  const changed = await makeStub();
  const input = await scanned("b.txt", utf8("b, as scanned"), false);
  input.file = new Blob([utf8("b, edited since")]);
  await assert.rejects(makeTree([input], { transport: { fetch: changed.fetch } }), (e: { code?: string }) => e.code === "bad-input");
  assert.equal(changed.commits.length, 0, "the change is caught before the commit");

  const tamper = await makeStub({ metadata: "tamper" });
  await assert.rejects(makeTree([await scanned("c.txt", utf8("c"))], { transport: { fetch: tamper.fetch } }), (e: { code?: string; status?: number }) => e.code === "commit-refused" && e.status === 502);
});

test("a boundary that drops the metadata: the root document is attached and the proof still binds", async () => {
  const stub = await makeStub({ metadata: "drop" });
  const made = await makeTree([await scanned("d.txt", utf8("d"))], { transport: { fetch: stub.fetch } });
  // The route attaches it (reconcileTreeMetadata); the maker would too.
  assert.equal((made.proof as { metadata?: Record<string, unknown> }).metadata?.[TREE_KEY], bytesToHex(made.rootDocument));
  assert.ok(bindTree(made.proof).ok);
});

test("a lost reply is read back by digest under this position, never another", async () => {
  const stub = await makeStub({ loseFirstReply: true });
  const made = await makeTree([await scanned("e.txt", utf8("e"))], { transport: { fetch: stub.fetch, recoveryDelayMs: 1 } });
  assert.equal(made.recovered, true);
  assert.equal(stub.minted.length, 1);
  assert.equal(made.proof.commit.nonceB64, stub.minted[0]!.commit.nonceB64);
});

test("planTrees: files with a state and files as is cost no read; a drop past the cap or the budget becomes consecutive trees", () => {
  const MB = 1024 * 1024;
  assert.deepEqual(planTrees([{ size: 10 * MB, stateful: true }, { size: 10 * MB, stateful: true }], 1), [[0, 1]], "stateful files never cut a tree");
  assert.deepEqual(planTrees([{ size: 300 * MB, stateful: false }, { size: 300 * MB, stateful: false }], 1), [[0, 1]], "as-is files are never read");
  assert.deepEqual(planTrees([{ size: 5, stateful: false }, { size: 5, stateful: false }, { size: 5, stateful: false }], 10), [[0, 1], [2]]);
  assert.deepEqual(planTrees(Array.from({ length: 5 }, () => ({ size: 1, stateful: true })), 1, { maxLeaves: 2 }), [[0, 1], [2, 3], [4]]);
  assert.equal(SITE_MAX_TREE_LEAVES, 100_000);
});

test("the exports a holder keeps: one file's and the owner's, filled from the site's routes, check with verifyExport; everything holds but the test key's missing attestation", async () => {
  const stub = await makeStub();
  const files = [
    { name: "photo.jpg", bytes: JPEG(512) },
    { name: "notes.txt", bytes: utf8("notes\n") },
    { name: "empty.txt", bytes: new Uint8Array(0) },
  ];
  const inputs = await Promise.all(files.map((f) => scanned(f.name, f.bytes)));
  const made = await makeTree(inputs, { transport: { fetch: stub.fetch } });
  const src = { fetch: stub.fetch, baseUrl: "" };
  const ev = await fetchTreeEvidence(made.proof as BitGraphProof, src);
  assert.equal(ev.floor?.blockNumber, stub.floor.blockNumber);
  assert.equal(ev.floor?.header, stub.floor.headerHex);
  assert.deepEqual(ev.ceiling, { status: "pending" }, "no ceiling yet is pending, not absent");
  assert.deepEqual(ev.settlement, { status: "pending" });
  assert.ok(ev.notes.some((n) => /ceiling/i.test(n)), "the pending ceiling is said");

  const expected = { format: "TRUE", "proof.signature": "TRUE", "attestation.signature": "FALSE", "spec.pin": "TRUE", "tree.root": "TRUE", "tree.member": "TRUE", "bytes.member": "TRUE", "floor.record": "TRUE", "floor.content": "TRUE", "floor.header": "TRUE", "ceiling.base": "NOT_CARRIED", "ceiling.ethereum": "NOT_CARRIED" };
  // One file's export.
  const m = made.members[1]!;
  const one = await buildTreeExport(made.proof, memberTree(made.rootDocument, made.evidenceOf(m.leafIndex)), ev);
  assert.equal(one.exp.format, "bitgraph-export/1");
  assert.deepEqual(Object.keys(one.exp), ["format", "spec", "proof", "tree", "floor", "ceiling", "settlement"]);
  const r1 = await verifyExport(JSON.stringify(one.exp), { bytes: files[1]!.bytes });
  for (const [id, want] of Object.entries(expected)) assert.equal(claim(r1, id), want, `member export ${id}`);
  assert.equal(r1.times.floor?.blockNumber, stub.floor.blockNumber);
  assert.equal(r1.times.floor?.blockTimestamp, stub.floor.timestamp);
  assert.equal(r1.member?.index, m.leafIndex);
  // A stranger's bytes are not the member.
  const stranger = await verifyExport(one.exp, { bytes: utf8("someone else's notes\n") });
  assert.notEqual(claim(stranger, "bytes.member"), "TRUE");

  // The owner's export: every leaf and name; each file found in the list.
  const owner = await buildTreeExport(made.proof, ownerTree(made.rootDocument, made.leavesBytes, made.names), ev);
  assert.equal(owner.exp.tree.names?.length, 3);
  for (const f of files) {
    const r = await verifyExport(owner.exp, { bytes: f.bytes });
    assert.equal(claim(r, "tree.leaves"), "TRUE", f.name);
    for (const [id, want] of Object.entries(expected)) assert.equal(claim(r, id), want, `owner export ${f.name} ${id}`);
  }

  // SPEC.md is shipped only when its hash is the proof's pin.
  const spec = await fetchSpecFor(made.proof.attribution!.message!, src);
  assert.ok(spec && Buffer.compare(Buffer.from(spec), Buffer.from(SPEC_BYTES)) === 0);
  assert.equal(await fetchSpecFor(digestB64(utf8("another spec")), src), null);
});

test("an export never carries a part BitGraph served wrong: a floor header for another block is left out and said", async () => {
  const stub = await makeStub();
  const made = await makeTree([await scanned("f.txt", utf8("f"))], { transport: { fetch: stub.fetch } });
  const ev = await fetchTreeEvidence(made.proof as BitGraphProof, { fetch: stub.fetch });
  const wrongHeader = { ...ev, floor: { ...ev.floor!, header: ev.floor!.header.replace(/.$/, (c) => (c === "0" ? "1" : "0")) } };
  const built = await buildTreeExport(made.proof, memberTree(made.rootDocument, made.evidenceOf(made.members[0]!.leafIndex)), wrongHeader);
  assert.equal(built.exp.floor, null);
  assert.ok(built.notes.some((n) => /floor/.test(n)));
  const r = await verifyExport(built.exp, { bytes: utf8("f") });
  assert.equal(claim(r, "floor.header"), "NOT_CARRIED");
  assert.equal(claim(r, "bytes.member"), "TRUE");
});
