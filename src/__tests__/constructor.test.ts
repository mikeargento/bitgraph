// Copyright (c) Mike Argento. All rights reserved. See LICENSE.

import { describe, test } from "node:test";
import * as assert from "node:assert/strict";
import { getPublicKeyAsync, signAsync } from "@noble/ed25519";
import { Constructor } from "../constructor.js";
import type { HostCapabilities } from "../host.js";

// ---------------------------------------------------------------------------
// Test helper: build a mock host backed by a real Ed25519 key pair
// ---------------------------------------------------------------------------

interface KeyMaterial {
  privateKey: Uint8Array;
  publicKeyBytes: Uint8Array;
  publicKeyB64: string;
}

async function makeKeys(): Promise<KeyMaterial> {
  const privateKey = crypto.getRandomValues(new Uint8Array(32));
  const publicKeyBytes = await getPublicKeyAsync(privateKey);
  const publicKeyB64 = Buffer.from(publicKeyBytes).toString("base64");
  return { privateKey, publicKeyBytes, publicKeyB64 };
}

/** Minimal stub host — all required capabilities, no optional ones. */
function baseHost(km: KeyMaterial): HostCapabilities {
  return {
    enforcementTier: "stub" as const,
    getMeasurement: async () => "test-measurement-cafebabe",
    getFreshNonce: async () => crypto.getRandomValues(new Uint8Array(16)),
    sign: async (data: Uint8Array) => signAsync(data, km.privateKey),
    getPublicKey: async () => km.publicKeyBytes,
  };
}

/** Stub host that also exposes a monotonic counter. */
function hostWithCounter(km: KeyMaterial): HostCapabilities {
  let c = 0;
  return {
    enforcementTier: "stub" as const,
    getMeasurement: async () => "test-measurement-cafebabe",
    getFreshNonce: async () => crypto.getRandomValues(new Uint8Array(16)),
    sign: async (data: Uint8Array) => signAsync(data, km.privateKey),
    getPublicKey: async () => km.publicKeyBytes,
    nextCounter: async () => String(++c),
  };
}

/** Stub host that also exposes a secure clock. */
function hostWithTime(km: KeyMaterial, timeMs: number): HostCapabilities {
  return {
    enforcementTier: "stub" as const,
    getMeasurement: async () => "test-measurement-cafebabe",
    getFreshNonce: async () => crypto.getRandomValues(new Uint8Array(16)),
    sign: async (data: Uint8Array) => signAsync(data, km.privateKey),
    getPublicKey: async () => km.publicKeyBytes,
    secureTime: async () => timeMs,
  };
}

// ---------------------------------------------------------------------------
// Constructor.initialize
// ---------------------------------------------------------------------------

describe("Constructor.initialize", () => {
  test("succeeds with a minimal host", async () => {
    const km = await makeKeys();
    const ctor = await Constructor.initialize({ host: baseHost(km) });
    assert.ok(ctor instanceof Constructor);
  });

  test("fails when getMeasurement() rejects", async () => {
    const km = await makeKeys();
    const host: HostCapabilities = {
      ...baseHost(km),
      getMeasurement: async () => { throw new Error("measurement unavailable"); },
    };
    await assert.rejects(
      Constructor.initialize({ host }),
      /preflight failed/,
    );
  });

  test("fails when getPublicKey() rejects", async () => {
    const km = await makeKeys();
    const host: HostCapabilities = {
      ...baseHost(km),
      getPublicKey: async () => { throw new Error("key unavailable"); },
    };
    await assert.rejects(
      Constructor.initialize({ host }),
      /preflight failed/,
    );
  });

  test("rejects requireCounter policy when host has no nextCounter", async () => {
    const km = await makeKeys();
    await assert.rejects(
      Constructor.initialize({ host: baseHost(km), policy: { requireCounter: true } }),
      /nextCounter/,
    );
  });

  test("rejects requireTime policy when host has no secureTime", async () => {
    const km = await makeKeys();
    await assert.rejects(
      Constructor.initialize({ host: baseHost(km), policy: { requireTime: true } }),
      /secureTime/,
    );
  });

  test("accepts requireCounter policy when host has nextCounter", async () => {
    const km = await makeKeys();
    const ctor = await Constructor.initialize({
      host: hostWithCounter(km),
      policy: { requireCounter: true },
    });
    assert.ok(ctor instanceof Constructor);
  });

  test("accepts requireTime policy when host has secureTime", async () => {
    const km = await makeKeys();
    const ctor = await Constructor.initialize({
      host: hostWithTime(km, Date.now()),
      policy: { requireTime: true },
    });
    assert.ok(ctor instanceof Constructor);
  });
});

