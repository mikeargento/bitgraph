/**
 * Regression test: all code paths must produce identical proofHash.
 *
 * Simulates the hash computation as done by:
 *   1. computeProofHash() from bitgraph (canonical)
 *   2. Inline signed-body + canonicalize + sha256 (how ledger s3.ts USED to do it)
 *   3. Any other path
 *
 * If these ever diverge, this test fails.
 */
import { describe, it } from "node:test";
import * as assert from "node:assert/strict";
import { sha256 } from "@noble/hashes/sha256";
import { computeProofHash, canonicalize } from "../index.js";
// Fixture extracted verbatim to a shared non-test module so other suites
// (audit attestation honesty tests) can import it without re-registering
// this file's suites. Values unchanged.
import { REALISTIC_PROOF } from "./realistic-proof-fixture.js";

/**
 * Inline signed-body hash — the OLD way ledger s3.ts computed it.
 * This must produce the same result as computeProofHash().
 */
function inlineSignedBodyHash(proof: Record<string, unknown>): string {
  const signer = proof.signer as { publicKeyB64: string };
  const env = proof.environment as { enforcement: string; measurement: string; attestation?: { format: string } };

  const signedBody: Record<string, unknown> = {
    version: proof.version,
    artifact: proof.artifact,
    commit: proof.commit,
    publicKeyB64: signer.publicKeyB64,
    enforcement: env.enforcement,
    measurement: env.measurement,
  };
  if (proof.attribution) signedBody.attribution = proof.attribution;
  if (env.attestation) signedBody.attestationFormat = env.attestation.format;

  return Buffer.from(sha256(canonicalize(signedBody))).toString("base64");
}

describe("proof hash regression — all paths must agree", () => {
  it("computeProofHash matches inline signed-body hash (with attribution)", () => {
    const canonical = computeProofHash(REALISTIC_PROOF);
    const inline = inlineSignedBodyHash(REALISTIC_PROOF);
    assert.equal(canonical, inline, "hash drift detected: computeProofHash vs inline");
  });

  it("computeProofHash matches inline signed-body hash (without attribution)", () => {
    const noAttr = { ...REALISTIC_PROOF } as Record<string, unknown>;
    delete noAttr.attribution;
    const canonical = computeProofHash(noAttr);
    const inline = inlineSignedBodyHash(noAttr);
    assert.equal(canonical, inline, "hash drift detected without attribution");
  });

  it("computeProofHash matches inline signed-body hash (without attestation)", () => {
    const noAttest = {
      ...REALISTIC_PROOF,
      environment: {
        enforcement: REALISTIC_PROOF.environment.enforcement,
        measurement: REALISTIC_PROOF.environment.measurement,
      },
    };
    const canonical = computeProofHash(noAttest);
    const inline = inlineSignedBodyHash(noAttest);
    assert.equal(canonical, inline, "hash drift detected without attestation");
  });

  it("anchor proof and user proof use the same hash function", () => {
    // User proof (no attribution)
    const userProof = { ...REALISTIC_PROOF } as Record<string, unknown>;
    delete userProof.attribution;

    // Anchor proof (has attribution)
    const anchorProof = REALISTIC_PROOF;

    // Both should work with the same function
    const userHash = computeProofHash(userProof);
    const anchorHash = computeProofHash(anchorProof);

    // They should be different (different inputs) but both valid
    assert.notEqual(userHash, anchorHash, "user and anchor proofs with different data should differ");
    assert.equal(Buffer.from(userHash, "base64").length, 32, "user hash should be SHA-256");
    assert.equal(Buffer.from(anchorHash, "base64").length, 32, "anchor hash should be SHA-256");
  });

  it("adding slotAllocation or metadata does not change hash", () => {
    const bare = { ...REALISTIC_PROOF } as Record<string, unknown>;
    delete bare.slotAllocation;

    const withSlot = { ...REALISTIC_PROOF };

    const withMetadata = {
      ...REALISTIC_PROOF,
      metadata: { type: "ethereum-anchor", extra: true },
      timestamps: { artifact: { time: 1234567890 } },
    };

    const bareHash = computeProofHash(bare);
    const withSlotHash = computeProofHash(withSlot);
    const withMetaHash = computeProofHash(withMetadata);

    assert.equal(bareHash, withSlotHash, "slotAllocation should not affect hash");
    assert.equal(bareHash, withMetaHash, "metadata/timestamps should not affect hash");
  });
});
