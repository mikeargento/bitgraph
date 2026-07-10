// Copyright (c) 2024-2026 Mike Argento. Licensed under the MIT License. See LICENSE.

/**
 * bitgraph-audit temporal bounds
 *
 * Turns verified anchor witnesses into one-sided wall-clock bounds on
 * segments of the observed record. Only anchors with a VERIFIED witness
 * (witness.ts) contribute: an anchor without one still establishes causal
 * order, but confers no wall-clock evidence. Nothing here reads a block
 * number as a time, an unsigned metadata timestamp, or a manifest time.
 *
 * Bound semantics, stated once and enforced everywhere:
 *
 *   not-before (lower bound): a proof causally AFTER an anchor that
 *   consumed the hash of a block published at time T was COMMITTED no
 *   earlier than T. Grounded in block-hash unpredictability: the hash did
 *   not exist before T and the covered proofs embed it through the chain.
 *   This additionally assumes the anchored header is a genuine, publicly
 *   published Ethereum block, which this offline audit cannot confirm: it
 *   checks the header's structure and hash binding, not proof-of-work,
 *   consensus, or chain membership. Every not-before claim states that
 *   assumption. Sound along chain-link evidence, subject to it.
 *
 *   not-after (upper bound): a proof causally BEFORE an anchor existed
 *   before that anchor's commit, and the consumed block proves the commit
 *   came AT OR AFTER its timestamp T, not how promptly. Reading T as a
 *   wall-clock ceiling therefore additionally assumes the anchor consumed
 *   a recently published block. The deployed anchor service commits the
 *   latest block on a short interval, but that is service behavior, not
 *   proof; the assumption is stated on every not-after bound and on every
 *   cross-epoch ordering derived from one. This is a deliberate
 *   correction toward honesty over the looser "existed by T" phrasing:
 *   the anchor mechanism is inbound-only (a block hash committed INTO the
 *   chain), and an inbound commitment cannot cryptographically upper-bound
 *   prior events.
 *
 * Evidence classes: a bound holds along a verified prevB64 hash-link path
 * ("chain-link") or, weaker, by commit-counter ordering within the same
 * partition ("counter-order", which relies on the authority's counter
 * discipline rather than verifiable links). Every bound record states
 * which class supports it. Bounds never cross partitions; epoch-level
 * aggregation only collects the per-partition results.
 *
 * Bounds attach to segments, never to individual proofs, and a one-sided
 * bound is never presented as an interval. Segments with no verified
 * anchor evidence are ordered-but-unanchored. Cross-epoch ordering pairs
 * are evidence, never divergence; overlapping or absent bounds mean
 * concurrent-or-unordered.
 *
 * Run after verifyObservedProofs, reconstructChains, identifyAnchors, and
 * verifyAnchorWitnesses. Populates EpochRecord.anchorBounds on the given
 * reconstruction (the typed Phase 4c extension point) and returns the
 * segment-level analysis.
 */

import type {
  AnchorIdentification,
  AnchorOrderedPair,
  AnchorWitnessAnalysis,
  BoundEvidence,
  ChainPartition,
  EpochAnchorBound,
  IngestResult,
  ObservedProof,
  ReconstructionResult,
  SegmentBound,
  TemporalAnalysis,
  TemporalSegment,
} from "./types.js";
import { byCounterThenHash, parseCounter, pushMap } from "./validity.js";

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export function deriveTemporalBounds(
  ingest: IngestResult,
  reconstruction: ReconstructionResult,
  identification: AnchorIdentification,
  witnessAnalysis: AnchorWitnessAnalysis
): TemporalAnalysis {
  const byHash = new Map<string, ObservedProof>(ingest.proofs.map((p) => [p.proofHash, p]));

  // Verified wall-clock evidence per anchor. Multiple verified witnesses
  // for one anchor are necessarily identical (the hash comparison pins
  // the exact header bytes); the first is kept.
  const evidence = new Map<string, VerifiedAnchorEvidence>();
  for (const outcome of witnessAnalysis.outcomes) {
    if (!outcome.verified || outcome.anchorProofHash === undefined) continue;
    if (evidence.has(outcome.anchorProofHash)) continue;
    evidence.set(outcome.anchorProofHash, {
      anchorProofHash: outcome.anchorProofHash,
      timestamp: outcome.timestamp as number,
      blockHash: outcome.computedBlockHash as string,
      ...(outcome.blockNumber !== undefined ? { blockNumber: outcome.blockNumber } : {}),
    });
  }

  const verifiedAnchorProofHashes = [...evidence.keys()].sort();
  const unverifiedAnchorProofHashes = identification.anchors
    .map((a) => a.proofHash)
    .filter((h) => !evidence.has(h))
    .sort();

  // Per-partition segments.
  const segments: TemporalSegment[] = [];
  for (const partition of reconstruction.partitions) {
    segments.push(...buildPartitionSegments(partition, byHash, evidence));
  }

  // Epoch-level aggregation and cross-epoch ordering.
  const anchorOrderedPairs = aggregateEpochs(reconstruction, segments);

  return {
    segments,
    anchorOrderedPairs,
    verifiedAnchorProofHashes,
    unverifiedAnchorProofHashes,
  };
}