// ---------------------------------------------------------------------------
// Constructor.commit
// ---------------------------------------------------------------------------

describe("Constructor.commit", () => {
  test("returns a structurally valid BitGraphProof", async () => {
    const km = await makeKeys();
    const ctor = await Constructor.initialize({ host: baseHost(km) });
    const bytes = new TextEncoder().encode("hello bitgraph");
    const proof = await ctor.commit({ bytes });

    assert.equal(proof.version, "bitgraph/1");
    assert.equal(proof.artifact.hashAlg, "sha256");
    assert.ok(typeof proof.artifact.digestB64 === "string" && proof.artifact.digestB64.length > 0);
    assert.ok(typeof proof.commit.nonceB64 === "string" && proof.commit.nonceB64.length > 0);
    assert.equal(proof.signer.publicKeyB64, km.publicKeyB64);
    assert.ok(typeof proof.signer.signatureB64 === "string" && proof.signer.signatureB64.length > 0);
    assert.equal(proof.environment.enforcement, "stub");
    assert.equal(proof.environment.measurement, "test-measurement-cafebabe");
  });

  test("works with empty bytes", async () => {
    const km = await makeKeys();
    const ctor = await Constructor.initialize({ host: baseHost(km) });
    const proof = await ctor.commit({ bytes: new Uint8Array(0) });
    assert.equal(proof.version, "bitgraph/1");
    assert.ok(proof.artifact.digestB64.length > 0);
  });

  test("works with large bytes (100 KB)", async () => {
    const km = await makeKeys();
    const ctor = await Constructor.initialize({ host: baseHost(km) });
    // crypto.getRandomValues is limited to 65536 bytes; use fill instead
    const bytes = new Uint8Array(100_000).fill(0xab);
    const proof = await ctor.commit({ bytes });
    assert.equal(proof.version, "bitgraph/1");
  });

  test("includes metadata when provided (outside signature)", async () => {
    const km = await makeKeys();
    const ctor = await Constructor.initialize({ host: baseHost(km) });
    const proof = await ctor.commit({
      bytes: new Uint8Array([1, 2, 3]),
      metadata: { source: "test-suite" },
    });
    assert.deepEqual(proof.metadata, { source: "test-suite" });
  });

  test("omits metadata field when not provided", async () => {
    const km = await makeKeys();
    const ctor = await Constructor.initialize({ host: baseHost(km) });
    const proof = await ctor.commit({ bytes: new Uint8Array([1]) });
    assert.equal(proof.metadata, undefined);
  });

  test("includes counter when host provides nextCounter", async () => {
    const km = await makeKeys();
    const ctor = await Constructor.initialize({ host: hostWithCounter(km) });
    const proof = await ctor.commit({ bytes: new Uint8Array([1]) });
    assert.ok(typeof proof.commit.counter === "string");
    assert.equal(proof.commit.counter, "1");
  });

  test("counter increments across commits", async () => {
    const km = await makeKeys();
    const ctor = await Constructor.initialize({ host: hostWithCounter(km) });
    const p1 = await ctor.commit({ bytes: new Uint8Array([1]) });
    const p2 = await ctor.commit({ bytes: new Uint8Array([2]) });
    assert.equal(p1.commit.counter, "1");
    assert.equal(p2.commit.counter, "2");
  });

  test("includes time when host provides secureTime", async () => {
    const km = await makeKeys();
    const fixedTime = 1_700_000_000_000;
    const ctor = await Constructor.initialize({ host: hostWithTime(km, fixedTime) });
    const proof = await ctor.commit({ bytes: new Uint8Array([1]) });
    assert.equal(proof.commit.time, fixedTime);
  });

  test("includes prevB64 when provided", async () => {
    const km = await makeKeys();
    const ctor = await Constructor.initialize({ host: baseHost(km) });
    const prevHash = Buffer.alloc(32).toString("base64");
    const proof = await ctor.commit({
      bytes: new Uint8Array([1]),
      prevProofHashB64: prevHash,
    });
    assert.equal(proof.commit.prevB64, prevHash);
  });

  test("includes epochId when Constructor was initialized with one", async () => {
    const km = await makeKeys();
    const epochId = "epoch-abc-123";
    const ctor = await Constructor.initialize({ host: baseHost(km), epochId });
    const proof = await ctor.commit({ bytes: new Uint8Array([1]) });
    assert.equal(proof.commit.epochId, epochId);
  });

  test("omits epochId when not provided at initialization", async () => {
    const km = await makeKeys();
    const ctor = await Constructor.initialize({ host: baseHost(km) });
    const proof = await ctor.commit({ bytes: new Uint8Array([1]) });
    assert.equal(proof.commit.epochId, undefined);
  });

  test("each commit has a unique nonce", async () => {
    const km = await makeKeys();
    const ctor = await Constructor.initialize({ host: baseHost(km) });
    const p1 = await ctor.commit({ bytes: new Uint8Array([1]) });
    const p2 = await ctor.commit({ bytes: new Uint8Array([1]) });
    assert.notEqual(p1.commit.nonceB64, p2.commit.nonceB64);
  });

  test("fail-closed: throws when sign() rejects (no partial proof)", async () => {
    const km = await makeKeys();
    const badSignHost: HostCapabilities = {
      enforcementTier: "stub" as const,
      getMeasurement: async () => "meas",
      getFreshNonce: async () => crypto.getRandomValues(new Uint8Array(16)),
      sign: async () => { throw new Error("HSM offline"); },
      getPublicKey: async () => km.publicKeyBytes,
    };
    const ctor = await Constructor.initialize({ host: badSignHost });
    await assert.rejects(
      ctor.commit({ bytes: new Uint8Array([1]) }),
      /host\.sign\(\) rejected/,
    );
  });

  test("throws when nonce is too short", async () => {
    const km = await makeKeys();
    const shortNonceHost: HostCapabilities = {
      ...baseHost(km),
      getFreshNonce: async () => new Uint8Array(8), // < 16 bytes required
    };
    const ctor = await Constructor.initialize({ host: shortNonceHost });
    await assert.rejects(
      ctor.commit({ bytes: new Uint8Array([1]) }),
      /insufficient length/,
    );
  });

  test("two commits to same bytes produce different proofs (nonce)", async () => {
    const km = await makeKeys();
    const ctor = await Constructor.initialize({ host: baseHost(km) });
    const bytes = new Uint8Array([42, 43, 44]);
    const p1 = await ctor.commit({ bytes });
    const p2 = await ctor.commit({ bytes });
    assert.equal(p1.artifact.digestB64, p2.artifact.digestB64); // same digest
    assert.notEqual(p1.signer.signatureB64, p2.signer.signatureB64); // different signature
  });
});

