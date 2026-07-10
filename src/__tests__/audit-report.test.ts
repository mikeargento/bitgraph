// Copyright (c) Mike Argento. All rights reserved. See LICENSE.

/**
 * Tests for the Phase 4d audit orchestrator and report generators:
 * runAudit end-to-end over the standard mixed bundle, JSON report with
 * stable codes and correct counts, deterministic double-run equality
 * (runMetadata stripped), executive-summary language in the brief's
 * style (two-position gap wording, no-winner divergence wording), and
 * zero em dash characters in all generated output.
 */

import { describe, it, before, after } from "node:test";
import * as assert from "node:assert/strict";
import { rm } from "node:fs/promises";
import {
  buildJsonReport,
  buildMarkdownReport,
  computeExitFlags,
  runAudit,
} from "@mikeargento/bitgraph-audit";
import type { AuditJsonReport, AuditResult } from "@mikeargento/bitgraph-audit";
import { makeStandardAuditBundle, type StandardAuditBundle } from "./audit-fixtures.js";

const EM_DASH = "—";

describe("audit orchestrator and reports: standard mixed bundle", () => {
  let bundle: StandardAuditBundle;
  let result: AuditResult;
  let report: AuditJsonReport;
  let markdown: string;

  before(async () => {
    bundle = await makeStandardAuditBundle();
    result = await runAudit(bundle.dir);
    report = buildJsonReport(result);
    markdown = buildMarkdownReport(result);
  });

  after(async () => {
    await rm(bundle.dir, { recursive: true, force: true });
  });

  it("runs the full pipeline end-to-end", () => {
    assert.equal(result.ingest.container, "directory");
    assert.equal(result.runMetadata.bundlePath, bundle.dir);
    assert.equal(typeof result.runMetadata.toolVersion, "string");
    assert.ok(result.runMetadata.startedAt.includes("T"));

    // Two partitions: the main chain and the anchor's own epoch.
    assert.equal(result.reconstruction.partitions.length, 2);

    // Verification tiers.
    assert.equal(result.verification.verified, bundle.expected.verified);
    assert.equal(result.verification.failed, bundle.expected.failed);
    assert.equal(result.verification.artifactUnavailable, bundle.expected.artifactUnavailable);
    assert.equal(result.verification.chainless, bundle.expected.chainless);

    // Chain anomalies: gap, break, fork.
    const codes = result.anomalies.anomalies.map((a) => a.code).sort();
    assert.deepEqual(codes, [
      "chain-break-missing",
      "predecessor-reuse",
      "unexplained-counter-positions",
    ]);
    assert.equal(result.anomalies.divergences.length, 1);
    assert.equal(result.anomalies.divergences[0]?.kind, "predecessor-reuse");
    const partyHashes = result.anomalies.divergences[0]?.parties.map((p) => p.proofHash).sort();
    assert.deepEqual(partyHashes, [bundle.forkAProofHash, bundle.forkBProofHash].sort());

    // The gap is exactly the dropped proof's two positions (slot 3, commit 4).
    const gap = result.anomalies.anomalies.find(
      (a) => a.code === "unexplained-counter-positions"
    );
    assert.deepEqual((gap?.details as { positions: string[] }).positions, ["3", "4"]);

    // Authority analysis is quiet; attestation records exist without documents.
    assert.equal(result.authorities.anomalies.length, 0);
    assert.equal(result.attestations.records.length, 6);
    assert.equal(result.attestations.counts.proofsWithDocument, 0);

    // The anchor was identified and its witness verified with the header timestamp.
    assert.deepEqual(result.temporal.verifiedAnchorProofHashes, [bundle.anchorProofHash]);
    const outcome = result.witnesses.outcomes.find((o) => o.verified);
    assert.equal(outcome?.anchorProofHash, bundle.anchorProofHash);
    assert.equal(outcome?.timestamp, bundle.blockTimestamp);
    assert.equal(outcome?.blockNumber, String(bundle.blockNumber));

    // Exit flags: unsupported-version sets bit 1, anomalies set bit 2.
    assert.deepEqual(computeExitFlags(result), {
      verificationFailures: true,
      chainAnomaliesOrDivergences: true,
      code: 3,
    });
  });

  it("JSON report carries the schema version, stable codes, and correct counts", () => {
    assert.equal(report.reportSchemaVersion, "bitgraph-audit-report/1");
    assert.equal(report.toolVersion, result.runMetadata.toolVersion);
    assert.equal(report.runMetadata.nondeterministic, true);

    assert.equal(report.input.counts.observed, bundle.expected.observed);
    assert.equal(report.input.counts.proofFiles, bundle.expected.proofFiles);
    assert.equal(report.input.counts.exactDuplicates, bundle.expected.exactDuplicates);
    assert.equal(report.input.counts.semanticDuplicates, bundle.expected.semanticDuplicates);
    assert.equal(report.input.counts.unsupportedVersion, bundle.expected.unsupportedVersion);
    assert.equal(report.input.counts.verified, bundle.expected.verified);
    assert.equal(report.input.counts.failed, bundle.expected.failed);
    assert.equal(report.input.counts.artifactUnavailable, bundle.expected.artifactUnavailable);
    assert.equal(report.input.counts.chainless, bundle.expected.chainless);

    // Machine consumers key on stable codes, never prose.
    const codes = report.anomalies.map((a) => a.code);
    for (const expected of [
      "unsupported-version",
      "exact-duplicate",
      "semantic-duplicate",
      "unexplained-counter-positions",
      "chain-break-missing",
      "predecessor-reuse",
    ]) {
      assert.ok(codes.includes(expected), `anomaly list includes ${expected}`);
    }
    assert.equal(report.anomalies.length, 6);
    assert.deepEqual(report.summary.anomalyCountsByCode, {
      "chain-break-missing": 1,
      "exact-duplicate": 1,
      "predecessor-reuse": 1,
      "semantic-duplicate": 1,
      "unexplained-counter-positions": 1,
      "unsupported-version": 1,
    });

    // Per-proof records: sorted by canonical hash, compact fields only.
    const hashes = report.proofs.map((p) => p.proofHash);
    assert.deepEqual(hashes, [...hashes].sort());
    assert.equal(report.proofs.length, bundle.expected.observed);
    assert.ok(!("proof" in (report.proofs[0] as object)), "raw proof objects never serialized");

    // The stored-form copy is cross-checked, never trusted. Its embedded
    // proofHash matched, so no mismatch escalation and no finding; the
    // record keeps the first observed copy's "absent" status per ingest
    // semantics (only a mismatch on any copy escalates).
    const genesis = report.proofs.find((p) => p.proofHash === bundle.chainProofHashes[0]);
    assert.notEqual(genesis?.embeddedProofHash, "mismatch");
    assert.ok(!codes.includes("proofhash-mismatch"));
    assert.equal(genesis?.sources.length, 3);
    assert.equal(genesis?.verificationStatus, "verified");

    // Partition intactness: main chain broken, anchor partition intact.
    assert.equal(report.partitions.length, 2);
    const mainPartition = report.partitions.find((p) => p.key.epochId === bundle.epochId);
    const anchorPartition = report.partitions.find((p) => p.key.epochId === bundle.anchorEpochId);
    assert.equal(mainPartition?.intact, false);
    assert.equal(mainPartition?.components.length, 2);
    assert.equal(anchorPartition?.intact, true);
    assert.equal(report.summary.chainIntact, false);
    assert.equal(report.summary.partitionsIntact, 1);

    // Epoch relationships: two epochs, no ordering evidence between them.
    assert.equal(report.summary.epochsObserved, 2);
    assert.equal(report.epochRelationships.unorderedPairs.length, 1);
    assert.equal(report.epochRelationships.orderedPairs.length, 0);

    // Rejected input listed with path and offending version string.
    assert.equal(report.unsupportedVersions.length, 1);
    assert.equal(report.unsupportedVersions[0]?.path, bundle.unsupportedPath);
    assert.equal(report.unsupportedVersions[0]?.version, "occ/1");

    // Temporal summary: the anchor's own segment is lower-bounded, the rest unanchored.
    assert.equal(report.summary.temporal.anchorsIdentified, 1);
    assert.equal(report.summary.temporal.anchorsWithVerifiedWitness, 1);
    assert.ok(report.summary.temporal.segmentsLowerBounded >= 1);
    assert.ok(report.summary.temporal.segmentsUnanchored >= 1);

    // Exit flags mirrored into the summary.
    assert.deepEqual(report.summary.exit, {
      verificationFailures: true,
      chainAnomaliesOrDivergences: true,
      code: 3,
    });
  });

  it("is deterministic across runs once runMetadata is stripped", async () => {
    const resultA = await runAudit(bundle.dir);
    const resultB = await runAudit(bundle.dir);
    const reportA = buildJsonReport(resultA);
    const reportB = buildJsonReport(resultB);

    const { runMetadata: metaA, ...restA } = reportA;
    const { runMetadata: metaB, ...restB } = reportB;
    assert.deepEqual(restA, restB);
    assert.equal(JSON.stringify(restA), JSON.stringify(restB));

    // The markdown differs only in the wall-clock start time.
    const mdA = buildMarkdownReport(resultA).replaceAll(metaA.startedAt, "STARTED_AT");
    const mdB = buildMarkdownReport(resultB).replaceAll(metaB.startedAt, "STARTED_AT");
    assert.equal(mdA, mdB);
  });

  it("markdown executive summary uses the brief's gap and divergence language", () => {
    assert.ok(markdown.includes("# BitGraph Audit Report"));
    // G2 gap language: two-position wording, honest absence claim.
    assert.ok(markdown.includes("neither commit positions nor referenced slot positions"));
    assert.ok(markdown.includes("does not, by itself, prove"));
    // Divergence: no winner is ever chosen.
    assert.ok(markdown.includes("does not choose between them"));
    // Rejected legacy input listed with its path and version string.
    assert.ok(markdown.includes(bundle.unsupportedPath));
    assert.ok(markdown.includes("occ/1"));
    // Chain intactness stated per partition.
    assert.ok(markdown.includes("Chain intact: no"));
    assert.ok(markdown.includes("Chain intact: yes"));
  });

  it("contains zero em dash characters in the markdown and the JSON", () => {
    assert.ok(!markdown.includes(EM_DASH), "markdown contains no em dashes");
    const json = JSON.stringify(report, null, 2);
    assert.ok(!json.includes(EM_DASH), "JSON report contains no em dashes");
    // The report never leaks signatures or raw proof bodies.
    assert.ok(!json.includes('"signatureB64"'));
  });
});
