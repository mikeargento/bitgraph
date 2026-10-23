import { describe, it } from "node:test";
import * as assert from "node:assert/strict";
import { sha256 } from "@noble/hashes/sha256";
import { computeProofHash, canonicalize } from "../index.js";
import type { BitGraphProof } from "../index.js";
// Fixture moved verbatim to a shared non-test module so other suites can
// import it without re-registering this file's describes under node:test.
import { MOCK_PROOF } from "./mock-proof-fixture.js";

describe("computeProofHash", () => {
  it("produces base64-encoded SHA-256", () => {
    const hash = computeProofHash(MOCK_PROOF);
    // Base64 of SHA-256 is always 44 chars (with padding)
    assert.ok(hash.length > 0 && hash.length <= 44, `unexpected hash length: ${hash.length}`);
    // Valid base64
    const decoded = Buffer.from(hash, "base64");
    assert.equal(decoded.length, 32, "SHA-256 output should be 32 bytes");
  });

  it("matches manual signed-body computation", () => {
    const signedBody: Record<string, unknown> = {
      version: MOCK_PROOF.version,
      artifact: MOCK_PROOF.artifact,
      commit: MOCK_PROOF.commit,
      publicKeyB64: MOCK_PROOF.signer.publicKeyB64,
      enforcement: MOCK_PROOF.environment.enforcement,
      measurement: MOCK_PROOF.environment.measurement,
      attribution: MOCK_PROOF.attribution,
      attestationFormat: MOCK_PROOF.environment.attestation!.format,
    };
    const expected = Buffer.from(sha256(canonicalize(signedBody))).toString("base64");
    const actual = computeProofHash(MOCK_PROOF);
    assert.equal(actual, expected, "computeProofHash must match manual signed-body hash");
  });

  it("is deterministic — same input always produces same output", () => {
    const a = computeProofHash(MOCK_PROOF);
    const b = computeProofHash(MOCK_PROOF);
    assert.equal(a, b);
  });

  it("is not affected by key ordering in input", () => {
    // Construct same proof with keys in different order
    const reordered = {
      environment: MOCK_PROOF.environment,
      version: MOCK_PROOF.version,
      signer: MOCK_PROOF.signer,
      artifact: MOCK_PROOF.artifact,
      commit: MOCK_PROOF.commit,
      attribution: MOCK_PROOF.attribution,
    } as unknown as BitGraphProof;
    assert.equal(computeProofHash(reordered), computeProofHash(MOCK_PROOF));
  });

  it("is not affected by metadata (outside signed body)", () => {
    const withMetadata = {
      ...MOCK_PROOF,
      metadata: { extra: "stuff", nested: { deep: true } },
      timestamps: { artifact: { time: 12345 } },
    } as unknown as BitGraphProof;
    assert.equal(computeProofHash(withMetadata), computeProofHash(MOCK_PROOF));
  });

  it("is not affected by signatureB64 (not in signed body)", () => {
    const differentSig = {
      ...MOCK_PROOF,
      signer: { ...MOCK_PROOF.signer, signatureB64: "completely-different-sig==" },
    } as BitGraphProof;
    assert.equal(computeProofHash(differentSig), computeProofHash(MOCK_PROOF));
  });

  it("is not affected by attestation reportB64 (not in signed body)", () => {
    const differentReport = {
      ...MOCK_PROOF,
      environment: {
        ...MOCK_PROOF.environment,
        attestation: { format: "aws-nitro", reportB64: "totally-different==" },
      },
    } as BitGraphProof;
    assert.equal(computeProofHash(differentReport), computeProofHash(MOCK_PROOF));
  });

  it("changes when artifact changes", () => {
    const different = {
      ...MOCK_PROOF,
      artifact: { hashAlg: "sha256" as const, digestB64: "different==" },
    };
    assert.notEqual(computeProofHash(different), computeProofHash(MOCK_PROOF));
  });

  it("changes when counter changes", () => {
    const different = {
      ...MOCK_PROOF,
      commit: { ...MOCK_PROOF.commit, counter: "99" },
    };
    assert.notEqual(computeProofHash(different), computeProofHash(MOCK_PROOF));
  });

  it("changes when publicKeyB64 changes", () => {
    const different = {
      ...MOCK_PROOF,
      signer: { ...MOCK_PROOF.signer, publicKeyB64: "different-key==" },
    } as BitGraphProof;
    assert.notEqual(computeProofHash(different), computeProofHash(MOCK_PROOF));
  });

  it("includes attribution when present", () => {
    const without = { ...MOCK_PROOF } as Record<string, unknown>;
    delete without.attribution;
    assert.notEqual(computeProofHash(without), computeProofHash(MOCK_PROOF));
  });

  it("includes attestationFormat when present", () => {
    const withoutAttestation = {
      ...MOCK_PROOF,
      environment: {
        enforcement: MOCK_PROOF.environment.enforcement,
        measurement: MOCK_PROOF.environment.measurement,
      },
    } as BitGraphProof;
    assert.notEqual(computeProofHash(withoutAttestation), computeProofHash(MOCK_PROOF));
  });

  it("works with Record<string, unknown> input (not just BitGraphProof)", () => {
    const record: Record<string, unknown> = { ...MOCK_PROOF };
    const hash = computeProofHash(record);
    assert.equal(hash, computeProofHash(MOCK_PROOF));
  });
});
