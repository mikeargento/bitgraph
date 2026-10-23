// Copyright (c) 2024-2026 Argento Computing Inc. Licensed under the MIT License. See LICENSE.

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
 * Base floors (enclave v10). A proof that signs a Base block as its floor
 * (commit.slotFloor, read through floors.ts and signedFloorOf) is bounded
 * NOT-BEFORE by that block, with evidence "signed-floor": the proof's own
 * signed field. Proofs after it in the chain inherit the bound like an
 * anchor's ("chain-link", or "counter-order", weaker). A floor never gives a
 * not-after, to any proof: a later proof's floor block can predate this
 * proof. Floors count toward an epoch's lower-bound coverage; cross-epoch
 * ordering pairs stay anchor-only (a pair needs a not-after, which only an
 * anchor supplies, and the after side is read from anchor bounds alone, so
 * no ordering is ever claimed from floors). Proofs without slotFloor are not
 * touched: a bundle from before the cutover yields exactly the bounds it did.
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
import { baseFloorTimeSentence, readSignedFloors, type FloorEvidence } from "./floors.js";

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

  // Base floors the proofs sign (enclave v10). Empty for older bundles.
  const floors = readSignedFloors(ingest);

  // Per-partition segments.
  const segments: TemporalSegment[] = [];
  const anchorLower = new Map<string, SegmentBound[]>();
  for (const partition of reconstruction.partitions) {
    const built = buildPartitionSegments(partition, byHash, evidence, floors.bounds);
    segments.push(...built.segments);
    for (const [h, b] of built.anchorLower) anchorLower.set(h, b);
  }

  // Epoch-level aggregation and cross-epoch ordering.
  const anchorOrderedPairs = aggregateEpochs(reconstruction, segments, anchorLower);

  return {
    segments,
    anchorOrderedPairs,
    verifiedAnchorProofHashes,
    unverifiedAnchorProofHashes,
    ...(floors.records.length > 0 ? { signedFloors: floors.records } : {}),
    ...(floors.problems.length > 0 ? { floorProblems: floors.problems } : {}),
  };
}

interface VerifiedAnchorEvidence {
  anchorProofHash: string;
  timestamp: number;
  blockHash: string;
  blockNumber?: string;
  /** Present for a Base floor: how its time was read. Absent for an anchor. */
  floor?: { timeSource: "header" | "signed" };
}

/** Tie-break strength of bound evidence at an equal block time. */
const EVIDENCE_RANK: Record<BoundEvidence, number> = { "signed-floor": 2, "chain-link": 1, "counter-order": 0 };

/** Candidate key of a Base floor: kept apart from anchor keys (a proof hash). */
const FLOOR_KEY = "floor:";

function floorSource(f: FloorEvidence): VerifiedAnchorEvidence {
  return {
    anchorProofHash: f.proofHash,
    timestamp: f.timestamp,
    blockHash: f.blockHash,
    blockNumber: String(f.blockNumber),
    floor: { timeSource: f.timeSource },
  };
}

