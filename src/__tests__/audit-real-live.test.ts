// Copyright (c) Mike Argento. All rights reserved. See LICENSE.

/**
 * Real-ledger regression test for the audit pipeline.
 *
 * These three proofs (real-fixtures/live-proof-0.json .. live-proof-2.json)
 * were captured from the live BitGraph ledger: a contiguous single-epoch
 * chain (genesis commit counter 2, then 4, then 6, each linked to its
 * predecessor by commit.prevB64). They are stored-form, carrying the
 * ledger-added proofHash field.
 *
 * This test exists specifically because the synthetic fixtures shared the
 * audit tool's ORIGINAL wrong assumptions and so masked two real bugs:
 *
 *   Bug A: real slot allocations carry NO time field (the enclave builds
 *   slot bodies without a clock). The verifier used to require it, so real
 *   slots failed verification. If this test's proofs verify at the
 *   integrity tier (0 failed), Bug A is fixed.
 *
 *   Bug B: commit.prevB64 references computeChainHash(predecessor) (SHA-256
 *   over the whole canonical proof minus the ledger proofHash), NOT
 *   computeProofHash (the signed-body subset). The synthetic fixtures built
 *   their prevB64 from computeProofHash, the same wrong value the tool
 *   assumed, so they linked "by accident". Real proofs use the true chain
 *   hash. If this real chain reconstructs as ONE intact component with ZERO
 *   anomalies, Bug B is fixed.
 *
 * No synthetic construction: the assertions ride entirely on real bytes.
 */

import { describe, it, before, after } from "node:test";
import * as assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, rm, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  runAudit,
  buildJsonReport,
  computeExitFlags,
  type AuditResult,
} from "@mikeargento/bitgraph-audit";
import { computeProofHash, type BitGraphProof } from "@mikeargento/bitgraph-verify";

/** Filesystem-safe token from a base64/arbitrary string. */
function safe(value: string): string {
  return value.replace(/[^A-Za-z0-9]/g, "_");
}

describe("audit: real live-ledger chain (Bug A + Bug B regression)", () => {
  let dir: string;
  let result: AuditResult;
  let proofs: Array<BitGraphProof & { proofHash?: string }>;

  before(async () => {
    // Load the three captured real proofs from src/__tests__/real-fixtures.
    // The test runs from dist/__tests__, so reach back into src.
    proofs = [];
    for (const i of [0, 1, 2]) {
      const url = new URL(
        `../../src/__tests__/real-fixtures/live-proof-${i}.json`,
        import.meta.url
      );
      const raw = await readFile(fileURLToPath(url), "utf8");
      proofs.push(JSON.parse(raw) as BitGraphProof & { proofHash?: string });
    }

    // Write a valid directory bundle: proofs/<epoch>/<counter>-<hash>.json.
    // Bytes are the exact captured stored-form JSON; no re-serialization of
    // the signed content, so nothing about the real proof is altered.
    dir = await mkdtemp(join(tmpdir(), "bitgraph-audit-real-live-"));
    for (const proof of proofs) {
      const epochDir = join(dir, "proofs", safe(proof.commit.epochId as string));
      await mkdir(epochDir, { recursive: true });
      const name = `${proof.commit.counter}-${safe(computeProofHash(proof))}.json`;
      await writeFile(join(epochDir, name), JSON.stringify(proof));
    }

    result = await runAudit(dir);
  });

  after(async () => {
    if (dir !== undefined) await rm(dir, { recursive: true, force: true });
  });

  it("verifies every real proof at the integrity tier (Bug A: clockless slots verify)", () => {
    // All three are observed, none rejected as an unsupported version.
    assert.equal(result.ingest.counts.observed, 3);
    assert.equal(result.ingest.counts.unsupportedVersion, 0);

    // Bug A proof: real slot allocations carry no time field. If the
    // verifier still required it, these would be "failed", not
    // "artifact-unavailable". No artifact bytes are in the bundle, so the
    // integrity tier is the ceiling and every proof must pass it.
    assert.equal(result.verification.failed, 0);
    assert.equal(result.verification.verified, 0);
    assert.equal(result.verification.artifactUnavailable, 3);
  });

  it("reconstructs the real chain as one intact component (Bug B: prevB64 is the chain hash)", () => {
    const report = buildJsonReport(result);

    // One signer, one epoch, one chain -> exactly one partition.
    assert.equal(result.reconstruction.partitions.length, 1);
    const partition = result.reconstruction.partitions[0]!;

    // The three proofs link into a SINGLE connected component of all three
    // members. This only holds if commit.prevB64 resolves against
    // computeChainHash(predecessor); against computeProofHash it would
    // fragment into three genesis components with chain breaks.
    assert.equal(partition.components.length, 1);
    assert.equal(partition.components[0]!.memberProofHashes.length, 3);

    // No anomalies of any kind, no divergences, chain intact.
    assert.equal(result.anomalies.anomalies.length, 0);
    assert.equal(result.anomalies.divergences.length, 0);
    assert.equal(report.summary.chainIntact, true);
    assert.equal(report.summary.partitionsIntact, 1);
  });

  it("exits clean (code 0) over the real bundle", () => {
    assert.deepEqual(computeExitFlags(result), {
      verificationFailures: false,
      chainAnomaliesOrDivergences: false,
      code: 0,
    });
  });
});