// ---------------------------------------------------------------------------
// Constructor.commitDigest
// ---------------------------------------------------------------------------

describe("Constructor.commitDigest", () => {
  test("returns a valid proof given a correct 32-byte base64 digest", async () => {
    const km = await makeKeys();
    const ctor = await Constructor.initialize({ host: baseHost(km) });
    // SHA-256 of empty bytes
    const digest = Buffer.alloc(32, 0xab).toString("base64");
    const proof = await ctor.commitDigest({ digestB64: digest });
    assert.equal(proof.version, "bitgraph/1");
    assert.equal(proof.artifact.digestB64, digest);
  });

  test("throws for invalid base64", async () => {
    const km = await makeKeys();
    const ctor = await Constructor.initialize({ host: baseHost(km) });
    await assert.rejects(
      ctor.commitDigest({ digestB64: "not-valid-base64!!!" }),
      /base64/i,
    );
  });

  test("throws when digest decodes to != 32 bytes", async () => {
    const km = await makeKeys();
    const ctor = await Constructor.initialize({ host: baseHost(km) });
    // 16 bytes, valid base64, but not 32 bytes
    const shortDigest = Buffer.alloc(16).toString("base64");
    await assert.rejects(
      ctor.commitDigest({ digestB64: shortDigest }),
      /32/,
    );
  });

  test("throws for empty string digest", async () => {
    const km = await makeKeys();
    const ctor = await Constructor.initialize({ host: baseHost(km) });
    await assert.rejects(
      ctor.commitDigest({ digestB64: "" }),
      /non-empty|base64/i,
    );
  });

  test("includes metadata when provided", async () => {
    const km = await makeKeys();
    const ctor = await Constructor.initialize({ host: baseHost(km) });
    const digest = Buffer.alloc(32, 0x77).toString("base64");
    const proof = await ctor.commitDigest({
      digestB64: digest,
      metadata: { mode: "digest-only" },
    });
    assert.deepEqual(proof.metadata, { mode: "digest-only" });
  });
});