/** The tighter of two floors (later block time; at a tie, the lower proof hash, for determinism). */
function laterFloor(a: FloorEvidence | undefined, b: FloorEvidence | undefined): FloorEvidence | undefined {
  if (a === undefined) return b;
  if (b === undefined) return a;
  if (a.timestamp !== b.timestamp) return a.timestamp > b.timestamp ? a : b;
  return a.proofHash <= b.proofHash ? a : b;
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
  anchorEvidence: Map<string, VerifiedAnchorEvidence>,
  floorBounds: Map<string, FloorEvidence>
): { segments: TemporalSegment[]; anchorLower: Map<string, SegmentBound[]> } {
  const members = partition.memberProofHashes.map((h) => byHash.get(h) as ObservedProof);
  // Keyed by CHAIN hash: this map is used only to resolve prevB64 pointers
  // (here and in collectAncestors), and prevB64 references the predecessor's
  // chain hash, not its identity hash.
  const memberSet = new Map<string, ObservedProof>(members.map((m) => [m.chainHash, m]));

  const anchors = members.filter((m) => anchorEvidence.has(m.proofHash));

  // Base floors signed in this partition. Floor sources join the evidence
  // map under their own keys, so selection treats a floor exactly as it
  // treats an anchor's not-before.
  const floored = members.filter((m) => floorBounds.has(m.proofHash));
  let evidence = anchorEvidence;
  if (floored.length > 0) {
    evidence = new Map(anchorEvidence);
    for (const m of floored) evidence.set(FLOOR_KEY + m.proofHash, floorSource(floorBounds.get(m.proofHash) as FloorEvidence));
  }

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

  // Base floors reach a member three ways: its own signed floor; the
  // tightest floor among its hash-link ancestors (chain-link); the tightest
  // floor signed at a lower commit counter (counter-order). Both inherited
  // forms are computed in one pass each, never per pair.
  const chainFloor = new Map<string, FloorEvidence | undefined>();
  const counterFloor = new Map<string, FloorEvidence | undefined>();
  if (floored.length > 0) {
    const pred = (m: ObservedProof): ObservedProof | undefined => {
      if (m.prevB64 === undefined) return undefined;
      const p = memberSet.get(m.prevB64);
      return p === undefined || p.proofHash === m.proofHash ? undefined : p;
    };
    for (const m of members) {
      const path: ObservedProof[] = [];
      const seen = new Set<string>();
      let cur: ObservedProof | undefined = m;
      while (cur !== undefined && !chainFloor.has(cur.proofHash) && !seen.has(cur.proofHash)) {
        seen.add(cur.proofHash);
        path.push(cur);
        cur = pred(cur);
      }
      let carry =
        cur !== undefined && chainFloor.has(cur.proofHash)
          ? laterFloor(chainFloor.get(cur.proofHash), floorBounds.get(cur.proofHash))
          : undefined;
      for (let i = path.length - 1; i >= 0; i--) {
        const node = path[i] as ObservedProof;
        chainFloor.set(node.proofHash, carry);
        carry = laterFloor(carry, floorBounds.get(node.proofHash));
      }
    }
    const counted = members
      .map((m) => ({ m, c: parseCounter(m.counter) }))
      .filter((x): x is { m: ObservedProof; c: bigint } => x.c !== undefined)
      .sort((a, b) => (a.c < b.c ? -1 : a.c > b.c ? 1 : 0));
    let running: FloorEvidence | undefined;
    for (let i = 0; i < counted.length; ) {
      let j = i;
      while (j < counted.length && (counted[j] as { c: bigint }).c === (counted[i] as { c: bigint }).c) j++;
      let group: FloorEvidence | undefined;
      for (let k = i; k < j; k++) {
        const m = (counted[k] as { m: ObservedProof }).m;
        counterFloor.set(m.proofHash, running);
        group = laterFloor(group, floorBounds.get(m.proofHash));
      }
      running = laterFloor(running, group);
      i = j;
    }
  }
  const mixed = floored.length > 0 && anchors.length > 0;
  const anchorLower = new Map<string, SegmentBound[]>();

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

    // A partition holding both anchors and floors keeps each member's
    // anchor-only not-before apart, for the cross-epoch pairs.
    if (mixed && lowerCandidates.size > 0) {
      anchorLower.set(member.proofHash, selectBounds("not-before", lowerCandidates, evidence));
    }

    // Base floors: not-before only. Never an upper candidate.
    if (floored.length > 0) {
      const own = floorBounds.get(member.proofHash);
      if (own !== undefined) lowerCandidates.set(FLOOR_KEY + own.proofHash, "signed-floor");
      const viaChain = chainFloor.get(member.proofHash);
      if (viaChain !== undefined && !lowerCandidates.has(FLOOR_KEY + viaChain.proofHash)) {
        lowerCandidates.set(FLOOR_KEY + viaChain.proofHash, "chain-link");
      }
      const viaCounter = counterFloor.get(member.proofHash);
      if (viaCounter !== undefined && !lowerCandidates.has(FLOOR_KEY + viaCounter.proofHash)) {
        lowerCandidates.set(FLOOR_KEY + viaCounter.proofHash, "counter-order");
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
        ? ("lower-bounded-with-following-anchor" as const)
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
  return { segments, anchorLower };
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
    // Tie: prefer the proof's own signed floor, then chain-link evidence over
    // counter order, then the lower key.
    if (a.evidenceKind !== b.evidenceKind) return EVIDENCE_RANK[a.evidenceKind] > EVIDENCE_RANK[b.evidenceKind];
    return a.anchorHash < b.anchorHash;
  };

  let best: (typeof entries)[number] | undefined;
  let bestChain: (typeof entries)[number] | undefined;
  for (const entry of entries) {
    if (better(entry, best)) best = entry;
    if (entry.evidenceKind !== "counter-order" && better(entry, bestChain)) bestChain = entry;
  }

  const bounds: SegmentBound[] = [makeBound(kind, best as (typeof entries)[number])];
  if (bestChain !== undefined && bestChain !== best) {
    bounds.push(makeBound(kind, bestChain));
  }
  return bounds;
}

function makeBound(
  kind: "not-before" | "not-after",
  entry: { anchorHash: string; evidenceKind: BoundEvidence; info: VerifiedAnchorEvidence }
): SegmentBound {
  const { info, evidenceKind } = entry;
  if (info.floor !== undefined) return makeFloorBound(entry);
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
    // Machine-readable: a not-after bound from an inbound anchor is an
    // assumption about anchor latency, never proof-carried evidence.
    boundClass: kind === "not-before" ? "evidence" : "assumption",
    claim: kind === "not-before" ? claim : "NOT a proof-carried upper bound. " + claim,
  };
}

