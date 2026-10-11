// Copyright (c) Argento Computing Inc. All rights reserved. See LICENSE.

/**
 * bitgraph-carrier/4: the BitGraphed file of one member of a tree/1 BitGraph.
 *
 * The committed bytes before the block are a LEAF's committed bytes, and the
 * block carries what reaches the signed digest from them: the tree's root
 * document and the member's evidence (export/1's one-file tree part). Built
 * here with throwaway keys over both floors (an Ethereum anchor, enclave v9;
 * a Base header, enclave v10), with an AWS-shaped attestation under a test
 * root, so every rule can be driven to TRUE and then broken one part at a
 * time. Nothing here touches a network or a ledger.
 */

import { before, describe, test } from "node:test";
import * as assert from "node:assert/strict";
import { sha256 } from "@noble/hashes/sha256";
import {
  assembleCarrierV2Payload,
  assembleCarrierV3Payload,
  assembleCarrierV4Payload,
  buildCarrier,
  buildTree,
  buildTreeMemberEvidence,
  buildTreeRootDocument,
  bytesToHex,
  canonicalize,
  canonicalSlotBody,
  CARRIER_VERSION_4,
  completeCarrier,
  completeCarrierInTime,
  computeSlotCommitment2,
  computeSlotCommitment3,
  currentTreeSpecHash,
  innerDigestMatches,
  leafFor,
  memberArtifactDigest,
  parseCarrier,
  treeAttribution,
  verifyCarrier,
  verifyCarrierPayload,
  type BitGraphProof,
  type CarrierPayload,
  type CarrierProof,
  type CarrierFloor,
  type CarrierBaseFloor,
  type TreeLeaf,
  type TreeMemberEvidence,
} from "@mikeargento/bitgraph-verify";
import { b64, makeKey, signBody, utf8, type ManualKey } from "./audit-fixtures.js";
import { BASE_TEST_CHAIN, chainWorld, floorBlock, FLOOR_NUMBER, FLOOR_TIME, signedSlot } from "./tree-fixtures.js";
import { attest, baseBlock, BASE_FLOOR_NUMBER, BASE_FLOOR_TIME, makeTestRoot, pinsFor, slotFloorOf, type TestRoot } from "./base-floor-fixtures.js";

type Claims = { claims: Array<{ id: string; result: string; detail: string; restsOn: string; name: string }> };
const claim = (r: Claims, id: string) => r.claims.find((c) => c.id === id);
const result = (r: Claims, id: string) => claim(r, id)?.result;

let t: TestRoot;
before(async () => {
  t = await makeTestRoot();
});

interface Member {
  name: string;
  original: Uint8Array;
  committed: Uint8Array;
  leaf: TreeLeaf;
  evidence: TreeMemberEvidence;
}

interface Minted {
  kind: "ethereum" | "base";
  key: ManualKey;
  proof: BitGraphProof;
  rootDocument: Uint8Array;
  members: Member[];
  floor: CarrierFloor | CarrierBaseFloor;
  floorHeaderHex: string;
  /** A genuine anchor after the commit, under the same key: the closing anchor of an Ethereum floor. */
  closing?: { anchor: CarrierProof; witness: { headerRlpHex: string; blockNumber: number; blockHash: string } };
}

/** A genuine Ethereum anchor proof under `key` at `counter`, carrying the block's hash as its signed message. */
async function anchorProof(key: ManualKey, slotCounter: string, counter: string, blockNumber: number, blockHash: string): Promise<BitGraphProof> {
  const slot = await signedSlot(key, slotCounter);
  const commit = {
    nonceB64: slot.nonceB64, counter, epochId: slot.epochId, slotCounter: slot.counter,
    slotHashB64: b64(sha256(canonicalize(canonicalSlotBody(slot)))), chainId: "bitgraph:main",
    anchor: { blockNumber, blockHash },
  };
  const p = await signBody(key, { hashAlg: "sha256", digestB64: b64(sha256(utf8(blockHash))) }, commit as never, "test-measurement-anchor", {
    attribution: { name: "Ethereum Anchor", title: `https://etherscan.io/block/${blockNumber}`, message: blockHash },
  });
  p.slotAllocation = slot;
  return p;
}

