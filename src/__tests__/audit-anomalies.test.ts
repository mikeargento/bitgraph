// Copyright (c) Mike Argento. All rights reserved. See LICENSE.

/**
 * Tests for @mikeargento/bitgraph-audit anomaly classification and
 * authority analysis: the G2 two-position gap logic, collisions, forks,
 * chain breaks, multiple genesis, slot ordering, epochLink anomalies,
 * divergence records (valid parties versus invalid observed context),
 * and intra-epoch authority changes.
 */

import { describe, test, after } from "node:test";
import * as assert from "node:assert/strict";
import { rm } from "node:fs/promises";
import { sha256 } from "@noble/hashes/sha256";
import {
  analyzeAuthorities,
  classifyAnomalies,
  ingestBundle,
  reconstructChains,
  verifyObservedProofs,
} from "@mikeargento/bitgraph-audit";
import type {
  AnomalyReport,
  IngestResult,
  ReconstructionResult,
  UnexplainedPositionsDetail,
} from "@mikeargento/bitgraph-audit";
import type { BitGraphProof } from "@mikeargento/bitgraph-verify";
import { computeProofHash, computeChainHash } from "@mikeargento/bitgraph-verify";
import {
  b64,
  healthyPairs,
  makeCounterChain,
  makeEpochLinkProof,
  makeKey,
  makeTempDir,
  proofJson,
  signBody,
  utf8,
  writeBundleDir,
} from "./audit-fixtures.js";

const tempDirs: string[] = [];

after(async () => {
  for (const dir of tempDirs) {
    await rm(dir, { recursive: true, force: true });
  }
});

async function auditBundle(files: Record<string, Uint8Array | string>): Promise<{
  ingest: IngestResult;
  reconstruction: ReconstructionResult;
  report: AnomalyReport;
}> {
  const dir = await makeTempDir("bitgraph-audit-anomalies-");
  tempDirs.push(dir);
  await writeBundleDir(dir, files);
  const ingest = await ingestBundle(dir);
  await verifyObservedProofs(ingest);
  const reconstruction = await reconstructChains(ingest);
  const report = await classifyAnomalies(ingest, reconstruction);
  return { ingest, reconstruction, report };
}

function codes(report: AnomalyReport): string[] {
  return report.anomalies.map((a) => a.code).sort();
}

// ---------------------------------------------------------------------------
// G2 gap logic
// ---------------------------------------------------------------------------

describe("anomalies: G2 gap logic", () => {
  test("interleaved slot allocation is healthy: no unexplained positions", async () => {
    // Concurrent slot allocation: slot 1 and slot 2 are both taken before
    // either commit lands (commits at 3 and 4). M is not N+1 here, and
    // that is still a complete record.
    const chain = await makeCounterChain({
      epochId: "epoch-interleaved",
      pairs: [
        { slot: "1", commit: "3" },
        { slot: "2", commit: "4" },
      ],
    });
    const { report } = await auditBundle({
      "p0.json": proofJson(chain.proofs[0]!.proof),
      "p1.json": proofJson(chain.proofs[1]!.proof),
    });
    assert.deepEqual(report.anomalies, []);
  });

  test("a missing middle proof yields exactly its slot and commit positions plus a chain break", async () => {
    const chain = await makeCounterChain({ epochId: "epoch-gap2", pairs: healthyPairs(3) });
    // Drop the middle proof (slot 3 / commit 4).
    const { report } = await auditBundle({
      "p0.json": proofJson(chain.proofs[0]!.proof),
      "p2.json": proofJson(chain.proofs[2]!.proof),
    });

    assert.deepEqual(codes(report), ["chain-break-missing", "unexplained-counter-positions"]);

    const gap = report.anomalies.find((a) => a.code === "unexplained-counter-positions")!;
    const detail = gap.details as unknown as UnexplainedPositionsDetail;
    assert.deepEqual(detail.positions, ["3", "4"]);
    assert.equal(detail.count, "2");
    assert.deepEqual(detail.ranges, [{ start: "3", end: "4" }]);
    assert.equal(detail.truncated, false);
    // Report language: absence from the bundle, never asserted authority failure.
    assert.match(gap.message, /absent\s+from the bundle/);
    assert.match(gap.message, /does not, by itself, establish/);
    // The message must NOT presume a proof exists: an uncommitted slot is a
    // routine, benign alternative the offline audit cannot rule out.
    assert.match(gap.message, /allocated but never committed/);
    assert.match(gap.message, /failed to create or withheld any proof/);

    const chainBreak = report.anomalies.find((a) => a.code === "chain-break-missing")!;
    assert.deepEqual(chainBreak.proofHashes, [chain.proofs[2]!.proofHash]);
    assert.equal(chainBreak.details!["prevB64"], chain.proofs[1]!.chainHash);
    assert.deepEqual(report.divergences, []);
  });

  test("a partition missing its head is an expected boundary, not an anomaly", async () => {
    const chain = await makeCounterChain({ epochId: "epoch-headless", pairs: healthyPairs(3) });
    // Only the last two proofs are in the bundle: positions 3,4,5,6.
    const { report } = await auditBundle({
      "p1.json": proofJson(chain.proofs[1]!.proof),
      "p2.json": proofJson(chain.proofs[2]!.proof),
    });
    // Positions 1 and 2 are outside the observed [min, max] range and are not
    // flagged. The earliest included proof's dangling prevB64 is the excerpt's
    // starting boundary — an expected bundle frontier, not a chain-integrity
    // anomaly — so there are no anomalies at all.
    assert.deepEqual(codes(report), []);
    assert.equal(report.boundaryEntryPoints.length, 1);
    assert.equal(report.boundaryEntryPoints[0]!.proofHash, chain.proofs[1]!.proofHash);
    assert.equal(report.boundaryEntryPoints[0]!.prevB64, chain.proofs[0]!.chainHash);
  });
});

