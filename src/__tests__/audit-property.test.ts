// Copyright (c) Mike Argento. All rights reserved. See LICENSE.

/**
 * Property-based topology tests for the audit pipeline (Phase 4e).
 *
 * A seeded deterministic PRNG (mulberry32, fixed literal seeds below, no
 * Date.now, no unseeded Math.random) drives a synthetic topology generator
 * that produces protocol-correct chains through the REAL signing path:
 * real Ed25519 signatures over the canonical SignedBody, real
 * computeProofHash links, and the G2 two-position slot/commit counter
 * pattern (slot 1/commit 2, slot 3/commit 4, ...). A mutation engine then
 * injects each anomaly class deliberately, each class in its own isolated
 * partition (fresh key, fresh epochId) so expected codes compose by
 * union.
 *
 * Assertions:
 *   - each class in isolation produces exactly its stable codes plus the
 *     class-specific structure (components, divergences, lineage edges);
 *   - the property loop composes a random subset of classes per seed and
 *     asserts EXACTLY the injected anomaly codes appear: no missing
 *     detections, no spurious extras (control chains contribute zero);
 *   - determinism: regenerating the same seed into a fresh directory
 *     yields a deep-equal JSON report modulo runMetadata.
 *
 * No verifier semantics are bypassed anywhere: every proof that must be
 * valid is signed for real, and deliberately absent proofs are simply not
 * written to the bundle.
 */

import { describe, it, after } from "node:test";
import * as assert from "node:assert/strict";
import { rm } from "node:fs/promises";
import { sha256 } from "@noble/hashes/sha256";
import { computeProofHash } from "@mikeargento/bitgraph-verify";
import type { BitGraphProof } from "@mikeargento/bitgraph-verify";
import { buildJsonReport, runAudit } from "@mikeargento/bitgraph-audit";
import type { AuditResult, ReportPartition } from "@mikeargento/bitgraph-audit";
import {
  b64,
  makeCounterChain,
  makeEpochLinkProof,
  makeKey,
  makeTempDir,
  proofJson,
  signBody,
  utf8,
  writeBundleDir,
  healthyPairs,
  type CounterChainLink,
  type RandomSource,
} from "./audit-fixtures.js";

// ---------------------------------------------------------------------------
// Seeded deterministic PRNG (mulberry32). Fixed seeds only; runs are
// reproducible byte for byte.
// ---------------------------------------------------------------------------

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function randomSource(rng: () => number): RandomSource {
  return (byteLength: number) => {
    const out = new Uint8Array(byteLength);
    for (let i = 0; i < byteLength; i++) out[i] = Math.floor(rng() * 256);
    return out;
  };
}

function randInt(rng: () => number, min: number, max: number): number {
  return min + Math.floor(rng() * (max - min + 1));
}

/** Fixed seeds for the property loop. Chosen once; never derived from the clock. */
const PROPERTY_SEEDS = [
  0x00000001, 0x1bad5eed, 0x2c0ffee5, 0x3d0d0bee, 0x4e1e5701, 0x5a5a5a5a,
  0x6b17c0de, 0x7f00ba75, 0x8badf00d, 0x9e3779b9, 0xa11ce001, 0xb0bca742,
] as const;

/** Seed used by the isolation tests and the determinism test. */
const ISOLATION_SEED = 0xf1c5e0e5;

// ---------------------------------------------------------------------------
// Topology builder context
// ---------------------------------------------------------------------------

interface TopologyContext {
  rng: () => number;
  random: RandomSource;
  files: Record<string, string | Uint8Array>;
  /** Expected stable anomaly codes, as a multiset. */
  expectedCodes: string[];
  /** Expected unique observed proofs. */
  expectedObserved: number;
  /** Expected unsupported-version rejects. */
  expectedUnsupported: number;
  /** Expected chainless proofs. */
  expectedChainless: number;
  /** Unique path prefix per scenario instance. */
  nextPrefix: (className: string) => string;
}

function makeContext(seed: number): TopologyContext {
  const rng = mulberry32(seed);
  let scenarioIndex = 0;
  return {
    rng,
    random: randomSource(rng),
    files: {},
    expectedCodes: [],
    expectedObserved: 0,
    expectedUnsupported: 0,
    expectedChainless: 0,
    nextPrefix: (className: string) => `s${String(scenarioIndex++).padStart(2, "0")}-${className}`,
  };
}

function addChainFiles(ctx: TopologyContext, prefix: string, proofs: CounterChainLink[]): void {
  for (let i = 0; i < proofs.length; i++) {
    ctx.files[`${prefix}/proof-${i}.json`] = proofJson(proofs[i]!.proof);
  }
  ctx.expectedObserved += proofs.length;
}

/** Random chainId variant: the named production chain or the enclave default. */
function pickChainId(ctx: TopologyContext): string | undefined {
  return ctx.rng() < 0.5 ? "bitgraph:main" : undefined;
}

