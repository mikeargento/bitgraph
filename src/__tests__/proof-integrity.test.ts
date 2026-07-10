// Copyright (c) Mike Argento. All rights reserved. See LICENSE.

/**
 * Tests for verifyProofIntegrity, the bytes-free proof integrity API in
 * @mikeargento/bitgraph-verify.
 *
 * Also carries regression coverage asserting that verify() behavior is
 * unchanged by the shared-pipeline refactor: same checks, same order,
 * same failure strings.
 */

import { describe, test, before, beforeEach } from "node:test";
import * as assert from "node:assert/strict";
import { getPublicKeyAsync, signAsync } from "@noble/ed25519";
import { sha256 } from "@noble/hashes/sha256";
import {
  verify,
  verifyProofIntegrity,
  resetEpochLinkState,
  canonicalize,
} from "@mikeargento/bitgraph-verify";
import type { BitGraphProof, ProofIntegrityResult } from "@mikeargento/bitgraph-verify";
import { Constructor } from "../constructor.js";
import type { HostCapabilities } from "../host.js";

// ---------------------------------------------------------------------------
// Test-fixture helpers
// ---------------------------------------------------------------------------

interface Fixture {
  proof: BitGraphProof;
  bytes: Uint8Array;
  publicKeyB64: string;
  measurement: string;
}

/** Constructor-built fixture, mirroring makeFixture in verifier.test.ts. */
async function makeFixture(opts?: {
  epochId?: string;
  withCounter?: boolean;
}): Promise<Fixture> {
  const privateKey = crypto.getRandomValues(new Uint8Array(32));
  const publicKeyBytes = await getPublicKeyAsync(privateKey);
  const publicKeyB64 = Buffer.from(publicKeyBytes).toString("base64");
  const measurement = "test-measurement-integrity";

  let counter = 0;
  const host: HostCapabilities = opts?.withCounter
    ? {
        enforcementTier: "stub" as const,
        getMeasurement: async () => measurement,
        getFreshNonce: async () => crypto.getRandomValues(new Uint8Array(16)),
        sign: async (data: Uint8Array) => signAsync(data, privateKey),
        getPublicKey: async () => publicKeyBytes,
        nextCounter: async () => String(++counter),
      }
    : {
        enforcementTier: "stub" as const,
        getMeasurement: async () => measurement,
        getFreshNonce: async () => crypto.getRandomValues(new Uint8Array(16)),
        sign: async (data: Uint8Array) => signAsync(data, privateKey),
        getPublicKey: async () => publicKeyBytes,
      };

  const ctor = await Constructor.initialize(
    opts?.epochId !== undefined ? { host, epochId: opts.epochId } : { host },
  );

  const bytes = new TextEncoder().encode("bitgraph-integrity-test-payload");
  const proof = await ctor.commit({ bytes });

  return { proof, bytes, publicKeyB64, measurement };
}

/** Deep-clone a proof so mutations don't affect the original. */
function clone(proof: BitGraphProof): BitGraphProof {
  return JSON.parse(JSON.stringify(proof)) as BitGraphProof;
}

function b64(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString("base64");
}

interface ManualKey {
  privateKey: Uint8Array;
  publicKeyB64: string;
}

async function makeKey(): Promise<ManualKey> {
  const privateKey = crypto.getRandomValues(new Uint8Array(32));
  const publicKeyB64 = b64(await getPublicKeyAsync(privateKey));
  return { privateKey, publicKeyB64 };
}

/**
 * Manually build and sign a proof over the exact canonical SignedBody
 * layout the verifier reconstructs. Used for slot-carrying and
 * epochLink-carrying proofs, which the root Constructor does not produce.
 */
async function signBody(
  key: ManualKey,
  artifact: BitGraphProof["artifact"],
  commit: BitGraphProof["commit"],
  measurement: string,
): Promise<BitGraphProof> {
  const signedBody = {
    version: "bitgraph/1" as const,
    artifact,
    commit,
    publicKeyB64: key.publicKeyB64,
    enforcement: "stub" as const,
    measurement,
  };
  const signatureB64 = b64(await signAsync(canonicalize(signedBody), key.privateKey));
  return {
    version: "bitgraph/1",
    artifact,
    commit,
    signer: { publicKeyB64: key.publicKeyB64, signatureB64 },
    environment: { enforcement: "stub", measurement },
  };
}

