import { test } from "node:test";
import assert from "node:assert/strict";
import { SET_KEY, attachSetManifests } from "../fuse-set.ts";

// The batch route sends a member's set proof stripped of its manifest and
// each distinct set once; the camera puts the manifest back per entry. A
// side-table proof attaches only to entries whose signed artifact digest is
// its own, and never to an entry that names no set.
const manifest = { type: SET_KEY, placement: "set/1", slotCommitment: { algorithm: "sha256", digest: "0".repeat(64) }, members: [] };
const setProof = (digest: string) => ({ artifact: { digestB64: digest }, metadata: { [SET_KEY]: manifest } });
const member = (digest: string, setDigest?: string, metadata?: Record<string, unknown>) =>
  ({ proof: { artifact: { digestB64: digest }, ...(metadata ? { metadata } : {}) } as Record<string, unknown>, ...(setDigest ? { setDigest } : {}) });

test("attachSetManifests puts the side table's manifest on the entries that name it, by reference", () => {
  const a = member("SETA", "SETA_safe");
  const b = member("SETA", "SETA_safe", { other: 1 });
  const stranger = member("SETB", "SETB_safe");
  const wrongSet = member("SETA", "SETB_safe");
  const plain = member("FILE");
  const results = { d1: { proofs: [a, plain] }, d2: { proofs: [b, stranger, wrongSet] }, d3: undefined };
  const n = attachSetManifests(results, { SETA_safe: setProof("SETA"), SETB_safe: setProof("SETB") });
  assert.equal(n, 3);
  assert.equal((a.proof.metadata as Record<string, unknown>)[SET_KEY], manifest, "shared by reference, one parsed object per set");
  assert.deepEqual(b.proof.metadata, { other: 1, [SET_KEY]: manifest }, "other metadata keys kept");
  assert.equal((stranger.proof.metadata as Record<string, unknown>)[SET_KEY], manifest);
  assert.equal(wrongSet.proof.metadata, undefined, "a header naming a set whose digest is not the entry's attaches nothing");
  assert.equal(plain.proof.metadata, undefined, "an entry that names no set is untouched");
});

test("attachSetManifests without a side table, or with a set that carries no manifest, changes nothing", () => {
  const a = member("SETA", "SETA_safe");
  assert.equal(attachSetManifests({ d: { proofs: [a] } }, undefined), 0);
  assert.equal(attachSetManifests({ d: { proofs: [a] } }, { SETA_safe: { artifact: { digestB64: "SETA" } } }), 0);
  assert.equal(attachSetManifests({ d: { proofs: [a] } }, { SETA_safe: { artifact: { digestB64: "SETA" }, metadata: { [SET_KEY]: "not an object" } } }), 0);
  assert.equal(a.proof.metadata, undefined);
});

// set/2: the root document is the committed artifact; a member is known by
// its evidence, bound to the root before any row is read.
import { computeSlotCommitment, buildSetRoot, buildSetTree, buildSetMemberProof, bytesToBase64, sha256Hex } from "./set2-helpers.ts";
import { bindSet, bindSetMember, setKindOf, setCountOf, validateSetCommit, SET2_TITLE } from "../fuse-set.ts";

