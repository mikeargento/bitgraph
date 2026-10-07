// The site's bitgraph-fuse/2 pieces against the vector the v9 enclave minted
// (repo src/__tests__/fuse2-fixtures, made by local-enclave/make-fuse2-fixtures.mts).
import { test } from "node:test";
import * as assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { computeCommitmentFor } from "../fuse-commitment.ts";
import { isFuseName, isAnchorMark, isFusedProof, fusedOriginDigestOf, FUSE2_ATTRIBUTION_NAME } from "../fuse-core.ts";

const FIX = new URL("../../../../src/__tests__/fuse2-fixtures/", import.meta.url);
const vec = JSON.parse(readFileSync(new URL("trailer2.vector.json", FIX), "utf8"));
const proof2 = JSON.parse(readFileSync(new URL("trailer2.proof.json", FIX), "utf8"));
const hex = (b: Uint8Array) => Buffer.from(b).toString("hex");

test("the site's commitment/2 equals the enclave-minted vector", () => {
  assert.equal(hex(computeCommitmentFor(vec.slot, vec.floorBlockHash)), vec.commitmentHex);
  assert.equal(hex(computeCommitmentFor(vec.slot, null)), vec.fuse1CommitmentHex);
});

test("every marker name reads as fused (fuse/3 since enclave v10); the origin is read from either", () => {
  assert.ok(isFuseName("bitgraph-fuse/1") && isFuseName(FUSE2_ATTRIBUTION_NAME) && isFuseName("bitgraph-fuse/3") && !isFuseName("bitgraph-fuse/4"));
  assert.ok(isFusedProof(proof2));
  assert.equal(fusedOriginDigestOf(proof2), proof2.attribution.message);
});

test("an allocation's anchor is recognized; malformed ones are not", () => {
  assert.ok(isAnchorMark(proof2.commit.slotAnchor));
  assert.ok(!isAnchorMark({ counter: "1", blockNumber: 1, blockHash: "0xZZ" }));
  assert.ok(!isAnchorMark({ counter: 1, blockNumber: 1, blockHash: "0x" + "a".repeat(64) }));
});

// The Base floor's suite (fuse/3, enclave v10) runs with this one under test:fuse.
import "./base-floor.test.ts";