// ---------------------------------------------------------------------------
// Collisions and divergence
// ---------------------------------------------------------------------------

describe("anomalies: collisions", () => {
  test("a commit counter collision between valid proofs produces a divergence with all parties", async () => {
    const key = await makeKey();
    const chain = await makeCounterChain({
      key,
      epochId: "epoch-collision",
      pairs: healthyPairs(2), // p0: 1/2, p1: 3/4
    });
    // A second valid proof also claiming commit counter 4, linked after p1.
    const rival = await makeCounterChain({
      key,
      epochId: "epoch-collision",
      pairs: [{ commit: "4" }],
      payloadPrefix: "rival",
    });
    const rivalProof = JSON.parse(proofJson(rival.proofs[0]!.proof)) as Record<string, unknown>;
    (rivalProof["commit"] as Record<string, unknown>)["prevB64"] = chain.proofs[1]!.chainHash;
    // Re-sign with the same key over the modified commit.
    const resigned = await signBody(
      key,
      rival.proofs[0]!.proof.artifact,
      rivalProof["commit"] as BitGraphProof["commit"],
      "test-measurement-chain"
    );

    const { report } = await auditBundle({
      "p0.json": proofJson(chain.proofs[0]!.proof),
      "p1.json": proofJson(chain.proofs[1]!.proof),
      "p2.json": proofJson(resigned),
    });

    assert.deepEqual(codes(report), ["counter-collision"]);
    assert.equal(report.divergences.length, 1);
    const divergence = report.divergences[0]!;
    assert.equal(divergence.kind, "counter-collision");
    assert.deepEqual(divergence.contested, { counter: "4" });
    assert.equal(divergence.parties.length, 2);
    assert.deepEqual(divergence.invalidContext, []);
    assert.deepEqual(
      divergence.parties.map((p) => p.proofHash).sort(),
      [chain.proofs[1]!.proofHash, computeProofHash(resigned)].sort()
    );
    // Every party keeps its verification status; no winner is selected.
    for (const party of divergence.parties) {
      assert.equal(party.verificationStatus, "artifact-unavailable");
      assert.equal(party.counter, "4");
    }
    assert.match(divergence.explanation, /does not choose/);
  });

  test("a slot counter collision between valid proofs is classified separately", async () => {
    const key = await makeKey();
    const chain = await makeCounterChain({
      key,
      epochId: "epoch-slot-collision",
      pairs: [
        { slot: "1", commit: "2" },
        { slot: "3", commit: "4" },
      ],
    });
    // A third proof consuming slot 3 again with a later commit counter.
    const rival = await makeCounterChain({
      key,
      epochId: "epoch-slot-collision",
      pairs: [{ slot: "3", commit: "5" }],
      payloadPrefix: "slot-rival",
    });
    const rivalCommit = JSON.parse(proofJson(rival.proofs[0]!.proof)) as Record<string, unknown>;
    (rivalCommit["commit"] as Record<string, unknown>)["prevB64"] = chain.proofs[1]!.chainHash;
    const resigned = await signBody(
      key,
      rival.proofs[0]!.proof.artifact,
      rivalCommit["commit"] as BitGraphProof["commit"],
      "test-measurement-chain"
    );

    const { report } = await auditBundle({
      "p0.json": proofJson(chain.proofs[0]!.proof),
      "p1.json": proofJson(chain.proofs[1]!.proof),
      "p2.json": proofJson(resigned),
    });

    assert.deepEqual(codes(report), ["slot-collision"]);
    const divergence = report.divergences[0]!;
    assert.equal(divergence.kind, "slot-collision");
    assert.deepEqual(divergence.contested, { slotCounter: "3" });
    assert.equal(divergence.parties.length, 2);
  });

  test("an invalid proof sharing a counter is observed context, never a competing branch", async () => {
    const key = await makeKey();
    const chain = await makeCounterChain({
      key,
      epochId: "epoch-invalid-context",
      pairs: healthyPairs(2), // p1 has commit 4
    });
    // A second VALID claimant of commit counter 4.
    const rivalValid = await makeCounterChain({
      key,
      epochId: "epoch-invalid-context",
      pairs: [{ commit: "4" }],
      payloadPrefix: "valid-rival",
    });
    const validCommit = JSON.parse(proofJson(rivalValid.proofs[0]!.proof)) as Record<
      string,
      unknown
    >;
    (validCommit["commit"] as Record<string, unknown>)["prevB64"] = chain.proofs[1]!.chainHash;
    const resignedValid = await signBody(
      key,
      rivalValid.proofs[0]!.proof.artifact,
      validCommit["commit"] as BitGraphProof["commit"],
      "test-measurement-chain"
    );
    // An INVALID claimant: distinct content, garbage signature.
    const rivalInvalid = await makeCounterChain({
      key,
      epochId: "epoch-invalid-context",
      pairs: [{ commit: "4" }],
      payloadPrefix: "invalid-rival",
    });
    const forged = JSON.parse(proofJson(rivalInvalid.proofs[0]!.proof)) as BitGraphProof;
    forged.signer.signatureB64 = b64(new Uint8Array(64)); // not a valid signature

    const { report } = await auditBundle({
      "p0.json": proofJson(chain.proofs[0]!.proof),
      "p1.json": proofJson(chain.proofs[1]!.proof),
      "valid-rival.json": proofJson(resignedValid),
      "forged.json": JSON.stringify(forged),
    });

    const divergence = report.divergences.find((d) => d.kind === "counter-collision")!;
    assert.equal(divergence.parties.length, 2);
    assert.equal(divergence.invalidContext.length, 1);
    assert.equal(divergence.invalidContext[0]!.proofHash, computeProofHash(forged));
    assert.equal(divergence.invalidContext[0]!.verificationStatus, "failed");
    assert.ok(
      !divergence.parties.some((p) => p.proofHash === computeProofHash(forged)),
      "the forged proof must never appear as a valid competing branch"
    );
  });
});

