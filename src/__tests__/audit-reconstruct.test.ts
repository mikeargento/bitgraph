// Copyright (c) Mike Argento. All rights reserved. See LICENSE.

/**
 * Tests for @mikeargento/bitgraph-audit causal reconstruction:
 * partitioning per (signer key, epochId, chainId), chain components from
 * prevB64 hash links, genesis and terminal identification, counter
 * evidence, and epoch relationships (epochLink lineage edges, hard-edge
 * ordering, observed-but-unordered epochs).
 */

import { describe, test, after } from "node:test";
import * as assert from "node:assert/strict";
import { rm } from "node:fs/promises";
import {
  classifyAnomalies,
  ingestBundle,
  reconstructChains,
  verifyObservedProofs,
} from "@mikeargento/bitgraph-audit";
import type { IngestResult, ReconstructionResult, AnomalyReport } from "@mikeargento/bitgraph-audit";
import { sha256 } from "@noble/hashes/sha256";
import {
  b64,
  healthyPairs,
  makeConstructorProof,
  makeCounterChain,
  makeEpochLinkProof,
  makeKey,
  makeTempDir,
  proofJson,
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
  const dir = await makeTempDir("bitgraph-audit-reconstruct-");
  tempDirs.push(dir);
  await writeBundleDir(dir, files);
  const ingest = await ingestBundle(dir);
  await verifyObservedProofs(ingest);
  const reconstruction = await reconstructChains(ingest);
  const report = await classifyAnomalies(ingest, reconstruction);
  return { ingest, reconstruction, report };
}

// ---------------------------------------------------------------------------
// The critical regression: a healthy chain is clean
// ---------------------------------------------------------------------------

describe("reconstruct: healthy slot/commit chain", () => {
  test("one partition, one component, zero anomalies, zero unexplained positions", async () => {
    const chain = await makeCounterChain({
      epochId: "epoch-healthy",
      chainId: "bitgraph:main",
      pairs: healthyPairs(4), // slot 1/commit 2 ... slot 7/commit 8
    });
    const { ingest, reconstruction, report } = await auditBundle({
      "proofs/p0.json": proofJson(chain.proofs[0]!.proof),
      "proofs/p1.json": proofJson(chain.proofs[1]!.proof),
      "proofs/p2.json": proofJson(chain.proofs[2]!.proof),
      "proofs/p3.json": proofJson(chain.proofs[3]!.proof),
    });

    assert.equal(ingest.proofs.length, 4);
    assert.equal(reconstruction.partitions.length, 1);
    const partition = reconstruction.partitions[0]!;
    assert.deepEqual(partition.key, {
      publicKeyB64: chain.key.publicKeyB64,
      epochId: "epoch-healthy",
      chainId: "bitgraph:main",
    });

    assert.equal(partition.components.length, 1);
    const component = partition.components[0]!;
    assert.deepEqual(
      component.memberProofHashes,
      chain.proofs.map((p) => p.proofHash),
      "link order must follow the hash chain from genesis to terminal"
    );
    assert.deepEqual(component.genesisProofHashes, [chain.proofs[0]!.proofHash]);
    assert.deepEqual(component.terminalProofHashes, [chain.proofs[3]!.proofHash]);
    assert.deepEqual(component.brokenLinkProofHashes, []);
    assert.equal(component.hasCounterEvidence, true);
    assert.deepEqual(component.positionRange, { min: "1", max: "8" });

    // THE critical regression: a healthy slot/commit chain produces NO
    // unexplained positions and no anomalies of any kind.
    assert.deepEqual(report.anomalies, []);
    assert.deepEqual(report.divergences, []);
  });

  test("reconstruction is link-driven: file order and counters are not the mechanism", async () => {
    const chain = await makeCounterChain({
      epochId: "epoch-shuffled",
      pairs: healthyPairs(3),
    });
    // Write files in an order that reverses the causal order.
    const { reconstruction } = await auditBundle({
      "a-last.json": proofJson(chain.proofs[2]!.proof),
      "b-middle.json": proofJson(chain.proofs[1]!.proof),
      "c-first.json": proofJson(chain.proofs[0]!.proof),
    });
    const component = reconstruction.partitions[0]!.components[0]!;
    assert.deepEqual(
      component.memberProofHashes,
      chain.proofs.map((p) => p.proofHash)
    );
  });

  test("a counterless link chain still reconstructs as one component", async () => {
    const chain = await makeCounterChain({
      epochId: "epoch-no-counters",
      pairs: [{}, {}, {}], // epochId only: hash links are the only evidence
    });
    const { reconstruction, report } = await auditBundle({
      "p0.json": proofJson(chain.proofs[0]!.proof),
      "p1.json": proofJson(chain.proofs[1]!.proof),
      "p2.json": proofJson(chain.proofs[2]!.proof),
    });
    const partition = reconstruction.partitions[0]!;
    assert.equal(partition.components.length, 1);
    const component = partition.components[0]!;
    assert.deepEqual(
      component.memberProofHashes,
      chain.proofs.map((p) => p.proofHash)
    );
    assert.equal(component.hasCounterEvidence, false);
    assert.equal(component.positionRange, undefined);
    assert.deepEqual(report.anomalies, []);
  });
});

