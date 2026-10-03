/**
 * The hosted MCP under an enclave that returns its floor with the position
 * (v9 and later), offline: a stub boundary signs with a test key and runs the
 * site's real commit-route checks. Every token then carries the floor its
 * commitment bound, and the commit makes tree/1: one file a tree of one,
 * files opened together one tree, each coming back as ONE export/1 that
 * checks with the file alone. And the earlier set path, given an anchored
 * token, now commits under the marker and floor its manifest was built with
 * (it sent the fuse/1 name without the floor, which the route refused).
 */
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { sha256 } from "@noble/hashes/sha256";
import { bytesToBase64, computeSlotCommitment2, verifyExport, verifyTreeMember } from "@mikeargento/bitgraph-verify";
import { assemble, commitHostedSet, commitHostedTree, openHosted, openHostedSet, treeExportFor, type OpenInput, type SetEntry } from "../mcp/fuse-hosted.ts";
import { makeStub, utf8, type Stub } from "./tree1-helpers.ts";

const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
let stub: Stub;
const realFetch = globalThis.fetch;

before(async () => {
  stub = await makeStub();
  process.env.BITGRAPH_API_URL = "https://stub.test";
  globalThis.fetch = stub.fetch;
});

after(() => {
  globalThis.fetch = realFetch;
  delete process.env.BITGRAPH_API_URL;
});

const fileInput = (name: string, bytes: Uint8Array): OpenInput => ({ name, size: bytes.length, digestB64: bytesToBase64(sha256(bytes)), head: bytes.subarray(0, Math.min(16, bytes.length)) });
const originals = [
  { name: "a.png", bytes: new Uint8Array([...PNG, 1, 2, 3, 4, 5]) },
  { name: "b.txt", bytes: utf8("plain text\n") },
  { name: "c.pdf", bytes: utf8("%PDF-1.7\nsomething\n") },
];
const claim = (r: { claims: Array<{ id: string; result: string }> }, id: string) => r.claims.find((c) => c.id === id)?.result;

test("files opened together under a floor commit as ONE tree/1, and the owner's export checks every file with the file alone", async () => {
  const opened = await openHostedSet(originals.map((o) => fileInput(o.name, o.bytes)));
  for (const m of opened.members) assert.equal(m.state.anchor?.blockHash, stub.floor.blockHash, "every token carries the floor");
  const commitment = computeSlotCommitment2(opened.slot, stub.floor.blockHash);
  assert.equal(opened.commitmentB64, bytesToBase64(commitment), "the recipes carry commitment/2");
  const built = opened.members.map((m, i) => assemble(m.recipe, originals[i]!.bytes));
  const entries: SetEntry[] = opened.members.map((m, i) => ({ state: m.state, artifactDigestB64: bytesToBase64(sha256(built[i]!)) }));
  const commitsBefore = stub.commits.length;
  const t = await commitHostedTree(entries);
  assert.equal(stub.commits.length - commitsBefore, 1, "one commit for the tree");
  const body = stub.commits[stub.commits.length - 1]!;
  assert.deepEqual(body.attribution, t.proof.attribution);
  assert.equal((t.proof.attribution as { title: string }).title, "tree/1");
  assert.equal((body.anchor as { blockHash: string }).blockHash, stub.floor.blockHash, "the floor the commitment bound goes with it");
  assert.equal(t.count, 3);
  // Every file's own evidence places it, from its original and from the new file the caller built.
  for (let i = 0; i < originals.length; i++) {
    const a = await verifyTreeMember({ proof: t.proof as never, bytes: originals[i]!.bytes, member: t.evidence[i] });
    assert.equal(a.category, "TREE_MEMBER_FROM_ORIGIN", `${originals[i]!.name}: ${a.reason}`);
    const b = await verifyTreeMember({ proof: t.proof as never, bytes: built[i]!, member: t.evidence[i] });
    assert.equal(b.category, "TREE_MEMBER_DIRECT", `${originals[i]!.name}: ${b.reason}`);
  }
  // The caller keeps one export: the owner's, with every leaf and name.
  const ex = await treeExportFor(t);
  assert.match(ex.name, /^bitgraph-\d+\.bitgraph\.json$/);
  assert.deepEqual(ex.export.tree.names?.slice().sort(), originals.map((o) => o.name).sort());
  for (const o of originals) {
    const r = await verifyExport(ex.export, { bytes: o.bytes });
    for (const id of ["proof.signature", "spec.pin", "tree.root", "tree.leaves", "tree.member", "bytes.member", "floor.header"]) assert.equal(claim(r, id), "TRUE", `${o.name} ${id}`);
    assert.equal(claim(r, "ceiling.base"), "NOT_CARRIED", "a fresh tree's ceiling is pending, not failed");
  }
});