interface SlotFixture {
  proof: BitGraphProof;
  bytes: Uint8Array;
  measurement: string;
}

/**
 * Build a slot-carrying proof: slot allocated at counter 1, commit at
 * counter 2, slotHashB64 binding the signed commit to the exact slot body.
 */
async function makeSlotFixture(opts?: { commitCounter?: string }): Promise<SlotFixture> {
  const key = await makeKey();
  const measurement = "test-measurement-slot";
  const epochId = "epoch-slot-test";
  const nonceB64 = b64(crypto.getRandomValues(new Uint8Array(16)));

  const slotBody = {
    version: "bitgraph/slot/1" as const,
    nonceB64,
    counter: "1",
    time: 1_700_000_000_000,
    epochId,
    publicKeyB64: key.publicKeyB64,
  };
  const slotCanonical = canonicalize(slotBody);
  const slotSignatureB64 = b64(await signAsync(slotCanonical, key.privateKey));
  const slotHashB64 = b64(sha256(slotCanonical));

  const bytes = new TextEncoder().encode("bitgraph-integrity-slot-payload");
  const artifact: BitGraphProof["artifact"] = {
    hashAlg: "sha256",
    digestB64: b64(sha256(bytes)),
  };
  const commit: BitGraphProof["commit"] = {
    nonceB64,
    counter: opts?.commitCounter ?? "2",
    epochId,
    slotCounter: "1",
    slotHashB64,
  };

  const proof = await signBody(key, artifact, commit, measurement);
  proof.slotAllocation = { ...slotBody, signatureB64: slotSignatureB64 };
  return { proof, bytes, measurement };
}

interface EpochLinkFixture {
  proof: BitGraphProof;
  bytes: Uint8Array;
}

/**
 * Build an epoch-genesis proof carrying an epochLink. The link is inside
 * the signed commit, so the Ed25519 signature covers it.
 */
async function makeEpochLinkFixture(opts?: {
  toEpochId?: string;
  samePrevKey?: boolean;
}): Promise<EpochLinkFixture> {
  const key = await makeKey();
  const prevKey = await makeKey();
  const toEpochId = opts?.toEpochId ?? "epoch-successor-a";

  const epochLink = {
    prevEpochId: "epoch-predecessor-a",
    prevPublicKeyB64: opts?.samePrevKey === true ? key.publicKeyB64 : prevKey.publicKeyB64,
    prevCounter: "42",
    prevProofHashB64: b64(sha256(new TextEncoder().encode("predecessor-terminal-proof"))),
    toEpochId,
    toPublicKeyB64: key.publicKeyB64,
  };

  const bytes = new TextEncoder().encode("bitgraph-integrity-epochlink-payload");
  const artifact: BitGraphProof["artifact"] = {
    hashAlg: "sha256",
    digestB64: b64(sha256(bytes)),
  };
  const commit: BitGraphProof["commit"] = {
    nonceB64: b64(crypto.getRandomValues(new Uint8Array(16))),
    counter: "1",
    epochId: toEpochId,
    epochLink,
  };

  const proof = await signBody(key, artifact, commit, "test-measurement-epochlink");
  return { proof, bytes };
}

// ---------------------------------------------------------------------------
// Module-level fixtures
// ---------------------------------------------------------------------------

let fx!: Fixture;

before(async () => {
  fx = await makeFixture();
});

// ---------------------------------------------------------------------------
// Happy path: integrity without bytes
// ---------------------------------------------------------------------------

