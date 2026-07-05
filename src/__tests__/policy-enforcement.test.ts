// Copyright (c) Mike Argento. All rights reserved. See LICENSE.
// End-to-end test for the BitGraph policy enforcement pipeline.

import { test, describe } from "node:test";
import * as assert from "node:assert/strict";
import { tmpdir } from "node:os";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { Constructor } from "../constructor.js";
import { canonicalize } from "../canonical.js";
import { hashPolicy, createPolicyBinding } from "../policy.js";
import { sha256 } from "@noble/hashes/sha256";

// Inline stub host for test isolation — dynamic import avoids tsc dist conflicts
async function createTestHost(statePath: string) {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const mod = await import("bitgraph-stub" as string) as any;
  const StubHost = mod.StubHost ?? mod.default?.StubHost;
  return StubHost.createPersistent({
    statePath,
    measurement: "test",
    enableTime: true,
    enableCounter: true,
  });
}

const TEST_POLICY = `# Policy: Test Policy
version: 2.0

## Allowed Tools
- search
- read_file

## Limits
- max_actions: 100
- rate_limit: 10/min
`;

const TEST_POLICY_REVOKED = `# Policy: Test Policy Revoked
version: 3.0

## Allowed Tools
- search

## Limits
- max_actions: 50
`;

