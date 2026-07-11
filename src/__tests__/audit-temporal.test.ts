// Copyright (c) Mike Argento. All rights reserved. See LICENSE.

/**
 * Temporal bounds tests: verified-witness anchors only, one-sided bounds
 * with honest semantics (not-before is grounded in block-hash
 * unpredictability; not-after is causal precedence whose wall-clock
 * reading carries an explicit freshness assumption), chain-link versus
 * counter-order evidence marked, unanchored segments reported, and
 * cross-epoch ordering only from non-overlapping covered bounds.
 */

import { describe, it, before } from "node:test";
import * as assert from "node:assert/strict";
import { keccak_256 } from "@noble/hashes/sha3";
import { sha256 } from "@noble/hashes/sha256";
import {
  deriveTemporalBounds,
  identifyAnchors,
  ingestBundle,
  reconstructChains,
  verifyAnchorWitnesses,
  verifyObservedProofs,
} from "@mikeargento/bitgraph-audit";
import type {
  IngestResult,
  ReconstructionResult,
  TemporalAnalysis,
  TemporalSegment,
} from "@mikeargento/bitgraph-audit";
import type { BitGraphProof } from "@mikeargento/bitgraph-verify";
import { computeProofHash, computeChainHash } from "@mikeargento/bitgraph-verify";
import {
  b64,
  makeAnchorProof,
  makeEthereumHeader,
  makeKey,
  makeTempDir,
  proofJson,
  signBody,
  utf8,
  witnessJson,
  writeBundleDir,
  type ManualKey,
} from "./audit-fixtures.js";

const T1 = 1_000_000;
const T2 = 2_000_000;
const T3 = 3_000_000;
const T_OVERLAP = 1_500_000;

function header(blockNumber: number, timestamp: number): { rlpHex: string; hash: string } {
  const h = makeEthereumHeader({ blockNumber, timestamp });
  return { rlpHex: h.headerRlpHex, hash: `0x${Buffer.from(keccak_256(h.headerBytes)).toString("hex")}` };
}

const H1 = header(100, T1);
const H2 = header(101, T2);
const H3 = header(102, T3);
const H4 = header(103, T_OVERLAP);

async function userProof(
  key: ManualKey,
  epochId: string,
  slot: string,
  commit: string,
  prevB64?: string
): Promise<{ proof: BitGraphProof; proofHash: string; chainHash: string }> {
  const bytes = utf8(`temporal-${epochId}-${commit}`);
  const commitBody: BitGraphProof["commit"] = {
    nonceB64: b64(crypto.getRandomValues(new Uint8Array(16))),
    counter: commit,
    slotCounter: slot,
    ...(prevB64 !== undefined ? { prevB64 } : {}),
    epochId,
  };
  (commitBody as unknown as Record<string, unknown>)["chainId"] = "bitgraph:main";
  const proof = await signBody(
    key,
    { hashAlg: "sha256", digestB64: b64(sha256(bytes)) },
    commitBody,
    "test-measurement-temporal"
  );
  return { proof, proofHash: computeProofHash(proof), chainHash: computeChainHash(proof) };
}

interface Fixture {
  ingest: IngestResult;
  reconstruction: ReconstructionResult;
  analysis: TemporalAnalysis;
  hashes: Record<string, string>;
}

let fx: Fixture;

function segmentOf(hash: string): TemporalSegment {
  const segment = fx.analysis.segments.find((s) => s.memberProofHashes.includes(hash));
  assert.ok(segment !== undefined, "every partitioned proof lands in a segment");
  return segment;
}

