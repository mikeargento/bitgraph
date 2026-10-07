// tree/1 through the UNMODIFIED enclave (local harness, v9 source): a single
// file and a five-file tree, each made the way a producer makes them, committed,
// and verified with the published verifier. Proves the enclave signs a tree/1
// commit (attribution, metadata, floor) with no change to its code.
// Run: node --import tsx/esm tree1-e2e.mts
// Writes nothing outside .build/. Real signatures, fake PCR0 and attestation.
import { startStack, post } from "./lib.mts";
import * as F from "../../../packages/verify/dist/index.js";
import { getPublicKeyAsync, signAsync, utils } from "@noble/ed25519";
import { sha256 } from "@noble/hashes/sha256";

const utf8 = (s: string) => new TextEncoder().encode(s);
const b64 = (u: Uint8Array) => Buffer.from(u).toString("base64");
const CHAIN = "bitgraph:main";

const seed = utils.randomPrivateKey();
process.env["HARNESS_ANCHOR_PUBKEY_B64"] = b64(await getPublicKeyAsync(seed));
const stack = await startStack({ quiet: true, parentEnv: { FUSE_ENABLED: "true" } });
const U = stack.parentUrl;

let pass = 0;
const ok = (name: string, cond: boolean, detail?: unknown) => {
  if (!cond) { console.error("FAIL", name, detail === undefined ? "" : JSON.stringify(detail).slice(0, 600)); process.exitCode = 1; }
  else { pass++; console.log("ok  ", name); }
};
const blockHashFor = (n: number) => "0x" + Buffer.from(sha256(utf8(`harness-block-${n}`))).toString("hex");
const proofOf = (r: { json: any }) => (Array.isArray(r.json) ? r.json[0] : r.json?.proofs?.[0] ?? r.json);

async function anchorAt(n: number) {
  const key = await (await fetch(`${U}/key`)).json() as { epochId: string };
  const blockHash = blockHashFor(n);
  const sig = await signAsync(utf8(`bitgraph-anchor/1\n${key.epochId}\n${CHAIN}\n${n}\n${blockHash}`), seed);
  const r = await post(`${U}/commit`, {
    digests: [{ digestB64: b64(sha256(utf8(blockHash))), hashAlg: "sha256" }],
    chainId: CHAIN,
    attribution: { name: "Ethereum Anchor", title: `https://etherscan.io/block/${n}`, message: blockHash },
    anchor: { blockNumber: n, blockHash, signatureB64: b64(sig) },
  });
  if (r.status !== 200) throw new Error("anchor: " + JSON.stringify(r.json));
}

async function makeTree(files: Array<{ name: string; bytes: Uint8Array; code: number }>) {
  const a = await post(`${U}/allocate-slot`, { chainId: CHAIN });
  if (a.status !== 200) throw new Error("allocate: " + JSON.stringify(a.json));
  // Enclave v10: the allocation returns a Base floor, so the tree is fuse/3 and pins SPEC v2.
  const { slotId, slot, floor: anchor } = a.json as { slotId: string; slot: F.SlotAllocation; floor?: { chain: "base"; evmChainId: 8453; blockNumber: number; blockHash: string; blockTimestamp: number } };
  if (!anchor) throw new Error("no Base floor with the allocation (tree/1 under SPEC v2 needs enclave v10)");
  const { commitment, version } = F.producerCommitment(slot, anchor);
  if (version !== 3) throw new Error("expected commitment/3");
  const members = files.map((f) => ({ ...f, ...F.leafFor(f.code, f.bytes, commitment) }));
  const built = F.buildTree(members.map((m) => m.leaf));
  const rootDoc = F.buildTreeRootDocument(commitment, built.sorted.length, built.root);
  const c = await post(`${U}/commit`, {
    digests: [{ digestB64: b64(sha256(rootDoc)), hashAlg: "sha256" }],
    slotId, slot, chainId: CHAIN,
    attribution: F.treeAttribution(F.currentTreeSpecHash(3)),
    metadata: { [F.TREE_METADATA_KEY]: F.bytesToHex(rootDoc) },
  });
  if (c.status !== 200) throw new Error("commit: " + JSON.stringify(c.json));
  const proof = proofOf(c) as F.BitGraphProof;
  const evidenceOf = (m: (typeof members)[number]) => {
    const k = built.sorted.findIndex((l) => F.bytesEqual(l.artifact, m.leaf.artifact));
    return F.buildTreeMemberEvidence(m.leaf, k, built.sorted.length, built.tree.path(k));
  };
  return { proof, anchor, members, built, rootDoc, evidenceOf };
}