// ---------------------------------------------------------------------------
// Mutation engine: one builder per anomaly class. Every builder works in
// its own partition (fresh PRNG key, unique epochId), so expected codes
// compose by union across an arbitrary subset of classes.
// ---------------------------------------------------------------------------

type ScenarioBuilder = (ctx: TopologyContext) => Promise<void>;

/** Continuous healthy chain: the control. Contributes zero codes. */
const buildControl: ScenarioBuilder = async (ctx) => {
  const prefix = ctx.nextPrefix("control");
  const length = randInt(ctx.rng, 3, 6);
  const chainId = pickChainId(ctx);
  const chain = await makeCounterChain({
    epochId: `${prefix}-epoch`,
    pairs: healthyPairs(length),
    ...(chainId !== undefined ? { chainId } : {}),
    payloadPrefix: prefix,
    random: ctx.random,
  });
  addChainFiles(ctx, prefix, chain.proofs);
};

/** Removed proof: its slot+commit positions unexplained plus a chain break. */
const buildRemovedProof: ScenarioBuilder = async (ctx) => {
  const prefix = ctx.nextPrefix("removed");
  const length = randInt(ctx.rng, 3, 6);
  const dropIndex = randInt(ctx.rng, 1, length - 2); // never genesis, never tail
  const chain = await makeCounterChain({
    epochId: `${prefix}-epoch`,
    pairs: healthyPairs(length),
    payloadPrefix: prefix,
    random: ctx.random,
  });
  for (let i = 0; i < chain.proofs.length; i++) {
    if (i === dropIndex) continue; // deliberately absent from the bundle
    ctx.files[`${prefix}/proof-${i}.json`] = proofJson(chain.proofs[i]!.proof);
  }
  ctx.expectedObserved += length - 1;
  ctx.expectedCodes.push("unexplained-counter-positions", "chain-break-missing");
};

/** Two proofs signed for the same commit counter (distinct slots, no shared prev). */
const buildCounterCollision: ScenarioBuilder = async (ctx) => {
  const prefix = ctx.nextPrefix("counter-collision");
  const length = randInt(ctx.rng, 3, 5);
  const chain = await makeCounterChain({
    epochId: `${prefix}-epoch`,
    pairs: healthyPairs(length),
    payloadPrefix: prefix,
    random: ctx.random,
  });
  addChainFiles(ctx, prefix, chain.proofs);
  const collideWith = chain.proofs[1]!.proof.commit.counter as string; // "4"
  const tail = chain.proofs[length - 1]!;
  // The collider stays protocol-correct on its own terms: slot strictly
  // below commit per the G2 nonce-first order, and its slot ("2") is an
  // existing COMMIT position, never another slot, because cross-kind
  // position sharing is deliberately not a collision.
  const extra = await makeCounterChain({
    epochId: `${prefix}-epoch`,
    key: chain.key,
    pairs: [{ slot: "2", commit: collideWith }],
    payloadPrefix: `${prefix}-collider`,
    prevB64OfFirst: tail.proofHash,
    random: ctx.random,
  });
  ctx.files[`${prefix}/collider.json`] = proofJson(extra.proofs[0]!.proof);
  ctx.expectedObserved += 1;
  ctx.expectedCodes.push("counter-collision");
};

/** Two proofs referencing the same slot counter. */
const buildSlotCollision: ScenarioBuilder = async (ctx) => {
  const prefix = ctx.nextPrefix("slot-collision");
  const length = randInt(ctx.rng, 3, 5);
  const chain = await makeCounterChain({
    epochId: `${prefix}-epoch`,
    pairs: healthyPairs(length),
    payloadPrefix: prefix,
    random: ctx.random,
  });
  addChainFiles(ctx, prefix, chain.proofs);
  const collideWith = chain.proofs[1]!.proof.commit.slotCounter as string;
  const tail = chain.proofs[length - 1]!;
  const extra = await makeCounterChain({
    epochId: `${prefix}-epoch`,
    key: chain.key,
    pairs: [{ slot: collideWith, commit: String(2 * length + 1) }],
    payloadPrefix: `${prefix}-collider`,
    prevB64OfFirst: tail.proofHash,
    random: ctx.random,
  });
  ctx.files[`${prefix}/collider.json`] = proofJson(extra.proofs[0]!.proof);
  ctx.expectedObserved += 1;
  ctx.expectedCodes.push("slot-collision");
};

/** Predecessor-reuse fork: two valid successors consume the same tail. */
const buildPredecessorReuse: ScenarioBuilder = async (ctx) => {
  const prefix = ctx.nextPrefix("fork");
  const length = randInt(ctx.rng, 2, 4);
  const chain = await makeCounterChain({
    epochId: `${prefix}-epoch`,
    pairs: healthyPairs(length),
    payloadPrefix: prefix,
    random: ctx.random,
  });
  addChainFiles(ctx, prefix, chain.proofs);
  const tail = chain.proofs[length - 1]!;
  for (const [branch, offset] of [
    ["a", 0],
    ["b", 2],
  ] as const) {
    const child = await makeCounterChain({
      epochId: `${prefix}-epoch`,
      key: chain.key,
      pairs: [{ slot: String(2 * length + 1 + offset), commit: String(2 * length + 2 + offset) }],
      payloadPrefix: `${prefix}-branch-${branch}`,
      prevB64OfFirst: tail.proofHash,
      random: ctx.random,
    });
    ctx.files[`${prefix}/branch-${branch}.json`] = proofJson(child.proofs[0]!.proof);
    ctx.expectedObserved += 1;
  }
  ctx.expectedCodes.push("predecessor-reuse");
};

