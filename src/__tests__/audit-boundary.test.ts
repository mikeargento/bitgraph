/**
 * Option A: a bounded proof bundle (a real export excerpt) audits CLEAN.
 *
 * These are the three real, contiguous proofs from an actual export of the
 * BitGraph whitepaper: the before-anchor (112758) -> the whitepaper commit
 * (112760) -> the after-anchor (112762). They chain intact among themselves;
 * the only "missing" link is 112758's predecessor (112756), which precedes the
 * exported window and is legitimately not included.
 *
 * Before Option A, that leading-edge gap surfaced as a `chain-break-missing`
 * anomaly and set exit code 2, making a perfectly good proof bundle look
 * failed. A validly signed, attested proof only exists by extending the chain
 * (fail-closed construction), so the excerpt boundary is expected, not a
 * defect. The audit now records it as an informational boundary entry point:
 * zero anomalies, chain intact, exit 0. Interior holes remain anomalies (see
 * audit-anomalies "missing middle" / "missing head"), so this does not weaken
 * full-epoch auditing.
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

function safe(value: string): string {
  return value.replace(/[^A-Za-z0-9]/g, "_");
}

describe("audit: bounded export excerpt is clean (Option A boundary)", () => {
  let dir: string;
  let result: AuditResult;
  let proofs: Array<BitGraphProof & { proofHash?: string }>;

  before(async () => {
    proofs = [];
    for (const name of [
      "anchor-with-ethereum-112758.json",
      "successor-112760.json",
      "anchor-after-112762.json",
    ]) {
      const url = new URL(`../../src/__tests__/real-fixtures/${name}`, import.meta.url);
      proofs.push(JSON.parse(await readFile(fileURLToPath(url), "utf8")));
    }

    dir = await mkdtemp(join(tmpdir(), "bitgraph-audit-boundary-"));
    for (const proof of proofs) {
      const epochDir = join(dir, "proofs", safe(proof.commit.epochId as string));
      await mkdir(epochDir, { recursive: true });
      const fileName = `${proof.commit.counter}-${safe(computeProofHash(proof))}.json`;
      await writeFile(join(epochDir, fileName), JSON.stringify(proof));
    }
    result = await runAudit(dir);
  });

  after(async () => {
    if (dir !== undefined) await rm(dir, { recursive: true, force: true });
  });

  it("reconstructs the excerpt as one intact chain with no anomalies", () => {
    const report = buildJsonReport(result);
    assert.equal(result.ingest.counts.observed, 3);
    assert.equal(result.reconstruction.partitions.length, 1);
    assert.equal(result.reconstruction.partitions[0]!.components.length, 1);
    assert.equal(result.anomalies.anomalies.length, 0);
    assert.equal(result.anomalies.divergences.length, 0);
    assert.equal(report.summary.chainIntact, true);
    assert.equal(report.summary.partitionsIntact, 1);
  });

  it("records exactly one boundary entry point: the excerpt's earliest proof (112758)", () => {
    const report = buildJsonReport(result);
    assert.equal(report.summary.boundaryEntryPoints, 1);
    assert.equal(report.boundaryEntryPoints.length, 1);
    const boundary = report.boundaryEntryPoints[0]!;
    const earliest = proofs.find((p) => p.commit.counter === "112758")!;
    assert.equal(boundary.proofHash, computeProofHash(earliest));
    assert.equal(boundary.prevB64, earliest.commit.prevB64);
  });

  it("exits clean (code 0): a bounded excerpt is not a failure", () => {
    assert.deepEqual(computeExitFlags(result), {
      verificationFailures: false,
      chainAnomaliesOrDivergences: false,
      code: 0,
    });
  });
});
