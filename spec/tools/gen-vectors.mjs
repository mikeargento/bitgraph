// Generate the deterministic tree/1 and export/1 test vectors in spec/vectors/.
//
//   node spec/tools/gen-vectors.mjs        (from the repo root, after building packages/verify)
//
// Everything is derived from fixed seeds, so the output is byte-identical on
// every run until the code or SPEC.md changes. The proof in export-1.json is
// signed with a published TEST key (seed below): it is not a BitGraph, and its
// attestation is absent on purpose. Re-run after any SPEC.md edit, because the
// proof's signed attribution.message pins SPEC.md's hash.

import { writeFileSync, readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import * as ed from "@noble/ed25519";
import { sha512 } from "@noble/hashes/sha512";
import { keccak_256 } from "@noble/hashes/sha3";
import * as v from "../../packages/verify/dist/index.js";

ed.etc.sha512Sync = (...m) => sha512(ed.etc.concatBytes(...m));

const root = new URL("../../", import.meta.url);
const out = (name, obj) => writeFileSync(new URL(`spec/vectors/${name}`, root), JSON.stringify(obj, null, 1) + "\n");
const sha256 = (b) => new Uint8Array(createHash("sha256").update(b).digest());
const hex = (b) => Buffer.from(b).toString("hex");
const b64 = (b) => Buffer.from(b).toString("base64");
const utf8 = (s) => new TextEncoder().encode(s);

// ---- RLP for a synthetic Ethereum header whose keccak becomes the floor block hash.
function rlp(item) {
  const len = (n, off) => {
    if (n < 56) return Uint8Array.of(off + n);
    const b = [];
    for (let x = n; x > 0; x = Math.floor(x / 256)) b.unshift(x % 256);
    return Uint8Array.of(off + 55 + b.length, ...b);
  };
  if (item instanceof Uint8Array) {
    if (item.length === 1 && item[0] < 0x80) return item;
    return Uint8Array.from([...len(item.length, 0x80), ...item]);
  }
  const body = item.map(rlp).reduce((a, x) => Uint8Array.from([...a, ...x]), new Uint8Array(0));
  return Uint8Array.from([...len(body.length, 0xc0), ...body]);
}
const be = (n) => {
  const b = [];
  for (let x = BigInt(n); x > 0n; x >>= 8n) b.unshift(Number(x & 0xffn));
  return Uint8Array.from(b);
};
const FLOOR_NUMBER = 25000000;
const FLOOR_TIME = 1790000000;
const header = rlp(Array.from({ length: 17 }, (_, i) => (i === 8 ? be(FLOOR_NUMBER) : i === 11 ? be(FLOOR_TIME) : new Uint8Array(32).fill(i + 1))));
const floorHash = "0x" + hex(keccak_256(header));

// ---- A published test key and a position record.
const priv = sha256(utf8("bitgraph spec vector key (TEST ONLY, NOT A BITGRAPH KEY)"));
const pub = await ed.getPublicKeyAsync(priv);
const publicKeyB64 = b64(pub);
const EPOCH = b64(sha256(utf8("bitgraph spec vector epoch")));
const slotBody = { version: "bitgraph/slot/1", nonceB64: b64(sha256(utf8("bitgraph spec vector nonce"))), counter: "4", epochId: EPOCH, publicKeyB64, chainId: "bitgraph:main" };
const slot = { ...slotBody, signatureB64: b64(await ed.signAsync(v.canonicalize(slotBody), priv)) };
const slotRecordHash = v.computeSlotRecordHash(slot);
const commitment = v.computeSlotCommitment2(slot, floorHash);

// ---- Five files across every placement, including one kept as is.
const files = [
  { name: "hello.txt", bytes: utf8("hello\n"), code: 0x01 },
  { name: "note.md", bytes: utf8("# a note\n\nkept in a tree\n"), code: 0x02 },
  { name: "data.csv", bytes: utf8("a,b\n1,2\n"), code: 0x03 },
  { name: "empty.bin", bytes: new Uint8Array(0), code: 0x01 },
  { name: "as-is.bin", bytes: utf8("recorded exactly as it is\n"), code: 0x00 },
];
const members = files.map((f) => {
  const { leaf, committed } = v.leafFor(f.code, f.bytes, commitment);
  return { ...f, leaf, committed };
});
const built = v.buildTree(members.map((m) => m.leaf));
const rootDoc = v.buildTreeRootDocument(commitment, built.sorted.length, built.root);
const indexOf = (m) => built.sorted.findIndex((l) => v.bytesEqual(l.artifact, m.leaf.artifact));

const specHash = sha256(readFileSync(new URL("spec/SPEC.md", root)));
const attribution = v.treeAttribution(specHash);
const commit = {
  nonceB64: slot.nonceB64,
  counter: "6",
  epochId: EPOCH,
  slotCounter: slot.counter,
  slotHashB64: b64(slotRecordHash),
  slotAnchor: { counter: "3", blockNumber: FLOOR_NUMBER, blockHash: floorHash },
  chainId: "bitgraph:main",
  prevB64: b64(sha256(utf8("bitgraph spec vector previous proof"))),
};
const artifact = { hashAlg: "sha256", digestB64: b64(sha256(rootDoc)) };
const signedBody = { version: "bitgraph/1", artifact, commit, publicKeyB64, enforcement: "stub", measurement: "test-measurement-not-a-pcr0", attribution };
const signatureB64 = b64(await ed.signAsync(v.canonicalize(signedBody), priv));
const proof = {
  version: "bitgraph/1",
  artifact,
  commit,
  signer: { publicKeyB64, signatureB64 },
  environment: { enforcement: "stub", measurement: "test-measurement-not-a-pcr0" },
  slotAllocation: slot,
  attribution,
  metadata: { [v.TREE_METADATA_KEY]: hex(rootDoc) },
};

out("tree-1.json", {
  description: "tree/1, deterministic: five files under one position, every placement code, the leaves, the tree, the root document and every member's evidence. Generated by spec/tools/gen-vectors.mjs.",
  slot: { record: slot, canonicalBodyHex: hex(v.canonicalize(slotBody)), slotRecordHashHex: hex(slotRecordHash) },
  floor: { blockNumber: FLOOR_NUMBER, blockHash: floorHash, timestamp: FLOOR_TIME, headerHex: "0x" + hex(header) },
  commitment: { preimageHex: hex(v.slotCommitment2Preimage(slot, floorHash)), hex: hex(commitment) },
  files: members.map((m) => ({
    name: m.name,
    placementCode: m.code,
    originalHex: hex(m.bytes),
    originSha256: hex(sha256(m.bytes)),
    committedHex: hex(m.committed),
    committedSha256: hex(sha256(m.committed)),
    leafHex: hex(v.encodeTreeLeaf(m.leaf)),
    leafHashHex: hex(v.treeLeafHash(m.leaf)),
    index: indexOf(m),
    evidence: v.buildTreeMemberEvidence(m.leaf, indexOf(m), built.sorted.length, built.tree.path(indexOf(m))),
  })),
  tree: {
    count: built.sorted.length,
    sortedLeavesHex: built.sorted.map((l) => hex(v.encodeTreeLeaf(l))),
    rootHex: hex(built.root),
    rootDocumentHex: hex(rootDoc),
    artifactDigestB64: artifact.digestB64,
    ownerLeavesB64: b64(v.encodeTreeLeaves(built.sorted)),
  },
});

const m0 = members[0];
const exp = v.buildExport({
  proof,
  tree: { rootDocument: hex(rootDoc), member: v.buildTreeMemberEvidence(m0.leaf, indexOf(m0), built.sorted.length, built.tree.path(indexOf(m0))) },
  floor: { blockNumber: FLOOR_NUMBER, blockHash: floorHash, header: "0x" + hex(header) },
  ceiling: { status: "pending" },
  settlement: { status: "pending" },
});
const owner = v.buildExport({
  proof,
  tree: { rootDocument: hex(rootDoc), leaves: b64(v.encodeTreeLeaves(built.sorted)), names: built.sorted.map((l) => members.find((m) => v.bytesEqual(m.leaf.artifact, l.artifact)).name) },
  floor: { blockNumber: FLOOR_NUMBER, blockHash: floorHash, header: "0x" + hex(header) },
  ceiling: null,
  settlement: null,
});
const checked = await v.verifyExport(exp, { bytes: m0.bytes });
out("export-1.json", {
  description: "bitgraph-export/1 for one member (hello.txt) and the owner's export, signed with a published TEST key (not a BitGraph). The attestation is absent on purpose, so attestation claims fail; every other claim must hold. Generated by spec/tools/gen-vectors.mjs.",
  testKey: { privateKeySeed: "SHA-256(UTF-8 \"bitgraph spec vector key (TEST ONLY, NOT A BITGRAPH KEY)\")", publicKeyB64 },
  signedBodyCanonicalHex: hex(v.canonicalize(signedBody)),
  signedBodySha256B64: b64(sha256(v.canonicalize(signedBody))),
  proofHashB64: v.computeProofHash(proof),
  memberExport: exp,
  memberFileHex: hex(m0.bytes),
  ownerExport: owner,
  expectedClaims: Object.fromEntries(checked.claims.filter((c) => c.level === "offline").map((c) => [c.id, c.result])),
});

// ---- Negative: a second signed tree whose leaves are containers that name one
// original and hold another. Each must fail as its member by every file.
const slotBody2 = { version: "bitgraph/slot/1", nonceB64: b64(sha256(utf8("bitgraph spec vector nonce, negative tree"))), counter: "8", epochId: EPOCH, publicKeyB64, chainId: "bitgraph:main" };
const slot2 = { ...slotBody2, signatureB64: b64(await ed.signAsync(v.canonicalize(slotBody2), priv)) };
const commitment2 = v.computeSlotCommitment2(slot2, floorHash);
const lies = [
  { id: "container/1", code: 0x02, inside: utf8("the bytes inside the first archive\n"), named: utf8("the bytes the first archive names\n") },
  { id: "container/2", code: 0x03, inside: utf8("the bytes inside the second archive\n"), named: utf8("the bytes the second archive names\n") },
].map((l) => {
  const archive = v.getPlacement(l.id).build({ original: l.inside, originDigest: sha256(l.named), commitment: commitment2 });
  return { ...l, archive, leaf: { placement: l.code, artifact: sha256(archive), origin: sha256(l.named) } };
});
const built2 = v.buildTree(lies.map((l) => l.leaf));
const rootDoc2 = v.buildTreeRootDocument(commitment2, built2.sorted.length, built2.root);
const commit2 = { nonceB64: slot2.nonceB64, counter: "10", epochId: EPOCH, slotCounter: slot2.counter, slotHashB64: b64(v.computeSlotRecordHash(slot2)), slotAnchor: { counter: "3", blockNumber: FLOOR_NUMBER, blockHash: floorHash }, chainId: "bitgraph:main", prevB64: b64(sha256(utf8("bitgraph spec vector previous proof, negative tree"))) };
const artifact2 = { hashAlg: "sha256", digestB64: b64(sha256(rootDoc2)) };
const signedBody2 = { version: "bitgraph/1", artifact: artifact2, commit: commit2, publicKeyB64, enforcement: "stub", measurement: "test-measurement-not-a-pcr0", attribution };
const proof2 = {
  version: "bitgraph/1", artifact: artifact2, commit: commit2,
  signer: { publicKeyB64, signatureB64: b64(await ed.signAsync(v.canonicalize(signedBody2), priv)) },
  environment: { enforcement: "stub", measurement: "test-measurement-not-a-pcr0" },
  slotAllocation: slot2, attribution, metadata: { [v.TREE_METADATA_KEY]: hex(rootDoc2) },
};
const at2 = (l) => built2.sorted.findIndex((x) => v.bytesEqual(x.artifact, l.leaf.artifact));
const negative = [];
for (const l of lies) {
  const evidence = v.buildTreeMemberEvidence(l.leaf, at2(l), built2.sorted.length, built2.tree.path(at2(l)));
  for (const [file, bytes] of [["the archive", l.archive], ["the original it names", l.named], ["the original it holds", l.inside]]) {
    const r = await v.verifyTreeMember({ proof: proof2, member: evidence, rootDocument: rootDoc2, bytes });
    negative.push({ placement: l.id, file, bytesHex: hex(bytes), evidence, expect: r.category });
  }
}
out("tree-1-negative.json", {
  description: "tree/1 negative cases: a signed tree (the published TEST key) whose two leaves are a container/1 and a container/2 that name one original and hold another. None of the three files for each is that member. Generated by spec/tools/gen-vectors.mjs.",
  proof: proof2,
  rootDocumentHex: hex(rootDoc2),
  cases: negative,
});

console.log(`tree-1.json, export-1.json and tree-1-negative.json written; spec hash ${b64(specHash)}; root ${hex(built.root)}`);