/** Dangling prevB64: well-formed 32-byte reference into unobserved history. */
const buildMissingPredecessor: ScenarioBuilder = async (ctx) => {
  const prefix = ctx.nextPrefix("dangling-prev");
  const length = randInt(ctx.rng, 2, 4);
  const chain = await makeCounterChain({
    epochId: `${prefix}-epoch`,
    pairs: healthyPairs(length),
    payloadPrefix: prefix,
    random: ctx.random,
  });
  addChainFiles(ctx, prefix, chain.proofs);
  const stray = await makeCounterChain({
    epochId: `${prefix}-epoch`,
    key: chain.key,
    pairs: [{ slot: String(2 * length + 1), commit: String(2 * length + 2) }],
    payloadPrefix: `${prefix}-stray`,
    prevB64OfFirst: b64(ctx.random(32)), // no observed proof has this hash
    random: ctx.random,
  });
  ctx.files[`${prefix}/stray.json`] = proofJson(stray.proofs[0]!.proof);
  ctx.expectedObserved += 1;
  ctx.expectedCodes.push("chain-break-missing");
};

/** Malformed prevB64: not base64 of 32 bytes. The proof itself stays verifier-valid. */
const buildMalformedPrev: ScenarioBuilder = async (ctx) => {
  const prefix = ctx.nextPrefix("malformed-prev");
  const length = randInt(ctx.rng, 2, 4);
  const chain = await makeCounterChain({
    epochId: `${prefix}-epoch`,
    pairs: healthyPairs(length),
    payloadPrefix: prefix,
    random: ctx.random,
  });
  addChainFiles(ctx, prefix, chain.proofs);
  const malformed = await makeCounterChain({
    epochId: `${prefix}-epoch`,
    key: chain.key,
    pairs: [{ slot: String(2 * length + 1), commit: String(2 * length + 2) }],
    payloadPrefix: `${prefix}-malformed`,
    prevB64OfFirst: "this-is-not-base64-of-32-bytes!",
    random: ctx.random,
  });
  ctx.files[`${prefix}/malformed.json`] = proofJson(malformed.proofs[0]!.proof);
  ctx.expectedObserved += 1;
  ctx.expectedCodes.push("chain-break-malformed");
};

/** Byte-identical duplicate proof file. Benign; still a stable code. */
const buildExactDuplicate: ScenarioBuilder = async (ctx) => {
  const prefix = ctx.nextPrefix("exact-dup");
  const chain = await makeCounterChain({
    epochId: `${prefix}-epoch`,
    pairs: healthyPairs(2),
    payloadPrefix: prefix,
    random: ctx.random,
  });
  addChainFiles(ctx, prefix, chain.proofs);
  ctx.files[`${prefix}/copy-of-0.json`] = proofJson(chain.proofs[0]!.proof);
  ctx.expectedCodes.push("exact-duplicate");
};

/**
 * Semantic duplicate: the same proof re-serialized with a different key
 * order and an extra UNSIGNED metadata field, so the bytes differ but the
 * canonical identity matches. The builder verifies the computeProofHash
 * equality before relying on it (metadata sits outside the signed body).
 */
const buildSemanticDuplicate: ScenarioBuilder = async (ctx) => {
  const prefix = ctx.nextPrefix("semantic-dup");
  const chain = await makeCounterChain({
    epochId: `${prefix}-epoch`,
    pairs: healthyPairs(2),
    payloadPrefix: prefix,
    random: ctx.random,
  });
  addChainFiles(ctx, prefix, chain.proofs);
  const original = chain.proofs[0]!.proof;
  const reserialized = {
    environment: original.environment,
    signer: original.signer,
    commit: original.commit,
    artifact: original.artifact,
    version: original.version,
    metadata: { note: "unsigned metadata added by a relay", relay: prefix },
  };
  const reserializedJson = JSON.stringify(reserialized);
  assert.notEqual(reserializedJson, proofJson(original), "bytes must differ");
  assert.equal(
    computeProofHash(JSON.parse(reserializedJson) as Record<string, unknown>),
    chain.proofs[0]!.proofHash,
    "re-serialization with reordered keys and unsigned metadata must keep the canonical identity"
  );
  ctx.files[`${prefix}/reserialized-0.json`] = reserializedJson;
  ctx.expectedCodes.push("semantic-duplicate");
};

