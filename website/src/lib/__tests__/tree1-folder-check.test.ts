/**
 * The drop's export/1 check (folder-check.ts): a dropped export is found in a
 * drop by its content, then checked against the files it covers in the same
 * drop with the published verifier. One file's export with its file, the
 * owner's export with every file, an export alone, a file that is not the
 * member, and SPEC.md beside it. The owner's export is checked once without a
 * file and each file is placed by the list; the claims that produces must be
 * the very claims verifyExport gives for that file, which is pinned here.
 * Also run against the spec's own published vectors (spec/vectors/).
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { bytesToBase64, verifyExport, type BitGraphExport, type ExportClaim } from "@mikeargento/bitgraph-verify";
import { checkTreeExports, readTreeExports, type DroppedExport } from "../folder-check.ts";
import { makeTree, type TreeInput } from "../fuse-tree-make.ts";
import { buildTreeExport, exportJson, fetchTreeEvidence, memberExportName, memberTree, ownerExportName, ownerTree, rootOnlyTree } from "../fuse-tree.ts";
import { makeStub, utf8, digestB64, SPEC_BYTES } from "./tree1-helpers.ts";

const JPEG = (n: number) => new Uint8Array([0xff, 0xd8, 0xff, 0xe0, ...Array.from({ length: n }, (_, i) => (i * 11 + 1) & 0xff)]);
const asFile = (name: string, bytes: Uint8Array, type = "") => new File([bytes.slice()], name, { type });
const withDigests = (files: File[], bytes: Uint8Array[]) => files.map((file, i) => ({ file, digestB64: digestB64(bytes[i]!) }));
const offline = (claims: ExportClaim[]) => claims.filter((c) => c.level === "offline").map((c) => `${c.id}=${c.result}`);

async function madeTree(files: Array<{ name: string; bytes: Uint8Array }>, asIs: readonly string[] = []) {
  const stub = await makeStub();
  const inputs: TreeInput[] = files.map((f) => ({ file: new Blob([f.bytes.slice()]), name: f.name, digestB64: digestB64(f.bytes), placement: null, state: null, ...(asIs.includes(f.name) ? { asIs: true } : {}) }));
  const made = await makeTree(inputs, { transport: { fetch: stub.fetch } });
  const evidence = await fetchTreeEvidence(made.proof, { fetch: stub.fetch });
  return { stub, made, evidence };
}

test("readTreeExports finds export/1 files by content, small or large, and leaves every other file in the drop", async () => {
  const { made, evidence } = await madeTree([{ name: "a.txt", bytes: utf8("a\n") }]);
  const built = await buildTreeExport(made.proof, memberTree(made.rootDocument, made.evidenceOf(made.members[0]!.leafIndex)), evidence);
  const text = exportJson(built.exp);
  // A large owner's export is recognised from its first bytes: buildExport writes the format line first.
  const padded = text.replace('"format": "bitgraph-export/1",', `"format": "bitgraph-export/1",\n  "pad": "${"x".repeat(3 * 1024 * 1024)}",`);
  const files = [
    asFile("a.txt.bitgraph.json", utf8(text)),
    asFile("big.bitgraph.json", utf8(padded)),
    asFile("proof.json", utf8(JSON.stringify(made.proof))),
    asFile("notes.json", utf8('{"format":"something else"}')),
    asFile("photo.jpg", JPEG(10)),
    asFile("export-without-extension", utf8(text), "application/json"),
  ];
  const r = await readTreeExports(files);
  assert.deepEqual(r.exports.map((e) => e.file.name), ["a.txt.bitgraph.json", "big.bitgraph.json", "export-without-extension"]);
  assert.deepEqual(r.rest.map((f) => f.name), ["proof.json", "notes.json", "photo.jpg"]);
});

test("one file's export with its file: the file is checked against its leaf, covered, and SPEC.md beside it is recognised", async () => {
  const notes = utf8("the notes\n");
  const { made, evidence } = await madeTree([{ name: "notes.txt", bytes: notes }]);
  const built = await buildTreeExport(made.proof, memberTree(made.rootDocument, made.evidenceOf(made.members[0]!.leafIndex)), evidence);
  const exportFile = asFile(memberExportName("notes.txt"), utf8(exportJson(built.exp)));
  const { exports } = await readTreeExports([exportFile]);
  const drop = [asFile("notes.txt", notes), asFile("SPEC.md", SPEC_BYTES), asFile("other.txt", utf8("other"))];
  const r = await checkTreeExports(exports, withDigests(drop, [notes, SPEC_BYTES, utf8("other")]));
  assert.equal(r.rows.length, 1);
  const row = r.rows[0]!;
  assert.equal(row.scope, "file");
  assert.equal(row.file, drop[0]);
  assert.equal(row.member?.index, 0);
  assert.equal(row.member?.count, 1);
  assert.equal(row.count, 1);
  assert.equal(row.floorCovers, "content");
  assert.equal(row.spec, "pinned");
  assert.equal(row.times.floor?.blockNumber, 25_100_000);
  assert.equal(row.ceiling, "pending");
  assert.equal(row.settlement, "pending");
  assert.ok(row.evidence, "the evidence goes with the row, for the proof page");
  // Every claim but the test key's missing attestation holds; the verdict says so.
  assert.equal(row.verdict, "FALSE");
  assert.ok(row.problems.every((p) => /attestation|AWS/i.test(p)), row.problems.join("\n"));
  assert.ok(row.claims.some((c) => c.id === "bytes.member" && c.result === "TRUE"));
  // Covered: never offered as new. SPEC.md too. Strangers stay in the drop.
  assert.ok(r.covered.has(drop[0]!));
  assert.ok(r.specFiles.has(drop[1]!));
  assert.ok(!r.covered.has(drop[2]!) && !r.specFiles.has(drop[2]!));
});

test("the owner's export with its files: each file placed by the list, the claims identical to verifyExport's for that file", async () => {
  const files = [
    { name: "photo.jpg", bytes: JPEG(12) },
    { name: "notes.txt", bytes: utf8("owner's notes\n") },
    { name: "empty.bin", bytes: new Uint8Array(0) },
    { name: "kept.bin", bytes: utf8("kept exactly as it is: over the test cap\n") },
  ];
  const { made, evidence } = await madeTree(files, ["kept.bin"]);
  assert.deepEqual(made.members.map((m) => m.placement), ["trailer/1", "container/2", "container/2", "as-is"]);
  const built = await buildTreeExport(made.proof, ownerTree(made.rootDocument, made.leavesBytes, made.names), evidence);
  const owner: DroppedExport = { file: asFile(ownerExportName(made.proof), utf8(exportJson(built.exp))), exp: built.exp };
  const drop = files.map((f) => asFile(f.name, f.bytes));
  const stranger = asFile("stranger.txt", utf8("not in the tree"));
  const r = await checkTreeExports([owner], [...withDigests(drop, files.map((f) => f.bytes)), { file: stranger, digestB64: digestB64(utf8("not in the tree")) }]);
  assert.equal(r.rows.length, 4);
  for (const row of r.rows) {
    const k = files.findIndex((f) => f.name === row.fileName);
    assert.ok(k >= 0, row.fileName ?? "");
    assert.equal(row.scope, "file");
    assert.equal(row.member?.count, 4);
    assert.equal(row.floorCovers, files[k]!.name === "kept.bin" ? "record" : "content", row.fileName ?? "");
    // The merged claims are exactly verifyExport's own for this file.
    const direct = await verifyExport(built.exp, { bytes: files[k]!.bytes });
    assert.deepEqual(row.claims, direct.claims, `${row.fileName}: claims`);
    assert.equal(row.verdict, direct.verdict, `${row.fileName}: verdict`);
    assert.deepEqual(row.member, direct.member ? { index: direct.member.index, count: direct.member.count, placement: direct.member.placement } : null);
  }
  for (const f of drop) assert.ok(r.covered.has(f), f.name);
  assert.ok(!r.covered.has(stranger));
  assert.ok(offline(r.rows[0]!.claims).includes("tree.leaves=TRUE"));
});

test("an export alone: one row about the proof and its times, the file not carried; a file that is not the member is not covered", async () => {
  const { made, evidence } = await madeTree([{ name: "x.txt", bytes: utf8("x") }, { name: "y.txt", bytes: utf8("y") }]);
  const member = made.members[0]!;
  const one = await buildTreeExport(made.proof, memberTree(made.rootDocument, made.evidenceOf(member.leafIndex)), evidence);
  const alone = await checkTreeExports([{ file: asFile("x.txt.bitgraph.json", utf8(exportJson(one.exp))), exp: one.exp }], []);
  assert.equal(alone.rows.length, 1);
  assert.equal(alone.rows[0]!.scope, "export");
  assert.equal(alone.rows[0]!.member?.index, member.leafIndex, "the export's own leaf is placed, without the file");
  assert.equal(alone.rows[0]!.floorCovers, null);
  assert.ok(alone.rows[0]!.claims.some((c) => c.id === "bytes.member" && c.result === "NOT_CARRIED"));
  // The other member's file is not this export's: not covered, so it stays a file in the drop.
  const wrong = await checkTreeExports([{ file: asFile("x.txt.bitgraph.json", utf8(exportJson(one.exp))), exp: one.exp }], withDigests([asFile("y.txt", utf8("y"))], [utf8("y")]));
  assert.equal(wrong.rows[0]!.scope, "export");
  assert.equal(wrong.covered.size, 0);
  // An owner's export with none of its files: the same, said for the list.
  const owner = await buildTreeExport(made.proof, ownerTree(made.rootDocument, made.leavesBytes, made.names), evidence);
  const ownerAlone = await checkTreeExports([{ file: asFile("o.bitgraph.json", utf8(exportJson(owner.exp))), exp: owner.exp }], []);
  assert.equal(ownerAlone.rows[0]!.scope, "export");
  assert.equal(ownerAlone.rows[0]!.count, 2);
  assert.match(ownerAlone.rows[0]!.claims.find((c) => c.id === "tree.member")!.detail, /no file of this tree/);
  // The root document alone (a tree not made in this browser).
  const root = await buildTreeExport(made.proof, rootOnlyTree(made.rootDocument), evidence);
  const rootAlone = await checkTreeExports([{ file: asFile("r.bitgraph.json", utf8(exportJson(root.exp))), exp: root.exp }], []);
  assert.ok(rootAlone.rows[0]!.claims.some((c) => c.id === "tree.root" && c.result === "TRUE"));
});

test("a tampered export does not verify, and a file edited after the fact is not the member", async () => {
  const bytes = utf8("the original text\n");
  const { made, evidence } = await madeTree([{ name: "t.txt", bytes }]);
  const built = await buildTreeExport(made.proof, memberTree(made.rootDocument, made.evidenceOf(made.members[0]!.leafIndex)), evidence);
  const forged = JSON.parse(exportJson(built.exp)) as BitGraphExport;
  forged.tree.rootDocument = forged.tree.rootDocument.replace(/^./, (c) => (c === "6" ? "7" : "6"));
  const r1 = await checkTreeExports([{ file: asFile("t.txt.bitgraph.json", utf8(JSON.stringify(forged))), exp: forged }], withDigests([asFile("t.txt", bytes)], [bytes]));
  assert.equal(r1.rows[0]!.verdict, "FALSE");
  assert.ok(r1.rows[0]!.claims.some((c) => c.id === "tree.root" && c.result === "FALSE"));
  // A file with the right name and other bytes is simply not found by the leaf's digests.
  const edited = utf8("the original text, edited\n");
  const r2 = await checkTreeExports([{ file: asFile("t.txt.bitgraph.json", utf8(exportJson(built.exp))), exp: built.exp }], withDigests([asFile("t.txt", edited)], [edited]));
  assert.equal(r2.rows[0]!.scope, "export");
  assert.equal(r2.covered.size, 0);
});

test("the spec's published vectors: one member's export and the owner's export check with their files exactly as the vector says", async () => {
  const vec = JSON.parse(readFileSync(new URL("../../../../spec/vectors/export-1.json", import.meta.url), "utf8")) as { memberExport: BitGraphExport; ownerExport: BitGraphExport; memberFileHex: string; expectedClaims: Record<string, string> };
  const tree = JSON.parse(readFileSync(new URL("../../../../spec/vectors/tree-1.json", import.meta.url), "utf8")) as { files: Array<{ name: string; originalHex: string }> };
  const hex = (h: string) => Uint8Array.from((h.match(/../g) ?? []).map((x) => parseInt(x, 16)));
  const memberBytes = hex(vec.memberFileHex);
  const one = await checkTreeExports([{ file: asFile("hello.txt.bitgraph.json", utf8(JSON.stringify(vec.memberExport))), exp: vec.memberExport }], withDigests([asFile("hello.txt", memberBytes)], [memberBytes]));
  const got = Object.fromEntries(one.rows[0]!.claims.filter((c) => c.level === "offline").map((c) => [c.id, c.result]));
  for (const [id, want] of Object.entries(vec.expectedClaims)) assert.equal(got[id], want, `vector claim ${id}`);
  // The owner's export places all five files, the as-is one with no floor.
  const files = tree.files.map((f) => ({ name: f.name, bytes: hex(f.originalHex) }));
  const owner = await checkTreeExports([{ file: asFile("owner.bitgraph.json", utf8(JSON.stringify(vec.ownerExport))), exp: vec.ownerExport }], withDigests(files.map((f) => asFile(f.name, f.bytes)), files.map((f) => f.bytes)));
  assert.equal(owner.rows.length, 5);
  for (const row of owner.rows) {
    assert.ok(row.claims.some((c) => c.id === "bytes.member" && c.result === "TRUE"), `${row.fileName}`);
    assert.equal(row.floorCovers, row.fileName === "as-is.bin" ? "record" : "content", `${row.fileName}`);
  }
  assert.equal(bytesToBase64(memberBytes).length > 0, true);
});
