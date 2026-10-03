/**
 * The commit route's tree/1 half, offline: validateTreeCommit accepts exactly
 * a well-formed tree/1 commit and refuses every malformed one with its own
 * sentence, before anything is spent; reconcileTreeMetadata keeps, attaches
 * or refuses the root document the boundary hands back; and nothing that
 * indexes by digest ever reads a tree's spec hash as an origin.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { sha256 } from "@noble/hashes/sha256";
import {
  KNOWN_TREE_SPEC_HASHES,
  TREE_METADATA_KEY,
  TREE_PLACEMENT_ID,
  buildTreeRootDocument,
  bytesToBase64,
  bytesToHex,
  computeSlotCommitment2,
  type SlotAllocation,
} from "@mikeargento/bitgraph-verify";
import { TREE_KEY, TREE_TITLE, bindTree, reconcileTreeMetadata, validateTreeCommit } from "../fuse-tree.ts";
import { TREE_TITLE as CORE_TREE_TITLE, fusedOriginDigestOf, isFusedProof } from "../fuse-core.ts";
import { makeTree } from "../fuse-tree-make.ts";
import { makeStub, utf8, digestB64 } from "./tree1-helpers.ts";

const filled = (n: number, seed: number) => { const b = new Uint8Array(n); for (let i = 0; i < n; i++) b[i] = (i * 31 + seed) & 0xff; return b; };
const slot = { version: "bitgraph/slot/1", nonceB64: bytesToBase64(filled(32, 7)), counter: "10", epochId: bytesToBase64(filled(32, 5)), publicKeyB64: bytesToBase64(filled(32, 1)), chainId: "bitgraph:main", signatureB64: bytesToBase64(filled(64, 2)) } as unknown as SlotAllocation;
const FLOOR = "0x" + "ab".repeat(32);
const SPEC = KNOWN_TREE_SPEC_HASHES[KNOWN_TREE_SPEC_HASHES.length - 1]!;
const commitment = computeSlotCommitment2(slot, FLOOR);
const rootDoc = buildTreeRootDocument(commitment, 5, filled(32, 99));
const hex = bytesToHex(rootDoc);
const good = { name: "bitgraph-fuse/2", message: SPEC, metadata: { [TREE_KEY]: hex }, digestB64: bytesToBase64(sha256(rootDoc)), slot, floorBlockHash: FLOOR };

test("the site pins the protocol's own names for tree/1", () => {
  assert.equal(TREE_TITLE, TREE_PLACEMENT_ID);
  assert.equal(CORE_TREE_TITLE, TREE_PLACEMENT_ID);
  assert.equal(TREE_KEY, TREE_METADATA_KEY);
});

test("validateTreeCommit accepts a well-formed tree/1 commit and returns the root document it checked", () => {
  const v = validateTreeCommit(good);
  assert.ok(v.ok, v.ok ? "" : v.error);
  assert.equal(v.count, 5);
  assert.equal(v.hex, hex);
  assert.deepEqual(v.rootDocument, rootDoc);
});

test("validateTreeCommit refuses every malformed commit, each with its own sentence, and never throws", () => {
  const otherSlot = { ...slot, nonceB64: bytesToBase64(filled(32, 8)) } as SlotAllocation;
  const badDomain = rootDoc.slice(); badDomain[0] = 0x42;
  const zeroCount = rootDoc.slice(); zeroCount.set([0, 0, 0, 0], 16);
  const withProto = JSON.parse(`{"${TREE_KEY}":"${hex}","__proto__":{"x":1}}`) as Record<string, unknown>;
  const cases: Array<[string, Partial<typeof good> & Record<string, unknown>, RegExp]> = [
    ["fuse/1 name", { name: "bitgraph-fuse/1" }, /bitgraph-fuse\/2/],
    ["no name", { name: undefined }, /bitgraph-fuse\/2/],
    ["no floor named", { floorBlockHash: null }, /body\.anchor/],
    ["unknown spec", { message: digestB64(utf8("some other spec")) }, /SPEC\.md this site knows/],
    ["no spec", { message: undefined }, /SPEC\.md this site knows/],
    ["no metadata", { metadata: undefined }, /nothing else/],
    ["metadata not an object", { metadata: [hex] }, /nothing else/],
    ["an extra key", { metadata: { [TREE_KEY]: hex, "bitgraph-fuse/1": {} } }, /nothing else/],
    ["__proto__ smuggled in", { metadata: withProto }, /nothing else/],
    ["uppercase hex", { metadata: { [TREE_KEY]: hex.toUpperCase() } }, /nothing else/],
    ["83 bytes", { metadata: { [TREE_KEY]: hex.slice(0, 166) } }, /nothing else/],
    ["85 bytes", { metadata: { [TREE_KEY]: hex + "00" } }, /nothing else/],
    ["the root document as an object", { metadata: { [TREE_KEY]: { hex } } }, /nothing else/],
    ["a wrong domain", { metadata: { [TREE_KEY]: bytesToHex(badDomain) }, digestB64: bytesToBase64(sha256(badDomain)) }, /not a tree\/1 root document/],
    ["a count of zero", { metadata: { [TREE_KEY]: bytesToHex(zeroCount) }, digestB64: bytesToBase64(sha256(zeroCount)) }, /not a tree\/1 root document/],
    ["another position's commitment", { slot: otherSlot }, /commitment is not this position's/],
    ["another floor", { floorBlockHash: "0x" + "cd".repeat(32) }, /commitment is not this position's/],
    ["a digest that is not the root document's", { digestB64: digestB64(utf8("x")) }, /does not hash to the committed digest/],
  ];
  for (const [label, change, why] of cases) {
    const v = validateTreeCommit({ ...good, ...change } as typeof good);
    assert.equal(v.ok, false, label);
    if (!v.ok) {
      assert.equal(v.status, 400, label);
      assert.match(v.error, why, `${label}: ${v.error}`);
    }
  }
  // Garbage never throws.
  assert.equal(validateTreeCommit({ ...good, slot: null as unknown as SlotAllocation }).ok, false);
});

test("reconcileTreeMetadata keeps an echo, attaches a dropped root document beside other metadata, refuses another", () => {
  const echoed: Record<string, unknown> = { metadata: { [TREE_KEY]: hex } };
  assert.equal(reconcileTreeMetadata(echoed, { hex }), "echoed");
  const dropped: Record<string, unknown> = { metadata: { other: 1 } };
  assert.equal(reconcileTreeMetadata(dropped, { hex }), "attached");
  assert.deepEqual(dropped.metadata, { other: 1, [TREE_KEY]: hex });
  const none: Record<string, unknown> = {};
  assert.equal(reconcileTreeMetadata(none, { hex }), "attached");
  assert.deepEqual(none.metadata, { [TREE_KEY]: hex });
  const rewritten: Record<string, unknown> = { metadata: { [TREE_KEY]: "00".repeat(84) } };
  assert.equal(reconcileTreeMetadata(rewritten, { hex }), "mismatch");
  assert.deepEqual(rewritten.metadata, { [TREE_KEY]: "00".repeat(84) }, "never mutated on a mismatch");
});

test("a tree's signed message is SPEC.md's hash, never an origin: nothing indexes it, and bindTree checks every link", async () => {
  const stub = await makeStub();
  const made = await makeTree([{ file: new Blob([utf8("indexed nowhere")]), name: "a.txt", digestB64: digestB64(utf8("indexed nowhere")), placement: null, state: null }], { transport: { fetch: stub.fetch } });
  const proof = made.proof as unknown as Record<string, unknown>;
  assert.equal(isFusedProof(proof), true, "a tree is a made BitGraph");
  assert.equal(fusedOriginDigestOf(proof), null, "and names no origin: its message is the spec's hash");
  // A fused single file still names its origin.
  assert.equal(fusedOriginDigestOf({ attribution: { name: "bitgraph-fuse/2", title: "trailer/1", message: SPEC } }), SPEC);

  assert.ok(bindTree(made.proof).ok);
  const withoutRoot = { ...made.proof, metadata: undefined };
  const r1 = bindTree(withoutRoot);
  assert.equal(r1.ok, false);
  assert.ok(bindTree(withoutRoot, made.rootDocument).ok, "the root document beside the proof binds the same way");
  const forged = made.rootDocument.slice(); forged[30] = forged[30]! ^ 1;
  assert.equal(bindTree(made.proof, forged).ok, false, "a root document that is not the signed one");
  const fuse1 = { ...made.proof, attribution: { ...made.proof.attribution!, name: "bitgraph-fuse/1" } };
  assert.match((bindTree(fuse1) as { reason: string }).reason, /bitgraph-fuse\/2/);
  const unknownSpec = { ...made.proof, attribution: { ...made.proof.attribution!, message: digestB64(utf8("v0")) } };
  assert.match((bindTree(unknownSpec) as { reason: string }).reason, /does not know/);
  const otherFloor = { ...made.proof, commit: { ...made.proof.commit, slotAnchor: { ...made.proof.commit.slotAnchor!, blockHash: "0x" + "ee".repeat(32) } } };
  assert.match((bindTree(otherFloor) as { reason: string }).reason, /commitment/);
  assert.equal(bindTree({ attribution: { title: "set/2" } }).ok, false);
});
