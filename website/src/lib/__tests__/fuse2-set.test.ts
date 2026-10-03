/**
 * Sets made under bitgraph-fuse/2 (enclave v9, since 2026-09-30) are sets.
 *
 * The site read a set only under the name "bitgraph-fuse/1" and bound only
 * commitment/1, so every fuse/2 set looked like no set to the proof page, the
 * by-digest index, the camera and /api/fuse/set-index, which is how a real
 * 100,000-file set/2 indexed 0 of its members (2026-10-03). Here a fuse/2
 * set/2 and a fuse/2 set/1, each signed by a test key through the real
 * commit-route validation, bind, and so does every member, exactly as the
 * index binds them; a fuse/1 set still does too.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { sha256 } from "@noble/hashes/sha256";
import {
  buildSetManifest,
  buildSetMemberProof,
  buildSetRoot,
  buildSetTree,
  bytesToBase64,
  computeSlotCommitment,
  computeSlotCommitment2,
  fuseAttribution,
  getPlacement,
  verifyFuseMember,
  type SetMember,
  type SlotAllocation,
} from "@mikeargento/bitgraph-verify";
import { SET_KEY, bindSet, bindSetMember, isSetProof, setIndexEntries, setKindOf } from "../fuse-set.ts";
import { makeStub, utf8 } from "./tree1-helpers.ts";

async function allocate(stub: Awaited<ReturnType<typeof makeStub>>) {
  const r = await stub.fetch("https://stub.test/api/fuse/allocate", { method: "POST", body: "{}" });
  return (await r.json()) as { slot: SlotAllocation; anchor: { counter: string; blockNumber: number; blockHash: string } };
}

async function commit(stub: Awaited<ReturnType<typeof makeStub>>, body: Record<string, unknown>) {
  const r = await stub.fetch("https://stub.test/api/fuse/commit", { method: "POST", body: JSON.stringify(body) });
  const j = (await r.json()) as { proof?: Record<string, unknown>; error?: string };
  assert.equal(r.status, 200, j.error);
  return j.proof!;
}

const originals = ["a", "bb", "ccc", "dddd", "eeeee"].map((s) => utf8(`${s}\n`));

/** Each original fused under one commitment with container/2, as a set member. */
function members(commitment: Uint8Array): { rows: SetMember[]; fused: Uint8Array[] } {
  const p = getPlacement("container/2")!;
  const fused = originals.map((o) => p.build({ original: o, originDigest: sha256(o), commitment }));
  return { rows: originals.map((o, i) => ({ artifact: sha256(fused[i]!), origin: sha256(o), placement: "container/2" })), fused };
}

test("a fuse/2 set/2 binds, and every member binds by its path, as /api/fuse/set-index binds them", async () => {
  const stub = await makeStub();
  const { slot, anchor } = await allocate(stub);
  const commitment = computeSlotCommitment2(slot, anchor.blockHash);
  const { rows, fused } = members(commitment);
  const tree = buildSetTree(rows);
  const rootDoc = buildSetRoot(commitment, rows.length, tree.root);
  const rootObj = JSON.parse(new TextDecoder().decode(rootDoc)) as Record<string, unknown>;
  const proof = await commit(stub, {
    digests: [{ digestB64: bytesToBase64(sha256(rootDoc)), hashAlg: "sha256" }],
    slotId: slot.nonceB64, slot, chainId: "bitgraph:main",
    attribution: fuseAttribution("set/2", undefined, 2),
    metadata: { [SET_KEY]: rootObj },
    anchor,
  });
  assert.equal((proof.attribution as { name: string }).name, "bitgraph-fuse/2");
  assert.equal(setKindOf(proof), "set/2", "a fuse/2 set is a set");
  assert.ok(isSetProof(proof));
  const bound = await bindSet(proof);
  assert.ok(bound, "the root document binds under commitment/2");
  assert.equal(bound.kind, "set/2");
  assert.equal(bound.count, 5);
  for (let k = 0; k < rows.length; k++) {
    const ev = JSON.parse(JSON.stringify(buildSetMemberProof(tree.sorted[k]!, k, rows.length, tree.tree.path(k))));
    const row = bindSetMember(bound, ev);
    assert.ok(row, `member ${k} binds`);
    assert.equal(row.fusedDigestB64, bytesToBase64(tree.sorted[k]!.artifact));
  }
  // The published verifier agrees about a member's bytes.
  const k0 = tree.sorted.findIndex((r) => bytesToBase64(r.artifact) === bytesToBase64(rows[0]!.artifact));
  const v = await verifyFuseMember({ proof: proof as never, bytes: fused[0]!, member: buildSetMemberProof(tree.sorted[k0]!, k0, rows.length, tree.tree.path(k0)) });
  assert.equal(v.category, "SET_MEMBER_DIRECT", v.reason ?? "");
  // A root document made under commitment/1 does not bind to a fuse/2 proof.
  const wrong = { ...proof, metadata: { [SET_KEY]: JSON.parse(new TextDecoder().decode(buildSetRoot(computeSlotCommitment(slot), rows.length, tree.root))) } };
  assert.equal(await bindSet(wrong), null);
});

test("a fuse/2 set/1 binds and indexes every member by both digests; a fuse/1 set still binds", async () => {
  const stub = await makeStub();
  const { slot, anchor } = await allocate(stub);
  const commitment = computeSlotCommitment2(slot, anchor.blockHash);
  const { rows } = members(commitment);
  const manifest = buildSetManifest(commitment, rows);
  const proof = await commit(stub, {
    digests: [{ digestB64: bytesToBase64(sha256(manifest)), hashAlg: "sha256" }],
    slotId: slot.nonceB64, slot, chainId: "bitgraph:main",
    attribution: fuseAttribution("set/1", undefined, 2),
    metadata: { [SET_KEY]: JSON.parse(new TextDecoder().decode(manifest)) },
    anchor,
  });
  const bound = await bindSet(proof);
  assert.ok(bound && bound.kind === "set/1" && bound.members.length === 5);
  const entries = setIndexEntries(bound, (proof.artifact as { digestB64: string }).digestB64);
  assert.equal(entries.length, 10, "each member's origin and fused digest");

  const stub1 = await makeStub({ noAnchor: true });
  const a1 = await allocate(stub1);
  const c1 = computeSlotCommitment(a1.slot);
  const m1 = buildSetManifest(c1, members(c1).rows);
  const p1 = await commit(stub1, {
    digests: [{ digestB64: bytesToBase64(sha256(m1)), hashAlg: "sha256" }],
    slotId: a1.slot.nonceB64, slot: a1.slot, chainId: "bitgraph:main",
    attribution: fuseAttribution("set/1"),
    metadata: { [SET_KEY]: JSON.parse(new TextDecoder().decode(m1)) },
  });
  assert.ok(await bindSet(p1), "a fuse/1 set binds as before");
});
