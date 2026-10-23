/**
 * bitgraph-fuse/3: the commitment binds a Base floor block (commit.slotFloor),
 * fixed by the enclave at allocation (enclave v10). Fixtures minted by the
 * unmodified enclave v10 on the local harness with a stand-in Base node
 * (server/commit-service/local-enclave/make-fuse3-fixtures.mts).
 */
import { test } from "node:test";
import * as assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
  verifyFuse, verifyProofIntegrity, bytesToHex, computeSlotCommitment, computeSlotCommitment2, computeSlotCommitment3,
  slotCommitment3Preimage, commitmentForProof, producerCommitment, fuseVersionOfName, fuseNameOfVersion, isFuseMarkerName,
  readFuseAttribution, signedFloorOf, FUSE3_ATTRIBUTION_NAME, resetEpochLinkState,
} from "@mikeargento/bitgraph-verify";
import type { BitGraphProof, SlotAllocation } from "@mikeargento/bitgraph-verify";

const FIX = fileURLToPath(new URL("../../src/__tests__/fuse3-fixtures/", import.meta.url));
const bytes = (name: string) => new Uint8Array(readFileSync(FIX + name));
const json = <T>(name: string) => JSON.parse(readFileSync(FIX + name, "utf8")) as T;
const proofOf = (name: string) => json<BitGraphProof>(name);

test("the fuse/3 vector: preimage and commitment are exactly the spec's", () => {
  const v = json<{ slot: SlotAllocation; floorBlockHash: string; preimageHex: string; commitmentHex: string; fuse2CommitmentHex: string; fuse1CommitmentHex: string }>("trailer3.vector.json");
  const pre = bytesToHex(slotCommitment3Preimage(v.slot, v.floorBlockHash));
  assert.equal(pre, v.preimageHex);
  // "bitgraph-fuse/3" (15 bytes) + 0x00 + 32 + 32 + 32
  assert.equal(pre.length / 2, 16 + 32 + 32 + 32);
  assert.ok(pre.startsWith(bytesToHex(new TextEncoder().encode("bitgraph-fuse/3")) + "00"));
  assert.ok(pre.endsWith(v.floorBlockHash.slice(2).toLowerCase()));
  assert.equal(bytesToHex(computeSlotCommitment3(v.slot, v.floorBlockHash)), v.commitmentHex);
  assert.notEqual(v.commitmentHex, v.fuse2CommitmentHex, "fuse/3 and fuse/2 commitments over the same block must differ (the domain separates them)");
  assert.notEqual(v.commitmentHex, v.fuse1CommitmentHex);
});

test("marker names: fuse/3 is recognized as fused, with its version", () => {
  assert.equal(fuseVersionOfName(FUSE3_ATTRIBUTION_NAME), 3);
  assert.equal(fuseNameOfVersion(3), "bitgraph-fuse/3");
  assert.equal(fuseVersionOfName("bitgraph-fuse/4"), null);
  assert.ok(isFuseMarkerName("bitgraph-fuse/3"));
  const m = readFuseAttribution(proofOf("trailer3.proof.json"));
  assert.equal(m?.version, 3);
  assert.equal(m?.placement, "trailer/1");
});

test("a v10 proof signs exactly one floor, a Base block, and names its chain", () => {
  const p = proofOf("trailer3.proof.json");
  assert.equal(p.commit.slotAnchor, undefined);
  const f = signedFloorOf(p);
  assert.equal(f?.chain, "base");
  assert.equal(p.commit.slotFloor?.evmChainId, 8453);
  assert.equal(p.commit.slotFloor?.blockTimestamp, 1686789347 + 2 * p.commit.slotFloor!.blockNumber, "the floor's time is Base mainnet's schedule for its number");
});

test("the producer picks fuse/3 for a Base floor and fuse/2 for an Ethereum anchor", () => {
  const p = proofOf("trailer3.proof.json");
  const slot = p.slotAllocation!;
  assert.equal(producerCommitment(slot, p.commit.slotFloor!).version, 3);
  const ethAnchor: { blockHash: string } = { blockHash: p.commit.slotFloor!.blockHash };
  assert.equal(producerCommitment(slot, ethAnchor).version, 2);
  assert.equal(producerCommitment(slot, null).version, 1);
});

