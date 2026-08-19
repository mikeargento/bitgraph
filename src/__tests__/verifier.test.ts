// Copyright (c) Mike Argento. All rights reserved. See LICENSE.

import { describe, test, before } from "node:test";
import * as assert from "node:assert/strict";
import { getPublicKeyAsync, signAsync } from "@noble/ed25519";
import { Constructor } from "../constructor.js";
import { verify, resetEpochLinkState } from "../index.js";
import { verifyProofIntegrity } from "@mikeargento/bitgraph-verify";
import { DECLARED_12010 } from "./declared-proof-fixture.js";
import type { HostCapabilities } from "../host.js";
import type { BitGraphProof } from "../index.js";

// ---------------------------------------------------------------------------
// Test-fixture helpers
// ---------------------------------------------------------------------------

interface Fixture {
  proof: BitGraphProof;
  bytes: Uint8Array;
  publicKeyB64: string;
  measurement: string;
  privateKey: Uint8Array;
}

async function makeFixture(opts?: {
  epochId?: string;
  withCounter?: boolean;
  withTime?: number;
  measurement?: string;
}): Promise<Fixture> {
  const privateKey = crypto.getRandomValues(new Uint8Array(32));
  const publicKeyBytes = await getPublicKeyAsync(privateKey);
  const publicKeyB64 = Buffer.from(publicKeyBytes).toString("base64");
  const measurement = opts?.measurement ?? "test-measurement-deadbeef";

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
    : opts?.withTime !== undefined
    ? {
        enforcementTier: "stub" as const,
        getMeasurement: async () => measurement,
        getFreshNonce: async () => crypto.getRandomValues(new Uint8Array(16)),
        sign: async (data: Uint8Array) => signAsync(data, privateKey),
        getPublicKey: async () => publicKeyBytes,
        secureTime: async () => opts.withTime as number,
      }
    : {
        enforcementTier: "stub" as const,
        getMeasurement: async () => measurement,
        getFreshNonce: async () => crypto.getRandomValues(new Uint8Array(16)),
        sign: async (data: Uint8Array) => signAsync(data, privateKey),
        getPublicKey: async () => publicKeyBytes,
      };

  const ctor = await Constructor.initialize(
    opts?.epochId !== undefined
      ? { host, epochId: opts.epochId }
      : { host },
  );

  const bytes = new TextEncoder().encode("bitgraph-test-payload-42");
  const proof = await ctor.commit({ bytes });

  return { proof, bytes, publicKeyB64, measurement, privateKey };
}

/** Deep-clone a proof so mutations don't affect the original. */
function clone(proof: BitGraphProof): BitGraphProof {
  return JSON.parse(JSON.stringify(proof)) as BitGraphProof;
}

// ---------------------------------------------------------------------------
// Module-level fixture (no optional capabilities)
// ---------------------------------------------------------------------------

let fx!: Fixture;

before(async () => {
  fx = await makeFixture();
});

// ---------------------------------------------------------------------------
// Happy path
// ---------------------------------------------------------------------------

describe("verify — valid proof", () => {
  test("returns { valid: true } for a freshly created proof", async () => {
    const result = await verify({ proof: fx.proof, bytes: fx.bytes });
    assert.deepEqual(result, { valid: true });
  });

  test("verify is idempotent (same result on second call)", async () => {
    const r1 = await verify({ proof: fx.proof, bytes: fx.bytes });
    const r2 = await verify({ proof: fx.proof, bytes: fx.bytes });
    assert.deepEqual(r1, { valid: true });
    assert.deepEqual(r2, { valid: true });
  });
});

// ---------------------------------------------------------------------------
// Artifact check (step 2)
// ---------------------------------------------------------------------------

describe("verify — artifact mismatch", () => {
  test("fails when wrong bytes are provided", async () => {
    const result = await verify({
      proof: fx.proof,
      bytes: new Uint8Array([99, 98, 97]),
    });
    assert.equal(result.valid, false);
    assert.match(result.reason ?? "", /digest mismatch/);
  });

  test("fails with empty bytes when proof covers non-empty content", async () => {
    const result = await verify({
      proof: fx.proof,
      bytes: new Uint8Array(0),
    });
    assert.equal(result.valid, false);
    assert.match(result.reason ?? "", /digest mismatch/);
  });

  test("succeeds when proof covers empty bytes and empty bytes are provided", async () => {
    const pk = crypto.getRandomValues(new Uint8Array(32));
    const pkBytes = await getPublicKeyAsync(pk);
    const host: HostCapabilities = {
      enforcementTier: "stub",
      getMeasurement: async () => "meas",
      getFreshNonce: async () => crypto.getRandomValues(new Uint8Array(16)),
      sign: async (data: Uint8Array) => signAsync(data, pk),
      getPublicKey: async () => pkBytes,
    };
    const ctor = await Constructor.initialize({ host });
    const emptyBytes = new Uint8Array(0);
    const proof = await ctor.commit({ bytes: emptyBytes });
    const result = await verify({ proof, bytes: emptyBytes });
    assert.deepEqual(result, { valid: true });
  });
});