/** Two disconnected components in one partition: a second no-prevB64 genesis. */
const buildDisconnectedChains: ScenarioBuilder = async (ctx) => {
  const prefix = ctx.nextPrefix("disconnected");
  const first = await makeCounterChain({
    epochId: `${prefix}-epoch`,
    pairs: healthyPairs(2),
    payloadPrefix: `${prefix}-one`,
    random: ctx.random,
  });
  addChainFiles(ctx, `${prefix}/one`, first.proofs);
  // Same key and epoch, later counters, no link back: a second genesis.
  const second = await makeCounterChain({
    epochId: `${prefix}-epoch`,
    key: first.key,
    pairs: [
      { slot: "5", commit: "6" },
      { slot: "7", commit: "8" },
    ],
    payloadPrefix: `${prefix}-two`,
    random: ctx.random,
  });
  addChainFiles(ctx, `${prefix}/two`, second.proofs);
  ctx.expectedCodes.push("multiple-genesis");
};

/** Valid epochLink transition: prior epoch terminal consumed by a new epoch. Zero codes. */
const buildValidEpochLink: ScenarioBuilder = async (ctx) => {
  const prefix = ctx.nextPrefix("epochlink-valid");
  const length = randInt(ctx.rng, 2, 3);
  // One measurement per epoch: an epochId is boot-scoped, so the genesis
  // and its continuation declare the same measurement (a mix would
  // honestly flag mid-epoch-measurement-change).
  const measurementB = `${prefix}-measurement-b`;
  const prior = await makeCounterChain({
    epochId: `${prefix}-epoch-a`,
    pairs: healthyPairs(length),
    measurement: `${prefix}-measurement-a`,
    payloadPrefix: `${prefix}-a`,
    random: ctx.random,
  });
  addChainFiles(ctx, `${prefix}/a`, prior.proofs);
  const terminal = prior.proofs[length - 1]!;
  const genesis = await makeEpochLinkProof({
    prevEpochId: `${prefix}-epoch-a`,
    prevCounter: terminal.proof.commit.counter as string,
    prevProofHashB64: terminal.proofHash,
    toEpochId: `${prefix}-epoch-b`,
    prevPublicKeyB64: prior.key.publicKeyB64,
    counter: "2",
    slotCounter: "1",
    measurement: measurementB,
    payload: `${prefix}-b-genesis`,
    random: ctx.random,
  });
  ctx.files[`${prefix}/b-genesis.json`] = proofJson(genesis.proof);
  const continuation = await makeCounterChain({
    epochId: `${prefix}-epoch-b`,
    key: genesis.key,
    pairs: [{ slot: "3", commit: "4" }],
    measurement: measurementB,
    payloadPrefix: `${prefix}-b`,
    prevB64OfFirst: computeProofHash(genesis.proof),
    random: ctx.random,
  });
  ctx.files[`${prefix}/b-1.json`] = proofJson(continuation.proofs[0]!.proof);
  ctx.expectedObserved += 2;
};

/** Broken epochLink: dangling reference to an unobserved epoch and terminal. */
const buildDanglingEpochLink: ScenarioBuilder = async (ctx) => {
  const prefix = ctx.nextPrefix("epochlink-dangling");
  const genesis = await makeEpochLinkProof({
    prevEpochId: `${prefix}-unobserved-epoch`,
    prevCounter: "88",
    prevProofHashB64: b64(ctx.random(32)),
    toEpochId: `${prefix}-epoch`,
    counter: "2",
    slotCounter: "1",
    payload: `${prefix}-genesis`,
    random: ctx.random,
  });
  ctx.files[`${prefix}/genesis.json`] = proofJson(genesis.proof);
  ctx.expectedObserved += 1;
  ctx.expectedCodes.push("epochlink-dangling");
};

/** Multiple independent lineages: two signers, two epochs. Zero codes, never merged. */
const buildMultipleLineages: ScenarioBuilder = async (ctx) => {
  const prefix = ctx.nextPrefix("lineages");
  for (const which of ["x", "y"] as const) {
    const chain = await makeCounterChain({
      epochId: `${prefix}-epoch-${which}`,
      pairs: healthyPairs(randInt(ctx.rng, 2, 3)),
      payloadPrefix: `${prefix}-${which}`,
      random: ctx.random,
    });
    addChainFiles(ctx, `${prefix}/${which}`, chain.proofs);
  }
};

/** Mid-epoch measurement transition: one signer, one epoch, linked chain, two measurements. */
const buildMeasurementChange: ScenarioBuilder = async (ctx) => {
  const prefix = ctx.nextPrefix("measurement-change");
  const first = await makeCounterChain({
    epochId: `${prefix}-epoch`,
    pairs: healthyPairs(2),
    measurement: `${prefix}-measurement-one`,
    payloadPrefix: `${prefix}-one`,
    random: ctx.random,
  });
  addChainFiles(ctx, `${prefix}/one`, first.proofs);
  const second = await makeCounterChain({
    epochId: `${prefix}-epoch`,
    key: first.key,
    pairs: [{ slot: "5", commit: "6" }],
    measurement: `${prefix}-measurement-two`,
    payloadPrefix: `${prefix}-two`,
    prevB64OfFirst: first.proofs[1]!.proofHash,
    random: ctx.random,
  });
  ctx.files[`${prefix}/two.json`] = proofJson(second.proofs[0]!.proof);
  ctx.expectedObserved += 1;
  ctx.expectedCodes.push("mid-epoch-measurement-change");
};