describe("verifyProofIntegrity: valid proof, no bytes", () => {
  test("passes for a freshly created proof and reports binding not checked", async () => {
    const result = await verifyProofIntegrity({ proof: fx.proof });
    assert.deepEqual(result, { valid: true, artifactBinding: "not-checked" });
  });

  test("passes for a proof with counter and epochId", async () => {
    const chained = await makeFixture({ withCounter: true, epochId: "epoch-integrity-xyz" });
    const result = await verifyProofIntegrity({ proof: chained.proof });
    assert.deepEqual(result, { valid: true, artifactBinding: "not-checked" });
  });

  test("passes even when verify() with wrong bytes fails: binding is genuinely not checked", async () => {
    const wrongBytes = new Uint8Array([1, 2, 3]);
    const full = await verify({ proof: fx.proof, bytes: wrongBytes });
    assert.equal(full.valid, false);
    assert.match(full.reason ?? "", /digest mismatch/);

    const integrity = await verifyProofIntegrity({ proof: fx.proof });
    assert.deepEqual(integrity, { valid: true, artifactBinding: "not-checked" });
  });
});

// ---------------------------------------------------------------------------
// Result shape
// ---------------------------------------------------------------------------

describe("verifyProofIntegrity: result shape", () => {
  test("failure result also carries artifactBinding 'not-checked' plus a reason", async () => {
    const tampered = clone(fx.proof);
    tampered.signer.signatureB64 = Buffer.alloc(64).toString("base64");
    const result: ProofIntegrityResult = await verifyProofIntegrity({ proof: tampered });
    assert.equal(result.valid, false);
    assert.equal(result.artifactBinding, "not-checked");
    assert.equal(typeof result.reason, "string");
  });
});

// ---------------------------------------------------------------------------
// Tampering
// ---------------------------------------------------------------------------

describe("verifyProofIntegrity: tampering", () => {
  test("fails when signatureB64 is replaced with all-zeros", async () => {
    const tampered = clone(fx.proof);
    tampered.signer.signatureB64 = Buffer.alloc(64).toString("base64");
    const result = await verifyProofIntegrity({ proof: tampered });
    assert.equal(result.valid, false);
    assert.match(result.reason ?? "", /signature/);
  });

  test("fails when version is tampered, with a version reason", async () => {
    const tampered = clone(fx.proof);
    (tampered as unknown as Record<string, unknown>)["version"] = "bitgraph/2";
    const result = await verifyProofIntegrity({ proof: tampered });
    assert.equal(result.valid, false);
    assert.equal(result.reason, "unsupported proof version: bitgraph/2");
  });

  test("fails when a signed field (measurement) is tampered", async () => {
    const tampered = clone(fx.proof);
    tampered.environment.measurement = "evil-measurement";
    const result = await verifyProofIntegrity({ proof: tampered });
    assert.equal(result.valid, false);
    assert.match(result.reason ?? "", /signature/);
  });

  test("fails when artifact.digestB64 is not valid base64 (well-formedness still checked)", async () => {
    const tampered = clone(fx.proof);
    tampered.artifact.digestB64 = "!!!";
    const result = await verifyProofIntegrity({ proof: tampered });
    assert.equal(result.valid, false);
    assert.equal(result.reason, "artifact.digestB64 is not valid base64");
  });

  test("fails for non-object proof", async () => {
    const result = await verifyProofIntegrity({
      proof: "not-a-proof" as unknown as BitGraphProof,
    });
    assert.equal(result.valid, false);
    assert.match(result.reason ?? "", /object/);
  });
});

// ---------------------------------------------------------------------------
// Slot allocation (bytes-free)
// ---------------------------------------------------------------------------