describe("Policy Enforcement Pipeline", () => {
  test("policy binding is created from markdown", () => {
    const binding = createPolicyBinding(TEST_POLICY);
    assert.ok(binding.digestB64, "should have digestB64");
    assert.equal(binding.name, "Test Policy");
    assert.equal(binding.version, "2.0");
  });

  test("policy committed as slot 0 with binding in proof", async () => {
    const testDir = join(tmpdir(), `bitgraph-test-${Date.now()}`);
    mkdirSync(testDir, { recursive: true });

    const stub = await createTestHost(join(testDir, "state.json"));

    const constructor = await Constructor.initialize({
      host: stub.host,
      policy: { requireCounter: true, requireTime: true },
    });

    const binding = createPolicyBinding(TEST_POLICY);
    const policyDigest = hashPolicy(TEST_POLICY);

    const policyProof = await constructor.commitDigest({
      digestB64: policyDigest,
      metadata: { kind: "policy-commitment", policyName: binding.name },
      policy: binding,
    });

    assert.ok(policyProof, "should return a proof");
    assert.equal(policyProof.commit.counter, "1");
    assert.ok(policyProof.policy, "proof should have policy field");
    assert.equal(policyProof.policy!.digestB64, policyDigest);
    assert.equal(policyProof.policy!.name, "Test Policy");

    const proofHash = Buffer.from(sha256(canonicalize(policyProof))).toString("base64");
    binding.authorProofDigestB64 = proofHash;
    assert.ok(binding.authorProofDigestB64);
  });

  test("action proofs carry the policy binding", async () => {
    const testDir = join(tmpdir(), `bitgraph-test-${Date.now()}`);
    mkdirSync(testDir, { recursive: true });

    const stub = await createTestHost(join(testDir, "state.json"));

    const constructor = await Constructor.initialize({
      host: stub.host,
      policy: { requireCounter: true, requireTime: true },
    });

    const binding = createPolicyBinding(TEST_POLICY);
    const policyDigest = hashPolicy(TEST_POLICY);

    const policyProof = await constructor.commitDigest({
      digestB64: policyDigest,
      metadata: { kind: "policy-commitment" },
      policy: binding,
    });

    const proofHash = Buffer.from(sha256(canonicalize(policyProof))).toString("base64");
    binding.authorProofDigestB64 = proofHash;

    const actionDigest = Buffer.from(sha256(new TextEncoder().encode("search:query"))).toString("base64");
    const actionProof = await constructor.commitDigest({
      digestB64: actionDigest,
      metadata: { kind: "tool-execution", tool: "search" },
      prevProofHashB64: proofHash,
      policy: binding,
    });

    assert.ok(actionProof.policy, "action proof should have policy");
    assert.equal(actionProof.policy!.digestB64, policyDigest);
    assert.equal(actionProof.policy!.authorProofDigestB64, proofHash);
    assert.equal(actionProof.commit.counter, "2");
  });

  test("policy revocation updates binding", async () => {
    const testDir = join(tmpdir(), `bitgraph-test-${Date.now()}`);
    mkdirSync(testDir, { recursive: true });

    const stub = await createTestHost(join(testDir, "state.json"));

    const constructor = await Constructor.initialize({
      host: stub.host,
      policy: { requireCounter: true, requireTime: true },
    });

    // Slot 0: original policy
    const originalBinding = createPolicyBinding(TEST_POLICY);
    const originalDigest = hashPolicy(TEST_POLICY);

    const slot0Proof = await constructor.commitDigest({
      digestB64: originalDigest,
      metadata: { kind: "policy-commitment" },
      policy: originalBinding,
    });
    const slot0Hash = Buffer.from(sha256(canonicalize(slot0Proof))).toString("base64");
    originalBinding.authorProofDigestB64 = slot0Hash;

    // Action under original policy
    const action1 = await constructor.commitDigest({
      digestB64: Buffer.from(sha256(new TextEncoder().encode("action1"))).toString("base64"),
      metadata: { kind: "tool-execution", tool: "read_file" },
      prevProofHashB64: slot0Hash,
      policy: originalBinding,
    });
    assert.equal(action1.policy!.digestB64, originalDigest);

    // Revoke: commit new policy
    const revokedBinding = createPolicyBinding(TEST_POLICY_REVOKED);
    const revokedDigest = hashPolicy(TEST_POLICY_REVOKED);

    const action1Hash = Buffer.from(sha256(canonicalize(action1))).toString("base64");
    const revokeProof = await constructor.commitDigest({
      digestB64: revokedDigest,
      metadata: { kind: "policy-change", removed: ["read_file"] },
      prevProofHashB64: action1Hash,
      policy: revokedBinding,
    });
    const revokeHash = Buffer.from(sha256(canonicalize(revokeProof))).toString("base64");
    revokedBinding.authorProofDigestB64 = revokeHash;

    // Action under new (revoked) policy
    const action2 = await constructor.commitDigest({
      digestB64: Buffer.from(sha256(new TextEncoder().encode("action2"))).toString("base64"),
      metadata: { kind: "tool-execution", tool: "search" },
      prevProofHashB64: revokeHash,
      policy: revokedBinding,
    });

    assert.equal(action2.policy!.digestB64, revokedDigest);
    assert.equal(action2.policy!.authorProofDigestB64, revokeHash);
    assert.notEqual(action2.policy!.digestB64, originalDigest);
  });

  test("causal ordering: policy counter < action counter", async () => {
    const testDir = join(tmpdir(), `bitgraph-test-${Date.now()}`);
    mkdirSync(testDir, { recursive: true });

    const stub = await createTestHost(join(testDir, "state.json"));

    const constructor = await Constructor.initialize({
      host: stub.host,
      policy: { requireCounter: true, requireTime: true },
    });

    const binding = createPolicyBinding(TEST_POLICY);

    const policyProof = await constructor.commitDigest({
      digestB64: hashPolicy(TEST_POLICY),
      metadata: { kind: "policy-commitment" },
      policy: binding,
    });
    const policyCounter = BigInt(policyProof.commit.counter ?? "0");

    const proofHash = Buffer.from(sha256(canonicalize(policyProof))).toString("base64");
    binding.authorProofDigestB64 = proofHash;

    for (let i = 1; i <= 3; i++) {
      const actionProof = await constructor.commitDigest({
        digestB64: Buffer.from(sha256(new TextEncoder().encode(`action-${i}`))).toString("base64"),
        metadata: { kind: "tool-execution", tool: "search" },
        policy: binding,
      });
      const actionCounter = BigInt(actionProof.commit.counter ?? "0");
      assert.ok(actionCounter > policyCounter, `action ${i} counter (${actionCounter}) > policy counter (${policyCounter})`);
    }
  });

  test("hashPolicy produces consistent digest", () => {
    const digest1 = hashPolicy(TEST_POLICY);
    const digest2 = hashPolicy(TEST_POLICY);
    assert.equal(digest1, digest2);

    const digest3 = hashPolicy(TEST_POLICY_REVOKED);
    assert.notEqual(digest1, digest3);
  });
});