test("set/2: bindSet binds a root document to the signed digest and the slot; bindSetMember binds evidence by its path; validateSetCommit accepts the root document at the route", async () => {
  const filled = (n: number, seed: number) => { const b = new Uint8Array(n); for (let i = 0; i < n; i++) b[i] = (i * 31 + seed) & 0xff; return b; };
  const slot = { version: "bitgraph/slot/1", nonceB64: bytesToBase64(filled(32, 7)), counter: "10", epochId: bytesToBase64(filled(32, 5)), publicKeyB64: bytesToBase64(filled(32, 1)), chainId: "bitgraph:main", signatureB64: bytesToBase64(filled(64, 2)) } as unknown as Parameters<typeof computeSlotCommitment>[0];
  const commitment = computeSlotCommitment(slot);
  const rows = [0, 1, 2, 3, 4].map((i) => ({ artifact: filled(32, 40 + i), origin: filled(32, 60 + i), placement: i % 2 ? "trailer/1" : "container/2" }));
  const tree = buildSetTree(rows);
  const rootDoc = buildSetRoot(commitment, 5, tree.root);
  const rootObj = JSON.parse(new TextDecoder().decode(rootDoc)) as Record<string, unknown>;
  const digestB64 = await sha256Hex(rootDoc);
  const proof: Record<string, unknown> = { attribution: { name: SET_KEY, title: SET2_TITLE }, artifact: { digestB64 }, slotAllocation: slot, metadata: { [SET_KEY]: rootObj } };
  assert.equal(setKindOf(proof), "set/2");
  assert.equal(setCountOf(proof), 5);
  const bound = await bindSet(proof);
  assert.ok(bound && bound.kind === "set/2" && bound.count === 5 && bound.members.length === 0 && bound.root !== null, "bound with no rows: a member needs its evidence");
  for (let k = 0; k < 5; k++) {
    const ev = buildSetMemberProof(tree.sorted[k]!, k, 5, tree.tree.path(k));
    const m = bindSetMember(bound!, JSON.parse(JSON.stringify(ev)));
    assert.ok(m, `member ${k} binds`);
    assert.equal(m!.index, k);
    assert.equal(m!.count, 5);
    assert.equal(m!.fusedDigestB64, bytesToBase64(tree.sorted[k]!.artifact));
    const forged = JSON.parse(JSON.stringify(ev)) as { path: string[]; count: number };
    forged.count = 6;
    assert.equal(bindSetMember(bound!, forged), null, "the wrong count never binds");
    if (forged.path.length) { forged.count = 5; forged.path[0] = forged.path[0]!.replace(/^./, (c) => (c === "a" ? "b" : "a")); assert.equal(bindSetMember(bound!, forged), null, "a forged node never binds"); }
  }
  assert.equal(bindSetMember(bound!, null), null);
  assert.equal(bindSetMember(bound!, { nonsense: true }), null);
  // A tampered count or root breaks the binding to the signed digest.
  const tampered = { ...proof, metadata: { [SET_KEY]: { ...rootObj, count: 6 } } };
  assert.equal(await bindSet(tampered), null);
  const stripped = { ...proof, metadata: undefined };
  assert.equal(await bindSet(stripped), null);
  assert.equal(await bindSet({ ...proof, attribution: { name: SET_KEY, title: "set/1" } }), null, "a set/1 title over a root document is not a bound set");
  // The route's validation of a set/2 commit.
  const ok = await validateSetCommit({ title: SET2_TITLE, metadata: { [SET_KEY]: rootObj }, digestB64, slot });
  assert.ok(ok.ok, ok.ok ? "" : ok.error);
  const wrongDigest = await validateSetCommit({ title: SET2_TITLE, metadata: { [SET_KEY]: rootObj }, digestB64: bytesToBase64(filled(32, 99)), slot });
  assert.ok(!wrongDigest.ok && /does not hash/.test(wrongDigest.error));
  const badCount = await validateSetCommit({ title: SET2_TITLE, metadata: { [SET_KEY]: { ...rootObj, count: 0 } }, digestB64, slot });
  assert.ok(!badCount.ok && /not a set root document/.test(badCount.error));
  const asSet1 = await validateSetCommit({ title: "set/1", metadata: { [SET_KEY]: rootObj }, digestB64, slot });
  assert.ok(!asSet1.ok, "a root document under a set/1 title is not a manifest");
  const noMeta = await validateSetCommit({ title: SET2_TITLE, metadata: undefined, digestB64, slot });
  assert.ok(!noMeta.ok && /requires metadata/.test(noMeta.error));
});
