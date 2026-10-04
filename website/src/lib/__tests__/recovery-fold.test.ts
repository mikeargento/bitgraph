// The drop box's recovery lookup (recovery-fold.ts): a file the ledger does
// not know is found through its sealed recovery entry, bound to its proof and
// verified as that member; everything else stays "new". Real sealed entries
// in a memory store, the spec's signed vector tree, no network.
import { describe, test } from "node:test";
import * as assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { MemoryRecoveryStore } from "../recovery-store.ts";
import { recoveryPlaintextFor, recoveryTreeFrom, sealRecoveryMember } from "../recovery.ts";
import { recoverRows, treePositionKey } from "../recovery-fold.ts";
import { fakeFetch, sha256, syntheticTree, utf8, vectorTree } from "./recovery-helpers.ts";

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
    const r = await recoverRows(rows, { fetch, trust: "none" });
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
    const r = await recoverRows([row(utf8("never recorded")), row(utf8("already found"), "found")], { fetch, trust: "none" });
    assert.equal(r.found.size, 0);
    assert.equal(calls.length, 1, "only the new row was asked about");
  });

  test("an entry whose proof cannot be found, or whose file is not the member, is not a match", async () => {
    const { store } = await storeWithEveryMember();
    const noProofs = fakeFetch(store, { proofs: [] });
    const file = Buffer.from(TREE.files[0]!.originalHex, "hex");
    const r = await recoverRows([row(file)], { fetch: noProofs, trust: "none" });
    assert.equal(r.found.size, 0);
  });

  test("a recovery store that is down leaves the row new and counts the failure", async () => {
    const { store } = await storeWithEveryMember();
    const down = fakeFetch(store, { status: 503 });
    const r = await recoverRows([row(Buffer.from(TREE.files[1]!.originalHex, "hex"))], { fetch: down, trust: "none" });
    assert.equal(r.found.size, 0);
    assert.equal(r.failed, 1);
  });

  test("many new rows go a thousand addresses a request, and every one of them is answered", async () => {
    const { t, store } = await storeWithEveryMember();
    const calls: string[] = [];
    const rows = Array.from({ length: 1_200 }, (_, i) => row(utf8(`file ${i}`)));
    const r = await recoverRows(rows, { fetch: fakeFetch(store, { proofs: [t.proof], calls }), trust: "none" });
    assert.equal(r.found.size, 0);
    assert.equal(r.unknown.size, 0, "an empty listing is an answer");
    assert.equal(calls.filter((c) => c.endsWith("/api/recovery/lookup")).length, 2, "1,000 + 200");
  });

  test("a tree this browser made whose entries are not written yet still finds its members, through the local queue", async () => {
    const t = vectorTree();
    const tree = recoveryTreeFrom({ proof: t.proof, rootDocument: t.rootDocument, leavesBytes: t.leavesBytes });
    const empty = new MemoryRecoveryStore();
    const file = Buffer.from(TREE.files[0]!.originalHex, "hex");
    const d = sha256(file);
    // The queue's answer for this digest: member 0's entry, from the job's own leaves.
    const local = async (digest32: Uint8Array) => {
      if (Buffer.from(digest32).toString("hex") !== Buffer.from(d).toString("hex")) return [];
      const index = TREE.files.findIndex((f) => f.name === t.names[0]) >= 0 ? t.names.indexOf(TREE.files[0]!.name) : 0;
      const { plaintext } = recoveryPlaintextFor(tree, index, t.names[index]);
      return [{ salted: false, salt: null, matched: "origin" as const, proofHash: plaintext.proofHash, leafIndex: plaintext.leafIndex, rootDocument: plaintext.rootDocument, member: plaintext.member, proof: plaintext.proof, name: plaintext.name ?? null }];
    };
    const r = await recoverRows([row(file)], { fetch: fakeFetch(empty, { proofs: [t.proof] }), local, trust: "none" });
    assert.equal(r.unknown.size, 0);
    assert.equal(r.found.size, 1, "found through the pending job, with nothing in the store");
    assert.equal(r.found.get(0)![0]!.proofKey, treePositionKey(t.proof));
    // The store down AND the local queue holding the member: found, not unknown.
    empty.failing = true;
    const down = await recoverRows([row(file)], { fetch: fakeFetch(empty, { proofs: [t.proof] }), local, trust: "none" });
    assert.equal(down.found.size, 1);
    assert.equal(down.unknown.size, 0);
    // The store down and the local entry's proof not readable yet: unknown, never new (the cold review's finding 3a).
    const noProofs = fakeFetch(empty, { proofs: [] });
    const masked = await recoverRows([row(file)], { fetch: noProofs, local, trust: "none" });
    assert.equal(masked.found.size, 0);
    assert.equal(masked.unknown.size, 1);
  });

  test("a verified match wins over an unfinished discovery: one candidate verifies, the next cannot be read, the row is found", async () => {
    const t = vectorTree();
    const store = new MemoryRecoveryStore();
    const tree = recoveryTreeFrom({ proof: t.proof, rootDocument: t.rootDocument, leavesBytes: t.leavesBytes });
    for (let i = 0; i < t.count; i++) for (const w of (await sealRecoveryMember(tree, i, t.names[i])).writes) await store.putIfAbsent(w.objectKey, w.envelope);
    // The same file recorded a second time, in a tree whose proof route is down.
    const second = syntheticTree([{ name: "again.txt", original: Buffer.from(TREE.files[0]!.originalHex, "hex"), code: 0x00 }], "4242");
    const tree2 = recoveryTreeFrom({ proof: second.proof, rootDocument: second.rootDocument, leavesBytes: second.leavesBytes });
    for (const w of (await sealRecoveryMember(tree2, 0, "again.txt")).writes) await store.putIfAbsent(w.objectKey, w.envelope);
    const inner = fakeFetch(store, { proofs: [t.proof] });
    const secondDigest = second.proof.artifact.digestB64.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
    const flaky = async (u: string, init?: RequestInit) => (u === `/api/proofs/${secondDigest}` ? new Response("down", { status: 503 }) : inner(u, init));
    const file = Buffer.from(TREE.files[0]!.originalHex, "hex");
    const r = await recoverRows([row(file)], { fetch: flaky, trust: "none" });
    assert.equal(r.found.size, 1, "the vector's tree verified");
    assert.equal(r.unknown.size, 0, "the unreadable second candidate does not unsettle a verified match");
  });

  test("this browser's own records that cannot be read leave the row unknown, never new", async () => {
    const t = vectorTree();
    const empty = new MemoryRecoveryStore();
    const file = Buffer.from(TREE.files[0]!.originalHex, "hex");
    const r = await recoverRows([row(file)], { fetch: fakeFetch(empty, { proofs: [t.proof] }), local: async () => { throw new Error("IndexedDB unavailable"); }, trust: "none" });
    assert.equal(r.found.size, 0);
    assert.equal(r.unknown.size, 1);
    assert.match(r.unknown.get(0)!, /own pending records could not be read/);
  });

  test("a store that cannot be read, or a proof route that is down, leaves the row unknown, never new", async () => {
    const { t, store } = await storeWithEveryMember();
    const file = Buffer.from(TREE.files[0]!.originalHex, "hex");
    store.failing = true;
    const r = await recoverRows([row(file)], { fetch: fakeFetch(store, { proofs: [t.proof] }), trust: "none" });
    assert.equal(r.found.size, 0);
    assert.equal(r.unknown.size, 1);
    assert.match(r.unknown.get(0)!, /could not read this address/);
    store.failing = false;
    // The entry is there, but the proof route answers 503: the file cannot be verified as that member, and it is not new either.
    const inner = fakeFetch(store, { proofs: [t.proof] });
    const proofsDown = async (u: string, init?: RequestInit) => (u.startsWith("/api/proofs/") ? new Response("down", { status: 503 }) : inner(u, init));
    const d = await recoverRows([row(file)], { fetch: proofsDown, trust: "none" });
    assert.equal(d.found.size, 0);
    assert.equal(d.unknown.size, 1);
  });
});
