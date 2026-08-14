// Copyright (c) 2024-2026 Mike Argento. Licensed under the MIT License. See LICENSE.

/**
 * Minimal synthetic AuditResult for end-to-end tests: one partition,
 * counter-ordered proofs. Deliberately NOT real proofs; no test ever
 * writes to the ledger — the ledger is compliance-locked and recordings
 * are permanent.
 */

import type { AuditResult, ObservedProof } from "@mikeargento/bitgraph-audit";

export interface FixtureProofSpec {
  name: string;
  digestB64: string;
  counter: string;
}

export function makeProof(spec: FixtureProofSpec): ObservedProof {
  return {
    proofHash: `proofhash-${spec.name}`,
    chainHash: `chainhash-${spec.name}`,
    proof: {
      version: "bitgraph/1",
      artifact: { hashAlg: "sha256", digestB64: spec.digestB64 },
    },
    sources: [],
    version: "bitgraph/1",
    chainId: "bitgraph:main",
    publicKeyB64: "key-A",
    epochId: "e1",
    counter: spec.counter,
    hasSlotAllocation: true,
    hasAttestation: false,
    hasAgency: false,
    hasEpochLink: false,
    embeddedProofHash: "absent",
    chainless: false,
    verification: { tier: "full", status: "verified" },
  } as unknown as ObservedProof;
}

export function makeAudit(specs: FixtureProofSpec[]): AuditResult {
  const proofs = specs.map(makeProof);
  const audit = {
    runMetadata: {
      toolVersion: "fixture",
      startedAt: "1970-01-01T00:00:00.000Z",
      bundlePath: "fixture",
      container: "directory",
    },
    ingest: {
      bundlePath: "fixture",
      container: "directory",
      entriesScanned: proofs.length,
      proofs,
      unsupportedVersions: [],
      artifacts: [],
      witnesses: [],
      computedContentsHashB64: "fixture",
      findings: [],
      counts: {
        observed: proofs.length,
        proofFiles: proofs.length,
        exactDuplicates: 0,
        semanticDuplicates: 0,
        unsupportedVersion: 0,
        artifacts: 0,
        witnesses: 0,
        skippedUnsafePaths: 0,
      },
    },
    verification: {},
    reconstruction: {
      partitions: [
        {
          key: { publicKeyB64: "key-A", chainId: "bitgraph:main", epochId: "e1" },
          memberProofHashes: proofs.map((p) => p.proofHash),
          components: proofs.map((p) => ({ memberProofHashes: [p.proofHash] })),
        },
      ],
      unchainedProofHashes: [],
      unpartitionedProofHashes: [],
      epochRelationships: { epochs: [], edges: [], orderedPairs: [] },
    },
    anomalies: {},
    authorities: {},
    anchors: {},
    witnesses: {},
    temporal: {
      segments: [],
      anchorOrderedPairs: [],
      verifiedAnchorProofHashes: [],
      unverifiedAnchorProofHashes: [],
    },
    attestations: {},
  };
  return audit as unknown as AuditResult;
}