// ---------------------------------------------------------------------------
// Cross-kind position reuse
// ---------------------------------------------------------------------------

describe("anomalies: cross-kind position reuse", () => {
  test("one proof's commit counter equal to a different proof's slot counter is a double-allocation", async () => {
    // Same signer, epoch, and chain. p0 commits position 5; p1 reserves
    // position 5 as its slot. Positions stay contiguous (4,5,6) so no gap
    // is produced, isolating the cross-kind detection.
    const chain = await makeCounterChain({
      epochId: "epoch-cross-kind",
      pairs: [
        { slot: "4", commit: "5" },
        { slot: "5", commit: "6" },
      ],
    });
    const { report } = await auditBundle({
      "p0.json": proofJson(chain.proofs[0]!.proof),
      "p1.json": proofJson(chain.proofs[1]!.proof),
    });

    assert.deepEqual(codes(report), ["cross-kind-position-reuse"]);
    const anomaly = report.anomalies[0]!;
    assert.equal(anomaly.details!["position"], "5");

    assert.equal(report.divergences.length, 1);
    const divergence = report.divergences[0]!;
    assert.equal(divergence.kind, "cross-kind-position-reuse");
    assert.deepEqual(divergence.contested, { position: "5" });
    assert.equal(divergence.parties.length, 2);
    assert.deepEqual(
      divergence.parties.map((p) => p.proofHash).sort(),
      [chain.proofs[0]!.proofHash, chain.proofs[1]!.proofHash].sort()
    );
    assert.deepEqual(divergence.invalidContext, []);
    assert.match(divergence.explanation, /does not choose/);
  });

  test("a single proof whose own slot equals its own commit stays slot-order, never cross-kind", async () => {
    const chain = await makeCounterChain({
      epochId: "epoch-self-position",
      pairs: [{ slot: "5", commit: "5" }],
    });
    const { report } = await auditBundle({ "p.json": proofJson(chain.proofs[0]!.proof) });
    assert.deepEqual(codes(report), ["slot-order-violation"]);
  });
});