try {
  await anchorAt(26100000);

  // One file: a tree of one.
  const one = await makeTree([{ name: "photo.txt", bytes: utf8("a single file, a tree of one\n"), code: 0x03 }]);
  ok("the enclave signed tree/1's marker as sent", JSON.stringify(one.proof.attribution) === JSON.stringify(F.treeAttribution(F.currentTreeSpecHash(3))) && one.proof.attribution?.name === "bitgraph-fuse/3", one.proof.attribution);
  ok("the enclave kept the root document in metadata", one.proof.metadata?.[F.TREE_METADATA_KEY] === F.bytesToHex(one.rootDoc));
  ok("the signed floor is the allocation's Base block", JSON.stringify(one.proof.commit.slotFloor) === JSON.stringify(one.anchor) && !one.proof.commit.slotAnchor, { signed: one.proof.commit.slotFloor, alloc: one.anchor });
  const r1 = await F.verifyTreeMember({ proof: one.proof, bytes: one.members[0]!.bytes, member: one.evidenceOf(one.members[0]!) });
  ok("one file verifies from its original", r1.category === "TREE_MEMBER_FROM_ORIGIN", r1);
  const r1d = await F.verifyTreeMember({ proof: one.proof, bytes: one.members[0]!.committed, member: one.evidenceOf(one.members[0]!) });
  ok("one file verifies from its committed bytes", r1d.category === "TREE_MEMBER_DIRECT", r1d);

  // Five files across every placement, one kept as is.
  const five = await makeTree([
    { name: "a.jpg", bytes: Uint8Array.from([0xff, 0xd8, 0xff, 1, 2, 3]), code: 0x01 },
    { name: "b.txt", bytes: utf8("b\n"), code: 0x03 },
    { name: "c.txt", bytes: utf8("c, the old container\n"), code: 0x02 },
    { name: "d.bin", bytes: utf8("d, kept exactly as it is\n"), code: 0x00 },
    { name: "e.txt", bytes: new Uint8Array(0), code: 0x03 },
  ]);
  for (const m of five.members) {
    const r = await F.verifyTreeMember({ proof: five.proof, bytes: m.bytes, member: five.evidenceOf(m) });
    ok(`${m.name} verifies (${m.code === 0 ? "as is" : "from its original"})`, r.category === (m.code === 0 ? "TREE_MEMBER_AS_IS" : "TREE_MEMBER_FROM_ORIGIN"), r);
  }

  // The export: everything but the attestation (fake here) and the chains (not carried) holds.
  const m0 = five.members[1]!;
  const exp = F.buildExport({ proof: five.proof, tree: { rootDocument: F.bytesToHex(five.rootDoc), member: five.evidenceOf(m0) }, floor: null, ceiling: { status: "pending" }, settlement: { status: "pending" } });
  const v = await F.verifyExport(JSON.stringify(exp), { bytes: m0.bytes });
  const claim = (id: string) => v.claims.find((c) => c.id === id)?.result;
  ok("export: proof, spec, root, member, file all TRUE", ["proof.signature", "spec.pin", "tree.root", "tree.member", "bytes.member"].every((id) => claim(id) === "TRUE"), v.claims);
  ok("export: the harness attestation is refused, as it must be", claim("attestation.signature") === "FALSE");
  ok("export: ceiling and settlement pending are NOT_CARRIED, not failures", claim("ceiling.base") === "NOT_CARRIED" && claim("ceiling.ethereum") === "NOT_CARRIED");
  const owner = F.buildExport({ proof: five.proof, tree: { rootDocument: F.bytesToHex(five.rootDoc), leaves: b64(F.encodeTreeLeaves(five.built.sorted)) }, floor: null, ceiling: null, settlement: null });
  for (const m of five.members) {
    const vo = await F.verifyExport(owner, { bytes: m.bytes });
    ok(`owner export finds ${m.name}`, vo.claims.find((c) => c.id === "bytes.member")?.result === "TRUE", vo.claims.find((c) => c.id === "bytes.member"));
  }

  // A tree/1 commit whose metadata is missing still signs; the verifier then needs the root document from the export.
  const c3 = await makeTree([{ name: "x.txt", bytes: utf8("x"), code: 0x03 }]);
  const stripped = { ...c3.proof, metadata: undefined } as unknown as F.BitGraphProof;
  const rNo = await F.verifyTreeMember({ proof: stripped, bytes: c3.members[0]!.bytes, member: c3.evidenceOf(c3.members[0]!) });
  ok("without the root document the member is not shown", rNo.category === "INVALID_TREE_ROOT", rNo);
  const rWith = await F.verifyTreeMember({ proof: stripped, bytes: c3.members[0]!.bytes, member: c3.evidenceOf(c3.members[0]!), rootDocument: c3.rootDoc });
  ok("with the root document beside it, it is", rWith.category === "TREE_MEMBER_FROM_ORIGIN", rWith);

  console.log(`\n${pass} checks passed${process.exitCode ? ", with failures above" : ""}`);
} finally {
  stack.stop();
}