interface VerifiedAnchorEvidence {
  anchorProofHash: string;
  timestamp: number;
  blockHash: string;
  blockNumber?: string;
}

// ---------------------------------------------------------------------------
// Per-partition bound computation
// ---------------------------------------------------------------------------

interface MemberBounds {
  member: ObservedProof;
  lower: SegmentBound[];
  upper: SegmentBound[];
}

function buildPartitionSegments(
  partition: ChainPartition,
  byHash: Map<string, ObservedProof>,
  evidence: Map<string, VerifiedAnchorEvidence>
): TemporalSegment[] {
  const members = partition.memberProofHashes.map((h) => byHash.get(h) as ObservedProof);
  const memberSet = new Map<string, ObservedProof>(members.map((m) => [m.proofHash, m]));

  const anchors = members.filter((m) => evidence.has(m.proofHash));

  // Hash-link structure within the partition.
  const successors = new Map<string, ObservedProof[]>();
  for (const m of members) {
    if (m.prevB64 === undefined) continue;
    const pred = memberSet.get(m.prevB64);
    if (pred === undefined || pred.proofHash === m.proofHash) continue;
    pushMap(successors, pred.proofHash, m);
  }

  // For each verified anchor: members causally after it (descendants via
  // hash links) and causally before it (ancestors via the prevB64 walk).
  const chainAfter = new Map<string, Set<string>>();
  const chainBefore = new Map<string, Set<string>>();
  for (const anchor of anchors) {
    chainAfter.set(anchor.proofHash, collectDescendants(anchor, successors));
    chainBefore.set(anchor.proofHash, collectAncestors(anchor, memberSet));
  }

  // Candidate bounds per member.
  const memberBounds: MemberBounds[] = members.map((member) => {
    const lowerCandidates = new Map<string, BoundEvidence>();
    const upperCandidates = new Map<string, BoundEvidence>();
    const memberCounter = parseCounter(member.counter);

    for (const anchor of anchors) {
      const anchorHash = anchor.proofHash;
      const anchorCounter = parseCounter(anchor.counter);

      // Lower (not-before): the anchor itself consumed the block hash, so
      // it is its own strongest lower bound; descendants inherit through
      // the chain; counter ordering is the weaker fallback.
      if (member.proofHash === anchorHash || (chainAfter.get(anchorHash) as Set<string>).has(member.proofHash)) {
        lowerCandidates.set(anchorHash, "chain-link");
      } else if (
        memberCounter !== undefined &&
        anchorCounter !== undefined &&
        memberCounter > anchorCounter
      ) {
        if (!lowerCandidates.has(anchorHash)) lowerCandidates.set(anchorHash, "counter-order");
      }

      // Upper (not-after): members the anchor's chain state commits to;
      // counter ordering as the weaker fallback. Never from the anchor to
      // itself.
      if ((chainBefore.get(anchorHash) as Set<string>).has(member.proofHash)) {
        upperCandidates.set(anchorHash, "chain-link");
      } else if (
        member.proofHash !== anchorHash &&
        memberCounter !== undefined &&
        anchorCounter !== undefined &&
        memberCounter < anchorCounter
      ) {
        if (!upperCandidates.has(anchorHash)) upperCandidates.set(anchorHash, "counter-order");
      }
    }

    return {
      member,
      lower: selectBounds("not-before", lowerCandidates, evidence),
      upper: selectBounds("not-after", upperCandidates, evidence),
    };
  });

  // Group members sharing an identical bound set into segments.
  const groups = new Map<string, MemberBounds[]>();
  for (const mb of memberBounds) {
    pushMap(groups, boundSetKey(mb), mb);
  }

  const segments: TemporalSegment[] = [];
  for (const group of groups.values()) {
    const groupMembers = group.map((g) => g.member).sort(byCounterThenHash);
    const first = group[0] as MemberBounds;
    const lowerBounds = first.lower;
    const upperBounds = first.upper;
    const status =
      lowerBounds.length > 0 && upperBounds.length > 0
        ? ("bracketed" as const)
        : lowerBounds.length > 0
          ? ("lower-bounded" as const)
          : upperBounds.length > 0
            ? ("upper-bounded" as const)
            : ("ordered-but-unanchored" as const);

    const range = positionRange(groupMembers);
    segments.push({
      partition: partition.key,
      memberProofHashes: groupMembers.map((m) => m.proofHash),
      ...(range !== undefined ? { positionRange: range } : {}),
      status,
      lowerBounds,
      upperBounds,
    });
  }

  segments.sort(compareSegments);
  return segments;
}