describe("verifyProofIntegrity: slot allocation", () => {
  test("passes for a valid slot-carrying proof", async () => {
    const slotFx = await makeSlotFixture();
    const result = await verifyProofIntegrity({ proof: slotFx.proof });
    assert.deepEqual(result, { valid: true, artifactBinding: "not-checked" });
  });

  test("fails when commit.slotHashB64 is tampered (signed field)", async () => {
    const slotFx = await makeSlotFixture();
    const tampered = clone(slotFx.proof);
    tampered.commit.slotHashB64 = Buffer.alloc(32, 0xee).toString("base64");
    const result = await verifyProofIntegrity({ proof: tampered });
    assert.equal(result.valid, false);
    assert.match(result.reason ?? "", /signature/);
  });

  test("fails with a slot binding reason when the embedded slot record is swapped", async () => {
    const slotA = await makeSlotFixture();
    const slotB = await makeSlotFixture();
    const tampered = clone(slotA.proof);
    // slotB's record is validly signed by its own key, but it is not the
    // record that slotA's signed commit.slotHashB64 binds to.
    tampered.slotAllocation = clone(slotB.proof).slotAllocation!;
    const result = await verifyProofIntegrity({ proof: tampered });
    assert.equal(result.valid, false);
    assert.match(result.reason ?? "", /slotHashB64 does not match SHA-256 of canonical slot body/);
  });

  test("fails when slotAllocation.counter is tampered (slot signature breaks)", async () => {
    const slotFx = await makeSlotFixture();
    const tampered = clone(slotFx.proof);
    tampered.slotAllocation!.counter = "999";
    const result = await verifyProofIntegrity({ proof: tampered });
    assert.equal(result.valid, false);
    assert.match(result.reason ?? "", /slotAllocation signature verification failed/);
  });

  test("fails when slot counter is not less than commit counter", async () => {
    // Slot at counter 1, commit also at counter 1: ordering violated even
    // though every signature is genuine.
    const slotFx = await makeSlotFixture({ commitCounter: "1" });
    const result = await verifyProofIntegrity({ proof: slotFx.proof });
    assert.equal(result.valid, false);
    assert.match(result.reason ?? "", /must be less than commit\.counter/);
  });
});

// ---------------------------------------------------------------------------
// Epoch link (bytes-free)
// ---------------------------------------------------------------------------

describe("verifyProofIntegrity: epochLink", () => {
  beforeEach(() => {
    resetEpochLinkState();
  });

  test("passes for a valid epoch-genesis proof with epochLink", async () => {
    const linkFx = await makeEpochLinkFixture();
    const result = await verifyProofIntegrity({ proof: linkFx.proof });
    assert.deepEqual(result, { valid: true, artifactBinding: "not-checked" });
  });

  test("is idempotent for the same successor epoch", async () => {
    const linkFx = await makeEpochLinkFixture();
    const first = await verifyProofIntegrity({ proof: linkFx.proof });
    const second = await verifyProofIntegrity({ proof: linkFx.proof });
    assert.equal(first.valid, true);
    assert.equal(second.valid, true);
  });

  test("fails when predecessor and successor keys are identical", async () => {
    const linkFx = await makeEpochLinkFixture({ samePrevKey: true });
    const result = await verifyProofIntegrity({ proof: linkFx.proof });
    assert.equal(result.valid, false);
    assert.match(result.reason ?? "", /different keys/);
  });

  test("detects a fork: same predecessor consumed by two successor epochs", async () => {
    const first = await makeEpochLinkFixture({ toEpochId: "epoch-successor-a" });
    const second = await makeEpochLinkFixture({ toEpochId: "epoch-successor-b" });

    const r1 = await verifyProofIntegrity({ proof: first.proof });
    assert.equal(r1.valid, true);

    const r2 = await verifyProofIntegrity({ proof: second.proof });
    assert.equal(r2.valid, false);
    assert.match(r2.reason ?? "", /FORK DETECTED/);
  });
});

// ---------------------------------------------------------------------------
// Policy checks (trustAnchors)
// ---------------------------------------------------------------------------