// ---------------------------------------------------------------------------
// Partitioning
// ---------------------------------------------------------------------------

describe("reconstruct: partitioning", () => {
  test("two independent lineages are never merged", async () => {
    const chainA = await makeCounterChain({ epochId: "epoch-A", pairs: healthyPairs(2) });
    const chainB = await makeCounterChain({ epochId: "epoch-B", pairs: healthyPairs(2) });
    const { reconstruction, report } = await auditBundle({
      "a0.json": proofJson(chainA.proofs[0]!.proof),
      "a1.json": proofJson(chainA.proofs[1]!.proof),
      "b0.json": proofJson(chainB.proofs[0]!.proof),
      "b1.json": proofJson(chainB.proofs[1]!.proof),
    });

    assert.equal(reconstruction.partitions.length, 2);
    const keys = reconstruction.partitions.map((p) => p.key.publicKeyB64).sort();
    assert.deepEqual(keys, [chainA.key.publicKeyB64, chainB.key.publicKeyB64].sort());
    // Same counters on both chains, yet no collisions: counters are
    // partition-local.
    assert.deepEqual(report.anomalies, []);
    assert.deepEqual(report.divergences, []);
  });

  test("same signer and epoch on different chainIds are separate partitions (G6)", async () => {
    const key = await makeKey();
    const main = await makeCounterChain({
      key,
      epochId: "epoch-multichain",
      chainId: "bitgraph:main",
      pairs: healthyPairs(2),
      payloadPrefix: "main",
    });
    const globalChain = await makeCounterChain({
      key,
      epochId: "epoch-multichain",
      pairs: healthyPairs(2), // no chainId: normalized "global"
      payloadPrefix: "global",
    });
    const { reconstruction, report } = await auditBundle({
      "m0.json": proofJson(main.proofs[0]!.proof),
      "m1.json": proofJson(main.proofs[1]!.proof),
      "g0.json": proofJson(globalChain.proofs[0]!.proof),
      "g1.json": proofJson(globalChain.proofs[1]!.proof),
    });

    assert.equal(reconstruction.partitions.length, 2);
    assert.deepEqual(
      reconstruction.partitions.map((p) => p.key.chainId).sort(),
      ["bitgraph:main", "global"]
    );
    assert.deepEqual(report.anomalies, []);
  });

  test("chainless proofs stay outside partitions as observed-but-unchained", async () => {
    const chain = await makeCounterChain({ epochId: "epoch-with-stray", pairs: healthyPairs(2) });
    const chainless = await makeConstructorProof(); // no counter, no epochId
    const { ingest, reconstruction, report } = await auditBundle({
      "p0.json": proofJson(chain.proofs[0]!.proof),
      "p1.json": proofJson(chain.proofs[1]!.proof),
      "stray.json": proofJson(chainless.proof),
    });

    assert.equal(ingest.proofs.length, 3);
    assert.equal(reconstruction.partitions.length, 1);
    assert.equal(reconstruction.partitions[0]!.memberProofHashes.length, 2);
    const strayHash = ingest.proofs.find((p) => p.chainless)!.proofHash;
    assert.deepEqual(reconstruction.unchainedProofHashes, [strayHash]);
    // Observed-but-unchained is not an anomaly.
    assert.deepEqual(report.anomalies, []);
  });

  test("a proof with chain fields but no signer key is unpartitioned", async () => {
    const broken = JSON.stringify({
      version: "bitgraph/1",
      artifact: { hashAlg: "sha256", digestB64: b64(sha256(utf8("broken-payload"))) },
      commit: { nonceB64: "AAAA", counter: "2", epochId: "epoch-broken" },
      signer: { publicKeyB64: 42, signatureB64: "AAAA" },
    });
    const { ingest, reconstruction } = await auditBundle({ "broken.json": broken });
    assert.equal(ingest.proofs.length, 1);
    assert.equal(reconstruction.partitions.length, 0);
    assert.deepEqual(reconstruction.unpartitionedProofHashes, [ingest.proofs[0]!.proofHash]);
    // The verification dimension reports the structural failure.
    assert.equal(ingest.proofs[0]!.verification!.status, "failed");
  });
});

// ---------------------------------------------------------------------------
// Missing proofs split components
// ---------------------------------------------------------------------------

describe("reconstruct: missing middle proof", () => {
  test("splits the partition into two components with the break identified", async () => {
    const chain = await makeCounterChain({ epochId: "epoch-gap", pairs: healthyPairs(3) });
    // Omit the middle proof (slot 3 / commit 4).
    const { reconstruction } = await auditBundle({
      "p0.json": proofJson(chain.proofs[0]!.proof),
      "p2.json": proofJson(chain.proofs[2]!.proof),
    });

    const partition = reconstruction.partitions[0]!;
    assert.equal(partition.components.length, 2);
    const [first, second] = partition.components;
    assert.deepEqual(first!.memberProofHashes, [chain.proofs[0]!.proofHash]);
    assert.deepEqual(first!.genesisProofHashes, [chain.proofs[0]!.proofHash]);
    assert.deepEqual(first!.terminalProofHashes, [chain.proofs[0]!.proofHash]);
    assert.deepEqual(second!.memberProofHashes, [chain.proofs[2]!.proofHash]);
    assert.deepEqual(second!.genesisProofHashes, []);
    assert.deepEqual(second!.brokenLinkProofHashes, [chain.proofs[2]!.proofHash]);
  });
});