/**
 * Select the reported bounds from the candidate set: the tightest bound
 * overall (max timestamp for not-before, min for not-after), plus the
 * tightest chain-link bound when the overall tightest rests only on
 * counter ordering. At most two entries, tightest first.
 */
function selectBounds(
  kind: "not-before" | "not-after",
  candidates: Map<string, BoundEvidence>,
  evidence: Map<string, VerifiedAnchorEvidence>
): SegmentBound[] {
  if (candidates.size === 0) return [];

  const entries = [...candidates.entries()].map(([anchorHash, evidenceKind]) => ({
    anchorHash,
    evidenceKind,
    info: evidence.get(anchorHash) as VerifiedAnchorEvidence,
  }));

  const better = (
    a: (typeof entries)[number],
    b: (typeof entries)[number] | undefined
  ): boolean => {
    if (b === undefined) return true;
    if (a.info.timestamp !== b.info.timestamp) {
      return kind === "not-before"
        ? a.info.timestamp > b.info.timestamp
        : a.info.timestamp < b.info.timestamp;
    }
    // Tie: prefer chain-link evidence, then the lower anchor hash.
    if (a.evidenceKind !== b.evidenceKind) return a.evidenceKind === "chain-link";
    return a.anchorHash < b.anchorHash;
  };

  let best: (typeof entries)[number] | undefined;
  let bestChain: (typeof entries)[number] | undefined;
  for (const entry of entries) {
    if (better(entry, best)) best = entry;
    if (entry.evidenceKind === "chain-link" && better(entry, bestChain)) bestChain = entry;
  }

  const bounds: SegmentBound[] = [makeBound(kind, best as (typeof entries)[number])];
  if (
    bestChain !== undefined &&
    ((best as (typeof entries)[number]).anchorHash !== bestChain.anchorHash ||
      (best as (typeof entries)[number]).evidenceKind !== "chain-link")
  ) {
    bounds.push(makeBound(kind, bestChain));
  }
  return bounds;
}

function makeBound(
  kind: "not-before" | "not-after",
  entry: { anchorHash: string; evidenceKind: BoundEvidence; info: VerifiedAnchorEvidence }
): SegmentBound {
  const { info, evidenceKind } = entry;
  const iso = new Date(info.timestamp * 1000).toISOString();
  const blockName =
    info.blockNumber !== undefined ? `Ethereum block ${info.blockNumber}` : "an Ethereum block";
  const evidenceSentence =
    evidenceKind === "chain-link"
      ? "Evidence: a verified hash-link path connects these proofs and the anchor."
      : "Evidence: commit-counter ordering within the partition only, which relies on the " +
        "authority's counter discipline rather than verifiable hash links (weaker).";
  const claim =
    kind === "not-before"
      ? `These proofs were committed no earlier than ${iso} (unix ${info.timestamp}), the ` +
        `timestamp of ${blockName}: the block hash was unpredictable before that time and the ` +
        `anchor commit consumed it. Reading this as a wall-clock floor additionally assumes the ` +
        `anchored header is a genuine, publicly published Ethereum block: this offline audit checks ` +
        `the header's structure and hash binding, not proof-of-work, consensus, or chain membership, ` +
        `so it cannot confirm the block is real. ${evidenceSentence}`
      : `These proofs existed before the anchor commit that consumed the hash of ${blockName} ` +
        `(block timestamp ${iso}, unix ${info.timestamp}). The block timestamp proves the anchor ` +
        `commit came at or after it, not how promptly; reading it as a wall-clock ceiling ` +
        `additionally assumes the anchor consumed a recently published block. ${evidenceSentence}`;

  return {
    kind,
    anchorProofHash: entry.anchorHash,
    ...(info.blockNumber !== undefined ? { blockNumber: info.blockNumber } : {}),
    blockHash: info.blockHash,
    timestamp: info.timestamp,
    evidence: evidenceKind,
    weaker: evidenceKind === "counter-order",
    basis: kind === "not-before" ? "block-hash-unpredictability" : "causal-precedence",
    claim,
  };
}