// ---------------------------------------------------------------------------
// Predecessor reuse (forks)
// ---------------------------------------------------------------------------

describe("anomalies: predecessor reuse", () => {
  test("one predecessor claimed by two valid successors is a fork with all branches preserved", async () => {
    const key = await makeKey();
    const chain = await makeCounterChain({
      key,
      epochId: "epoch-fork",
      pairs: healthyPairs(2), // p0 (1/2) <- p1 (3/4)
    });
    // A second successor of p0 at different positions (5/6).
    const branch = await makeCounterChain({
      key,
      epochId: "epoch-fork",
      pairs: [{ slot: "5", commit: "6" }],
      payloadPrefix: "branch",
    });
    const branchCommit = JSON.parse(proofJson(branch.proofs[0]!.proof)) as Record<string, unknown>;
    (branchCommit["commit"] as Record<string, unknown>)["prevB64"] = chain.proofs[0]!.chainHash;
    const resigned = await signBody(
      key,
      branch.proofs[0]!.proof.artifact,
      branchCommit["commit"] as BitGraphProof["commit"],
      "test-measurement-chain"
    );

    const { reconstruction, report } = await auditBundle({
      "p0.json": proofJson(chain.proofs[0]!.proof),
      "p1.json": proofJson(chain.proofs[1]!.proof),
      "branch.json": proofJson(resigned),
    });

    // One component: the fork is connected through the shared predecessor.
    const partition = reconstruction.partitions[0]!;
    assert.equal(partition.components.length, 1);
    const component = partition.components[0]!;
    assert.deepEqual(component.terminalProofHashes.length, 2);
    assert.deepEqual(component.genesisProofHashes, [chain.proofs[0]!.proofHash]);

    // Positions 1..6 all explained: the fork itself creates no gap.
    assert.deepEqual(codes(report), ["predecessor-reuse"]);
    const divergence = report.divergences[0]!;
    assert.equal(divergence.kind, "predecessor-reuse");
    assert.deepEqual(divergence.contested, { prevB64: chain.proofs[0]!.chainHash });
    assert.equal(divergence.parties.length, 2);
    assert.deepEqual(divergence.invalidContext, []);
    assert.match(divergence.explanation, /fork/);
  });
});

// ---------------------------------------------------------------------------
// Chain breaks
// ---------------------------------------------------------------------------

