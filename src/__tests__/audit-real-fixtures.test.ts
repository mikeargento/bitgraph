// Copyright (c) Mike Argento. All rights reserved. See LICENSE.

/**
 * Real-fixture audit test (Phase 4e, G8 honesty).
 *
 * Builds a bundle from the repo's real embedded fixtures and asserts the
 * audit reports them honestly:
 *
 *   - REALISTIC_PROOF mirrors what the TEE actually produces: a
 *     real-shaped Ethereum anchor proof with a TRUNCATED attestation blob
 *     and a placeholder signature. It must be observed, identified as an
 *     Ethereum anchor by its SIGNED attribution, fail verification with
 *     the verifier's precise NON-version reason (the placeholder
 *     signature), and its attestation must report document-present-but-
 *     invalid (the truncated blob), never a pass and never a version
 *     failure.
 *
 *   - MOCK_PROOF is placeholder values throughout; it fails on the first
 *     canonical check its placeholders trip (the non-base64 digest), also
 *     a non-version reason.
 *
 * The fixtures are used verbatim from their shared modules and are never
 * edited.
 */

import { describe, it, before, after } from "node:test";
import * as assert from "node:assert/strict";
import { rm } from "node:fs/promises";
import { computeProofHash } from "@mikeargento/bitgraph-verify";
import { buildJsonReport, runAudit } from "@mikeargento/bitgraph-audit";
import type { AuditResult } from "@mikeargento/bitgraph-audit";
import { makeTempDir, writeBundleDir } from "./audit-fixtures.js";
import { REALISTIC_PROOF } from "./realistic-proof-fixture.js";
import { MOCK_PROOF } from "./mock-proof-fixture.js";

describe("audit over the repo's real embedded fixtures", () => {
  let dir: string;
  let result: AuditResult;
  const realisticHash = computeProofHash(REALISTIC_PROOF as unknown as Record<string, unknown>);
  const mockHash = computeProofHash(MOCK_PROOF as unknown as Record<string, unknown>);

  before(async () => {
    dir = await makeTempDir("bitgraph-audit-real-fixtures-");
    await writeBundleDir(dir, {
      "proofs/realistic.json": JSON.stringify(REALISTIC_PROOF),
      "proofs/mock.json": JSON.stringify(MOCK_PROOF),
    });
    result = await runAudit(dir);
  });

  after(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it("observes both fixtures; neither is a version reject", () => {
    assert.equal(result.ingest.counts.observed, 2);
    assert.equal(result.ingest.counts.unsupportedVersion, 0);
    const hashes = result.ingest.proofs.map((p) => p.proofHash).sort();
    assert.deepEqual(hashes, [realisticHash, mockHash].sort());
  });

  it("REALISTIC_PROOF fails verification with the precise non-version signature reason", () => {
    const proof = result.ingest.proofs.find((p) => p.proofHash === realisticHash);
    assert.equal(proof?.verification?.tier, "integrity");
    assert.equal(proof?.verification?.status, "failed");
    assert.equal(
      proof?.verification?.reason,
      "signature verification failed: signature does not match"
    );
    assert.ok(!(proof?.verification?.reason as string).includes("version"));
  });

  it("MOCK_PROOF fails verification with a precise non-version placeholder reason", () => {
    const proof = result.ingest.proofs.find((p) => p.proofHash === mockHash);
    assert.equal(proof?.verification?.status, "failed");
    assert.equal(proof?.verification?.reason, "artifact.digestB64 is not valid base64");
    assert.ok(!(proof?.verification?.reason as string).includes("version"));
  });

  it("nothing passes: no proof is ever reported verified or artifact-unavailable", () => {
    assert.equal(result.verification.verified, 0);
    assert.equal(result.verification.artifactUnavailable, 0);
    assert.equal(result.verification.failed, 2);
  });

  it("REALISTIC_PROOF is identified as an Ethereum anchor by its signed attribution", () => {
    assert.equal(result.anchors.anchors.length, 1);
    const anchor = result.anchors.anchors[0]!;
    assert.equal(anchor.proofHash, realisticHash);
    assert.equal(anchor.blockNumber, "24800448");
    assert.equal(
      anchor.blockHash,
      "0x28ed3639cd705fb8cb2b915c1991e9f808b40e775bc8eb540702942729fec2c0"
    );
    // No unsigned metadata on the fixture: absent corroboration, not disagreement.
    assert.equal(anchor.metadataCorroboration, "absent");
    // The verification failure rides along unmodified.
    assert.equal(anchor.verificationStatus, "failed");
    // MOCK_PROOF's attribution ("test") never identifies an anchor.
    assert.ok(!result.anchors.anchors.some((a) => a.proofHash === mockHash));
    // No witness in the bundle: causal identification only, no wall-clock evidence.
    assert.deepEqual(result.temporal.verifiedAnchorProofHashes, []);
    assert.deepEqual(result.temporal.unverifiedAnchorProofHashes, [realisticHash]);
  });

  it("REALISTIC_PROOF attestation reports document-present-but-invalid, never a pass", () => {
    const record = result.attestations.records.find((r) => r.proofHash === realisticHash);
    assert.ok(record !== undefined);
    assert.equal(record.declaredMeasurementPresent, true);
    assert.equal(
      record.declaredMeasurement,
      "638d655ad6091bed5c358628b7780de0cdbe138a37fe09d52bf8021a720680a2b3c730fee9f6bef79c1dbe68ef3cdd94"
    );
    assert.equal(record.attestationFormat, "aws-nitro");
    assert.equal(record.documentPresent, true);
    assert.equal(record.documentValidated, false);
    // The truncated blob fails with a precise reason, never silently.
    assert.equal(typeof record.validationFailure, "string");
    assert.ok((record.validationFailure as string).length > 0);
    // Facts derived from an unvalidated document are never asserted.
    assert.equal(record.pcr0MatchesDeclared, undefined);
    assert.equal(record.userDataBoundToProof, undefined);
    // Aggregates: documents present on both fixtures, zero validated.
    assert.equal(result.attestations.counts.proofsWithDocument, 2);
    assert.equal(result.attestations.counts.documentsValidated, 0);
    assert.equal(result.attestations.counts.documentsFailed, 2);
    assert.equal(result.attestations.counts.pcr0Matches, 0);
    assert.equal(result.attestations.counts.userDataBound, 0);
  });

  it("the exact anomaly code multiset is honest: crypto and topology findings, no version failure", () => {
    const report = buildJsonReport(result);
    const codes = report.anomalies.map((a) => a.code).sort();
    assert.deepEqual(codes, [
      "attestation-invalid", // MOCK_PROOF's placeholder attestation blob
      "attestation-invalid", // REALISTIC_PROOF's truncated attestation blob
      "chain-break-malformed", // MOCK_PROOF's placeholder prevB64 ("prev==")
      "chain-break-missing", // REALISTIC_PROOF's real-shaped prevB64 into unobserved history
    ]);
    assert.ok(!codes.includes("unsupported-version"));
    assert.equal(report.summary.fullyVerified, 0);
    assert.deepEqual(report.summary.exit, {
      verificationFailures: true,
      chainAnomaliesOrDivergences: true,
      code: 3,
    });
  });
});