function boundSetKey(mb: MemberBounds): string {
  const part = (bounds: SegmentBound[]): string =>
    bounds.map((b) => `${b.anchorProofHash}:${b.evidence}`).join(",");
  return `${part(mb.lower)}|${part(mb.upper)}`;
}

function collectDescendants(
  anchor: ObservedProof,
  successors: Map<string, ObservedProof[]>
): Set<string> {
  const reached = new Set<string>();
  const stack = [...(successors.get(anchor.proofHash) ?? [])];
  while (stack.length > 0) {
    const node = stack.pop() as ObservedProof;
    if (reached.has(node.proofHash)) continue;
    reached.add(node.proofHash);
    for (const next of successors.get(node.proofHash) ?? []) stack.push(next);
  }
  return reached;
}

function collectAncestors(
  anchor: ObservedProof,
  memberSet: Map<string, ObservedProof>
): Set<string> {
  const reached = new Set<string>();
  let cursor: ObservedProof | undefined = anchor;
  while (cursor !== undefined && cursor.prevB64 !== undefined) {
    const pred: ObservedProof | undefined = memberSet.get(cursor.prevB64);
    if (pred === undefined || reached.has(pred.proofHash) || pred.proofHash === anchor.proofHash) {
      break;
    }
    reached.add(pred.proofHash);
    cursor = pred;
  }
  return reached;
}

function positionRange(
  members: ObservedProof[]
): { min: string; max: string } | undefined {
  let min: bigint | undefined;
  let max: bigint | undefined;
  for (const m of members) {
    for (const value of [m.counter, m.slotCounter]) {
      const n = parseCounter(value);
      if (n === undefined) continue;
      if (min === undefined || n < min) min = n;
      if (max === undefined || n > max) max = n;
    }
  }
  return min !== undefined && max !== undefined
    ? { min: String(min), max: String(max) }
    : undefined;
}

function compareSegments(a: TemporalSegment, b: TemporalSegment): number {
  const ma = a.positionRange?.min;
  const mb = b.positionRange?.min;
  if (ma !== undefined && mb !== undefined && ma !== mb) {
    return BigInt(ma) < BigInt(mb) ? -1 : 1;
  }
  if (ma !== undefined && mb === undefined) return -1;
  if (ma === undefined && mb !== undefined) return 1;
  const ha = a.memberProofHashes[0] ?? "";
  const hb = b.memberProofHashes[0] ?? "";
  return ha < hb ? -1 : ha > hb ? 1 : 0;
}

// ---------------------------------------------------------------------------
// Epoch aggregation and cross-epoch ordering
// ---------------------------------------------------------------------------

interface CoverageRepresentative {
  timestamp: number;
  anchorProofHash: string;
  blockHash: string;
  blockNumber?: string;
  /** Evidence class of the bound chosen as the conservative representative. */
  evidence: BoundEvidence;
  /** True when that representative rests on counter-order evidence. */
  weaker: boolean;
}

interface EpochCoverage {
  totalProofCount: number;
  /** Distinct members covered by any not-before bound, and the most conservative (minimum) covering timestamp. */
  lowerCovered: Set<string>;
  lowerMin?: CoverageRepresentative;
  /** Distinct members covered by any not-after bound, and the most conservative (maximum) covering timestamp. */
  upperCovered: Set<string>;
  upperMax?: CoverageRepresentative;
}