// ---------------------------------------------------------------------------
// Signature verification (step 4)
// ---------------------------------------------------------------------------

describe("verify — signature tampering", () => {
  test("fails when signatureB64 is replaced with all-zeros", async () => {
    const tampered = clone(fx.proof);
    tampered.signer.signatureB64 = Buffer.alloc(64).toString("base64");
    const result = await verify({ proof: tampered, bytes: fx.bytes });
    assert.equal(result.valid, false);
    assert.match(result.reason ?? "", /signature/);
  });

  test("fails when publicKeyB64 is replaced with a different key", async () => {
    const otherKey = crypto.getRandomValues(new Uint8Array(32));
    const otherPublic = await getPublicKeyAsync(otherKey);
    const tampered = clone(fx.proof);
    tampered.signer.publicKeyB64 = Buffer.from(otherPublic).toString("base64");
    const result = await verify({ proof: tampered, bytes: fx.bytes });
    assert.equal(result.valid, false);
    assert.match(result.reason ?? "", /signature/);
  });

  test("fails when artifact.digestB64 is tampered", async () => {
    const tampered = clone(fx.proof);
    tampered.artifact.digestB64 = Buffer.alloc(32, 0xff).toString("base64");
    const result = await verify({ proof: tampered, bytes: fx.bytes });
    assert.equal(result.valid, false);
    // Either artifact mismatch OR signature failure (both are valid)
    assert.ok(
      (result.reason ?? "").includes("digest mismatch") ||
      (result.reason ?? "").includes("signature"),
    );
  });

  test("fails when measurement is tampered (signed field)", async () => {
    const tampered = clone(fx.proof);
    tampered.environment.measurement = "evil-measurement";
    const result = await verify({ proof: tampered, bytes: fx.bytes });
    assert.equal(result.valid, false);
    assert.match(result.reason ?? "", /signature/);
  });

  test("fails when nonce is tampered (signed field)", async () => {
    const tampered = clone(fx.proof);
    tampered.commit.nonceB64 = Buffer.alloc(16, 0xab).toString("base64");
    const result = await verify({ proof: tampered, bytes: fx.bytes });
    assert.equal(result.valid, false);
    assert.match(result.reason ?? "", /signature/);
  });
});

// ---------------------------------------------------------------------------
// Structural validation (step 1)
// ---------------------------------------------------------------------------