test("one file opened alone under a floor is a tree of one, and its export is that file's own", async () => {
  const o = originals[1]!;
  const opened = await openHosted(fileInput(o.name, o.bytes));
  const builtFile = assemble(opened.recipe, o.bytes);
  const t = await commitHostedTree([{ state: opened.state, artifactDigestB64: bytesToBase64(sha256(builtFile)) }]);
  assert.equal(t.count, 1);
  assert.deepEqual(t.evidence[0]!.path, []);
  const ex = await treeExportFor(t);
  assert.equal(ex.name, "b.txt.bitgraph.json");
  assert.ok(ex.export.tree.member, "a member's export, not the owner's");
  const r = await verifyExport(ex.export, { bytes: o.bytes });
  assert.equal(claim(r, "bytes.member"), "TRUE");
  assert.equal(r.member?.count, 1);
});

test("the earlier set path, given an anchored token, commits under the fuse/2 name with the floor its manifest bound, and the route accepts it", async () => {
  const opened = await openHostedSet(originals.slice(0, 2).map((o) => fileInput(o.name, o.bytes)));
  const entries: SetEntry[] = opened.members.map((m, i) => ({ state: m.state, artifactDigestB64: bytesToBase64(sha256(assemble(m.recipe, originals[i]!.bytes))) }));
  const c = await commitHostedSet(entries);
  const body = stub.commits[stub.commits.length - 1]!;
  assert.equal((body.attribution as { name: string }).name, "bitgraph-fuse/2");
  assert.equal((body.anchor as { blockHash: string }).blockHash, stub.floor.blockHash);
  assert.equal(c.count, 2);
});

test("a tree refuses tokens from different positions or different floors before anything is sent", async () => {
  const a = await openHosted(fileInput("x.txt", utf8("x")));
  const b = await openHosted(fileInput("y.txt", utf8("y")));
  const before = stub.commits.length;
  await assert.rejects(commitHostedTree([
    { state: a.state, artifactDigestB64: bytesToBase64(sha256(assemble(a.recipe, utf8("x")))) },
    { state: b.state, artifactDigestB64: bytesToBase64(sha256(assemble(b.recipe, utf8("y")))) },
  ]), /same position/);
  const noFloor = { ...a.state, anchor: undefined };
  await assert.rejects(commitHostedTree([{ state: noFloor, artifactDigestB64: bytesToBase64(sha256(utf8("x"))) }]), /floor/);
  assert.equal(stub.commits.length, before);
});

test("the commit's words say tree for a tree and name its export (a set keeps its words: fuse-hosted.test.ts)", async () => {
  const { renderCommitMarkdown } = await import("../mcp/fuse-hosted.ts");
  const md = renderCommitMarkdown(
    [
      { name: "a.png", origin_digest: "d1", artifact_digest: "f1", outcome: "fused", placement: "trailer/1", slot_counter: "9", counter: "10", epoch: "e", fused_name: "a.fused.png", frame_name: "a.png.bitgraph-fuse.json", proof_url: "https://bitgraph.ing/proof/r1?counter=10", positions: [], recovered: false, error: null, member: 1, member_count: 2, set_digest: "r1", export_name: "bitgraph-10.bitgraph.json" },
      { name: "b.txt", origin_digest: "d2", artifact_digest: "f2", outcome: "fused", placement: "container/2", slot_counter: "9", counter: "10", epoch: "e", fused_name: "b.fused.tar", frame_name: "b.txt.bitgraph-fuse.json", proof_url: "https://bitgraph.ing/proof/r1?counter=10", positions: [], recovered: false, error: null, member: 2, member_count: 2, set_digest: "r1", export_name: "bitgraph-10.bitgraph.json" },
    ],
    [{ slot_counter: "9", counter: "10", epoch: "e", count: 2, artifact_digest: "r1", proof_url: "https://bitgraph.ing/proof/r1?counter=10", manifest_echoed: true, recovered: false, tree: true, export_name: "bitgraph-10.bitgraph.json" }],
  );
  assert.match(md, /^2 fused as one tree at #10 \(tree of 2\)\./);
  assert.match(md, /- tree · slot #9 → #10 · tree of 2 · export bitgraph-10\.bitgraph\.json/);
  assert.match(md, /exports\[\]/);
  assert.match(md, /SPEC\.md/);
  assert.doesNotMatch(md, /sets\[\]\.proof/, "no set wording for a tree");
  const solo = renderCommitMarkdown([{ name: "c.txt", origin_digest: "d3", artifact_digest: "f3", outcome: "fused", placement: "container/2", slot_counter: "11", counter: "12", epoch: "e", fused_name: "c.fused.tar", frame_name: "c.txt.bitgraph-fuse.json", proof_url: "u", positions: [], recovered: false, error: null, export_name: "c.txt.bitgraph.json" }]);
  assert.match(solo, /- fused · c\.txt → c\.fused\.tar \(container\/2\) · export c\.txt\.bitgraph\.json/);
  assert.doesNotMatch(solo, /Frame/, "a tree of one has an export, not a Frame");
});