/** Illegal mid-epoch signer change: two distinct keys under one epochId. */
const buildSignerChange: ScenarioBuilder = async (ctx) => {
  const prefix = ctx.nextPrefix("signer-change");
  const epochId = `${prefix}-epoch`;
  const first = await makeCounterChain({
    epochId,
    pairs: healthyPairs(2),
    payloadPrefix: `${prefix}-one`,
    random: ctx.random,
  });
  addChainFiles(ctx, `${prefix}/one`, first.proofs);
  const secondKey = await makeKey(ctx.random);
  const second = await makeCounterChain({
    epochId,
    key: secondKey,
    pairs: [
      { slot: "5", commit: "6" },
      { slot: "7", commit: "8" },
    ],
    payloadPrefix: `${prefix}-two`,
    random: ctx.random,
  });
  addChainFiles(ctx, `${prefix}/two`, second.proofs);
  ctx.expectedCodes.push("mid-epoch-signer-change");
};

/** Chainless proofs: no counter, no epochId. Observed-but-unchained, never an anomaly. */
const buildChainless: ScenarioBuilder = async (ctx) => {
  const prefix = ctx.nextPrefix("chainless");
  const count = randInt(ctx.rng, 1, 2);
  const key = await makeKey(ctx.random);
  for (let i = 0; i < count; i++) {
    const bytes = utf8(`${prefix}-payload-${i}`);
    const proof = await signBody(
      key,
      { hashAlg: "sha256", digestB64: b64(sha256(bytes)) },
      { nonceB64: b64(ctx.random(16)) },
      `${prefix}-measurement`
    );
    ctx.files[`${prefix}/proof-${i}.json`] = proofJson(proof);
  }
  ctx.expectedObserved += count;
  ctx.expectedChainless += count;
};

/** occ/1 reject: pre-release beta data, rejected at ingest per the version policy. */
const buildOccReject: ScenarioBuilder = async (ctx) => {
  const prefix = ctx.nextPrefix("occ1");
  ctx.files[`${prefix}/legacy.json`] = JSON.stringify({
    version: "occ/1",
    artifact: { hashAlg: "sha256", digestB64: b64(ctx.random(32)) },
    commit: { nonceB64: b64(ctx.random(16)), counter: "7" },
    signer: { publicKeyB64: b64(ctx.random(32)), signatureB64: b64(ctx.random(64)) },
  });
  ctx.expectedUnsupported += 1;
  ctx.expectedCodes.push("unsupported-version");
};

const MUTATIONS: ReadonlyArray<[name: string, builder: ScenarioBuilder]> = [
  ["removed-proof", buildRemovedProof],
  ["counter-collision", buildCounterCollision],
  ["slot-collision", buildSlotCollision],
  ["predecessor-reuse", buildPredecessorReuse],
  ["missing-predecessor", buildMissingPredecessor],
  ["malformed-prev", buildMalformedPrev],
  ["exact-duplicate", buildExactDuplicate],
  ["semantic-duplicate", buildSemanticDuplicate],
  ["disconnected-chains", buildDisconnectedChains],
  ["epochlink-valid", buildValidEpochLink],
  ["epochlink-dangling", buildDanglingEpochLink],
  ["multiple-lineages", buildMultipleLineages],
  ["measurement-change", buildMeasurementChange],
  ["signer-change", buildSignerChange],
  ["chainless", buildChainless],
  ["occ1-reject", buildOccReject],
];

// ---------------------------------------------------------------------------
// Shared runner
// ---------------------------------------------------------------------------

const tempDirs: string[] = [];

after(async () => {
  await Promise.all(tempDirs.map((dir) => rm(dir, { recursive: true, force: true })));
});

async function buildAndAudit(
  ctx: TopologyContext
): Promise<{ dir: string; result: AuditResult }> {
  const dir = await makeTempDir("bitgraph-audit-property-");
  tempDirs.push(dir);
  await writeBundleDir(dir, ctx.files);
  const result = await runAudit(dir);
  return { dir, result };
}

function assertExactCodes(result: AuditResult, ctx: TopologyContext, label: string): void {
  const report = buildJsonReport(result);
  const actual = report.anomalies.map((a) => a.code).sort();
  const expected = [...ctx.expectedCodes].sort();
  assert.deepEqual(actual, expected, `${label}: exactly the injected anomaly codes appear`);
  assert.equal(result.ingest.counts.observed, ctx.expectedObserved, `${label}: observed count`);
  assert.equal(
    result.ingest.counts.unsupportedVersion,
    ctx.expectedUnsupported,
    `${label}: unsupported-version count`
  );
  assert.equal(result.verification.chainless, ctx.expectedChainless, `${label}: chainless count`);
  // Every synthetic proof is signed through the real path with no artifact
  // bytes bundled: nothing may fail verification, nothing may be "verified".
  assert.equal(result.verification.failed, 0, `${label}: no verification failures`);
  assert.equal(result.verification.verified, 0, `${label}: no artifact bytes, no full tier`);
  assert.equal(
    result.verification.artifactUnavailable,
    ctx.expectedObserved,
    `${label}: all proofs at the integrity tier`
  );
}