describe("verify — structural validation", () => {
  test("fails for non-object proof", async () => {
    const result = await verify({
      proof: "not-a-proof" as unknown as BitGraphProof,
      bytes: fx.bytes,
    });
    assert.equal(result.valid, false);
    assert.match(result.reason ?? "", /object/);
  });

  test("fails for null proof", async () => {
    const result = await verify({
      proof: null as unknown as BitGraphProof,
      bytes: fx.bytes,
    });
    assert.equal(result.valid, false);
  });

  test("fails for wrong version", async () => {
    const tampered = clone(fx.proof);
    (tampered as unknown as Record<string, unknown>)["version"] = "bitgraph/2";
    const result = await verify({ proof: tampered, bytes: fx.bytes });
    assert.equal(result.valid, false);
    assert.match(result.reason ?? "", /version/);
  });

  test("fails when artifact is missing", async () => {
    const tampered = clone(fx.proof);
    delete (tampered as unknown as Record<string, unknown>)["artifact"];
    const result = await verify({ proof: tampered, bytes: fx.bytes });
    assert.equal(result.valid, false);
    assert.match(result.reason ?? "", /artifact/);
  });

  test("fails when commit is missing", async () => {
    const tampered = clone(fx.proof);
    delete (tampered as unknown as Record<string, unknown>)["commit"];
    const result = await verify({ proof: tampered, bytes: fx.bytes });
    assert.equal(result.valid, false);
    assert.match(result.reason ?? "", /commit/);
  });

  test("fails when signer is missing", async () => {
    const tampered = clone(fx.proof);
    delete (tampered as unknown as Record<string, unknown>)["signer"];
    const result = await verify({ proof: tampered, bytes: fx.bytes });
    assert.equal(result.valid, false);
    assert.match(result.reason ?? "", /signer/);
  });

  test("fails when environment is missing", async () => {
    const tampered = clone(fx.proof);
    delete (tampered as unknown as Record<string, unknown>)["environment"];
    const result = await verify({ proof: tampered, bytes: fx.bytes });
    assert.equal(result.valid, false);
    assert.match(result.reason ?? "", /environment/);
  });

  test("fails for invalid enforcement tier", async () => {
    const tampered = clone(fx.proof);
    tampered.environment.enforcement = "invalid-tier" as "stub";
    const result = await verify({ proof: tampered, bytes: fx.bytes });
    assert.equal(result.valid, false);
    assert.match(result.reason ?? "", /enforcement/);
  });

  test("fails when publicKeyB64 is wrong length (too short)", async () => {
    const tampered = clone(fx.proof);
    tampered.signer.publicKeyB64 = Buffer.alloc(16).toString("base64");
    const result = await verify({ proof: tampered, bytes: fx.bytes });
    assert.equal(result.valid, false);
    assert.match(result.reason ?? "", /32/);
  });
});

// ---------------------------------------------------------------------------
// Policy checks (step 5)
// ---------------------------------------------------------------------------

describe("verify — policy: requireEnforcement", () => {
  test("passes when enforcement matches required tier", async () => {
    const result = await verify({
      proof: fx.proof,
      bytes: fx.bytes,
      trustAnchors: { requireEnforcement: "stub" },
    });
    assert.deepEqual(result, { valid: true });
  });

  test("fails when enforcement does not match required tier", async () => {
    const result = await verify({
      proof: fx.proof,
      bytes: fx.bytes,
      trustAnchors: { requireEnforcement: "measured-tee" },
    });
    assert.equal(result.valid, false);
    assert.match(result.reason ?? "", /enforcement/);
  });
});

describe("verify — policy: allowedMeasurements", () => {
  test("passes when measurement is in the allowlist", async () => {
    const result = await verify({
      proof: fx.proof,
      bytes: fx.bytes,
      trustAnchors: { allowedMeasurements: [fx.measurement] },
    });
    assert.deepEqual(result, { valid: true });
  });

  test("passes when measurement is one of several in the allowlist", async () => {
    const result = await verify({
      proof: fx.proof,
      bytes: fx.bytes,
      trustAnchors: {
        allowedMeasurements: ["other-meas-1", fx.measurement, "other-meas-2"],
      },
    });
    assert.deepEqual(result, { valid: true });
  });

  test("fails when measurement is not in the allowlist", async () => {
    const result = await verify({
      proof: fx.proof,
      bytes: fx.bytes,
      trustAnchors: { allowedMeasurements: ["expected-meas", "another-meas"] },
    });
    assert.equal(result.valid, false);
    assert.match(result.reason ?? "", /measurement/);
  });

  test("passes with empty allowedMeasurements (no constraint)", async () => {
    const result = await verify({
      proof: fx.proof,
      bytes: fx.bytes,
      trustAnchors: { allowedMeasurements: [] },
    });
    assert.deepEqual(result, { valid: true });
  });
});

describe("verify — policy: allowedPublicKeys", () => {
  test("passes when public key is in the allowlist", async () => {
    const result = await verify({
      proof: fx.proof,
      bytes: fx.bytes,
      trustAnchors: { allowedPublicKeys: [fx.publicKeyB64] },
    });
    assert.deepEqual(result, { valid: true });
  });

  test("fails when public key is not in the allowlist", async () => {
    const otherKey = crypto.getRandomValues(new Uint8Array(32));
    const otherPublic = Buffer.from(await getPublicKeyAsync(otherKey)).toString("base64");
    const result = await verify({
      proof: fx.proof,
      bytes: fx.bytes,
      trustAnchors: { allowedPublicKeys: [otherPublic] },
    });
    assert.equal(result.valid, false);
    assert.match(result.reason ?? "", /public key/i);
  });
});