describe("anomalies: chain breaks", () => {
  test("a malformed prevB64 is distinguished from a missing predecessor", async () => {
    const key = await makeKey();
    const first = await makeCounterChain({
      key,
      epochId: "epoch-malformed",
      pairs: [{ slot: "1", commit: "2" }],
    });
    const badCommit = {
      nonceB64: b64(crypto.getRandomValues(new Uint8Array(16))),
      counter: "4",
      slotCounter: "3",
      prevB64: "!!!not-base64!!!",
      epochId: "epoch-malformed",
    } as BitGraphProof["commit"];
    const malformed = await signBody(
      key,
      { hashAlg: "sha256", digestB64: b64(sha256(utf8("malformed-prev-payload"))) },
      badCommit,
      "test-measurement-chain"
    );

    const { report } = await auditBundle({
      "p0.json": proofJson(first.proofs[0]!.proof),
      "p1.json": proofJson(malformed),
    });

    assert.deepEqual(codes(report), ["chain-break-malformed"]);
    const anomaly = report.anomalies[0]!;
    assert.deepEqual(anomaly.proofHashes, [computeProofHash(malformed)]);
    assert.equal(anomaly.details!["prevB64"], "!!!not-base64!!!");
  });

  test("prevB64 resolving into another partition is a cross-partition break, not a merge", async () => {
    const chainA = await makeCounterChain({ epochId: "epoch-cross-A", pairs: healthyPairs(1) });
    const keyB = await makeKey();
    const crossCommit = {
      nonceB64: b64(crypto.getRandomValues(new Uint8Array(16))),
      counter: "2",
      slotCounter: "1",
      prevB64: chainA.proofs[0]!.chainHash, // points into epoch A
      epochId: "epoch-cross-B",
    } as BitGraphProof["commit"];
    const crossProof = await signBody(
      keyB,
      { hashAlg: "sha256", digestB64: b64(sha256(utf8("cross-partition-payload"))) },
      crossCommit,
      "test-measurement-chain"
    );

    const { reconstruction, report } = await auditBundle({
      "a0.json": proofJson(chainA.proofs[0]!.proof),
      "b0.json": proofJson(crossProof),
    });

    // Two partitions; prevB64 never bridges them.
    assert.equal(reconstruction.partitions.length, 2);
    assert.deepEqual(codes(report), ["chain-break-cross-partition"]);
    const anomaly = report.anomalies[0]!;
    assert.equal(anomaly.details!["predecessorProofHash"], chainA.proofs[0]!.proofHash);
    const predecessorPartition = anomaly.details!["predecessorPartition"] as Record<string, string>;
    assert.equal(predecessorPartition["epochId"], "epoch-cross-A");
  });
});

// ---------------------------------------------------------------------------
// Multiple genesis and slot ordering
// ---------------------------------------------------------------------------

describe("anomalies: multiple genesis", () => {
  test("two valid no-prevB64 proofs in one partition are an anomaly and a divergence", async () => {
    const key = await makeKey();
    const first = await makeCounterChain({
      key,
      epochId: "epoch-two-genesis",
      pairs: [{ slot: "1", commit: "2" }],
      payloadPrefix: "genesis-one",
    });
    const second = await makeCounterChain({
      key,
      epochId: "epoch-two-genesis",
      pairs: [{ slot: "3", commit: "4" }],
      payloadPrefix: "genesis-two",
    });

    const { reconstruction, report } = await auditBundle({
      "g1.json": proofJson(first.proofs[0]!.proof),
      "g2.json": proofJson(second.proofs[0]!.proof),
    });

    assert.equal(reconstruction.partitions[0]!.components.length, 2);
    assert.deepEqual(codes(report), ["multiple-genesis"]);
    const divergence = report.divergences[0]!;
    assert.equal(divergence.kind, "multiple-genesis");
    assert.equal(divergence.parties.length, 2);
  });

  test("a single genesis without prevB64 is normal and never an anomaly (G1)", async () => {
    const chain = await makeCounterChain({ epochId: "epoch-one-genesis", pairs: healthyPairs(1) });
    const { report } = await auditBundle({ "g.json": proofJson(chain.proofs[0]!.proof) });
    assert.deepEqual(report.anomalies, []);
  });
});

describe("anomalies: slot ordering", () => {
  test("slotCounter >= counter is classified even on an otherwise valid proof", async () => {
    const chain = await makeCounterChain({
      epochId: "epoch-slot-order",
      pairs: [{ slot: "2", commit: "2" }],
    });
    const { report } = await auditBundle({ "p.json": proofJson(chain.proofs[0]!.proof) });
    assert.deepEqual(codes(report), ["slot-order-violation"]);
    assert.deepEqual(report.anomalies[0]!.details, { slotCounter: "2", counter: "2" });
  });
});

// ---------------------------------------------------------------------------
// Epoch link anomalies
// ---------------------------------------------------------------------------