before(async () => {
  const hashes: Record<string, string> = {};
  const files: Record<string, string> = {};

  // Epoch E1 on one key: P1 <- A1(T1) <- P2 <- A2(T2) <- P3, plus P4 with
  // a dangling prevB64 (counter evidence only).
  const k1 = await makeKey();
  const p1 = await userProof(k1, "E1", "1", "2");
  const a1 = await makeAnchorProof({
    key: k1,
    blockHash: H1.hash,
    blockNumber: "100",
    epochId: "E1",
    counter: "4",
    slotCounter: "3",
    prevB64: p1.chainHash,
    chainId: "bitgraph:main",
  });
  const p2 = await userProof(k1, "E1", "5", "6", a1.chainHash);
  const a2 = await makeAnchorProof({
    key: k1,
    blockHash: H2.hash,
    blockNumber: "101",
    epochId: "E1",
    counter: "8",
    slotCounter: "7",
    prevB64: p2.chainHash,
    chainId: "bitgraph:main",
  });
  const p3 = await userProof(k1, "E1", "9", "10", a2.chainHash);
  const p4 = await userProof(k1, "E1", "11", "12", b64(sha256(utf8("dangling-predecessor"))));

  hashes["P1"] = p1.proofHash;
  hashes["A1"] = a1.proofHash;
  hashes["P2"] = p2.proofHash;
  hashes["A2"] = a2.proofHash;
  hashes["P3"] = p3.proofHash;
  hashes["P4"] = p4.proofHash;
  files["proofs/e1-p1.json"] = proofJson(p1.proof);
  files["proofs/e1-a1.json"] = proofJson(a1.proof);
  files["proofs/e1-p2.json"] = proofJson(p2.proof);
  files["proofs/e1-a2.json"] = proofJson(a2.proof);
  files["proofs/e1-p3.json"] = proofJson(p3.proof);
  files["proofs/e1-p4.json"] = proofJson(p4.proof);
  files["witnesses/h1.json"] = witnessJson({ headerRlpHex: H1.rlpHex, blockNumber: 100, blockHash: H1.hash });
  files["witnesses/h2.json"] = witnessJson({ headerRlpHex: H2.rlpHex, blockNumber: 101, blockHash: H2.hash });

  // Epoch E2: linked chain, no anchors at all (ordered-but-unanchored).
  const k2 = await makeKey();
  const q1 = await userProof(k2, "E2", "1", "2");
  const q2 = await userProof(k2, "E2", "3", "4", q1.chainHash);
  hashes["Q1"] = q1.proofHash;
  hashes["Q2"] = q2.proofHash;
  files["proofs/e2-q1.json"] = proofJson(q1.proof);
  files["proofs/e2-q2.json"] = proofJson(q2.proof);

  // Epoch E3: an anchor WITHOUT a witness (causal only, no wall clock).
  const k3 = await makeKey();
  const a3 = await makeAnchorProof({
    key: k3,
    blockHash: `0x${"77".repeat(32)}`,
    blockNumber: "999",
    epochId: "E3",
    counter: "2",
    slotCounter: "1",
    chainId: "bitgraph:main",
  });
  hashes["A3"] = a3.proofHash;
  files["proofs/e3-a3.json"] = proofJson(a3.proof);

  // Epoch EB: anchored at T3, all members at or after the anchor: its
  // covered lower bound sits above E1's covered upper bound (T2 < T3).
  const kb = await makeKey();
  const ab = await makeAnchorProof({
    key: kb,
    blockHash: H3.hash,
    blockNumber: "102",
    epochId: "EB",
    counter: "2",
    slotCounter: "1",
    chainId: "bitgraph:main",
  });
  const pb = await userProof(kb, "EB", "3", "4", ab.chainHash);
  hashes["AB"] = ab.proofHash;
  hashes["PB"] = pb.proofHash;
  files["proofs/eb-ab.json"] = proofJson(ab.proof);
  files["proofs/eb-pb.json"] = proofJson(pb.proof);
  files["witnesses/h3.json"] = witnessJson({ headerRlpHex: H3.rlpHex, blockNumber: 102, blockHash: H3.hash });

  // Epoch EC: anchored at T_OVERLAP (between T1 and T2): overlaps E1, so
  // no ordering pair may be asserted between E1 and EC.
  const kc = await makeKey();
  const ac = await makeAnchorProof({
    key: kc,
    blockHash: H4.hash,
    blockNumber: "103",
    epochId: "EC",
    counter: "2",
    slotCounter: "1",
    chainId: "bitgraph:main",
  });
  hashes["AC"] = ac.proofHash;
  files["proofs/ec-ac.json"] = proofJson(ac.proof);
  files["witnesses/h4.json"] = witnessJson({ headerRlpHex: H4.rlpHex, blockNumber: 103, blockHash: H4.hash });

  const dir = await makeTempDir("bg-audit-temporal-");
  await writeBundleDir(dir, files);
  const ingest = await ingestBundle(dir);
  await verifyObservedProofs(ingest);
  const reconstruction = await reconstructChains(ingest);
  const anchors = identifyAnchors(ingest);
  const witnesses = await verifyAnchorWitnesses(ingest, anchors);
  const analysis = deriveTemporalBounds(ingest, reconstruction, anchors, witnesses);

  fx = { ingest, reconstruction, analysis, hashes };
});