describe("verify — policy: requireAttestation", () => {
  test("fails when attestation required but proof has none", async () => {
    const result = await verify({
      proof: fx.proof,
      bytes: fx.bytes,
      trustAnchors: { requireAttestation: true },
    });
    assert.equal(result.valid, false);
    assert.match(result.reason ?? "", /attestation/);
  });
});

describe("verify — policy: counter checks", () => {
  let counterFx!: Fixture;

  before(async () => {
    counterFx = await makeFixture({ withCounter: true });
  });

  test("valid proof with counter passes minCounter check", async () => {
    const result = await verify({
      proof: counterFx.proof,
      bytes: counterFx.bytes,
      trustAnchors: { minCounter: "1" },
    });
    assert.deepEqual(result, { valid: true });
  });

  test("fails when counter is below minCounter", async () => {
    const result = await verify({
      proof: counterFx.proof,
      bytes: counterFx.bytes,
      trustAnchors: { minCounter: "999" },
    });
    assert.equal(result.valid, false);
    assert.match(result.reason ?? "", /counter/);
  });

  test("passes when counter is at exactly maxCounter", async () => {
    // counter is set because hostWithCounter provides nextCounter
    const counter = counterFx.proof.commit.counter!;
    const result = await verify({
      proof: counterFx.proof,
      bytes: counterFx.bytes,
      trustAnchors: { maxCounter: counter },
    });
    assert.deepEqual(result, { valid: true });
  });

  test("fails when counter exceeds maxCounter", async () => {
    const result = await verify({
      proof: counterFx.proof,
      bytes: counterFx.bytes,
      trustAnchors: { maxCounter: "0" },
    });
    assert.equal(result.valid, false);
    assert.match(result.reason ?? "", /counter/);
  });

  test("fails when minCounter policy requires counter but proof has none", async () => {
    // fx.proof has no counter (base host has no nextCounter)
    const result = await verify({
      proof: fx.proof,
      bytes: fx.bytes,
      trustAnchors: { minCounter: "0" },
    });
    assert.equal(result.valid, false);
    assert.match(result.reason ?? "", /counter/);
  });
});

describe("verify — policy: time checks", () => {
  const fixedTime = 1_700_000_000_000;
  let timeFx!: Fixture;

  before(async () => {
    timeFx = await makeFixture({ withTime: fixedTime });
  });

  test("passes when commit time is within minTime/maxTime window", async () => {
    const result = await verify({
      proof: timeFx.proof,
      bytes: timeFx.bytes,
      trustAnchors: {
        minTime: fixedTime - 1000,
        maxTime: fixedTime + 1000,
      },
    });
    assert.deepEqual(result, { valid: true });
  });

  test("fails when commit time is before minTime", async () => {
    const result = await verify({
      proof: timeFx.proof,
      bytes: timeFx.bytes,
      trustAnchors: { minTime: fixedTime + 1 },
    });
    assert.equal(result.valid, false);
    assert.match(result.reason ?? "", /time/);
  });

  test("fails when commit time is after maxTime", async () => {
    const result = await verify({
      proof: timeFx.proof,
      bytes: timeFx.bytes,
      trustAnchors: { maxTime: fixedTime - 1 },
    });
    assert.equal(result.valid, false);
    assert.match(result.reason ?? "", /time/);
  });

  test("fails when time policy requires time but proof has none", async () => {
    // fx.proof has no time (base host has no secureTime)
    const result = await verify({
      proof: fx.proof,
      bytes: fx.bytes,
      trustAnchors: { minTime: 0 },
    });
    assert.equal(result.valid, false);
    assert.match(result.reason ?? "", /time/);
  });
});

describe("verify — policy: requireEpochId", () => {
  test("fails when epochId is required but proof has none", async () => {
    // fx.proof was created without epochId
    const result = await verify({
      proof: fx.proof,
      bytes: fx.bytes,
      trustAnchors: { requireEpochId: true },
    });
    assert.equal(result.valid, false);
    assert.match(result.reason ?? "", /epochId/i);
  });

  test("passes when epochId is required and proof has it", async () => {
    const epochFx = await makeFixture({ epochId: "epoch-test-xyz" });
    const result = await verify({
      proof: epochFx.proof,
      bytes: epochFx.bytes,
      trustAnchors: { requireEpochId: true },
    });
    assert.deepEqual(result, { valid: true });
  });
});

