#!/usr/bin/env node
// Copyright (c) Mike Argento. All rights reserved. See LICENSE.

/**
 * Agency signing integration test
 *
 * Exercises the full challenge → sign → commit → verify flow:
 *   1. Generate a P-256 keypair (simulates device Secure Enclave)
 *   2. POST /challenge → get enclave-issued nonce
 *   3. SHA-256 an artifact → build canonical AuthorizationPayload
 *   4. P-256 sign the payload (DER format, as Node.js crypto produces)
 *   5. POST /commit with agency envelope
 *   6. Verify returned proof has agency block
 *   7. POST /verify to validate server-side verification
 *   8. Also test: commit WITHOUT agency still works
 *   9. Also test: replay attack (reuse challenge) is rejected
 *
 * Run:
 *   1. Start mock server:  npm run dev
 *   2. In another terminal:  node --import tsx/esm src/mock/test-agency.ts
 */

import { createHash, createSign, generateKeyPairSync } from "node:crypto";
import { sha256 } from "@noble/hashes/sha256";

const BASE = process.env["BITGRAPH_URL"] ?? "http://localhost:8787";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function post(path: string, body: unknown): Promise<unknown> {
  const res = await fetch(`${BASE}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const json = await res.json();
  if (!res.ok) {
    throw new Error(`${path} returned ${res.status}: ${JSON.stringify(json)}`);
  }
  return json;
}

async function get(path: string): Promise<unknown> {
  const res = await fetch(`${BASE}${path}`);
  return res.json();
}

function assert(condition: boolean, message: string): void {
  if (!condition) {
    console.error(`❌ FAIL: ${message}`);
    process.exit(1);
  }
  console.log(`  ✅ ${message}`);
}

// ---------------------------------------------------------------------------
// Generate P-256 keypair (simulates device Secure Enclave)
// ---------------------------------------------------------------------------

const { publicKey, privateKey } = generateKeyPairSync("ec", {
  namedCurve: "P-256",
});

// Export SPKI DER for the actor identity
const pubKeyDer = publicKey.export({ type: "spki", format: "der" });
const publicKeyB64 = pubKeyDer.toString("base64");
const keyId = createHash("sha256").update(pubKeyDer).digest("hex");

console.log("\n═══════════════════════════════════════════════");
console.log("  BitGraph Agency Signing — Integration Test");
console.log("═══════════════════════════════════════════════\n");
console.log(`Server:     ${BASE}`);
console.log(`Actor keyId: ${keyId.slice(0, 16)}...`);
console.log(`Algorithm:   ES256 (P-256 ECDSA)`);
console.log(`Provider:    test-node-crypto\n`);

// ---------------------------------------------------------------------------
// Test 1: Health check
// ---------------------------------------------------------------------------

console.log("── Test 1: Health check ──");
const health = await get("/health") as { ok: boolean };
assert(health.ok === true, "Server is healthy");

// ---------------------------------------------------------------------------
// Test 2: Get enclave key info
// ---------------------------------------------------------------------------

console.log("\n── Test 2: Enclave key info ──");
const keyInfo = await get("/key") as { publicKeyB64: string; measurement: string; enforcement: string };
assert(typeof keyInfo.publicKeyB64 === "string", `Enclave publicKey: ${keyInfo.publicKeyB64.slice(0, 20)}...`);
assert(typeof keyInfo.measurement === "string", `Measurement: ${keyInfo.measurement.slice(0, 30)}...`);
assert(keyInfo.enforcement === "stub", `Enforcement: ${keyInfo.enforcement}`);

// ---------------------------------------------------------------------------
// Test 3: Commit WITHOUT agency (baseline — should still work)
// ---------------------------------------------------------------------------

console.log("\n── Test 3: Commit without agency (baseline) ──");
const testData = Buffer.from("hello world — no agency test");
const digest = sha256(testData);
const digestB64 = Buffer.from(digest).toString("base64");

const baselineProofs = await post("/commit", {
  digests: [{ digestB64, hashAlg: "sha256" }],
  metadata: { test: "no-agency-baseline" },
}) as any[];
assert(Array.isArray(baselineProofs) && baselineProofs.length === 1, "Received 1 proof");
assert(baselineProofs[0].agency === undefined, "No agency in baseline proof");
assert(baselineProofs[0].version === "bitgraph/1", "Version is bitgraph/1");
assert(typeof baselineProofs[0].signer.signatureB64 === "string", "Has Ed25519 signature");

// Verify baseline proof
const baselineVerify = await post("/verify", { proof: baselineProofs[0] }) as { valid: boolean; checks?: string[] };
assert(baselineVerify.valid === true, `Baseline proof verified (checks: ${baselineVerify.checks?.join(", ")})`);

// ---------------------------------------------------------------------------
// Test 4: Full agency flow — challenge → sign → commit → verify
// ---------------------------------------------------------------------------

console.log("\n── Test 4: Full agency flow ──");

// Step 1: Request challenge
console.log("  Step 1: Request challenge...");
const challengeResp = await post("/challenge", {}) as { challenge: string };
assert(typeof challengeResp.challenge === "string", `Got challenge: ${challengeResp.challenge.slice(0, 20)}...`);
const challenge = challengeResp.challenge;

// Step 2: Prepare artifact
console.log("  Step 2: Prepare artifact...");
const artifactBytes = Buffer.from("agency test artifact — biometric-authorized content");
const artifactDigest = sha256(artifactBytes);
const artifactDigestB64 = Buffer.from(artifactDigest).toString("base64");
assert(true, `Artifact digest: ${artifactDigestB64.slice(0, 20)}...`);

// Step 3: Build canonical authorization payload
console.log("  Step 3: Build canonical payload...");
const timestamp = Date.now();
const canonicalPayload = {
  purpose: "bitgraph/commit-authorize/v1" as const,
  actorKeyId: keyId,
  artifactHash: artifactDigestB64,
  challenge,
  timestamp,
};
// Canonical JSON: sorted keys, compact
const payloadJson = JSON.stringify(canonicalPayload, Object.keys(canonicalPayload).sort());
console.log(`    Canonical JSON: ${payloadJson.slice(0, 60)}...`);

// Step 4: P-256 sign the payload
console.log("  Step 4: P-256 sign payload...");
const signer = createSign("SHA256");
signer.update(Buffer.from(payloadJson, "utf8"));
const signatureBytes = signer.sign(privateKey);
const signatureB64 = signatureBytes.toString("base64");
assert(signatureBytes.length > 0, `Signature: ${signatureB64.slice(0, 20)}... (${signatureBytes.length} bytes DER)`);

// Step 5: Build agency envelope
const agency = {
  actor: {
    keyId,
    publicKeyB64,
    algorithm: "ES256" as const,
    provider: "test-node-crypto",
  },
  authorization: {
    purpose: "bitgraph/commit-authorize/v1" as const,
    actorKeyId: keyId,
    artifactHash: artifactDigestB64,
    challenge,
    timestamp,
    signatureB64,
  },
};

// Step 6: POST /commit with agency
console.log("  Step 5: POST /commit with agency...");
const agencyProofs = await post("/commit", {
  digests: [{ digestB64: artifactDigestB64, hashAlg: "sha256" }],
  metadata: { test: "agency-flow", actor: keyId.slice(0, 8) },
  agency,
}) as any[];

assert(Array.isArray(agencyProofs) && agencyProofs.length === 1, "Received 1 proof");
const proof = agencyProofs[0];

// Verify proof structure
console.log("\n  ── Proof structure checks ──");
assert(proof.version === "bitgraph/1", "Version: bitgraph/1");
assert(proof.artifact.digestB64 === artifactDigestB64, "Artifact digest matches");
assert(typeof proof.signer.signatureB64 === "string", "Has Ed25519 signature");
assert(proof.environment.enforcement === "stub", "Enforcement: stub");

// Verify agency block
assert(proof.agency !== undefined, "Proof has agency block");
assert(proof.agency.actor.keyId === keyId, "Actor keyId matches");
assert(proof.agency.actor.publicKeyB64 === publicKeyB64, "Actor publicKeyB64 matches");
assert(proof.agency.actor.algorithm === "ES256", "Actor algorithm: ES256");
assert(proof.agency.actor.provider === "test-node-crypto", "Actor provider: test-node-crypto");
assert(proof.agency.authorization.purpose === "bitgraph/commit-authorize/v1", "Purpose: bitgraph/commit-authorize/v1");
assert(proof.agency.authorization.challenge === challenge, "Challenge matches");
assert(proof.agency.authorization.artifactHash === artifactDigestB64, "ArtifactHash matches digest");
assert(proof.agency.authorization.actorKeyId === keyId, "ActorKeyId matches actor.keyId");
assert(proof.agency.authorization.signatureB64 === signatureB64, "P-256 signature preserved");

// Step 7: Verify agency proof server-side
console.log("\n  ── Server-side verification ──");
const agencyVerify = await post("/verify", { proof }) as { valid: boolean; checks?: string[] };
assert(agencyVerify.valid === true, `Agency proof verified (checks: ${agencyVerify.checks?.join(", ")})`);

// ---------------------------------------------------------------------------
// Test 5: Replay attack — reuse same challenge
// ---------------------------------------------------------------------------

console.log("\n── Test 5: Replay attack (reuse challenge) ──");
try {
  await post("/commit", {
    digests: [{ digestB64: artifactDigestB64, hashAlg: "sha256" }],
    agency: {
      actor: agency.actor,
      authorization: {
        ...agency.authorization,
        timestamp: Date.now(), // fresh timestamp but same challenge
      },
    },
  });
  assert(false, "Replay should have been rejected");
} catch (err: any) {
  assert(
    err.message.includes("challenge not found or expired") || err.message.includes("500"),
    `Replay rejected: ${err.message.slice(0, 80)}`
  );
}

// ---------------------------------------------------------------------------
// Test 6: Wrong keyId (tampered identity)
// ---------------------------------------------------------------------------

console.log("\n── Test 6: Tampered keyId ──");
const challenge2 = ((await post("/challenge", {})) as { challenge: string }).challenge;
const timestamp2 = Date.now();
const tamperedPayload = {
  purpose: "bitgraph/commit-authorize/v1" as const,
  actorKeyId: "deadbeef0000000000000000000000000000000000000000000000000000cafe",
  artifactHash: artifactDigestB64,
  challenge: challenge2,
  timestamp: timestamp2,
};
const tamperedJson = JSON.stringify(tamperedPayload, Object.keys(tamperedPayload).sort());
const tamperedSigner = createSign("SHA256");
tamperedSigner.update(Buffer.from(tamperedJson, "utf8"));
const tamperedSigB64 = tamperedSigner.sign(privateKey).toString("base64");

try {
  await post("/commit", {
    digests: [{ digestB64: artifactDigestB64, hashAlg: "sha256" }],
    agency: {
      actor: {
        ...agency.actor,
        keyId: "deadbeef0000000000000000000000000000000000000000000000000000cafe",
      },
      authorization: {
        ...tamperedPayload,
        signatureB64: tamperedSigB64,
      },
    },
  });
  assert(false, "Tampered keyId should have been rejected");
} catch (err: any) {
  assert(
    err.message.includes("keyId") || err.message.includes("does not match") || err.message.includes("500"),
    `Tampered keyId rejected: ${err.message.slice(0, 80)}`
  );
}

// ---------------------------------------------------------------------------
// Test 7: Wrong artifactHash (digest mismatch)
// ---------------------------------------------------------------------------

console.log("\n── Test 7: Digest mismatch ──");
const challenge3 = ((await post("/challenge", {})) as { challenge: string }).challenge;
const wrongDigest = Buffer.from(sha256(Buffer.from("different data"))).toString("base64");
const timestamp3 = Date.now();
const mismatchPayload = {
  purpose: "bitgraph/commit-authorize/v1" as const,
  actorKeyId: keyId,
  artifactHash: wrongDigest, // signed over wrong digest
  challenge: challenge3,
  timestamp: timestamp3,
};
const mismatchJson = JSON.stringify(mismatchPayload, Object.keys(mismatchPayload).sort());
const mismatchSigner = createSign("SHA256");
mismatchSigner.update(Buffer.from(mismatchJson, "utf8"));
const mismatchSigB64 = mismatchSigner.sign(privateKey).toString("base64");

try {
  await post("/commit", {
    digests: [{ digestB64: artifactDigestB64, hashAlg: "sha256" }], // actual digest differs
    agency: {
      actor: agency.actor,
      authorization: {
        ...mismatchPayload,
        signatureB64: mismatchSigB64,
      },
    },
  });
  assert(false, "Digest mismatch should have been rejected");
} catch (err: any) {
  assert(
    err.message.includes("artifactHash") || err.message.includes("does not match") || err.message.includes("500"),
    `Digest mismatch rejected: ${err.message.slice(0, 80)}`
  );
}

// ---------------------------------------------------------------------------
// Test 8: Invalid P-256 signature (signature over wrong data)
// ---------------------------------------------------------------------------

console.log("\n── Test 8: Invalid P-256 signature ──");
const challenge4 = ((await post("/challenge", {})) as { challenge: string }).challenge;
const timestamp4 = Date.now();
// Sign the right payload but with a different key
const { privateKey: wrongKey } = generateKeyPairSync("ec", { namedCurve: "P-256" });
const validPayload = {
  purpose: "bitgraph/commit-authorize/v1" as const,
  actorKeyId: keyId,
  artifactHash: artifactDigestB64,
  challenge: challenge4,
  timestamp: timestamp4,
};
const validJson = JSON.stringify(validPayload, Object.keys(validPayload).sort());
const wrongSigner = createSign("SHA256");
wrongSigner.update(Buffer.from(validJson, "utf8"));
const wrongSigB64 = wrongSigner.sign(wrongKey).toString("base64");

try {
  await post("/commit", {
    digests: [{ digestB64: artifactDigestB64, hashAlg: "sha256" }],
    agency: {
      actor: agency.actor, // original actor
      authorization: {
        ...validPayload,
        signatureB64: wrongSigB64, // signed with wrong key
      },
    },
  });
  assert(false, "Wrong P-256 signature should have been rejected");
} catch (err: any) {
  assert(
    err.message.includes("signature") || err.message.includes("verification failed") || err.message.includes("500"),
    `Wrong signature rejected: ${err.message.slice(0, 80)}`
  );
}

// ---------------------------------------------------------------------------
// Test 9: Multiple digests with agency (only first is bound)
// ---------------------------------------------------------------------------

console.log("\n── Test 9: Multiple digests with agency ──");
const challenge5 = ((await post("/challenge", {})) as { challenge: string }).challenge;
const timestamp5 = Date.now();
const digest2 = Buffer.from(sha256(Buffer.from("second artifact"))).toString("base64");

const multiPayload = {
  purpose: "bitgraph/commit-authorize/v1" as const,
  actorKeyId: keyId,
  artifactHash: artifactDigestB64, // bound to first digest
  challenge: challenge5,
  timestamp: timestamp5,
};
const multiJson = JSON.stringify(multiPayload, Object.keys(multiPayload).sort());
const multiSigner = createSign("SHA256");
multiSigner.update(Buffer.from(multiJson, "utf8"));
const multiSigB64 = multiSigner.sign(privateKey).toString("base64");

const multiProofs = await post("/commit", {
  digests: [
    { digestB64: artifactDigestB64, hashAlg: "sha256" },
    { digestB64: digest2, hashAlg: "sha256" },
  ],
  agency: {
    actor: agency.actor,
    authorization: {
      ...multiPayload,
      signatureB64: multiSigB64,
    },
  },
}) as any[];

assert(multiProofs.length === 2, "Received 2 proofs");
assert(multiProofs[0].agency !== undefined, "First proof has agency");
assert(multiProofs[1].agency !== undefined, "Second proof has agency");

// Verify both
const verify1 = await post("/verify", { proof: multiProofs[0] }) as { valid: boolean };
const verify2 = await post("/verify", { proof: multiProofs[1] }) as { valid: boolean };
assert(verify1.valid === true, "First proof verifies");
assert(verify2.valid === true, "Second proof verifies");

// ---------------------------------------------------------------------------
// Summary
// ---------------------------------------------------------------------------

console.log("\n═══════════════════════════════════════════════");
console.log("  ✅ ALL TESTS PASSED");
console.log("═══════════════════════════════════════════════");
console.log(`\nProof structure (from Test 4):`);
console.log(`  version:     ${proof.version}`);
console.log(`  artifact:    ${proof.artifact.digestB64.slice(0, 20)}...`);
console.log(`  counter:     ${proof.commit.counter}`);
console.log(`  enforcement: ${proof.environment.enforcement}`);
console.log(`  signer:      ${proof.signer.publicKeyB64.slice(0, 20)}... (Ed25519)`);
console.log(`  actor:       ${proof.agency.actor.keyId.slice(0, 16)}... (${proof.agency.actor.provider})`);
console.log(`  purpose:     ${proof.agency.authorization.purpose}`);
console.log(`\n  Two independent signatures:`);
console.log(`    Ed25519 (TEE):    ${proof.signer.signatureB64.slice(0, 20)}...`);
console.log(`    P-256 (device):   ${proof.agency.authorization.signatureB64.slice(0, 20)}...`);
console.log();
