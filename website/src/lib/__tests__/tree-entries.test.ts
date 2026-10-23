// Finding a file in its tree (lib/tree-entries.ts): every leaf's path walks to the root, for trees of every shape,
// and a sealed entry opens to exactly what was written, under the file's own key only.
import { test } from "node:test";
import { strict as assert } from "node:assert";
import { leafOf, pathOf, rootFromPath, sealTreeEntries, entryAddress, rootTextFor } from "../tree-entries.ts";
import { openRecoveryEnvelope, parseRecoveryObjectKey } from "../recovery.ts";
import { sha256 } from "@noble/hashes/sha256";

/** A tree in the format made before 2026-10-20 (leaf = SHA-256(0x00 || file)); the Make page now builds digest-leaf
 *  trees (lib/tree-member.ts), but these are still found by their sealed entries. */
async function buildTree(files: File[]) {
  const h = (...p: Uint8Array[]) => sha256(new Uint8Array(p.reduce<number[]>((a, x) => a.concat(Array.from(x)), [])));
  const hex = (b: Uint8Array) => Buffer.from(b).toString("hex");
  const leaves: Array<[string, string]> = [];
  for (const f of files) leaves.push([f.name, hex(h(new Uint8Array([0]), new Uint8Array(await f.arrayBuffer())))]);
  const levels: string[][] = [];
  let row = leaves.map((l) => l[1]);
  while (row.length > 1) {
    const next: string[] = [];
    for (let i = 0; i < row.length; i += 2) next.push(i + 1 < row.length ? hex(h(new Uint8Array([1]), Buffer.from(row[i]!, "hex"), Buffer.from(row[i + 1]!, "hex"))) : row[i]!);
    levels.push(next); row = next;
  }
  const tree = { format: "rfc6962-sha256" as const, files: files.length, root: row[0]!, leaves, levels };
  return { tree, rootText: rootTextFor(files.length, row[0]!) };
}

const filesOf = (n: number) => Array.from({ length: n }, (_, i) => new File([`file ${i} of ${n}\n`], `f${i}.txt`));

test("every leaf walks to the root, for odd and even trees", async () => {
  for (const n of [1, 2, 3, 5, 7, 8, 13, 100]) {
    const files = filesOf(n);
    const { tree, rootText } = await buildTree(files);
    assert.equal(rootText, rootTextFor(n, tree.root));
    const levels = [tree.leaves.map((l) => l[1]), ...tree.levels];
    for (let i = 0; i < n; i++) {
      const leaf = leafOf(new Uint8Array(await files[i]!.arrayBuffer()));
      assert.equal(Buffer.from(leaf).toString("hex"), tree.leaves[i]![1]);
      assert.equal(rootFromPath(leaf, i, n, pathOf(levels, i)), tree.root, `n=${n} i=${i}`);
    }
  }
});

test("a path for one leaf does not prove another, or another index", async () => {
  const files = filesOf(7);
  const { tree } = await buildTree(files);
  const levels = [tree.leaves.map((l) => l[1]), ...tree.levels];
  const leaf0 = leafOf(new Uint8Array(await files[0]!.arrayBuffer()));
  const leaf1 = leafOf(new Uint8Array(await files[1]!.arrayBuffer()));
  assert.notEqual(rootFromPath(leaf1, 0, 7, pathOf(levels, 0)), tree.root);
  assert.notEqual(rootFromPath(leaf0, 2, 7, pathOf(levels, 0)), tree.root);
  assert.equal(rootFromPath(leaf0, 7, 7, pathOf(levels, 0)), null);
});