function findPartition(result: AuditResult, epochId: string): ReportPartition | undefined {
  const report = buildJsonReport(result);
  return report.partitions.find((p) => p.key.epochId === epochId);
}

// ---------------------------------------------------------------------------
// Isolation: each anomaly class alone produces exactly its codes plus the
// class-specific structure.
// ---------------------------------------------------------------------------

describe("audit property tests: anomaly classes in isolation", () => {
  it("control: a continuous healthy chain produces zero anomaly codes", async () => {
    const ctx = makeContext(ISOLATION_SEED);
    await buildControl(ctx);
    const { result } = await buildAndAudit(ctx);
    assertExactCodes(result, ctx, "control");
    assert.equal(result.reconstruction.partitions.length, 1);
    assert.equal(result.reconstruction.partitions[0]?.components.length, 1);
    assert.equal(buildJsonReport(result).summary.chainIntact, true);
  });

  it("removed proof: gap covers exactly the dropped slot and commit positions, plus a chain break", async () => {
    const ctx = makeContext(ISOLATION_SEED + 1);
    // Deterministic variant: length 4, drop index 1 (slot 3 / commit 4).
    const prefix = ctx.nextPrefix("removed-fixed");
    const chain = await makeCounterChain({
      epochId: `${prefix}-epoch`,
      pairs: healthyPairs(4),
      payloadPrefix: prefix,
      random: ctx.random,
    });
    for (let i = 0; i < 4; i++) {
      if (i === 1) continue;
      ctx.files[`${prefix}/proof-${i}.json`] = proofJson(chain.proofs[i]!.proof);
    }
    ctx.expectedObserved += 3;
    ctx.expectedCodes.push("unexplained-counter-positions", "chain-break-missing");
    const { result } = await buildAndAudit(ctx);
    assertExactCodes(result, ctx, "removed");

    const gap = result.anomalies.anomalies.find((a) => a.code === "unexplained-counter-positions");
    assert.deepEqual((gap?.details as { positions: string[] }).positions, ["3", "4"]);
    const brk = result.anomalies.anomalies.find((a) => a.code === "chain-break-missing");
    assert.deepEqual(brk?.proofHashes, [chain.proofs[2]!.proofHash]);
    assert.equal((brk?.details as { prevB64: string }).prevB64, chain.proofs[1]!.proofHash);
    // The removal splits the partition into two observed components.
    assert.equal(findPartition(result, `${prefix}-epoch`)?.components.length, 2);
  });

  it("counter collision: two valid proofs on one commit counter, divergence preserved, no winner", async () => {
    const ctx = makeContext(ISOLATION_SEED + 2);
    await buildCounterCollision(ctx);
    const { result } = await buildAndAudit(ctx);
    assertExactCodes(result, ctx, "counter-collision");
    assert.equal(result.anomalies.divergences.length, 1);
    const divergence = result.anomalies.divergences[0]!;
    assert.equal(divergence.kind, "counter-collision");
    assert.equal(divergence.parties.length, 2);
    assert.equal(divergence.invalidContext.length, 0);
    assert.ok(divergence.explanation.includes("does not choose"));
  });

  it("slot collision: two valid proofs referencing one slot counter", async () => {
    const ctx = makeContext(ISOLATION_SEED + 3);
    await buildSlotCollision(ctx);
    const { result } = await buildAndAudit(ctx);
    assertExactCodes(result, ctx, "slot-collision");
    assert.equal(result.anomalies.divergences.length, 1);
    assert.equal(result.anomalies.divergences[0]?.kind, "slot-collision");
  });

  it("predecessor reuse: a fork with both branches preserved", async () => {
    const ctx = makeContext(ISOLATION_SEED + 4);
    await buildPredecessorReuse(ctx);
    const { result } = await buildAndAudit(ctx);
    assertExactCodes(result, ctx, "predecessor-reuse");
    assert.equal(result.anomalies.divergences.length, 1);
    const divergence = result.anomalies.divergences[0]!;
    assert.equal(divergence.kind, "predecessor-reuse");
    assert.equal(divergence.parties.length, 2);
    // Both branches verifier-valid at the integrity tier.
    for (const party of divergence.parties) {
      assert.equal(party.verificationStatus, "artifact-unavailable");
    }
  });

  it("missing predecessor: dangling prevB64 is a chain break into unobserved history", async () => {
    const ctx = makeContext(ISOLATION_SEED + 5);
    await buildMissingPredecessor(ctx);
    const { result } = await buildAndAudit(ctx);
    assertExactCodes(result, ctx, "missing-predecessor");
    const brk = result.anomalies.anomalies.find((a) => a.code === "chain-break-missing");
    assert.ok(brk?.message.includes("does not, by itself, establish"));
  });

  it("malformed prevB64: unusable link flagged; the proof itself stays verifier-valid", async () => {
    const ctx = makeContext(ISOLATION_SEED + 6);
    await buildMalformedPrev(ctx);
    const { result } = await buildAndAudit(ctx);
    assertExactCodes(result, ctx, "malformed-prev");
    const anomaly = result.anomalies.anomalies.find((a) => a.code === "chain-break-malformed");
    const flagged = result.ingest.proofs.find(
      (p) => p.proofHash === anomaly?.proofHashes[0]
    );
    // prevB64 is inside the signed body but the canonical verifier does not
    // require it to be base64; topology and verification stay separate.
    assert.equal(flagged?.verification?.status, "artifact-unavailable");
  });

  it("exact duplicate: byte-identical copy collapses to one observed proof", async () => {
    const ctx = makeContext(ISOLATION_SEED + 7);
    await buildExactDuplicate(ctx);
    const { result } = await buildAndAudit(ctx);
    assertExactCodes(result, ctx, "exact-duplicate");
    assert.equal(result.ingest.counts.exactDuplicates, 1);
    assert.equal(result.ingest.counts.semanticDuplicates, 0);
  });

  it("semantic duplicate: reordered keys plus unsigned metadata keep the canonical identity", async () => {
    const ctx = makeContext(ISOLATION_SEED + 8);
    await buildSemanticDuplicate(ctx);
    const { result } = await buildAndAudit(ctx);
    assertExactCodes(result, ctx, "semantic-duplicate");
    assert.equal(result.ingest.counts.exactDuplicates, 0);
    assert.equal(result.ingest.counts.semanticDuplicates, 1);
    // The two byte encodings collapsed into one observed proof with two sources.
    const withTwoSources = result.ingest.proofs.filter((p) => p.sources.length === 2);
    assert.equal(withTwoSources.length, 1);
  });

  it("disconnected chains: two components in one partition via a second genesis", async () => {
    const ctx = makeContext(ISOLATION_SEED + 9);
    await buildDisconnectedChains(ctx);
    const { result } = await buildAndAudit(ctx);
    assertExactCodes(result, ctx, "disconnected");
    assert.equal(result.reconstruction.partitions.length, 1);
    assert.equal(result.reconstruction.partitions[0]?.components.length, 2);
    // Both genesis proofs are valid: a multiple-genesis divergence.
    assert.equal(result.anomalies.divergences.length, 1);
    assert.equal(result.anomalies.divergences[0]?.kind, "multiple-genesis");
  });

  it("valid epochLink transition: zero codes, hard lineage edge, ordered epochs", async () => {
    const ctx = makeContext(ISOLATION_SEED + 10);
    await buildValidEpochLink(ctx);
    const { result } = await buildAndAudit(ctx);
    assertExactCodes(result, ctx, "epochlink-valid");
    const edges = result.reconstruction.epochRelationships.edges;
    assert.equal(edges.length, 1);
    assert.equal(edges[0]?.resolution, "matched");
    assert.equal(edges[0]?.hardEdge, true);
    assert.equal(edges[0]?.metadataConsistent, true);
    const pairs = result.reconstruction.epochRelationships.orderedPairs;
    assert.equal(pairs.length, 1);
    assert.ok(pairs[0]?.beforeEpochId.endsWith("epoch-a"));
    assert.ok(pairs[0]?.afterEpochId.endsWith("epoch-b"));
    for (const epoch of result.reconstruction.epochRelationships.epochs) {
      assert.equal(epoch.ordering, "linked");
    }
  });

  it("broken epochLink: dangling lineage claim flagged, no ordering asserted", async () => {
    const ctx = makeContext(ISOLATION_SEED + 11);
    await buildDanglingEpochLink(ctx);
    const { result } = await buildAndAudit(ctx);
    assertExactCodes(result, ctx, "epochlink-dangling");
    const edges = result.reconstruction.epochRelationships.edges;
    assert.equal(edges.length, 1);
    assert.equal(edges[0]?.resolution, "dangling");
    assert.equal(edges[0]?.hardEdge, false);
    assert.equal(result.reconstruction.epochRelationships.orderedPairs.length, 0);
  });

  it("multiple lineages: two signers never merge and never anomalize", async () => {
    const ctx = makeContext(ISOLATION_SEED + 12);
    await buildMultipleLineages(ctx);
    const { result } = await buildAndAudit(ctx);
    assertExactCodes(result, ctx, "lineages");
    assert.equal(result.reconstruction.partitions.length, 2);
    const keys = new Set(result.reconstruction.partitions.map((p) => p.key.publicKeyB64));
    assert.equal(keys.size, 2);
    // No ordering evidence between the epochs: concurrent-or-unordered.
    assert.equal(buildJsonReport(result).epochRelationships.unorderedPairs.length, 1);
  });

  it("mid-epoch measurement transition: flagged with both measurements listed", async () => {
    const ctx = makeContext(ISOLATION_SEED + 13);
    await buildMeasurementChange(ctx);
    const { result } = await buildAndAudit(ctx);
    assertExactCodes(result, ctx, "measurement-change");
    const anomaly = result.authorities.anomalies.find(
      (a) => a.code === "mid-epoch-measurement-change"
    );
    assert.ok(anomaly !== undefined);
    const details = anomaly.details as { measurements: string[] };
    assert.equal(details.measurements.length, 2);
    // One signer, one linked chain: still a single component.
    assert.equal(result.reconstruction.partitions.length, 1);
    assert.equal(result.reconstruction.partitions[0]?.components.length, 1);
    // Two authority groups (measurement is a grouping facet).
    assert.equal(result.authorities.groups.length, 2);
  });

  it("illegal mid-epoch signer change: flagged with both keys listed", async () => {
    const ctx = makeContext(ISOLATION_SEED + 14);
    await buildSignerChange(ctx);
    const { result } = await buildAndAudit(ctx);
    assertExactCodes(result, ctx, "signer-change");
    const anomaly = result.authorities.anomalies.find((a) => a.code === "mid-epoch-signer-change");
    assert.ok(anomaly !== undefined);
    const details = anomaly.details as { publicKeysB64: string[] };
    assert.equal(details.publicKeysB64.length, 2);
    // Two partitions: signer lineages are never merged.
    assert.equal(result.reconstruction.partitions.length, 2);
  });

  it("chainless proofs: observed-but-unchained, reported separately, never an anomaly", async () => {
    const ctx = makeContext(ISOLATION_SEED + 15);
    await buildChainless(ctx);
    const { result } = await buildAndAudit(ctx);
    assertExactCodes(result, ctx, "chainless");
    assert.equal(result.reconstruction.partitions.length, 0);
    assert.equal(
      result.reconstruction.unchainedProofHashes.length,
      ctx.expectedChainless
    );
  });

  it("occ/1 reject: unsupported-version at ingest, excluded from observation and analysis", async () => {
    const ctx = makeContext(ISOLATION_SEED + 16);
    await buildOccReject(ctx);
    await buildControl(ctx);
    const { result } = await buildAndAudit(ctx);
    assertExactCodes(result, ctx, "occ1");
    assert.equal(result.ingest.unsupportedVersions.length, 1);
    assert.equal(result.ingest.unsupportedVersions[0]?.version, "occ/1");
    assert.ok(result.ingest.unsupportedVersions[0]?.path.includes("legacy.json"));
    // Rejected inputs are not observed objects and join no partition.
    assert.equal(result.ingest.counts.observed, ctx.expectedObserved);
  });
});