// ---------------------------------------------------------------------------
// Epoch relationships
// ---------------------------------------------------------------------------

describe("reconstruct: epoch relationships", () => {
  test("a valid epochLink produces a hard lineage edge and linked ordering", async () => {
    const chainA = await makeCounterChain({ epochId: "epoch-lineage-A", pairs: healthyPairs(2) });
    const terminalA = chainA.proofs[1]!;
    const genesisB = await makeEpochLinkProof({
      prevEpochId: "epoch-lineage-A",
      prevCounter: terminalA.proof.commit.counter as string,
      prevProofHashB64: terminalA.chainHash,
      prevPublicKeyB64: chainA.key.publicKeyB64,
      toEpochId: "epoch-lineage-B",
      counter: "2",
      slotCounter: "1",
    });

    const { reconstruction, report } = await auditBundle({
      "a0.json": proofJson(chainA.proofs[0]!.proof),
      "a1.json": proofJson(terminalA.proof),
      "b-genesis.json": proofJson(genesisB.proof),
    });

    const { edges, epochs, orderedPairs } = reconstruction.epochRelationships;
    assert.equal(edges.length, 1);
    const edge = edges[0]!;
    assert.equal(edge.resolution, "matched");
    assert.equal(edge.fromEpochId, "epoch-lineage-A");
    assert.equal(edge.toEpochId, "epoch-lineage-B");
    assert.equal(edge.predecessorProofHash, terminalA.proofHash);
    assert.equal(edge.metadataConsistent, true);
    assert.equal(edge.referencedProofIsTerminal, true);
    assert.equal(edge.viaProofValid, true);
    assert.equal(edge.predecessorValid, true);
    assert.equal(edge.hardEdge, true);

    assert.deepEqual(orderedPairs, [
      { beforeEpochId: "epoch-lineage-A", afterEpochId: "epoch-lineage-B" },
    ]);
    const epochA = epochs.find((e) => e.epochId === "epoch-lineage-A")!;
    const epochB = epochs.find((e) => e.epochId === "epoch-lineage-B")!;
    assert.equal(epochA.ordering, "linked");
    assert.equal(epochB.ordering, "linked");
    assert.deepEqual(epochA.linkedSuccessorEpochIds, ["epoch-lineage-B"]);
    assert.deepEqual(epochB.linkedPredecessorEpochIds, ["epoch-lineage-A"]);
    // The extension point stays untouched by reconstruction.
    assert.equal(epochA.anchorBounds, undefined);

    // Valid lineage is not an anomaly.
    assert.deepEqual(report.anomalies, []);
    assert.deepEqual(report.divergences, []);
  });

  test("a dangling epochLink yields no hard edge and no ordering", async () => {
    const genesis = await makeEpochLinkProof({
      prevEpochId: "epoch-never-observed",
      prevCounter: "10",
      prevProofHashB64: b64(sha256(utf8("terminal-never-observed"))),
      toEpochId: "epoch-dangling-B",
      counter: "2",
      slotCounter: "1",
    });
    const { reconstruction } = await auditBundle({
      "b-genesis.json": proofJson(genesis.proof),
    });

    const { edges, epochs, orderedPairs } = reconstruction.epochRelationships;
    assert.equal(edges.length, 1);
    assert.equal(edges[0]!.resolution, "dangling");
    assert.equal(edges[0]!.hardEdge, false);
    assert.deepEqual(orderedPairs, []);
    assert.equal(epochs.find((e) => e.epochId === "epoch-dangling-B")!.ordering, "observed-but-unordered");
  });

  test("epochs with no lineage evidence are observed-but-unordered, never divergence", async () => {
    const chainA = await makeCounterChain({ epochId: "epoch-solo-A", pairs: healthyPairs(2) });
    const chainB = await makeCounterChain({ epochId: "epoch-solo-B", pairs: healthyPairs(2) });
    const { reconstruction, report } = await auditBundle({
      "a0.json": proofJson(chainA.proofs[0]!.proof),
      "a1.json": proofJson(chainA.proofs[1]!.proof),
      "b0.json": proofJson(chainB.proofs[0]!.proof),
      "b1.json": proofJson(chainB.proofs[1]!.proof),
    });

    const { epochs, edges, orderedPairs } = reconstruction.epochRelationships;
    assert.equal(edges.length, 0);
    assert.deepEqual(orderedPairs, []);
    for (const epoch of epochs) {
      assert.equal(epoch.ordering, "observed-but-unordered");
    }
    // Concurrent-or-unordered is never divergence.
    assert.deepEqual(report.divergences, []);
    assert.deepEqual(report.anomalies, []);
  });
});