describe("audit temporal: verified anchors only", () => {
  it("splits anchors into verified and unverified wall-clock sources", () => {
    assert.deepEqual(
      fx.analysis.verifiedAnchorProofHashes,
      [fx.hashes["A1"], fx.hashes["A2"], fx.hashes["AB"], fx.hashes["AC"]].sort()
    );
    assert.deepEqual(fx.analysis.unverifiedAnchorProofHashes, [fx.hashes["A3"] as string]);
  });

  it("an anchor without a verified witness confers no bounds", () => {
    const segment = segmentOf(fx.hashes["A3"] as string);
    assert.equal(segment.status, "ordered-but-unanchored");
    assert.equal(segment.lowerBounds.length, 0);
    assert.equal(segment.upperBounds.length, 0);
  });
});

describe("audit temporal: one-sided bounds and brackets along chain links", () => {
  it("proofs before the first anchor get only a not-after bound", () => {
    const segment = segmentOf(fx.hashes["P1"] as string);
    assert.equal(segment.status, "upper-bounded");
    assert.equal(segment.lowerBounds.length, 0);
    assert.equal(segment.upperBounds.length, 1);
    const bound = segment.upperBounds[0]!;
    assert.equal(bound.kind, "not-after");
    assert.equal(bound.anchorProofHash, fx.hashes["A1"]);
    assert.equal(bound.timestamp, T1);
    assert.equal(bound.evidence, "chain-link");
    assert.equal(bound.weaker, false);
    assert.equal(bound.basis, "causal-precedence");
    assert.match(bound.claim, /assumes the anchor consumed a recently published block/);
  });

  it("proofs between two verified anchors are bracketed by the tightest pair", () => {
    const segment = segmentOf(fx.hashes["P2"] as string);
    assert.equal(segment.status, "bracketed");
    // A1 shares the identical bound set (its own block for the lower
    // side, A2 for the upper) and groups into the same segment.
    assert.ok(segment.memberProofHashes.includes(fx.hashes["A1"] as string));
    const lower = segment.lowerBounds[0]!;
    assert.equal(lower.kind, "not-before");
    assert.equal(lower.anchorProofHash, fx.hashes["A1"]);
    assert.equal(lower.timestamp, T1);
    assert.equal(lower.evidence, "chain-link");
    assert.equal(lower.basis, "block-hash-unpredictability");
    assert.match(lower.claim, /no earlier than/);
    // The not-before claim carries the genuine-public-block assumption: the
    // offline audit cannot confirm the anchored header is a real Ethereum
    // block (no proof-of-work, consensus, or chain-membership check).
    assert.match(lower.claim, /genuine, publicly published Ethereum block/);
    const upper = segment.upperBounds[0]!;
    assert.equal(upper.anchorProofHash, fx.hashes["A2"]);
    assert.equal(upper.timestamp, T2);
  });

  it("proofs after the last anchor get only the tightest not-before bound", () => {
    const segment = segmentOf(fx.hashes["P3"] as string);
    assert.equal(segment.status, "lower-bounded");
    assert.equal(segment.upperBounds.length, 0);
    const bound = segment.lowerBounds[0]!;
    assert.equal(bound.anchorProofHash, fx.hashes["A2"], "tightest lower is the latest anchor");
    assert.equal(bound.timestamp, T2);
    assert.equal(bound.evidence, "chain-link");
  });
});

