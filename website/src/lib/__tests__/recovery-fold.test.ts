// The drop box's recovery lookup (recovery-fold.ts): a file the ledger does
// not know is found through its sealed recovery entry, bound to its proof and
// verified as that member; everything else stays "new". Real sealed entries
// in a memory store, the spec's signed vector tree, no network.
import { describe, test } from "node:test";
import * as assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { MemoryRecoveryStore } from "../recovery-store.ts";
import { recoveryTreeFrom, sealRecoveryMember } from "../recovery.ts";
import { recoverRows, treePositionKey } from "../recovery-fold.ts";
import { fakeFetch, sha256, utf8, vectorTree } from "./recovery-helpers.ts";

const b64 = (b: Uint8Array) => Buffer.from(b).toString("base64");

async function storeWithEveryMember() {
  const t = vectorTree();
  const tree = recoveryTreeFrom({ proof: t.proof, rootDocument: t.rootDocument, leavesBytes: t.leavesBytes });
  const store = new MemoryRecoveryStore();
  for (let i = 0; i < t.count; i++) {
    const { writes } = await sealRecoveryMember(tree, i, t.names[i]);
    for (const w of writes) await store.putIfAbsent(w.objectKey, w.envelope);
  }
  return { t, store };
}

const TREE = JSON.parse(readFileSync(new URL("../../../../spec/vectors/tree-1.json", import.meta.url), "utf8")) as {
  files: Array<{ name: string; originalHex: string; committedHex: string; placementCode: number }>;
};
const row = (bytes: Uint8Array, status = "new") => ({ status, digestB64: b64(sha256(bytes)), file: new Blob([bytes]) });

describe("recovery fold", () => {
  test("every member of the vector tree is found by its original and by its committed bytes, and verified", async () => {
    const { t, store } = await storeWithEveryMember();
    const fetch = fakeFetch(store, { proofs: [t.proof] });
    const rows = TREE.files.flatMap((f) => [row(Buffer.from(f.originalHex, "hex")), row(Buffer.from(f.committedHex, "hex"))]);
    const r = await recoverRows(rows, { fetch });
    assert.equal(r.failed, 0);
    assert.equal(r.found.size, rows.length, "all ten rows found");
    for (const trees of r.found.values()) {
      assert.equal(trees.length, 1);
      assert.equal(trees[0]!.proofKey, treePositionKey(t.proof));
    }
  });

  test("a file that is in no tree stays new; rows not new are never asked", async () => {
    const { t, store } = await storeWithEveryMember();
    const calls: string[] = [];
    const fetch = fakeFetch(store, { proofs: [t.proof], calls });
    const r = await recoverRows([row(utf8("never recorded")), row(utf8("already found"), "found")], { fetch });
    assert.equal(r.found.size, 0);
    assert.equal(calls.length, 1, "only the new row was asked about");
  });

  test("an entry whose proof cannot be found, or whose file is not the member, is not a match", async () => {
    const { store } = await storeWithEveryMember();
    const noProofs = fakeFetch(store, { proofs: [] });
    const file = Buffer.from(TREE.files[0]!.originalHex, "hex");
    const r = await recoverRows([row(file)], { fetch: noProofs });
    assert.equal(r.found.size, 0);
  });

  test("a recovery store that is down leaves the row new and counts the failure", async () => {
    const { store } = await storeWithEveryMember();
    const down = fakeFetch(store, { status: 503 });
    const r = await recoverRows([row(Buffer.from(TREE.files[1]!.originalHex, "hex"))], { fetch: down });
    assert.equal(r.found.size, 0);
    assert.equal(r.failed, 1);
  });

  test("more new rows than the limit: none are asked, and the fold says it skipped", async () => {
    const { t, store } = await storeWithEveryMember();
    const calls: string[] = [];
    const rows = Array.from({ length: 5 }, (_, i) => row(utf8(`file ${i}`)));
    const r = await recoverRows(rows, { fetch: fakeFetch(store, { proofs: [t.proof], calls }), limit: 4 });
    assert.equal(r.skipped, true);
    assert.equal(calls.length, 0);
  });
});