describe("verify — policy: requireActor", () => {
  test("fails when actor is required but proof has none", async () => {
    const result = await verify({
      proof: fx.proof,
      bytes: fx.bytes,
      trustAnchors: { requireActor: true },
    });
    assert.equal(result.valid, false);
    assert.match(result.reason ?? "", /actor|agency/i);
  });
});

// ---------------------------------------------------------------------------
// Agency: WebAuthn origin and RP binding
// ---------------------------------------------------------------------------

/* The real first declaration (#12,010) as it is, then the same proof with its
   client data altered. The origin check runs BEFORE the signature check, so a
   changed origin is reported as the origin problem it is, rather than as the
   signature failure it also causes; and a changed origin whose host still
   agrees with the rpIdHash passes the origin check and is then caught by the
   signature, which is the order a reader would want the reasons in. */
function withClientData(proof: typeof DECLARED_12010, patch: (cd: Record<string, unknown>) => void): BitGraphProof {
  const p = JSON.parse(JSON.stringify(proof)) as BitGraphProof;
  const auth = (p.agency as { authorization: { clientDataJSON: string } }).authorization;
  const cd = JSON.parse(auth.clientDataJSON) as Record<string, unknown>;
  patch(cd);
  auth.clientDataJSON = JSON.stringify(cd);
  return p;
}

describe("verify — agency: WebAuthn origin and rpIdHash", () => {
  test("the real declared proof verifies (origin https://bitgraph.ing, rpIdHash = SHA-256(bitgraph.ing))", async () => {
    resetEpochLinkState();
    const result = await verifyProofIntegrity({ proof: DECLARED_12010 as unknown as BitGraphProof });
    assert.equal(result.valid, true, result.valid ? "" : result.reason);
  });

  test("an origin whose host disagrees with the authenticator's rpIdHash is refused as such", async () => {
    resetEpochLinkState();
    const tampered = withClientData(DECLARED_12010, (cd) => { cd.origin = "https://evil.example"; });
    const result = await verifyProofIntegrity({ proof: tampered });
    assert.equal(result.valid, false);
    assert.match(result.reason ?? "", /rpIdHash does not match the origin/);
  });

  test("a missing origin is refused", async () => {
    resetEpochLinkState();
    const tampered = withClientData(DECLARED_12010, (cd) => { delete cd.origin; });
    const result = await verifyProofIntegrity({ proof: tampered });
    assert.equal(result.valid, false);
    assert.match(result.reason ?? "", /missing origin/);
  });

  test("a subdomain of the RP ID passes the origin check (and is then caught by the signature)", async () => {
    resetEpochLinkState();
    const tampered = withClientData(DECLARED_12010, (cd) => { cd.origin = "https://app.bitgraph.ing"; });
    const result = await verifyProofIntegrity({ proof: tampered });
    assert.equal(result.valid, false);
    assert.doesNotMatch(result.reason ?? "", /origin|rpIdHash/);
    assert.match(result.reason ?? "", /signature/i);
  });

  test("policy allowedOrigins accepts the production origin", async () => {
    resetEpochLinkState();
    const result = await verifyProofIntegrity({
      proof: DECLARED_12010 as unknown as BitGraphProof,
      trustAnchors: { allowedOrigins: ["https://bitgraph.ing"] },
    });
    assert.equal(result.valid, true, result.valid ? "" : result.reason);
  });

  test("policy allowedOrigins refuses any other origin", async () => {
    resetEpochLinkState();
    const result = await verifyProofIntegrity({
      proof: DECLARED_12010 as unknown as BitGraphProof,
      trustAnchors: { allowedOrigins: ["https://other.example"] },
    });
    assert.equal(result.valid, false);
    assert.match(result.reason ?? "", /origin .* is not in the allowed set/);
  });

  test("policy allowedOrigins refuses a proof with no agency", async () => {
    const result = await verify({
      proof: fx.proof,
      bytes: fx.bytes,
      trustAnchors: { allowedOrigins: ["https://bitgraph.ing"] },
    });
    assert.equal(result.valid, false);
    assert.match(result.reason ?? "", /no agency/);
  });
});

// ---------------------------------------------------------------------------
// resetEpochLinkState
// ---------------------------------------------------------------------------

describe("resetEpochLinkState", () => {
  test("is a function that can be called without error", () => {
    assert.doesNotThrow(() => resetEpochLinkState());
  });

  test("can be called multiple times", () => {
    assert.doesNotThrow(() => {
      resetEpochLinkState();
      resetEpochLinkState();
      resetEpochLinkState();
    });
  });
});