/**
 * A not-before from a Base floor (enclave v10). The proof that signs the
 * floor block is named in anchorProofHash; source, chain and timeSource say
 * what it is. Always evidence, never an assumption, and never a not-after.
 */
function makeFloorBound(entry: { anchorHash: string; evidenceKind: BoundEvidence; info: VerifiedAnchorEvidence }): SegmentBound {
  const { info, evidenceKind } = entry;
  const timeSource = (info.floor as { timeSource: "header" | "signed" }).timeSource;
  const iso = new Date(info.timestamp * 1000).toISOString();
  const evidenceSentence =
    evidenceKind === "signed-floor"
      ? "Evidence: the proof signs this block as its floor (commit.slotFloor)."
      : evidenceKind === "chain-link"
        ? "Evidence: a verified hash-link path connects these proofs to a proof that signs this block as its floor."
        : "Evidence: commit-counter ordering within the partition only, after a proof that signs this block as its " +
          "floor; this relies on the authority's counter discipline rather than verifiable hash links (weaker).";
  const claim =
    `These proofs were committed no earlier than ${iso} (unix ${info.timestamp}), the time of Base block ` +
    `${info.blockNumber}: the block hash was unpredictable before that time and the floor proof signs it. ` +
    `${baseFloorTimeSentence(info.blockNumber as string, info.timestamp, timeSource)} Reading this as a wall-clock ` +
    `floor additionally assumes the block is a genuine, publicly published Base block, which this offline audit ` +
    `cannot confirm. A floor is never an upper bound on anything. ${evidenceSentence}`;
  return {
    kind: "not-before",
    anchorProofHash: info.anchorProofHash,
    source: "signed-floor",
    chain: "base",
    timeSource,
    ...(info.blockNumber !== undefined ? { blockNumber: info.blockNumber } : {}),
    blockHash: info.blockHash,
    timestamp: info.timestamp,
    evidence: evidenceKind,
    weaker: evidenceKind === "counter-order",
    basis: "block-hash-unpredictability",
    boundClass: "evidence",
    claim,
  };
}