test("an entry opens with its file's key, to what was written, and with no other key", async () => {
  const files = filesOf(5);
  const { tree, rootText } = await buildTree(files);
  const proof = { proofHash: Buffer.from(sha256(new TextEncoder().encode("a proof"))).toString("base64"), epochId: "E", counter: "14", digestB64: Buffer.from(sha256(new TextEncoder().encode(rootText))).toString("base64") };
  const entries = await sealTreeEntries(tree, proof);
  assert.equal(entries.length, 5);
  const leaf3 = leafOf(new Uint8Array(await files[3]!.arrayBuffer()));
  const e = entries[3]!;
  assert.equal(parseRecoveryObjectKey(e.key)?.address, entryAddress(leaf3));
  const key3 = sha256(new Uint8Array([...new TextEncoder().encode("bitgraph-tree-entry/1 key"), ...leaf3]));
  const opened = await openRecoveryEnvelope(key3, e.key, Buffer.from(e.envelope, "base64"));
  assert.ok(opened);
  const p = JSON.parse(new TextDecoder().decode(opened!));
  assert.equal(p.leafIndex, 3); assert.equal(p.files, 5); assert.equal(p.name, "f3.txt"); assert.equal(p.proof.counter, "14");
  assert.equal(rootFromPath(leaf3, 3, 5, Buffer.from(p.path, "base64")), tree.root);
  const leaf2 = leafOf(new Uint8Array(await files[2]!.arrayBuffer()));
  const key2 = sha256(new Uint8Array([...new TextEncoder().encode("bitgraph-tree-entry/1 key"), ...leaf2]));
  assert.equal(await openRecoveryEnvelope(key2, e.key, Buffer.from(e.envelope, "base64")).catch(() => null), null);
});

// End to end, against the recovery store's own handlers (the routes wrap these) and a stand-in proof route: a tree's
// entries go up in batches, a member file is found and proven, a file outside the tree is not, and an entry whose
// proof does not match the ledger is refused.
import { MemoryRecoveryStore, handleRecoveryPost, handleRecoveryLookup } from "../recovery-store.ts";
import { postTreeEntries, findInTree } from "../tree-entries.ts";

test("made, stored, found: a member is proven in its tree; strangers and wrong proofs are not", async () => {
  const n = 1203; // three batches, an odd last node at several levels
  const files = filesOf(n);
  const { tree, rootText } = await buildTree(files);
  const digestB64 = Buffer.from(sha256(new TextEncoder().encode(rootText))).toString("base64");
  const proofHash = Buffer.from(sha256(new TextEncoder().encode("the root's proof"))).toString("base64");
  const ledger = [{ proof: { proofHash, commit: { counter: "14" } } }];
  const store = new MemoryRecoveryStore();
  const realFetch = globalThis.fetch;
  globalThis.fetch = (async (url: string, init?: { body?: string }) => {
    const reply = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
    if (url === "/api/recovery") { const r = await handleRecoveryPost(init!.body!, store, { writesOn: true } as never); return reply(r.status, r.body); }
    if (url === "/api/recovery/lookup") { const r = await handleRecoveryLookup(init!.body!, store); return reply(r.status, r.body); }
    if (url.startsWith("/api/proofs/")) return reply(200, { proofs: ledger });
    return reply(404, {});
  }) as typeof fetch;
  try {
    const entries = await sealTreeEntries(tree, { proofHash, epochId: "E", counter: "14", digestB64 });
    const stored = await postTreeEntries(entries);
    assert.equal(stored, n);
    for (const i of [0, 1, 600, 1201, 1202]) {
      const found = await findInTree(new Uint8Array(await files[i]!.arrayBuffer()));
      assert.ok(found, `file ${i} is found`);
      assert.equal(found!.leafIndex, i); assert.equal(found!.files, n); assert.equal(found!.proof.counter, "14"); assert.equal(found!.name, `f${i}.txt`);
    }
    assert.equal(await findInTree(new TextEncoder().encode("not in the tree")), null);
    ledger[0]!.proof.proofHash = "AAAA"; // the ledger's proof no longer matches the entries
    assert.equal(await findInTree(new Uint8Array(await files[5]!.arrayBuffer())), null);
  } finally { globalThis.fetch = realFetch; }
});