/**
 * A tree/1 BitGraph over the files given (code 0x00 as is, 0x01 trailer/1,
 * 0x03 container/2), signed under the real spec for its floor (v1 for an
 * Ethereum anchor under fuse/2, v2 for a Base header under fuse/3) unless
 * `spec` names another, and attested `afterFloorS` seconds after the floor.
 */
async function mintTree(kind: "ethereum" | "base", files: Array<{ name: string; code: number }>, o: { spec?: Uint8Array; afterFloorS?: number } = {}): Promise<Minted> {
  const key = await makeKey();
  const slot = await signedSlot(key, "700");
  const eth = kind === "ethereum" ? floorBlock() : null;
  const base = kind === "base" ? baseBlock() : null;
  const commitment = eth ? computeSlotCommitment2(slot, eth.hash) : computeSlotCommitment3(slot, base!.hash);
  const made = files.map((f) => ({ name: f.name, original: utf8(`${f.name}: a member of a tree, kept for its own BitGraphed file.\n`), ...leafFor(f.code, utf8(`${f.name}: a member of a tree, kept for its own BitGraphed file.\n`), commitment) }));
  const built = buildTree(made.map((m) => m.leaf));
  const rootDocument = buildTreeRootDocument(commitment, built.sorted.length, built.root);
  const indexOf = (l: TreeLeaf) => built.sorted.findIndex((x) => bytesToHex(x.artifact) === bytesToHex(l.artifact));
  const members: Member[] = made.map((m) => {
    const i = indexOf(m.leaf);
    return { name: m.name, original: m.original, committed: m.committed, leaf: m.leaf, evidence: buildTreeMemberEvidence(built.sorted[i]!, i, built.sorted.length, built.tree.path(i)) };
  });
  const attribution = treeAttribution(o.spec ?? currentTreeSpecHash(kind === "base" ? 3 : 2));
  const commit = {
    nonceB64: slot.nonceB64,
    counter: (BigInt(slot.counter) + 3n).toString(),
    epochId: slot.epochId,
    slotCounter: slot.counter,
    slotHashB64: b64(sha256(canonicalize(canonicalSlotBody(slot)))),
    chainId: "bitgraph:main",
    ...(eth ? { slotAnchor: { counter: "699", blockNumber: FLOOR_NUMBER, blockHash: eth.hash } } : { slotFloor: slotFloorOf(base!) }),
  };
  const signed = await signBody(key, { hashAlg: "sha256", digestB64: b64(sha256(rootDocument)) }, commit as never, "test-measurement-tree", { attribution });
  signed.slotAllocation = slot;
  const floorTime = eth ? FLOOR_TIME : BASE_FLOOR_TIME;
  const proof = await attest(signed, key, (floorTime + (o.afterFloorS ?? 20)) * 1000, t);
  if (eth) {
    const anchor = await anchorProof(key, "696", "699", FLOOR_NUMBER, eth.hash);
    const next = floorBlock(FLOOR_NUMBER + 1, FLOOR_TIME + 12);
    const closingAnchor = await anchorProof(key, "704", "707", FLOOR_NUMBER + 1, next.hash);
    return {
      kind, key, proof, rootDocument, members, floorHeaderHex: eth.headerHex,
      floor: { status: "present", anchor: anchor as unknown as CarrierProof, witness: { headerRlpHex: eth.headerHex, blockNumber: FLOOR_NUMBER, blockHash: eth.hash } },
      closing: { anchor: closingAnchor as unknown as CarrierProof, witness: { headerRlpHex: next.headerHex, blockNumber: FLOOR_NUMBER + 1, blockHash: next.hash } },
    };
  }
  return { kind, key, proof, rootDocument, members, floorHeaderHex: base!.headerHex, floor: { status: "present", basis: "base-header", header: base!.headerHex } };
}