function boundSetKey(mb: MemberBounds): string {
  const part = (bounds: SegmentBound[]): string =>
    bounds.map((b) => `${b.source === "signed-floor" ? FLOOR_KEY : ""}${b.anchorProofHash}:${b.evidence}`).join(",");
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
  /** Present when the representative is a Base floor. */
  floor?: true;
  /** Evidence class of the bound chosen as the conservative representative. */
  evidence: BoundEvidence;
  /** True when that representative rests on counter-order evidence. */
  weaker: boolean;
}

interface EpochCoverage {
  totalProofCount: number;
  /** Distinct members covered by any not-before bound (anchor or Base floor), and the most conservative (minimum) covering timestamp. */
  lowerCovered: Set<string>;
  lowerMin?: CoverageRepresentative;
  /** Whether any not-before bound counted here is a Base floor (changes the claim's wording only). */
  lowerFromFloors: boolean;
  /** Whether any not-before bound counted here is an anchor. */
  lowerFromAnchors: boolean;
  /** The same, from anchor bounds alone: the after side of a cross-epoch pair. Floors never order epochs. */
  anchorLowerCovered: Set<string>;
  anchorLowerMin?: CoverageRepresentative;
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

/** Fold one not-before bound into a coverage minimum, preferring stronger evidence at an equal time. */
function foldLower(current: CoverageRepresentative | undefined, bound: SegmentBound): CoverageRepresentative {
  if (
    current === undefined ||
    bound.timestamp < current.timestamp ||
    (bound.timestamp === current.timestamp && current.weaker && !bound.weaker)
  ) {
    return {
      timestamp: bound.timestamp,
      anchorProofHash: bound.anchorProofHash,
      blockHash: bound.blockHash,
      ...(bound.blockNumber !== undefined ? { blockNumber: bound.blockNumber } : {}),
      ...(bound.source === "signed-floor" ? { floor: true as const } : {}),
      evidence: bound.evidence,
      weaker: bound.weaker,
    };
  }
  return current;
}

/** The epoch-level not-before claim, worded for what grounds it. Pure-anchor wording is unchanged. */
function lowerClaim(cov: EpochCoverage): string {
  const min = cov.lowerMin as CoverageRepresentative;
  if (!cov.lowerFromFloors) {
    return (
      `${cov.lowerCovered.size} of ${cov.totalProofCount} observed proofs of this epoch were ` +
      `committed no earlier than unix ${min.timestamp}, grounded in block-hash ` +
      `unpredictability through verified anchor witnesses. This additionally assumes the anchored ` +
      `header is a genuine, publicly published Ethereum block, which this offline audit cannot ` +
      `confirm.` +
      weakerCaveat(min.weaker) +
      ` The remaining proofs sit causally before the covering anchors and carry no lower bound ` +
      `from this evidence.`
    );
  }
  const grounds = cov.lowerFromAnchors
    ? "the Base blocks the proofs sign as their floors and verified Ethereum anchor witnesses"
    : "the Base blocks the proofs sign as their floors";
  const blocks = cov.lowerFromAnchors ? "Base or Ethereum block" : "Base block";
  return (
    `${cov.lowerCovered.size} of ${cov.totalProofCount} observed proofs of this epoch were ` +
    `committed no earlier than unix ${min.timestamp} (${min.floor ? `Base block ${min.blockNumber}` : `Ethereum block ${min.blockNumber ?? "(unnumbered)"}`}), ` +
    `grounded in block-hash unpredictability through ${grounds}. This additionally assumes each ` +
    `${blocks} is a genuine, publicly published one, which this offline audit cannot confirm.` +
    weakerCaveat(min.weaker) +
    ` The remaining proofs sign no Base floor and follow no covering floor or anchor; they carry no ` +
    `lower bound from this evidence. A floor is a lower bound only: it orders no epoch.`
  );
}

function aggregateEpochs(
  reconstruction: ReconstructionResult,
  segments: TemporalSegment[],
  anchorLower: Map<string, SegmentBound[]>
): AnchorOrderedPair[] {
  const coverage = new Map<string, EpochCoverage>();
  for (const epoch of reconstruction.epochRelationships.epochs) {
    coverage.set(epoch.epochId, {
      totalProofCount: epoch.proofCount,
      lowerCovered: new Set(),
      lowerFromFloors: false,
      lowerFromAnchors: false,
      anchorLowerCovered: new Set(),
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
      if (bound.source === "signed-floor") cov.lowerFromFloors = true;
      else cov.lowerFromAnchors = true;
      cov.lowerMin = foldLower(cov.lowerMin, bound);
    }
    // Anchor-only coverage, for the pairs. In a partition holding both
    // anchors and floors a member's anchor bound may have been displaced
    // from its segment by a tighter floor, so it is read per member there.
    if (segment.memberProofHashes.some((h) => anchorLower.has(h))) {
      for (const h of segment.memberProofHashes) {
        for (const bound of anchorLower.get(h) ?? []) {
          cov.anchorLowerCovered.add(h);
          cov.anchorLowerMin = foldLower(cov.anchorLowerMin, bound);
        }
      }
    } else {
      for (const bound of segment.lowerBounds) {
        if (bound.source === "signed-floor") continue;
        for (const h of segment.memberProofHashes) cov.anchorLowerCovered.add(h);
        cov.anchorLowerMin = foldLower(cov.anchorLowerMin, bound);
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
        ...(cov.lowerMin.floor ? { source: "signed-floor" as const, chain: "base" as const } : {}),
        ...(cov.lowerMin.blockNumber !== undefined ? { blockNumber: cov.lowerMin.blockNumber } : {}),
        blockHash: cov.lowerMin.blockHash,
        witnessTimestamp: cov.lowerMin.timestamp,
        coverage: "members-after-anchor",
        coveredProofCount: cov.lowerCovered.size,
        totalProofCount: cov.totalProofCount,
        basis: "block-hash-unpredictability",
        evidence: cov.lowerMin.evidence,
        weaker: cov.lowerMin.weaker,
        claim: lowerClaim(cov),
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
      // The after side is read from anchor bounds alone: floors order no epoch.
      const lowerB = covB.anchorLowerMin;
      if (lowerB === undefined) continue;
      if (covA.upperMax.timestamp >= lowerB.timestamp) continue;
      const upperEvidence = covA.upperMax.evidence;
      const lowerEvidence = lowerB.evidence;
      const weaker = covA.upperMax.weaker || lowerB.weaker;
      pairs.push({
        beforeEpochId: before.epochId,
        afterEpochId: after.epochId,
        upperAnchorProofHash: covA.upperMax.anchorProofHash,
        upperBoundTimestamp: covA.upperMax.timestamp,
        lowerAnchorProofHash: lowerB.anchorProofHash,
        lowerBoundTimestamp: lowerB.timestamp,
        basis: "anchor-bounds",
        assumptionDependent: true,
        upperEvidence,
        lowerEvidence,
        weaker,
        beforeCoveredProofCount: covA.upperCovered.size,
        beforeTotalProofCount: covA.totalProofCount,
        afterCoveredProofCount: covB.anchorLowerCovered.size,
        afterTotalProofCount: covB.totalProofCount,
        note:
          `The anchor-covered portion of epoch ${before.epochId} ` +
          `(${covA.upperCovered.size} of ${covA.totalProofCount} proofs) precedes the ` +
          `anchor-covered portion of epoch ${after.epochId} ` +
          `(${covB.anchorLowerCovered.size} of ${covB.totalProofCount} proofs): the first is bounded ` +
          `not-after unix ${covA.upperMax.timestamp} and the second not-before unix ` +
          `${lowerB.timestamp}. One-sided evidence about the covered portions only; the ` +
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