describe("verifyProofIntegrity: policy (trustAnchors)", () => {
  test("passes when measurement is in the allowlist", async () => {
    const result = await verifyProofIntegrity({
      proof: fx.proof,
      trustAnchors: { allowedMeasurements: [fx.measurement] },
    });
    assert.deepEqual(result, { valid: true, artifactBinding: "not-checked" });
  });

  test("fails when measurement is not in the allowlist", async () => {
    const result = await verifyProofIntegrity({
      proof: fx.proof,
      trustAnchors: { allowedMeasurements: ["expected-meas"] },
    });
    assert.equal(result.valid, false);
    assert.match(result.reason ?? "", /measurement/);
  });

  test("fails when requireEnforcement does not match", async () => {
    const result = await verifyProofIntegrity({
      proof: fx.proof,
      trustAnchors: { requireEnforcement: "measured-tee" },
    });
    assert.equal(result.valid, false);
    assert.match(result.reason ?? "", /enforcement/);
  });

  test("requireSlot fails for a slotless proof and passes for a slot-carrying proof", async () => {
    const slotless = await verifyProofIntegrity({
      proof: fx.proof,
      trustAnchors: { requireSlot: true },
    });
    assert.equal(slotless.valid, false);
    assert.match(slotless.reason ?? "", /slotAllocation/);

    const slotFx = await makeSlotFixture();
    const slotted = await verifyProofIntegrity({
      proof: slotFx.proof,
      trustAnchors: { requireSlot: true },
    });
    assert.deepEqual(slotted, { valid: true, artifactBinding: "not-checked" });
  });

  test("counter policy applies without bytes", async () => {
    const slotFx = await makeSlotFixture();
    const pass = await verifyProofIntegrity({
      proof: slotFx.proof,
      trustAnchors: { minCounter: "1" },
    });
    assert.equal(pass.valid, true);

    const failResult = await verifyProofIntegrity({
      proof: slotFx.proof,
      trustAnchors: { minCounter: "999" },
    });
    assert.equal(failResult.valid, false);
    assert.match(failResult.reason ?? "", /counter/);
  });
});

// ---------------------------------------------------------------------------
// Regression: verify() behavior unchanged by the shared-pipeline refactor
// ---------------------------------------------------------------------------

describe("regression: verify() unchanged", () => {
  test("valid proof with bytes returns exactly { valid: true }", async () => {
    const result = await verify({ proof: fx.proof, bytes: fx.bytes });
    assert.deepEqual(result, { valid: true });
  });

  test("wrong bytes fail with the exact digest mismatch reason", async () => {
    const result = await verify({ proof: fx.proof, bytes: new Uint8Array([9, 9, 9]) });
    assert.equal(result.valid, false);
    assert.equal(
      result.reason,
      "artifact digest mismatch: the provided bytes do not match the committed digest",
    );
  });

  test("tampered signature fails with the exact signature reason", async () => {
    const tampered = clone(fx.proof);
    tampered.signer.signatureB64 = Buffer.alloc(64).toString("base64");
    const result = await verify({ proof: tampered, bytes: fx.bytes });
    assert.equal(result.valid, false);
    assert.equal(result.reason, "signature verification failed: signature does not match");
  });

  test("tampered version fails with the exact version reason", async () => {
    const tampered = clone(fx.proof);
    (tampered as unknown as Record<string, unknown>)["version"] = "bitgraph/2";
    const result = await verify({ proof: tampered, bytes: fx.bytes });
    assert.equal(result.valid, false);
    assert.equal(result.reason, "unsupported proof version: bitgraph/2");
  });

  test("verify() and verifyProofIntegrity() agree on every non-artifact failure", async () => {
    const variants: Array<(p: BitGraphProof) => void> = [
      (p) => {
        (p as unknown as Record<string, unknown>)["version"] = "occ/1";
      },
      (p) => {
        p.signer.signatureB64 = Buffer.alloc(64).toString("base64");
      },
      (p) => {
        p.environment.measurement = "evil-measurement";
      },
      (p) => {
        delete (p as unknown as Record<string, unknown>)["signer"];
      },
    ];

    for (const mutate of variants) {
      const tampered = clone(fx.proof);
      mutate(tampered);
      const full = await verify({ proof: tampered, bytes: fx.bytes });
      const integrity = await verifyProofIntegrity({ proof: tampered });
      assert.equal(full.valid, integrity.valid);
      assert.equal(full.reason, integrity.reason);
    }
  });

  test("verify() accepts the slot-carrying fixture with its bytes", async () => {
    const slotFx = await makeSlotFixture();
    const result = await verify({ proof: slotFx.proof, bytes: slotFx.bytes });
    assert.deepEqual(result, { valid: true });
  });

  test("verify() accepts the epochLink fixture with its bytes", async () => {
    resetEpochLinkState();
    const linkFx = await makeEpochLinkFixture();
    const result = await verify({ proof: linkFx.proof, bytes: linkFx.bytes });
    assert.deepEqual(result, { valid: true });
  });
});