// ---------------------------------------------------------------------------
// Property loop: random topologies across fixed seeds.
// ---------------------------------------------------------------------------

describe("audit property tests: random topologies across fixed seeds", () => {
  for (const seed of PROPERTY_SEEDS) {
    it(`seed 0x${seed.toString(16)}: exactly the injected anomaly codes appear`, async () => {
      const ctx = makeContext(seed);
      // Always a control chain; each mutation class joins with p = 0.5.
      // Selection draws happen BEFORE any builder runs so the include/skip
      // pattern is a pure function of the seed.
      const included = MUTATIONS.map(() => ctx.rng() < 0.5);
      await buildControl(ctx);
      for (let i = 0; i < MUTATIONS.length; i++) {
        if (included[i] === true) await MUTATIONS[i]![1](ctx);
      }
      const { result } = await buildAndAudit(ctx);
      const label = `seed 0x${seed.toString(16)} [${MUTATIONS.filter((_, i) => included[i]).map(([n]) => n).join(", ")}]`;
      assertExactCodes(result, ctx, label);
    });
  }

  it("determinism: the same seed regenerated twice yields identical reports modulo runMetadata", async () => {
    const build = async (): Promise<{ report: ReturnType<typeof buildJsonReport> }> => {
      const ctx = makeContext(ISOLATION_SEED + 100);
      const included = MUTATIONS.map(() => ctx.rng() < 0.5);
      await buildControl(ctx);
      for (let i = 0; i < MUTATIONS.length; i++) {
        if (included[i] === true) await MUTATIONS[i]![1](ctx);
      }
      const { result } = await buildAndAudit(ctx);
      return { report: buildJsonReport(result) };
    };

    const first = await build();
    const second = await build();
    const { runMetadata: metaA, ...restA } = first.report;
    const { runMetadata: metaB, ...restB } = second.report;
    assert.notEqual(metaA.bundlePath, metaB.bundlePath, "distinct temp dirs");
    assert.deepEqual(restA, restB, "reports deep-equal modulo runMetadata");
    assert.equal(JSON.stringify(restA), JSON.stringify(restB), "byte-equal serialization");
  });
});
