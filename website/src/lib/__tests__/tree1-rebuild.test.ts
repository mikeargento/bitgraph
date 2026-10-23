/**
 * A whole tree checked from its files (2026-10-07): the real maker makes a
 * tree against the stub boundary, then rebuildTreeFromFiles reads the same
 * files back and must give the signed count and root. Negative cases: a file
 * missing, an extra file, one byte changed, the files of another tree.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { makeTree, rebuildTreeFromFiles, rebuildMatches, type TreeInput } from "../fuse-tree-make.ts";
import { bindTree } from "../fuse-tree.ts";
import { hashBlob } from "../scan-hash.ts";
import { makeStub, utf8 } from "./tree1-helpers.ts";

const JPEG = (n: number) => new Uint8Array([0xff, 0xd8, 0xff, 0xe0, ...Array.from({ length: n }, (_, i) => (i * 13 + 5) & 0xff)]);

function filesOf(entries: Array<[string, Uint8Array]>): File[] {
  return entries.map(([name, bytes]) => new File([bytes.slice()], name));
}

async function inputsOf(files: File[]): Promise<TreeInput[]> {
  const out: TreeInput[] = [];
  for (const f of files) {
    const s = await hashBlob(f);
    out.push({ file: f, name: f.name, digestB64: s.digestB64, placement: s.placement, state: s.state });
  }
  return out;
}

async function madeTree(files: File[]) {
  const stub = await makeStub();
  const made = await makeTree(await inputsOf(files), { transport: { fetch: stub.fetch } });
  const bound = bindTree(made.proof);
  assert.ok(bound.ok, bound.ok ? "" : bound.reason);
  return bound.tree;
}

const set = (): Array<[string, Uint8Array]> => [
  ["a.txt", utf8("first file\n")],
  ["b.txt", utf8("second file\n")],
  ["photo.jpg", JPEG(300)],
  ["c.txt", utf8("third file\n")],
];

test("the whole set of files rebuilds the signed tree: same count, same root", async () => {
  const files = filesOf(set());
  const tree = await madeTree(files);
  const r = await rebuildTreeFromFiles(files, tree.commitment);
  assert.ok(rebuildMatches(r.placed, tree), "the placed reading is the tree the maker signed");
  assert.equal(r.placed!.count, 4);
  assert.equal(rebuildMatches(r.asIs, tree), false, "an as-is reading of placed files is another tree");
});

test("order and duplicates do not matter: shuffled, with one file twice, still the tree", async () => {
  const files = filesOf(set());
  const tree = await madeTree(files);
  const shuffled = [files[3]!, files[0]!, files[2]!, files[1]!, new File([await files[0]!.arrayBuffer()], "a copy.txt")];
  const r = await rebuildTreeFromFiles(shuffled, tree.commitment);
  assert.ok(rebuildMatches(r.placed, tree));
});

test("NEGATIVE: a missing file, an extra file, or one changed byte gives another root", async () => {
  const files = filesOf(set());
  const tree = await madeTree(files);
  const missing = await rebuildTreeFromFiles(files.slice(1), tree.commitment);
  assert.equal(rebuildMatches(missing.placed, tree), false);
  const extra = await rebuildTreeFromFiles([...files, new File([utf8("not in the tree\n")], "x.txt")], tree.commitment);
  assert.equal(rebuildMatches(extra.placed, tree), false);
  const edited = filesOf(set());
  edited[1] = new File([utf8("second file!\n")], "b.txt");
  const changed = await rebuildTreeFromFiles(edited, tree.commitment);
  assert.equal(rebuildMatches(changed.placed, tree), false);
});

test("NEGATIVE: the right files under another position's commitment are not this tree", async () => {
  const files = filesOf(set());
  const tree = await madeTree(files);
  const other = await madeTree(files);
  assert.notDeepEqual(other.commitment, tree.commitment);
  const r = await rebuildTreeFromFiles(files, other.commitment);
  assert.equal(rebuildMatches(r.placed, tree), false);
  assert.ok(rebuildMatches(r.placed, other));
});

test("files kept as is rebuild through the as-is reading", async () => {
  const files = filesOf(set());
  const stub = await makeStub();
  const inputs = (await inputsOf(files)).map((i) => ({ ...i, asIs: true }));
  const made = await makeTree(inputs, { transport: { fetch: stub.fetch } });
  const bound = bindTree(made.proof);
  assert.ok(bound.ok);
  const r = await rebuildTreeFromFiles(files, bound.tree.commitment);
  assert.ok(rebuildMatches(r.asIs, bound.tree));
  assert.equal(rebuildMatches(r.placed, bound.tree), false);
});
