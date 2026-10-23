/**
 * A file of a tree, checked by its own hash (bitgraph-tree-member/1).
 *
 * The fixture is real: BitGraph #18 of epoch pa9R…, made by enclave v13 on 2026-10-20 from bitgraph.ing's Make page,
 * binding the root text of a three-file tree; member-2.proof.json is the proof the site's index serves under
 * member-2.txt's own hash (the tree's proof with member-2's block in its unsigned metadata). Its attestation is
 * AWS-signed, so verifyAttested checks the real chain.
 *
 *   cd packages/verify && npx tsc -p . && node --test dist/__tests__/tree-member.test.js
 */

import { test } from "node:test";
import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";
import { sha256 } from "@noble/hashes/sha256";
import { verifyAttested } from "../attested.js";
import { TREE_MEMBER_METADATA_KEY, checkTreeMember, digestTreeRootText, parseDigestTreeRootText, treeMemberOf, treeRootFromPath, type TreeMemberBlock } from "../tree-member.js";
import type { BitGraphProof } from "../types.js";

const dir = new URL("../../src/__tests__/fixtures/tree-member/", import.meta.url);
const file = (n: number) => new Uint8Array(readFileSync(new URL(`member-${n}.txt`, dir)));
const proof = JSON.parse(readFileSync(new URL("member-2.proof.json", dir), "utf8")) as BitGraphProof;
const b64 = (u: Uint8Array) => Buffer.from(u).toString("base64");
const clone = <T>(x: T): T => JSON.parse(JSON.stringify(x)) as T;

test("the real member checks: its file is file 2 of 3, and the proof is BitGraph's", async () => {
  const block = treeMemberOf(proof);
  assert.ok(block);
  assert.equal(block!.index, 1); assert.equal(block!.files, 3);
  assert.ok(checkTreeMember(proof, sha256(file(2))));
  const r = await verifyAttested({ proof, bytes: file(2) });
  assert.equal(r.valid, true, r.reason);
  assert.deepEqual(r.treeMember, { index: 1, files: 3 });
  assert.equal(r.image?.version, "v13");
  assert.equal(r.artifactBinding, "checked");
});

test("the tree's other files and outside bytes are refused under member 2's block", async () => {
  for (const bytes of [file(1), file(3), new TextEncoder().encode("not in the tree\n")]) {
    const r = await verifyAttested({ proof, bytes });
    assert.equal(r.valid, false);
    assert.equal(r.reason, "the file is not in the tree this proof binds");
    assert.equal(r.treeMember, undefined);
  }
});

test("a block that was edited does not check, wherever the edit is", async () => {
  const block = treeMemberOf(proof)!;
  const d = sha256(file(2));
  const edit = (e: Partial<TreeMemberBlock>) => { const p = clone(proof) as unknown as { metadata: Record<string, unknown> }; p.metadata[TREE_MEMBER_METADATA_KEY] = { ...block, ...e }; return p; };
  assert.equal(checkTreeMember(edit({ index: 0 }), d), false, "another index");
  assert.equal(checkTreeMember(edit({ files: 4 }), d), false, "a count the text does not name");
  assert.equal(checkTreeMember(edit({ rootText: digestTreeRootText(3, "0".repeat(64)) }), d), false, "a root text the proof does not sign");
  assert.equal(checkTreeMember(edit({ path: b64(new Uint8Array(64)) }), d), false, "another path");
  // The proof's signed digest is untouched by any of these: metadata is unsigned, so the check is what binds it.
  const r = await verifyAttested({ proof: edit({ index: 0 }) as unknown as BitGraphProof, bytes: file(2) });
  assert.equal(r.valid, false);
});

test("without the file, the proof still verifies as the tree's: against its root text", async () => {
  const r = await verifyAttested({ proof });
  assert.equal(r.valid, true, r.reason);
  assert.equal(r.treeMember, undefined, "membership needs the file (or its hash, through checkTreeMember)");
  assert.equal(r.artifactBinding, "not-checked");
});

test("every leaf walks to its root, for odd and even trees", () => {
  const h = (...p: Uint8Array[]) => sha256(new Uint8Array(p.reduce<number[]>((a, x) => a.concat(Array.from(x)), [])));
  for (const n of [1, 2, 3, 5, 7, 8, 13, 100]) {
    const digests = Array.from({ length: n }, (_, i) => sha256(new TextEncoder().encode(`file ${i} of ${n}`)));
    const rows: Uint8Array[][] = [digests.map((d) => h(new Uint8Array([0]), d))];
    while (rows[rows.length - 1]!.length > 1) {
      const row = rows[rows.length - 1]!, next: Uint8Array[] = [];
      for (let i = 0; i < row.length; i += 2) next.push(i + 1 < row.length ? h(new Uint8Array([1]), row[i]!, row[i + 1]!) : row[i]!);
      rows.push(next);
    }
    const rootHex = Buffer.from(rows[rows.length - 1]![0]!).toString("hex");
    const rootText = digestTreeRootText(n, rootHex);
    assert.deepEqual(parseDigestTreeRootText(rootText), { files: n, root: rootHex });
    const fake = { artifact: { digestB64: b64(sha256(new TextEncoder().encode(rootText))) } };
    for (let i = 0; i < n; i++) {
      const sibs: number[] = [];
      for (let k = 0, idx = i; rows[k]!.length > 1; k++, idx >>= 1) { const s = idx ^ 1; if (s < rows[k]!.length) sibs.push(...rows[k]![s]!); }
      const path = new Uint8Array(sibs);
      assert.equal(treeRootFromPath(rows[0]![i]!, i, n, path), rootHex, `n=${n} i=${i}`);
      const block: TreeMemberBlock = { format: TREE_MEMBER_METADATA_KEY, files: n, index: i, path: b64(path), rootText };
      assert.ok(checkTreeMember(fake, digests[i]!, block), `n=${n} i=${i} checks`);
      if (n > 1) assert.equal(checkTreeMember(fake, digests[(i + 1) % n]!, block), false, `n=${n} i=${i} refuses a neighbour`);
    }
  }
});