describe("anomalies: epoch links", () => {
  test("terminal-missing when the prior epoch is observed but its terminal is not", async () => {
    const chainA = await makeCounterChain({ epochId: "epoch-tm-A", pairs: healthyPairs(1) });
    const genesis = await makeEpochLinkProof({
      prevEpochId: "epoch-tm-A",
      prevCounter: "4",
      prevProofHashB64: b64(sha256(utf8("an-unobserved-terminal"))),
      prevPublicKeyB64: chainA.key.publicKeyB64,
      toEpochId: "epoch-tm-B",
      counter: "2",
      slotCounter: "1",
    });
    const { report } = await auditBundle({
      "a0.json": proofJson(chainA.proofs[0]!.proof),
      "b-genesis.json": proofJson(genesis.proof),
    });
    assert.deepEqual(codes(report), ["epochlink-terminal-missing"]);
  });

  test("dangling when neither the epoch nor the terminal is observed", async () => {
    const genesis = await makeEpochLinkProof({
      prevEpochId: "epoch-nowhere",
      prevCounter: "8",
      prevProofHashB64: b64(sha256(utf8("nowhere-terminal"))),
      toEpochId: "epoch-dl-B",
      counter: "2",
      slotCounter: "1",
    });
    const { report } = await auditBundle({ "b.json": proofJson(genesis.proof) });
    assert.deepEqual(codes(report), ["epochlink-dangling"]);
  });

  test("mismatch when the hash matches but the declared metadata disagrees", async () => {
    const chainA = await makeCounterChain({ epochId: "epoch-mm-A", pairs: healthyPairs(1) });
    const genesis = await makeEpochLinkProof({
      prevEpochId: "epoch-mm-A",
      prevCounter: "999", // the observed terminal's counter is 2
      prevProofHashB64: chainA.proofs[0]!.chainHash,
      prevPublicKeyB64: chainA.key.publicKeyB64,
      toEpochId: "epoch-mm-B",
      counter: "2",
      slotCounter: "1",
    });
    const { reconstruction, report } = await auditBundle({
      "a0.json": proofJson(chainA.proofs[0]!.proof),
      "b-genesis.json": proofJson(genesis.proof),
    });
    assert.deepEqual(codes(report), ["epochlink-mismatch"]);
    const edge = reconstruction.epochRelationships.edges[0]!;
    assert.equal(edge.metadataConsistent, false);
    assert.equal(edge.hardEdge, false);
    assert.deepEqual(reconstruction.epochRelationships.orderedPairs, []);
  });

  test("two successor epochs consuming one terminal is a fork; both branches stay valid parties", async () => {
    const chainA = await makeCounterChain({ epochId: "epoch-ef-A", pairs: healthyPairs(2) });
    const terminal = chainA.proofs[1]!;
    const linkFields = {
      prevEpochId: "epoch-ef-A",
      prevCounter: terminal.proof.commit.counter as string,
      prevProofHashB64: terminal.chainHash,
      prevPublicKeyB64: chainA.key.publicKeyB64,
    };
    const genesisB = await makeEpochLinkProof({
      ...linkFields,
      toEpochId: "epoch-ef-B",
      counter: "2",
      slotCounter: "1",
    });
    const genesisC = await makeEpochLinkProof({
      ...linkFields,
      toEpochId: "epoch-ef-C",
      counter: "2",
      slotCounter: "1",
    });

    const { ingest, reconstruction, report } = await auditBundle({
      "a0.json": proofJson(chainA.proofs[0]!.proof),
      "a1.json": proofJson(terminal.proof),
      "b-genesis.json": proofJson(genesisB.proof),
      "c-genesis.json": proofJson(genesisC.proof),
    });

    // Whichever genesis verified second failed the run with the canonical
    // verifier's fork detection; that run status is preserved.
    const failed = ingest.proofs.filter((p) => p.verification!.status === "failed");
    assert.equal(failed.length, 1);
    assert.match(failed[0]!.verification!.reason ?? "", /FORK DETECTED/);

    assert.deepEqual(codes(report), ["epochlink-fork"]);
    const divergence = report.divergences[0]!;
    assert.equal(divergence.kind, "epochlink-fork");
    // Both branches are intrinsically valid competing parties: the run
    // failure was an artifact of verification order, and the audit never
    // selects a winner by that order.
    assert.equal(divergence.parties.length, 2);
    assert.deepEqual(divergence.invalidContext, []);
    assert.match(divergence.explanation, /verification order/);

    // Both lineage edges are hard ordering evidence: the terminal existed
    // before each successor genesis regardless of which branch wins.
    const hardEdges = reconstruction.epochRelationships.edges.filter((e) => e.hardEdge);
    assert.equal(hardEdges.length, 2);
    assert.deepEqual(reconstruction.epochRelationships.orderedPairs, [
      { beforeEpochId: "epoch-ef-A", afterEpochId: "epoch-ef-B" },
      { beforeEpochId: "epoch-ef-A", afterEpochId: "epoch-ef-C" },
    ]);
  });

  test("a lineage cycle is classified and contradictory ordering is asserted in neither direction", async () => {
    const keyA = await makeKey();
    const keyB = await makeKey();
    // Epoch A terminal.
    const chainA = await makeCounterChain({
      key: keyA,
      epochId: "epoch-cy-A",
      pairs: healthyPairs(1),
      payloadPrefix: "cycle-a",
    });
    const terminalA = chainA.proofs[0]!;
    // Epoch B genesis consumes A's terminal.
    const genesisB = await makeEpochLinkProof({
      prevEpochId: "epoch-cy-A",
      prevCounter: "2",
      prevProofHashB64: terminalA.chainHash,
      prevPublicKeyB64: keyA.publicKeyB64,
      key: keyB,
      toEpochId: "epoch-cy-B",
      counter: "2",
      slotCounter: "1",
    });
    // Epoch B continues to a terminal.
    const terminalB = await signBody(
      keyB,
      { hashAlg: "sha256", digestB64: b64(sha256(utf8("cycle-b-terminal"))) },
      {
        nonceB64: b64(crypto.getRandomValues(new Uint8Array(16))),
        counter: "4",
        slotCounter: "3",
        prevB64: computeChainHash(genesisB.proof),
        epochId: "epoch-cy-B",
      },
      "test-measurement-epochlink"
    );
    // A later epoch A proof claims lineage FROM epoch B: the cycle.
    const cycleCloser = await makeEpochLinkProof({
      prevEpochId: "epoch-cy-B",
      prevCounter: "4",
      prevProofHashB64: computeChainHash(terminalB),
      prevPublicKeyB64: keyB.publicKeyB64,
      key: keyA,
      toEpochId: "epoch-cy-A",
      counter: "4",
      slotCounter: "3",
      prevB64: terminalA.chainHash,
    });

    const { reconstruction, report } = await auditBundle({
      "a-terminal.json": proofJson(terminalA.proof),
      "b-genesis.json": proofJson(genesisB.proof),
      "b-terminal.json": proofJson(terminalB),
      "a-closer.json": proofJson(cycleCloser.proof),
    });

    const cycleAnomalies = report.anomalies.filter((a) => a.code === "epochlink-cycle");
    assert.equal(cycleAnomalies.length, 1);
    assert.deepEqual(
      (cycleAnomalies[0]!.details!["epochIds"] as string[]).slice().sort(),
      ["epoch-cy-A", "epoch-cy-B"]
    );
    // Contradictory ordering evidence: assert neither direction.
    assert.deepEqual(reconstruction.epochRelationships.orderedPairs, []);
  });
});

