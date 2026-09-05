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