test("a fuse/3 trailer file verifies FUSED_DIRECT, bound to its signed Base floor", async () => {
  resetEpochLinkState();
  const proof = proofOf("trailer3.proof.json");
  const r = await verifyFuse({ proof, bytes: bytes("fused3-trailer.bin") });
  assert.equal(r.category, "FUSED_DIRECT", r.reason ?? "");
  const expected = computeSlotCommitment3(proof.slotAllocation!, proof.commit.slotFloor!.blockHash);
  assert.equal(bytesToHex(commitmentForProof(proof, proof.slotAllocation!)), bytesToHex(expected));
});

test("the original rebuilds the fuse/3 file byte for byte", async () => {
  resetEpochLinkState();
  const r = await verifyFuse({ proof: proofOf("trailer3.proof.json"), bytes: bytes("original.txt") });
  assert.equal(r.category, "FUSED_FROM_ORIGIN", r.reason ?? "");
});

test("a made file carrying commitment/3 inline verifies CARRIED_INLINE", async () => {
  resetEpochLinkState();
  const r = await verifyFuse({ proof: proofOf("made3.proof.json"), bytes: bytes("made3.txt") });
  assert.equal(r.category, "CARRIED_INLINE", r.reason ?? "");
});

test("NEGATIVE: a fuse/2 marker over a Base floor is refused (fuse/2 binds only an Ethereum anchor)", async () => {
  resetEpochLinkState();
  const r = await verifyFuse({ proof: proofOf("as-fuse2.proof.json"), bytes: bytes("fused3-as-fuse2.bin") });
  assert.equal(r.category, "INVALID_SLOT_COMMITMENT", r.reason ?? "");
});

test("NEGATIVE: a fuse/3 marker over a fuse/1 commitment is refused", async () => {
  resetEpochLinkState();
  const r = await verifyFuse({ proof: proofOf("wrong3.proof.json"), bytes: bytes("fused3-wrong-commitment.bin") });
  assert.equal(r.category, "INVALID_SLOT_COMMITMENT", r.reason ?? "");
});

test("NEGATIVE: a proof signing both floors is ambiguous and binds nothing", () => {
  const p = proofOf("trailer3.proof.json");
  const both = { ...p, commit: { ...p.commit, slotAnchor: { counter: "1", blockNumber: 1, blockHash: "0x" + "22".repeat(32) } } } as BitGraphProof;
  assert.throws(() => signedFloorOf(both), /two floors/);
  assert.throws(() => commitmentForProof(both, both.slotAllocation!), /two floors/);
});

test("NEGATIVE: a slotFloor that does not name Base mainnet binds nothing", () => {
  const p = proofOf("trailer3.proof.json");
  const other = { ...p, commit: { ...p.commit, slotFloor: { ...p.commit.slotFloor!, evmChainId: 84532 } } } as unknown as BitGraphProof;
  assert.throws(() => commitmentForProof(other, other.slotAllocation!), /Base mainnet/);
});

test("NEGATIVE: swapping the Base floor breaks the commitment and the signature", async () => {
  const proof = proofOf("trailer3.proof.json");
  const other = "0x" + "11".repeat(32);
  assert.notEqual(bytesToHex(computeSlotCommitment3(proof.slotAllocation!, other)), bytesToHex(commitmentForProof(proof, proof.slotAllocation!)));
  resetEpochLinkState();
  const forged = { ...proof, commit: { ...proof.commit, slotFloor: { ...proof.commit.slotFloor!, blockHash: other } } };
  const integrity = await verifyProofIntegrity({ proof: forged as BitGraphProof });
  assert.equal(integrity.valid, false, "the floor is inside the signed body");
});

test("fuse/2 and fuse/1 commitments from the same slot differ from fuse/3", () => {
  const p = proofOf("trailer3.proof.json");
  const h = p.commit.slotFloor!.blockHash;
  const s = p.slotAllocation!;
  assert.notEqual(bytesToHex(computeSlotCommitment3(s, h)), bytesToHex(computeSlotCommitment2(s, h)));
  assert.notEqual(bytesToHex(computeSlotCommitment3(s, h)), bytesToHex(computeSlotCommitment(s)));
});