// ---------------------------------------------------------------------------
// Authority analysis
// ---------------------------------------------------------------------------

describe("authority: intra-epoch changes", () => {
  test("two signer keys within one epochId is flagged", async () => {
    const chainOne = await makeCounterChain({
      epochId: "epoch-shared",
      pairs: healthyPairs(1),
      payloadPrefix: "signer-one",
    });
    const chainTwo = await makeCounterChain({
      epochId: "epoch-shared",
      pairs: [{ slot: "3", commit: "4" }],
      payloadPrefix: "signer-two",
    });
    const dir = await makeTempDir("bitgraph-audit-authority-");
    tempDirs.push(dir);
    await writeBundleDir(dir, {
      "one.json": proofJson(chainOne.proofs[0]!.proof),
      "two.json": proofJson(chainTwo.proofs[0]!.proof),
    });
    const ingest = await ingestBundle(dir);
    await verifyObservedProofs(ingest);
    const authority = analyzeAuthorities(ingest);

    assert.equal(authority.anomalies.length, 1);
    const anomaly = authority.anomalies[0]!;
    assert.equal(anomaly.code, "mid-epoch-signer-change");
    assert.deepEqual(
      anomaly.details!["publicKeysB64"],
      [chainOne.key.publicKeyB64, chainTwo.key.publicKeyB64].sort()
    );
    assert.deepEqual(authority.sharedSignersAcrossEpochs, []);
  });

  test("two declared measurements within one epochId is flagged; declared is never attested", async () => {
    const key = await makeKey();
    const first = await makeCounterChain({
      key,
      epochId: "epoch-measure",
      pairs: healthyPairs(1),
      measurement: "measurement-one",
      payloadPrefix: "m-one",
    });
    const secondCommit = {
      nonceB64: b64(crypto.getRandomValues(new Uint8Array(16))),
      counter: "4",
      slotCounter: "3",
      prevB64: first.proofs[0]!.chainHash,
      epochId: "epoch-measure",
    } as BitGraphProof["commit"];
    const second = await signBody(
      key,
      { hashAlg: "sha256", digestB64: b64(sha256(utf8("m-two-payload"))) },
      secondCommit,
      "measurement-two"
    );

    const dir = await makeTempDir("bitgraph-audit-authority-");
    tempDirs.push(dir);
    await writeBundleDir(dir, {
      "one.json": proofJson(first.proofs[0]!.proof),
      "two.json": proofJson(second),
    });
    const ingest = await ingestBundle(dir);
    await verifyObservedProofs(ingest);
    const authority = analyzeAuthorities(ingest);

    assert.equal(authority.anomalies.length, 1);
    assert.equal(authority.anomalies[0]!.code, "mid-epoch-measurement-change");
    assert.deepEqual(authority.anomalies[0]!.details!["measurements"], [
      "measurement-one",
      "measurement-two",
    ]);
    // The attested extension point is never populated by authority analysis.
    for (const group of authority.groups) {
      assert.equal(group.attested, undefined);
      assert.equal(group.attestationPresent, false);
    }
  });

  test("the same signer across different epochs is normal transition evidence, not an anomaly", async () => {
    const key = await makeKey();
    const epochOne = await makeCounterChain({
      key,
      epochId: "epoch-span-1",
      pairs: healthyPairs(1),
      payloadPrefix: "span-one",
    });
    const epochTwo = await makeCounterChain({
      key,
      epochId: "epoch-span-2",
      pairs: healthyPairs(1),
      payloadPrefix: "span-two",
    });
    const dir = await makeTempDir("bitgraph-audit-authority-");
    tempDirs.push(dir);
    await writeBundleDir(dir, {
      "one.json": proofJson(epochOne.proofs[0]!.proof),
      "two.json": proofJson(epochTwo.proofs[0]!.proof),
    });
    const ingest = await ingestBundle(dir);
    await verifyObservedProofs(ingest);
    const authority = analyzeAuthorities(ingest);

    assert.deepEqual(authority.anomalies, []);
    assert.deepEqual(authority.sharedSignersAcrossEpochs, [
      { publicKeyB64: key.publicKeyB64, epochIds: ["epoch-span-1", "epoch-span-2"] },
    ]);
  });

  test("a healthy single-authority chain has no authority anomalies", async () => {
    const chain = await makeCounterChain({ epochId: "epoch-clean", pairs: healthyPairs(3) });
    const dir = await makeTempDir("bitgraph-audit-authority-");
    tempDirs.push(dir);
    await writeBundleDir(dir, {
      "p0.json": proofJson(chain.proofs[0]!.proof),
      "p1.json": proofJson(chain.proofs[1]!.proof),
      "p2.json": proofJson(chain.proofs[2]!.proof),
    });
    const ingest = await ingestBundle(dir);
    await verifyObservedProofs(ingest);
    const authority = analyzeAuthorities(ingest);
    assert.deepEqual(authority.anomalies, []);
    assert.equal(authority.groups.length, 1);
    assert.equal(authority.groups[0]!.proofHashes.length, 3);
  });
});