describe("audit temporal: counter-only evidence is weaker and marked", () => {
  it("a chain-broken proof falls back to counter ordering", () => {
    const segment = segmentOf(fx.hashes["P4"] as string);
    assert.equal(segment.status, "lower-bounded");
    const bound = segment.lowerBounds[0]!;
    assert.equal(bound.evidence, "counter-order");
    assert.equal(bound.weaker, true);
    assert.equal(bound.anchorProofHash, fx.hashes["A2"]);
    assert.equal(bound.timestamp, T2);
    assert.match(bound.claim, /counter discipline/);
  });
});

describe("audit temporal: unanchored segments", () => {
  it("a partition with no verified anchor evidence is ordered-but-unanchored", () => {
    const segment = segmentOf(fx.hashes["Q1"] as string);
    assert.equal(segment.status, "ordered-but-unanchored");
    assert.ok(segment.memberProofHashes.includes(fx.hashes["Q2"] as string));
    assert.equal(segment.lowerBounds.length, 0);
    assert.equal(segment.upperBounds.length, 0);
  });
});

describe("audit temporal: epoch bounds and cross-epoch ordering", () => {
  it("populates EpochRecord.anchorBounds with covered one-sided bounds", () => {
    const epochs = new Map(
      fx.reconstruction.epochRelationships.epochs.map((e) => [e.epochId, e])
    );
    const e1 = epochs.get("E1")!;
    assert.ok(e1.anchorBounds !== undefined);
    const notBefore = e1.anchorBounds.find((b) => b.kind === "not-before")!;
    assert.equal(notBefore.witnessTimestamp, T1, "conservative representative: minimum lower bound");
    assert.equal(notBefore.coverage, "members-after-anchor");
    assert.equal(notBefore.coveredProofCount, 5, "A1, P2, A2, P3 by chain, P4 by counter");
    assert.equal(notBefore.totalProofCount, 6);
    const notAfter = e1.anchorBounds.find((b) => b.kind === "not-after")!;
    assert.equal(notAfter.witnessTimestamp, T2, "conservative representative: maximum upper bound");
    assert.equal(notAfter.coverage, "members-before-anchor");
    assert.equal(notAfter.coveredProofCount, 3, "P1, A1, P2");
    assert.match(notAfter.claim as string, /assumes the anchor consumed a recently published block/);

    const eb = epochs.get("EB")!;
    assert.ok(eb.anchorBounds !== undefined);
    assert.equal(eb.anchorBounds.length, 1);
    assert.equal(eb.anchorBounds[0]!.kind, "not-before");

    assert.equal(epochs.get("E2")!.anchorBounds, undefined, "no verified evidence, no bounds");
  });

  it("derives covered-portion ordering only from non-overlapping bounds", () => {
    // E1's covered upper bound (T2) sits strictly below EB's covered
    // lower bound (T3): one assumption-dependent pair. EC overlaps E1
    // (T_OVERLAP < T2) so no pair is asserted in either direction, and
    // overlap is never divergence.
    assert.equal(fx.analysis.anchorOrderedPairs.length, 1);
    const pair = fx.analysis.anchorOrderedPairs[0]!;
    assert.equal(pair.beforeEpochId, "E1");
    assert.equal(pair.afterEpochId, "EB");
    assert.equal(pair.upperBoundTimestamp, T2);
    assert.equal(pair.lowerBoundTimestamp, T3);
    assert.equal(pair.assumptionDependent, true);
    assert.equal(pair.beforeCoveredProofCount, 3);
    assert.equal(pair.beforeTotalProofCount, 6);
    assert.equal(pair.afterCoveredProofCount, 2);
    assert.equal(pair.afterTotalProofCount, 2);
    assert.match(pair.note, /covered portions only/);
    // The existing E1 -> EB pair rests on chain-link evidence on both sides.
    assert.equal(pair.upperEvidence, "chain-link");
    assert.equal(pair.lowerEvidence, "chain-link");
    assert.equal(pair.weaker, false);
  });
});

