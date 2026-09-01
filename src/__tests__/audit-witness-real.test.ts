/**
 * End-to-end: block-header witnesses produced by the exporter make an anchor's
 * Ethereum time claim verifiable FULLY OFFLINE, and the audit accepts them.
 *
 * The two witness fixtures were produced by the same header-RLP encoder the
 * website export uses (website/src/lib/eth-header.ts), for the two real
 * Ethereum blocks the whitepaper bundle's anchors signed: 25525146 (the before
 * anchor, block of commit 112758) and 25525147 (the after anchor, block of
 * commit 112762). Each was self-checked at generation time: keccak256(headerRlp)
 * equals the block hash.
 *
 * This test bundles the three real proofs plus the two witnesses and confirms
 * the audit's zero-network witness procedure verifies both, so the exporter's
 * output and the verifier's expectations actually meet. Before this feature the
 * anchors carried a block hash but no header, so the timestamp could only be
 * resolved online; now the bundle stands alone.
 */

import { describe, it, before, after } from "node:test";
import * as assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, rm, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { runAudit, buildJsonReport, computeExitFlags, type AuditResult } from "@mikeargento/bitgraph-audit";
import { computeProofHash, type BitGraphProof } from "@mikeargento/bitgraph-verify";

function safe(value: string): string {
  return value.replace(/[^A-Za-z0-9]/g, "_");
}
async function fixture(name: string): Promise<Record<string, unknown>> {
  const url = new URL(`../../src/__tests__/real-fixtures/${name}`, import.meta.url);
  return JSON.parse(await readFile(fileURLToPath(url), "utf8"));
}

describe("audit: real block-header witnesses verify offline", () => {
  let dir: string;
  let result: AuditResult;

  before(async () => {
    const proofs = await Promise.all([
      fixture("anchor-with-ethereum-112758.json"),
      fixture("successor-112760.json"),
      fixture("anchor-after-112762.json"),
    ]);

    dir = await mkdtemp(join(tmpdir(), "bitgraph-audit-witness-"));
    for (const proof of proofs) {
      const commit = proof.commit as { epochId: string; counter: string };
      const epochDir = join(dir, "proofs", safe(commit.epochId));
      await mkdir(epochDir, { recursive: true });
      await writeFile(
        join(epochDir, `${commit.counter}-${safe(computeProofHash(proof as unknown as BitGraphProof))}.json`),
        JSON.stringify(proof)
      );
    }
    // Witnesses discovered by shape; path is conventional only.
    const witnessDir = join(dir, "witnesses");
    await mkdir(witnessDir, { recursive: true });
    for (const block of [25525146, 25525147]) {
      const w = await fixture(`witness-${block}.json`);
      await writeFile(join(witnessDir, `${block}.json`), JSON.stringify(w));
    }
    result = await runAudit(dir);
  });

  after(async () => {
    if (dir !== undefined) await rm(dir, { recursive: true, force: true });
  });

  it("ingests both witnesses and verifies both against the signed anchor hashes", () => {
    const report = buildJsonReport(result);
    assert.equal(report.input.counts.witnesses, 2);
    assert.equal(report.summary.temporal.anchorsWithVerifiedWitness, 2);
  });

  it("lower-bounds the whitepaper's causal segment and records its following anchor", () => {
    const report = buildJsonReport(result);
    // Both bounding anchors now carry a verified offline timestamp, so the
    // segment holding the whitepaper commit is bracketed (upper AND lower).
    assert.equal(report.summary.temporal.segmentsWithFollowingAnchor, 1);
    assert.equal(report.summary.temporal.segmentsUnanchored, 0);
  });

  it("exits clean (code 0): witnesses only add evidence, never failure", () => {
    assert.deepEqual(computeExitFlags(result), {
      verificationFailures: false,
      chainAnomaliesOrDivergences: false,
      code: 0,
    });
  });
});
