/**
 * bitgraph-fuse/2: the commitment binds the floor block, so a fused file's
 * content floor rests on the block hash, not on the enclave's counter.
 * Fixtures minted by the unmodified enclave v9 on the local harness
 * (server/commit-service/local-enclave/make-fuse2-fixtures.mts).
 */
import { test } from "node:test";
import * as assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
  verifyFuse, verifyProofIntegrity, bytesToHex, computeSlotCommitment, computeSlotCommitment2,
  slotCommitment2Preimage, commitmentForProof, fuseVersionOfName, isFuseMarkerName, readFuseAttribution,
  FUSE2_ATTRIBUTION_NAME, resetEpochLinkState,
} from "@mikeargento/bitgraph-verify";
import type { BitGraphProof, SlotAllocation } from "@mikeargento/bitgraph-verify";

const FIX = fileURLToPath(new URL("../../src/__tests__/fuse2-fixtures/", import.meta.url));
const bytes = (name: string) => new Uint8Array(readFileSync(FIX + name));
const json = <T>(name: string) => JSON.parse(readFileSync(FIX + name, "utf8")) as T;
const proofOf = (name: string) => json<BitGraphProof>(name);

test("the fuse/2 vector: preimage and commitment are exactly the spec's", () => {
  const v = json<{ slot: SlotAllocation; floorBlockHash: string; slotRecordHashHex: string; preimageHex: string; commitmentHex: string; fuse1CommitmentHex: string }>("trailer2.vector.json");
  const pre = bytesToHex(slotCommitment2Preimage(v.slot, v.floorBlockHash));
  assert.equal(pre, v.preimageHex);
  // "bitgraph-fuse/2" (15 bytes) + 0x00 + 32 + 32 + 32
  assert.equal(pre.length / 2, 16 + 32 + 32 + 32);
  assert.ok(pre.startsWith(bytesToHex(new TextEncoder().encode("bitgraph-fuse/2")) + "00"));
  assert.ok(pre.endsWith(v.floorBlockHash.slice(2).toLowerCase()));
  assert.equal(bytesToHex(computeSlotCommitment2(v.slot, v.floorBlockHash)), v.commitmentHex);
  assert.notEqual(v.commitmentHex, v.fuse1CommitmentHex, "fuse/2 and fuse/1 commitments must differ");
});

test("marker names: fuse/2 is recognized as fused, with its version", () => {
  assert.equal(fuseVersionOfName("bitgraph-fuse/1"), 1);
  assert.equal(fuseVersionOfName(FUSE2_ATTRIBUTION_NAME), 2);
  assert.equal(fuseVersionOfName("bitgraph-fuse/3"), null);
  assert.ok(isFuseMarkerName("bitgraph-fuse/2"));
  const m = readFuseAttribution(proofOf("trailer2.proof.json"));
  assert.equal(m?.version, 2);
  assert.equal(m?.placement, "trailer/1");
});

test("a fuse/2 trailer file verifies FUSED_DIRECT, bound to its signed floor block", async () => {
  resetEpochLinkState();
  const proof = proofOf("trailer2.proof.json");
  assert.ok(proof.commit.slotAnchor, "a fuse/2 proof carries its signed floor");
  const r = await verifyFuse({ proof, bytes: bytes("fused2-trailer.bin") });
  assert.equal(r.category, "FUSED_DIRECT", r.reason ?? "");
  const expected = computeSlotCommitment2(proof.slotAllocation!, proof.commit.slotAnchor!.blockHash);
  assert.equal(bytesToHex(commitmentForProof(proof, proof.slotAllocation!)), bytesToHex(expected));
});

test("the original rebuilds the fuse/2 file byte for byte", async () => {
  resetEpochLinkState();
  const r = await verifyFuse({ proof: proofOf("trailer2.proof.json"), bytes: bytes("original.txt") });
  assert.equal(r.category, "FUSED_FROM_ORIGIN", r.reason ?? "");
});

test("a made file carrying commitment/2 inline verifies CARRIED_INLINE", async () => {
  resetEpochLinkState();
  const r = await verifyFuse({ proof: proofOf("made2.proof.json"), bytes: bytes("made2.txt") });
  assert.equal(r.category, "CARRIED_INLINE", r.reason ?? "");
});

test("NEGATIVE: a fuse/2 marker over a fuse/1 commitment is refused", async () => {
  resetEpochLinkState();
  const r = await verifyFuse({ proof: proofOf("wrong2.proof.json"), bytes: bytes("fused2-wrong-commitment.bin") });
  assert.equal(r.category, "INVALID_SLOT_COMMITMENT", r.reason ?? "");
});

test("NEGATIVE: swapping the floor block breaks the commitment (and the signature)", async () => {
  const proof = proofOf("trailer2.proof.json");
  const other = "0x" + "11".repeat(32);
  const swapped = computeSlotCommitment2(proof.slotAllocation!, other);
  assert.notEqual(bytesToHex(swapped), bytesToHex(commitmentForProof(proof, proof.slotAllocation!)));
  resetEpochLinkState();
  const forged = { ...proof, commit: { ...proof.commit, slotAnchor: { ...proof.commit.slotAnchor!, blockHash: other } } };
  const integrity = await verifyProofIntegrity({ proof: forged as BitGraphProof });
  assert.equal(integrity.valid, false, "the floor is inside the commit signature");
});

test("fuse/1 from the same enclave is unchanged", async () => {
  resetEpochLinkState();
  const proof = proofOf("trailer1.proof.json");
  const r = await verifyFuse({ proof, bytes: bytes("fused1-trailer.bin") });
  assert.equal(r.category, "FUSED_DIRECT", r.reason ?? "");
  assert.equal(bytesToHex(commitmentForProof(proof, proof.slotAllocation!)), bytesToHex(computeSlotCommitment(proof.slotAllocation!)));
});

test("an old reader's view: a fuse/2 proof is an ordinary valid proof", async () => {
  resetEpochLinkState();
  const proof = proofOf("trailer2.proof.json");
  const integrity = await verifyProofIntegrity({ proof });
  assert.equal(integrity.valid, true);
  // A fuse/1-only reader matches the marker by exact name and finds none.
  assert.notEqual(proof.attribution?.name, "bitgraph-fuse/1");
});