/** One member's BitGraphed file: its committed bytes, then the /4 block. */
function memberFile(m: Minted, member: Member, o: { inner?: Uint8Array; payload?: Partial<CarrierPayload>; sidecar?: Record<string, unknown>; writer?: string } = {}): { payload: CarrierPayload; bytes: Uint8Array } {
  const payload = {
    ...assembleCarrierV4Payload({
      proof: m.proof as unknown as CarrierProof,
      ...(o.writer ? { pins: { ceilingWriter: o.writer, chains: { ethereum: 1, base: BASE_TEST_CHAIN } } } : {}),
      floor: m.floor,
      ceilingInTime: o.sidecar ? { status: "present", sidecar: o.sidecar } : { status: "unfetched" },
      tree: { rootDocument: bytesToHex(m.rootDocument), member: member.evidence },
    }),
    ...(o.payload ?? {}),
  } as CarrierPayload;
  return { payload, bytes: buildCarrier(o.inner ?? member.committed, payload) };
}

describe("bitgraph-carrier/4: a tree member carries its own proof", () => {
  test("Base floor, a placed member of two: TRUE, the content floor, no ceiling in position", async () => {
    const m = await mintTree("base", [{ name: "photo", code: 0x01 }, { name: "notes", code: 0x00 }]);
    const placed = m.members.find((x) => x.name === "photo")!;
    const { payload, bytes } = memberFile(m, placed);
    assert.equal(payload.carrier, CARRIER_VERSION_4);
    assert.deepEqual(Object.keys(payload).slice(0, 4), ["carrier", "proof", "tree", "floor"]);
    assert.deepEqual(payload.ceiling, { status: "none", basis: "hash-chain" }, "over a Base floor no ceiling in position exists");
    assert.equal(innerDigestMatches(placed.committed, payload), true, "the bytes are the leaf's");
    assert.equal(innerDigestMatches(placed.original, payload), false, "the original is not the leaf's committed bytes");
    assert.equal(bytesToHex(memberArtifactDigest(payload)!), bytesToHex(placed.leaf.artifact));

    const r = await verifyCarrier(bytes, { pins: pinsFor(t) });
    assert.equal(r.verdict, "TRUE", r.reasons.join("; "));
    assert.equal(r.version, 4);
    assert.equal(r.ceiling, "none");
    for (const id of ["block", "spec.pin", "tree.root", "tree.member", "bytes.digest", "proof.fused", "proof.signature", "floor.binding", "floor.header", "attestation.pins"]) {
      assert.equal(result(r, id), "TRUE", `${id}: ${claim(r, id)?.detail}`);
    }
    assert.equal(result(r, "ceiling.position"), "NOT_CARRIED");
    assert.equal(r.floorCovers, "content");
    assert.equal(r.member?.placement, "trailer/1");
    assert.equal(r.member?.count, 2);
    assert.match(claim(r, "tree.member")!.detail, /a path proves this leaf only, not the order of the others/);
    assert.match(r.reading, new RegExp(`These exact bytes are leaf ${placed.evidence.index} of 2 in the committed tree and carry the commitment, so they were finished after the floor block \\(the content floor\\); an original inside them is not dated by it\\.`));
    assert.match(r.reading, new RegExp(`Recorded after Base block ${BASE_FLOOR_NUMBER} \\([0-9T:-]+Z\\); its order among BitGraphs is the chain of proof hashes\\.`));
    assert.match(r.reading, /The proof names the tree's root document; the bytes before that block \(SHA-256 [0-9a-f]{64}\) are the tree member the block names/);
    assert.doesNotMatch(r.reading, /Ethereum|anchoring/);
  });

  test("Base floor, the member kept as is: TRUE, the record floor only, the bytes not dated", async () => {
    const m = await mintTree("base", [{ name: "photo", code: 0x01 }, { name: "notes", code: 0x00 }]);
    const asIs = m.members.find((x) => x.name === "notes")!;
    const r = await verifyCarrier(memberFile(m, asIs).bytes, { pins: pinsFor(t) });
    assert.equal(r.verdict, "TRUE", r.reasons.join("; "));
    assert.equal(result(r, "bytes.digest"), "TRUE");
    assert.equal(result(r, "proof.fused"), "NOT_CARRIED");
    assert.match(claim(r, "proof.fused")!.detail, /kept as is: the bytes carry no commitment, so the bytes themselves are not dated/);
    assert.equal(r.floorCovers, "record");
    assert.equal(r.member?.placement, "as-is");
    assert.match(r.reading, new RegExp(`These exact bytes are leaf ${asIs.evidence.index} of 2 in the committed tree, kept as is: they carry no commitment, so the bytes themselves are not dated \\(the record floor only\\)\\.`));
    assert.doesNotMatch(r.reading, /finished after/);
  });

  test("Ethereum floor, a tree of one (container/2): TRUE, the anchor floor; the closing anchor stamps in later", async () => {
    const m = await mintTree("ethereum", [{ name: "letter", code: 0x03 }]);
    const only = m.members[0]!;
    assert.equal(only.evidence.count, 1);
    assert.deepEqual(only.evidence.path, [], "a tree of one has an empty path");
    const { payload, bytes } = memberFile(m, only);
    assert.deepEqual(payload.ceiling, { status: "unfetched" });
    const r = await verifyCarrier(bytes, { pins: pinsFor(t) });
    assert.equal(r.verdict, "TRUE", r.reasons.join("; "));
    for (const id of ["tree.root", "tree.member", "bytes.digest", "proof.fused", "floor.anchor", "floor.binding", "floor.header"]) {
      assert.equal(result(r, id), "TRUE", `${id}: ${claim(r, id)?.detail}`);
    }
    assert.equal(r.member?.placement, "container/2");
    assert.equal(result(r, "ceiling.position.binding"), "NOT_CARRIED");
    assert.match(r.reading, new RegExp(`Recorded after Ethereum block ${FLOOR_NUMBER}`));

    const done = completeCarrier(bytes, { anchor: m.closing!.anchor, witness: m.closing!.witness });
    assert.equal(done.error, undefined);
    assert.equal(done.changed, true);
    const after = parseCarrier(done.bytes);
    assert.equal(after.kind === "carrier" && after.payload.carrier, CARRIER_VERSION_4, "completion keeps the version and the tree");
    assert.equal(after.kind === "carrier" && bytesToHex(after.inner), bytesToHex(only.committed), "the committed bytes never change");
    const r2 = await verifyCarrier(done.bytes, { pins: pinsFor(t) });
    assert.equal(r2.verdict, "TRUE", r2.reasons.join("; "));
    assert.equal(result(r2, "ceiling.position.binding"), "TRUE");
    assert.match(r2.reading, new RegExp(`committed before the anchoring of Ethereum block ${FLOOR_NUMBER + 1}, a bound in position`));
  });

  test("a multi-file tree: every member gets its own file, and each verifies alone", async () => {
    const m = await mintTree("ethereum", [{ name: "a", code: 0x01 }, { name: "b", code: 0x03 }, { name: "c", code: 0x00 }, { name: "d", code: 0x01 }, { name: "e", code: 0x03 }]);
    const seen = new Set<number>();
    for (const member of m.members) {
      const r = await verifyCarrier(memberFile(m, member).bytes, { pins: pinsFor(t) });
      assert.equal(r.verdict, "TRUE", `${member.name}: ${r.reasons.join("; ")}`);
      assert.equal(r.member?.index, member.evidence.index);
      assert.equal(r.member?.count, 5);
      assert.equal(r.floorCovers, member.leaf.placement === 0x00 ? "record" : "content");
      seen.add(member.evidence.index);
    }
    assert.equal(seen.size, 5);
  });

  test("the ceiling in time travels and verifies inside a member's file", async () => {
    const m = await mintTree("ethereum", [{ name: "a", code: 0x01 }, { name: "b", code: 0x00 }]);
    const w = chainWorld(m.proof, m.floorHeaderHex, { baseTime: FLOOR_TIME + 40 });
    const r = await verifyCarrier(memberFile(m, m.members[0]!, { sidecar: w.sidecar as unknown as Record<string, unknown>, writer: w.writer }).bytes, { pins: { ...pinsFor(t), ceilingWriter: w.writer, baseChainId: BASE_TEST_CHAIN } });
    assert.equal(r.verdict, "TRUE", r.reasons.join("; "));
    assert.equal(result(r, "ceiling.time.inclusion"), "TRUE");
    assert.equal(r.bounds?.existedBy?.timestamp, FLOOR_TIME + 40);
    assert.match(r.reading, /, and existed by Base block 30000000 \(/);
  });

  test("Base floor: the ceiling in time stamps in; a closing anchor never does", async () => {
    const m = await mintTree("base", [{ name: "a", code: 0x01 }]);
    const { bytes } = memberFile(m, m.members[0]!);
    const c = completeCarrier(bytes, null, { asOfCounter: "900", epochId: "e" });
    assert.equal(c.changed, false);
    assert.match(c.error ?? "", /^a block over a Base floor has no ceiling in position: its order is the chain of proof hashes/);
    const ct = completeCarrierInTime(bytes, null, { at: "2026-10-11T00:00:00.000Z" });
    assert.equal(ct.changed, true);
    const p = parseCarrier(ct.bytes);
    assert.ok(p.kind === "carrier" && p.payload.carrier === CARRIER_VERSION_4 && p.payload.tree !== undefined);
  });

  test("without the file (a proof page): the tree is judged, the bytes are not carried", async () => {
    const m = await mintTree("base", [{ name: "a", code: 0x01 }, { name: "b", code: 0x00 }]);
    const { payload } = memberFile(m, m.members[0]!);
    const r = await verifyCarrierPayload(payload, null, { pins: pinsFor(t) });
    assert.equal(r.verdict, "TRUE", r.reasons.join("; "));
    assert.equal(result(r, "tree.member"), "TRUE");
    assert.equal(result(r, "bytes.digest"), "NOT_CARRIED");
    assert.equal(result(r, "proof.fused"), "NOT_CARRIED");
    assert.match(r.reading, /^The tree this proof names was committed under this position, and leaf \d of 2 is in it\./);
  });
});

describe("bitgraph-carrier/4: what does not verify (the negative cases)", () => {
  test("one byte changed in the committed bytes: FALSE", async () => {
    const m = await mintTree("base", [{ name: "a", code: 0x01 }, { name: "b", code: 0x00 }]);
    for (const member of m.members) {
      const inner = member.committed.slice();
      inner[3] = inner[3]! ^ 0x01;
      const r = await verifyCarrier(memberFile(m, member, { inner }).bytes, { pins: pinsFor(t) });
      assert.equal(r.verdict, "FALSE", member.name);
      assert.equal(result(r, "bytes.digest"), "FALSE", `${member.name}: ${claim(r, "bytes.digest")?.detail}`);
      assert.equal(result(r, "tree.member"), "TRUE", "the evidence itself still holds");
      assert.match(r.reading, /^This file does not verify: the bytes are this member's committed bytes/);
    }
  });

  test("the original in place of a placed member's committed bytes: FALSE, said as such", async () => {
    const m = await mintTree("ethereum", [{ name: "a", code: 0x01 }]);
    const r = await verifyCarrier(memberFile(m, m.members[0]!, { inner: m.members[0]!.original }).bytes, { pins: pinsFor(t) });
    assert.equal(r.verdict, "FALSE");
    assert.match(claim(r, "bytes.digest")!.detail, /original, not its committed bytes/);
  });

  test("a wrong path, a wrong index, a wrong count: FALSE", async () => {
    const m = await mintTree("base", [{ name: "a", code: 0x01 }, { name: "b", code: 0x00 }, { name: "c", code: 0x03 }]);
    const member = m.members[0]!;
    const flip = (h: string) => (h[0] === "0" ? "1" : "0") + h.slice(1);
    const cases: Array<[string, TreeMemberEvidence]> = [
      ["path", { ...member.evidence, path: [flip(member.evidence.path[0]!), ...member.evidence.path.slice(1)] }],
      ["index", { ...member.evidence, index: (member.evidence.index + 1) % 3 }],
      ["count", { ...member.evidence, count: 4 }],
      ["leaf", { ...m.members[1]!.evidence, index: member.evidence.index, path: member.evidence.path }],
    ];
    for (const [what, evidence] of cases) {
      const r = await verifyCarrier(memberFile(m, { ...member, evidence }).bytes, { pins: pinsFor(t) });
      assert.equal(r.verdict, "FALSE", what);
      assert.equal(result(r, "tree.member"), "FALSE", `${what}: ${claim(r, "tree.member")?.detail}`);
    }
  });

  test("another member's bytes under this member's block: FALSE", async () => {
    const m = await mintTree("ethereum", [{ name: "a", code: 0x01 }, { name: "b", code: 0x01 }]);
    const r = await verifyCarrier(memberFile(m, m.members[0]!, { inner: m.members[1]!.committed }).bytes, { pins: pinsFor(t) });
    assert.equal(r.verdict, "FALSE");
    assert.equal(result(r, "bytes.digest"), "FALSE");
  });

  test("a wrong root document: FALSE (it does not hash to the signed digest)", async () => {
    const m = await mintTree("base", [{ name: "a", code: 0x01 }, { name: "b", code: 0x00 }]);
    const other = await mintTree("base", [{ name: "a", code: 0x01 }, { name: "b", code: 0x00 }]);
    const { bytes } = memberFile(m, m.members[0]!, { payload: { tree: { rootDocument: bytesToHex(other.rootDocument), member: m.members[0]!.evidence } } });
    const r = await verifyCarrier(bytes, { pins: pinsFor(t) });
    assert.equal(r.verdict, "FALSE");
    assert.equal(result(r, "tree.root"), "FALSE");
    assert.match(claim(r, "tree.root")!.detail, /does not hash to the signed artifact digest/);
  });

  test("a mismatched proof (another tree's, valid on its own): FALSE", async () => {
    const m = await mintTree("ethereum", [{ name: "a", code: 0x01 }]);
    const other = await mintTree("ethereum", [{ name: "a", code: 0x01 }]);
    const { bytes } = memberFile(m, m.members[0]!, { payload: { proof: other.proof as unknown as CarrierProof } });
    const r = await verifyCarrier(bytes, { pins: pinsFor(t) });
    assert.equal(r.verdict, "FALSE");
    assert.equal(result(r, "proof.signature"), "TRUE", "the other proof is genuine");
    assert.equal(result(r, "tree.root"), "FALSE");
  });

  test("a proof that is not tree/1 inside a /4 block: FALSE", async () => {
    const m = await mintTree("base", [{ name: "a", code: 0x01 }]);
    const notTree = await attest({ ...m.proof, attribution: { name: "bitgraph-fuse/3", title: "trailer/1", message: b64(sha256(m.members[0]!.original)) } } as BitGraphProof, m.key, (BASE_FLOOR_TIME + 20) * 1000, t);
    const r = await verifyCarrier(memberFile(m, m.members[0]!, { payload: { proof: notTree as unknown as CarrierProof } }).bytes, { pins: pinsFor(t) });
    assert.equal(r.verdict, "FALSE");
    assert.equal(result(r, "spec.pin"), "FALSE");
    assert.match(claim(r, "spec.pin")!.detail, /not a tree\/1 proof/);
  });

  test("a spec this verifier does not know: UNDETERMINED, never TRUE or FALSE; known on request: TRUE", async () => {
    const unknown = sha256(utf8("a later SPEC this verifier has not seen (TEST ONLY)"));
    const m = await mintTree("ethereum", [{ name: "a", code: 0x01 }], { spec: unknown });
    const { bytes } = memberFile(m, m.members[0]!);
    const r = await verifyCarrier(bytes, { pins: pinsFor(t) });
    assert.equal(r.verdict, "UNDETERMINED", r.reasons.join("; "));
    assert.equal(result(r, "spec.pin"), "UNDETERMINED");
    assert.equal(result(r, "tree.root"), "UNDETERMINED");
    assert.ok(r.claims.every((c) => c.result !== "FALSE"), "nothing is called false under rules this reader does not have");
    const known = await verifyCarrier(bytes, { pins: pinsFor(t), extraSpecHashes: [b64(unknown)] });
    assert.equal(known.verdict, "TRUE", known.reasons.join("; "));
  });

  test("the floor the proof signs, in its own shape: a Base header for an Ethereum-floored tree is FALSE, and the reverse", async () => {
    const eth = await mintTree("ethereum", [{ name: "a", code: 0x01 }]);
    const base = await mintTree("base", [{ name: "a", code: 0x01 }]);
    const r1 = await verifyCarrier(memberFile(eth, eth.members[0]!, { payload: { floor: base.floor, ceiling: { status: "none", basis: "hash-chain" } } }).bytes, { pins: pinsFor(t) });
    assert.equal(r1.verdict, "FALSE");
    assert.equal(result(r1, "floor.binding"), "FALSE");
    const r2 = await verifyCarrier(memberFile(base, base.members[0]!, { payload: { floor: eth.floor, ceiling: { status: "unfetched" } } }).bytes, { pins: pinsFor(t) });
    assert.equal(r2.verdict, "FALSE");
    assert.match(claim(r2, "floor.binding")!.detail, /the proof signs a Base floor \(commit\.slotFloor\), and this block carries an Ethereum anchor/);
  });

  test("an image the verifier does not accept: never TRUE", async () => {
    const m = await mintTree("base", [{ name: "a", code: 0x01 }]);
    const r = await verifyCarrier(memberFile(m, m.members[0]!).bytes, { pins: { ...pinsFor(t), pcr0: ["00".repeat(48)] } });
    assert.equal(r.verdict, "FALSE");
    assert.equal(result(r, "attestation.pins"), "FALSE");
  });
});

describe("bitgraph-carrier/4: the block's shape", () => {
  test("a /4 block requires its tree member, in export/1's exact shape; and its ceiling follows the floor", async () => {
    const m = await mintTree("base", [{ name: "a", code: 0x01 }, { name: "b", code: 0x00 }]);
    const { payload } = memberFile(m, m.members[0]!);
    const shapeOf = (p: unknown) => parseCarrier(buildCarrier(m.members[0]!.committed, p as CarrierPayload));
    const corrupt = (p: unknown, re: RegExp) => {
      const r = shapeOf(p);
      assert.equal(r.kind, "corrupt", String(re));
      assert.match((r as { reason: string }).reason, re);
    };
    assert.equal(shapeOf(payload).kind, "carrier");
    const tree = payload.tree!;
    corrupt({ ...payload, tree: undefined }, /carries its tree member: "tree" is missing/);
    corrupt({ ...payload, tree: { ...tree, names: ["a"] } }, /exactly rootDocument and member/);
    corrupt({ ...payload, tree: { ...tree, rootDocument: tree.rootDocument.toUpperCase() } }, /rootDocument is not 84 bytes of lowercase hex/);
    corrupt({ ...payload, tree: { ...tree, rootDocument: tree.rootDocument.slice(2) } }, /rootDocument is not 84 bytes/);
    corrupt({ ...payload, tree: { ...tree, member: { ...tree.member, leaf: tree.member.leaf.slice(2) } } }, /leaf is not 65 bytes/);
    corrupt({ ...payload, tree: { ...tree, member: { ...tree.member, index: 2 } } }, /index is not a leaf of the tree/);
    corrupt({ ...payload, tree: { ...tree, member: { ...tree.member, path: ["xyz"] } } }, /path is not a list of 32-byte/);
    corrupt({ ...payload, tree: { ...tree, member: { ...tree.member, extra: 1 } } }, /exactly index, count, leaf and path/);
    corrupt({ ...payload, ceiling: { status: "unfetched" } }, /over a Base floor states no ceiling in position/);
    corrupt({ ...payload, ceilingInTime: undefined }, /ceilingInTime is missing/);
    corrupt({ ...payload, carrier: "bitgraph-carrier/5" }, /unknown carrier version "bitgraph-carrier\/5"/);
    const eth = await mintTree("ethereum", [{ name: "a", code: 0x01 }]);
    const ep = memberFile(eth, eth.members[0]!).payload;
    assert.equal(shapeOf(ep).kind, "carrier");
    corrupt({ ...ep, ceiling: { status: "none", basis: "hash-chain" } }, /ceiling status must be "unfetched" or "present"/);
    corrupt({ ...ep, floor: { ...ep.floor, basis: "other" } }, /unknown floor basis "other"/);
  });

  test("a newer block than this reader knows is UNDETERMINED, never a verdict (how a /3 reader meets /4)", async () => {
    const m = await mintTree("base", [{ name: "a", code: 0x01 }]);
    const { payload } = memberFile(m, m.members[0]!);
    const r = await verifyCarrier(buildCarrier(m.members[0]!.committed, { ...payload, carrier: "bitgraph-carrier/5" } as unknown as CarrierPayload));
    assert.equal(r.verdict, "UNDETERMINED");
    assert.equal(r.carrier, "corrupt");
    assert.match(r.reading, /a damaged or newer block, not a verdict on the file/);
  });

  test("/1 to /3 read exactly as before: a tree field on them is not theirs and changes nothing", async () => {
    const m = await mintTree("base", [{ name: "a", code: 0x01 }]);
    const v3 = assembleCarrierV3Payload({ proof: m.proof as unknown as CarrierProof, floor: m.floor as CarrierBaseFloor, ceilingInTime: { status: "unfetched" } });
    const asV3 = await verifyCarrier(buildCarrier(m.members[0]!.committed, v3), { pins: pinsFor(t) });
    assert.equal(asV3.version, 3);
    assert.equal(asV3.verdict, "FALSE", "a tree member carried as /3 hashes against the root document's digest, as a /3 reader always did");
    assert.equal(result(asV3, "bytes.digest"), "FALSE");
    const eth = await mintTree("ethereum", [{ name: "a", code: 0x01 }]);
    const v2 = assembleCarrierV2Payload({ proof: eth.proof as unknown as CarrierProof, floor: eth.floor as CarrierFloor, ceiling: { status: "unfetched" }, ceilingInTime: { status: "unfetched" } });
    const withTree = { ...v2, tree: { rootDocument: bytesToHex(eth.rootDocument), member: eth.members[0]!.evidence } } as CarrierPayload;
    const p = parseCarrier(buildCarrier(eth.members[0]!.committed, withTree));
    assert.equal(p.kind, "carrier");
    assert.equal(p.kind === "carrier" && innerDigestMatches(p.inner, p.payload), false, "a /2 block compares with the proof's digest, tree field or not");
    const r = await verifyCarrier(buildCarrier(eth.members[0]!.committed, withTree), { pins: pinsFor(t) });
    assert.equal(r.version, 2);
    assert.equal(result(r, "bytes.digest"), "FALSE");
    assert.equal(result(r, "tree.member"), undefined, "no tree claims on a /2 block");
  });
});