/**
 * Populate EpochRecord.anchorBounds and derive covered-portion ordering
 * pairs.
 *
 * The epoch-level not-before is the MINIMUM timestamp over the members'
 * lower bounds (every covered member is not-before at least that), and
 * the epoch-level not-after is the MAXIMUM over the members' upper bounds
 * (every covered member existed before an anchor commit at or after that).
 * These conservative representatives make the cross-epoch comparison
 * sound for the covered portions: epoch A's not-after strictly below
 * epoch B's not-before orders the covered portion of A before the covered
 * portion of B, subject to the not-after freshness assumption.
 */
/** Sentence appended to an epoch-level claim when its representative bound rests on counter-order evidence. */
function weakerCaveat(weaker: boolean): string {
  return weaker
    ? " The representative bound rests on commit-counter ordering rather than a verified hash-link " +
        "path, which relies on the authority's counter discipline (weaker evidence)."
    : "";
}

function aggregateEpochs(
  reconstruction: ReconstructionResult,
  segments: TemporalSegment[]
): AnchorOrderedPair[] {
  const coverage = new Map<string, EpochCoverage>();
  for (const epoch of reconstruction.epochRelationships.epochs) {
    coverage.set(epoch.epochId, {
      totalProofCount: epoch.proofCount,
      lowerCovered: new Set(),
      upperCovered: new Set(),
    });
  }

  for (const segment of segments) {
    const epochId = segment.partition.epochId;
    if (epochId === undefined) continue;
    const cov = coverage.get(epochId);
    if (cov === undefined) continue;

    // The tightest bound is entry 0 by construction; every listed bound
    // covers the members, so the conservative representative scans all.
    // Conservative representative: minimum timestamp for not-before. At an
    // equal timestamp, prefer chain-link evidence so the epoch bound is
    // never marked weaker when a hash-link bound justifies the same time.
    for (const bound of segment.lowerBounds) {
      for (const h of segment.memberProofHashes) cov.lowerCovered.add(h);
      if (
        cov.lowerMin === undefined ||
        bound.timestamp < cov.lowerMin.timestamp ||
        (bound.timestamp === cov.lowerMin.timestamp && cov.lowerMin.weaker && !bound.weaker)
      ) {
        cov.lowerMin = {
          timestamp: bound.timestamp,
          anchorProofHash: bound.anchorProofHash,
          blockHash: bound.blockHash,
          ...(bound.blockNumber !== undefined ? { blockNumber: bound.blockNumber } : {}),
          evidence: bound.evidence,
          weaker: bound.weaker,
        };
      }
    }
    // Maximum timestamp for not-after, same chain-link tie preference.
    for (const bound of segment.upperBounds) {
      for (const h of segment.memberProofHashes) cov.upperCovered.add(h);
      if (
        cov.upperMax === undefined ||
        bound.timestamp > cov.upperMax.timestamp ||
        (bound.timestamp === cov.upperMax.timestamp && cov.upperMax.weaker && !bound.weaker)
      ) {
        cov.upperMax = {
          timestamp: bound.timestamp,
          anchorProofHash: bound.anchorProofHash,
          blockHash: bound.blockHash,
          ...(bound.blockNumber !== undefined ? { blockNumber: bound.blockNumber } : {}),
          evidence: bound.evidence,
          weaker: bound.weaker,
        };
      }
    }
  }

  // Populate EpochRecord.anchorBounds (the Phase 4c extension point).
  for (const epoch of reconstruction.epochRelationships.epochs) {
    const cov = coverage.get(epoch.epochId) as EpochCoverage;
    const bounds: EpochAnchorBound[] = [];
    if (cov.lowerMin !== undefined) {
      bounds.push({
        kind: "not-before",
        anchorProofHash: cov.lowerMin.anchorProofHash,
        ...(cov.lowerMin.blockNumber !== undefined ? { blockNumber: cov.lowerMin.blockNumber } : {}),
        blockHash: cov.lowerMin.blockHash,
        witnessTimestamp: cov.lowerMin.timestamp,
        coverage: "members-after-anchor",
        coveredProofCount: cov.lowerCovered.size,
        totalProofCount: cov.totalProofCount,
        basis: "block-hash-unpredictability",
        evidence: cov.lowerMin.evidence,
        weaker: cov.lowerMin.weaker,
        claim:
          `${cov.lowerCovered.size} of ${cov.totalProofCount} observed proofs of this epoch were ` +
          `committed no earlier than unix ${cov.lowerMin.timestamp}, grounded in block-hash ` +
          `unpredictability through verified anchor witnesses. This additionally assumes the anchored ` +
          `header is a genuine, publicly published Ethereum block, which this offline audit cannot ` +
          `confirm.` +
          weakerCaveat(cov.lowerMin.weaker) +
          ` The remaining proofs sit causally before the covering anchors and carry no lower bound ` +
          `from this evidence.`,
      });
    }
    if (cov.upperMax !== undefined) {
      bounds.push({
        kind: "not-after",
        anchorProofHash: cov.upperMax.anchorProofHash,
        ...(cov.upperMax.blockNumber !== undefined ? { blockNumber: cov.upperMax.blockNumber } : {}),
        blockHash: cov.upperMax.blockHash,
        witnessTimestamp: cov.upperMax.timestamp,
        coverage: "members-before-anchor",
        coveredProofCount: cov.upperCovered.size,
        totalProofCount: cov.totalProofCount,
        basis: "causal-precedence",
        evidence: cov.upperMax.evidence,
        weaker: cov.upperMax.weaker,
        claim:
          `${cov.upperCovered.size} of ${cov.totalProofCount} observed proofs of this epoch ` +
          `existed before an anchor commit that consumed a block published at unix ` +
          `${cov.upperMax.timestamp}. Reading that timestamp as a wall-clock ceiling additionally ` +
          `assumes the anchor consumed a recently published block; the causal precedence itself ` +
          `is verified.` +
          weakerCaveat(cov.upperMax.weaker) +
          ` Proofs after the covering anchors are not covered.`,
      });
    }
    if (bounds.length > 0) epoch.anchorBounds = bounds;
  }

  // Covered-portion ordering pairs. Strict inequality: equal timestamps
  // order nothing. Overlaps produce no pair (concurrent-or-unordered),
  // never divergence.
  const pairs: AnchorOrderedPair[] = [];
  const epochs = reconstruction.epochRelationships.epochs;
  for (const before of epochs) {
    const covA = coverage.get(before.epochId) as EpochCoverage;
    if (covA.upperMax === undefined) continue;
    for (const after of epochs) {
      if (after.epochId === before.epochId) continue;
      const covB = coverage.get(after.epochId) as EpochCoverage;
      if (covB.lowerMin === undefined) continue;
      if (covA.upperMax.timestamp >= covB.lowerMin.timestamp) continue;
      const upperEvidence = covA.upperMax.evidence;
      const lowerEvidence = covB.lowerMin.evidence;
      const weaker = covA.upperMax.weaker || covB.lowerMin.weaker;
      pairs.push({
        beforeEpochId: before.epochId,
        afterEpochId: after.epochId,
        upperAnchorProofHash: covA.upperMax.anchorProofHash,
        upperBoundTimestamp: covA.upperMax.timestamp,
        lowerAnchorProofHash: covB.lowerMin.anchorProofHash,
        lowerBoundTimestamp: covB.lowerMin.timestamp,
        basis: "anchor-bounds",
        assumptionDependent: true,
        upperEvidence,
        lowerEvidence,
        weaker,
        beforeCoveredProofCount: covA.upperCovered.size,
        beforeTotalProofCount: covA.totalProofCount,
        afterCoveredProofCount: covB.lowerCovered.size,
        afterTotalProofCount: covB.totalProofCount,
        note:
          `The anchor-covered portion of epoch ${before.epochId} ` +
          `(${covA.upperCovered.size} of ${covA.totalProofCount} proofs) precedes the ` +
          `anchor-covered portion of epoch ${after.epochId} ` +
          `(${covB.lowerCovered.size} of ${covB.totalProofCount} proofs): the first is bounded ` +
          `not-after unix ${covA.upperMax.timestamp} and the second not-before unix ` +
          `${covB.lowerMin.timestamp}. One-sided evidence about the covered portions only; the ` +
          `not-after side rests on the anchor-freshness assumption documented on its bound.` +
          (weaker
            ? ` At least one side rests on commit-counter ordering rather than a verified hash-link ` +
              `path (weaker evidence), which relies on the authority's counter discipline.`
            : "") +
          ` This is ordering evidence, never divergence.`,
      });
    }
  }
  pairs.sort((a, b) =>
    a.beforeEpochId !== b.beforeEpochId
      ? a.beforeEpochId < b.beforeEpochId
        ? -1
        : 1
      : a.afterEpochId < b.afterEpochId
        ? -1
        : a.afterEpochId > b.afterEpochId
          ? 1
          : 0
  );
  return pairs;
}
