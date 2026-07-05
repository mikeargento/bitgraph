// Copyright (c) Mike Argento. All rights reserved. See LICENSE.

/**
 * Integration test: HTTP commit service (mock server)
 *
 * Starts server/commit-service/dist/mock/mock-server.js, exercises the full
 * commit → verify cycle over HTTP, and confirms that tampered proofs are rejected.
 */

import { describe, test, before, after } from "node:test";
import * as assert from "node:assert/strict";
import { spawn, type ChildProcess } from "node:child_process";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import { join, dirname } from "node:path";
import type { BitGraphProof } from "../index.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

// Two levels up from dist/__tests__/ reaches the project root.
const MOCK_SERVER_PATH = join(
  __dirname,
  "../../server/commit-service/dist/mock/mock-server.js"
);

const PORT = 18787;
const BASE_URL = `http://localhost:${PORT}`;

async function waitForServer(timeoutMs = 8000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`${BASE_URL}/health`);
      if (res.ok) return;
    } catch {
      // not ready yet
    }
    await new Promise<void>((r) => setTimeout(r, 100));
  }
  throw new Error(`Mock server did not become ready within ${timeoutMs}ms`);
}

function sha256B64(text: string): string {
  return createHash("sha256").update(text, "utf8").digest("base64");
}

describe("HTTP commit service integration", () => {
  let server: ChildProcess;

  before(async () => {
    server = spawn(process.execPath, [MOCK_SERVER_PATH], {
      env: { ...process.env, PORT: String(PORT) },
      stdio: "pipe",
    });
    await waitForServer();
  });

  after(() => {
    server.kill();
  });

  test("happy path: commit + verify succeeds", async () => {
    const digestB64 = sha256B64("hello bitgraph integration test");

    // Commit
    const commitRes = await fetch(`${BASE_URL}/commit`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ digests: [{ digestB64, hashAlg: "sha256" }] }),
    });
    assert.equal(commitRes.status, 200, "POST /commit should return 200");

    const proofs = (await commitRes.json()) as BitGraphProof[];
    assert.ok(Array.isArray(proofs) && proofs.length === 1, "expected one proof");

    const proof = proofs[0]!;
    assert.equal(proof.version, "bitgraph/1");
    assert.equal(proof.artifact.digestB64, digestB64);

    // Verify
    const verifyRes = await fetch(`${BASE_URL}/verify`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ proof }),
    });
    assert.equal(verifyRes.status, 200, "POST /verify should return 200");

    const result = (await verifyRes.json()) as { valid: boolean; reason?: string };
    assert.equal(result.valid, true, `signature verification failed: ${result.reason}`);
  });

  test("tamper path: modified digest bytes are rejected", async () => {
    const digestB64 = sha256B64("tamper test payload");

    const commitRes = await fetch(`${BASE_URL}/commit`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ digests: [{ digestB64, hashAlg: "sha256" }] }),
    });
    assert.equal(commitRes.status, 200);

    const proofs = (await commitRes.json()) as BitGraphProof[];
    // Deep-clone and tamper the artifact digest
    const tampered: BitGraphProof = JSON.parse(JSON.stringify(proofs[0]!)) as BitGraphProof;
    tampered.artifact.digestB64 = sha256B64("completely different content");

    const verifyRes = await fetch(`${BASE_URL}/verify`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ proof: tampered }),
    });
    assert.equal(verifyRes.status, 200);

    const result = (await verifyRes.json()) as { valid: boolean; reason?: string };
    assert.equal(result.valid, false, "tampered proof should fail verification");
  });
});
