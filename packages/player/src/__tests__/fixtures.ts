// Copyright (c) 2024-2026 Mike Argento. Licensed under the MIT License. See LICENSE.

/**
 * Synthetic AuditResult fixtures for unit tests.
 *
 * Deliberately NOT real proofs and NOT run through the verifier: Player is
 * a pure function over runAudit's OUTPUT, so unit tests exercise it against
 * hand-built AuditResult shapes. No test ever writes to the ledger — the
 * ledger is compliance-locked and recordings are permanent — and the
 * integration/acceptance path uses existing exports read-only instead.
 */

import type { AuditResult, ObservedProof, SegmentBound } from "@mikeargento/bitgraph-audit";

export interface FixtureProofSpec {
  /** Short name; expands deterministically into hashes. */
  name: string;
  digestB64: string;
  epochId?: string;
  chainId?: string;
  publicKeyB64?: string;
  counter?: string;
  slotCounter?: string;
  /** Name of the predecessor proof this one links to via prevB64. */
  prev?: string;
  verified?: boolean;
  tier?: "full" | "integrity";
  status?: "verified" | "failed" | "artifact-unavailable";
}

export function proofHashOf(name: string): string {
  return `proofhash-${name}`;
}

export function makeProof(spec: FixtureProofSpec): ObservedProof {
  const tier = spec.tier ?? "full";
  const status =
    spec.status ??
    (spec.verified === false
      ? "failed"
      : tier === "integrity"
        ? "artifact-unavailable"
        : "verified");
  const proof = {
    proofHash: proofHashOf(spec.name),
    chainHash: `chainhash-${spec.name}`,
    proof: {
      version: "bitgraph/1",
      artifact: { hashAlg: "sha256", digestB64: spec.digestB64 },
    },
    sources: [],
    version: "bitgraph/1",
    chainId: spec.chainId ?? "bitgraph:main",
    publicKeyB64: spec.publicKeyB64 ?? "key-A",
    hasSlotAllocation: true,
    hasAttestation: false,
    hasAgency: false,
    hasEpochLink: false,
    embeddedProofHash: "absent",
    chainless: spec.counter === undefined && spec.epochId === undefined,
    verification: { tier, status },
  } as Record<string, unknown>;
  if (spec.epochId !== undefined) proof["epochId"] = spec.epochId;
  if (spec.counter !== undefined) proof["counter"] = spec.counter;
  if (spec.slotCounter !== undefined) proof["slotCounter"] = spec.slotCounter;
  if (spec.prev !== undefined) proof["prevB64"] = `chainhash-${spec.prev}`;
  return proof as unknown as ObservedProof;
}

export interface FixturePartitionSpec {
  publicKeyB64?: string;
  epochId?: string;
  chainId?: string;
  /** Member proof NAMES (expanded via proofHashOf). */
  members: string[];
  /** Component groupings by proof name; defaults to one component per member. */
  components?: string[][];
}

export interface FixtureSegmentSpec {
  /** Member proof names. */
  members: string[];
  lowerBounds?: Partial<SegmentBound>[];
  upperBounds?: Partial<SegmentBound>[];
}

export function makeBound(partial: Partial<SegmentBound>): SegmentBound {
  return {
    kind: partial.kind ?? "not-before",
    anchorProofHash: partial.anchorProofHash ?? "anchor-x",
    blockHash: partial.blockHash ?? "0x" + "0".repeat(64),
    timestamp: partial.timestamp ?? 0,
    evidence: partial.evidence ?? "chain-link",
    weaker: partial.weaker ?? false,
    basis: partial.basis ?? "block-hash-unpredictability",
    claim: partial.claim ?? "fixture bound",
    // Required since bitgraph-audit 0.3.0: a not-after bound is an assumption, never evidence.
    boundClass: partial.boundClass ?? ((partial.kind ?? "not-before") === "not-before" ? "evidence" : "assumption"),
    ...(partial.blockNumber !== undefined ? { blockNumber: partial.blockNumber } : {}),
  };
}

export interface FixtureAuditSpec {
  proofs: FixtureProofSpec[];
  partitions?: FixturePartitionSpec[];
  /** Epoch lineage pairs, transitive, as audit reports them. */
  orderedPairs?: { beforeEpochId: string; afterEpochId: string }[];
  /** Hard epochLink edges by proof NAME: predecessor and via. */
  edges?: { predecessor: string; via: string }[];
  segments?: FixtureSegmentSpec[];
  unchained?: string[];
}

export function makeAudit(spec: FixtureAuditSpec): AuditResult {
  const proofs = spec.proofs.map(makeProof);
  const partitions = (spec.partitions ?? []).map((p) => {
    const members = p.members.map(proofHashOf);
    const components = (p.components ?? p.members.map((m) => [m])).map((group) => ({
      memberProofHashes: group.map(proofHashOf),
    }));
    const key: Record<string, unknown> = {
      publicKeyB64: p.publicKeyB64 ?? "key-A",
      chainId: p.chainId ?? "bitgraph:main",
    };
    if (p.epochId !== undefined) key["epochId"] = p.epochId;
    return { key, memberProofHashes: members, components };
  });
  const segments = (spec.segments ?? []).map((s) => ({
    partition: { publicKeyB64: "key-A", chainId: "bitgraph:main" },
    memberProofHashes: s.members.map(proofHashOf),
    status: "lower-bounded-with-following-anchor",
    lowerBounds: (s.lowerBounds ?? []).map((b) => makeBound({ ...b, kind: "not-before" })),
    upperBounds: (s.upperBounds ?? []).map((b) => makeBound({ ...b, kind: "not-after" })),
  }));
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
      partitions,
      unchainedProofHashes: (spec.unchained ?? []).map(proofHashOf),
      unpartitionedProofHashes: [],
      epochRelationships: {
        epochs: [],
        edges: (spec.edges ?? []).map((e) => {
          const pred = spec.proofs.find((p) => p.name === e.predecessor);
          const via = spec.proofs.find((p) => p.name === e.via);
          return {
            fromEpochId: pred?.epochId ?? "?",
            toEpochId: via?.epochId ?? "?",
            viaProofHash: proofHashOf(e.via),
            link: {},
            resolution: "matched",
            predecessorProofHash: proofHashOf(e.predecessor),
            metadataConsistent: true,
            viaProofValid: true,
            predecessorValid: true,
            hardEdge: true,
          };
        }),
        orderedPairs: spec.orderedPairs ?? [],
      },
    },
    anomalies: {},
    authorities: {},
    anchors: {},
    witnesses: {},
    temporal: {
      segments,
      anchorOrderedPairs: [],
      verifiedAnchorProofHashes: [],
      unverifiedAnchorProofHashes: [],
    },
    attestations: {},
  };
  return audit as unknown as AuditResult;
}

/** A digest spelled the way rules spell it, unique per tag. */
export function digestFor(tag: string): string {
  // 32 bytes: the tag padded; deterministic and valid base64 once encoded.
  return Buffer.from(tag.padEnd(32, ".")).toString("base64");
}