describe("audit temporal: cross-epoch ordering carries its evidence class", () => {
  it("a pair whose before-side rests on counter-order is marked weaker with the caveat", async () => {
    const T_LOW = 2_000_000;
    const T_HIGH = 3_000_000;
    const hLow = header(200, T_LOW);
    const hHigh = header(201, T_HIGH);

    // Epoch WA: a user proof PW (lower counter, no chain link to the
    // anchor) plus a genesis anchor AW. PW is bounded not-after AW only by
    // commit-counter ordering, so WA's covered not-after rests on the
    // weaker evidence class.
    const ka = await makeKey();
    const pw = await userProof(ka, "WA", "1", "2"); // genesis, counter 2
    const aw = await makeAnchorProof({
      key: ka,
      blockHash: hLow.hash,
      blockNumber: "200",
      epochId: "WA",
      counter: "10",
      slotCounter: "9",
      chainId: "bitgraph:main",
    });

    // Epoch WB: an anchor AB and its chain-linked successor PB, both
    // bounded not-before AB by a verified hash-link path.
    const kb = await makeKey();
    const ab = await makeAnchorProof({
      key: kb,
      blockHash: hHigh.hash,
      blockNumber: "201",
      epochId: "WB",
      counter: "2",
      slotCounter: "1",
      chainId: "bitgraph:main",
    });
    const pb = await userProof(kb, "WB", "3", "4", ab.chainHash);

    const dir = await makeTempDir("bg-audit-temporal-weaker-");
    await writeBundleDir(dir, {
      "proofs/wa-pw.json": proofJson(pw.proof),
      "proofs/wa-aw.json": proofJson(aw.proof),
      "proofs/wb-ab.json": proofJson(ab.proof),
      "proofs/wb-pb.json": proofJson(pb.proof),
      "witnesses/low.json": witnessJson({
        headerRlpHex: hLow.rlpHex,
        blockNumber: 200,
        blockHash: hLow.hash,
      }),
      "witnesses/high.json": witnessJson({
        headerRlpHex: hHigh.rlpHex,
        blockNumber: 201,
        blockHash: hHigh.hash,
      }),
    });
    const ingest = await ingestBundle(dir);
    await verifyObservedProofs(ingest);
    const reconstruction = await reconstructChains(ingest);
    const anchors = identifyAnchors(ingest);
    const witnesses = await verifyAnchorWitnesses(ingest, anchors);
    const analysis = deriveTemporalBounds(ingest, reconstruction, anchors, witnesses);

    // Exactly one cross-epoch ordering pair, WA before WB, marked weaker
    // because the before side (WA's covered not-after) rests on
    // counter-order evidence.
    assert.equal(analysis.anchorOrderedPairs.length, 1);
    const pair = analysis.anchorOrderedPairs[0]!;
    assert.equal(pair.beforeEpochId, "WA");
    assert.equal(pair.afterEpochId, "WB");
    assert.equal(pair.upperEvidence, "counter-order");
    assert.equal(pair.lowerEvidence, "chain-link");
    assert.equal(pair.weaker, true);
    assert.match(pair.note, /weaker evidence/);

    // WA's covered not-after epoch bound carries the evidence class and the
    // weaker-evidence caveat in its own claim string (so the JSON report
    // and the markdown both state it).
    const wa = reconstruction.epochRelationships.epochs.find((e) => e.epochId === "WA");
    assert.ok(wa?.anchorBounds !== undefined);
    const notAfter = wa.anchorBounds.find((b) => b.kind === "not-after");
    assert.ok(notAfter !== undefined);
    assert.equal(notAfter.evidence, "counter-order");
    assert.equal(notAfter.weaker, true);
    assert.match(notAfter.claim as string, /weaker evidence/);
  });
});
