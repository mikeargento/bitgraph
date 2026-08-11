// Copyright (c) 2024-2026 Mike Argento. Licensed under the MIT License. See LICENSE.

/**
 * The ordering adapter. Player does not reimplement causal reconstruction —
 * `bitgraph-audit` already computes it — this module carries audit's
 * answers into a single compare(a, b) without flattening their evidence
 * classes, and without asserting anything the specific pair of recordings
 * is not actually covered by.
 *
 * An artifact's position is its COMMIT position. At the slot the digest is
 * not bound yet, so the slot cannot be the position of the artifact.
 *
 * Within a partition (signer key, epochId, chainId):
 *   - "chain-link": a DIRECTED prevB64 path connects the two recordings
 *     through observed proofs. The path itself decides the direction; a
 *     path contradicting the counters is an anomaly and answers nothing.
 *     Undirected co-membership in a component is NOT chain-link evidence:
 *     two fork branches share a component without any path between them.
 *   - "counter-order": no path, but both commit counters parse under the
 *     canonical strict-decimal grammar. Rests on counter discipline.
 *
 * Across epochs:
 *   - "epoch-lineage": a chain of hard epochLink edges whose observed
 *     predecessor/via proofs cover THIS pair. Successor-side coverage is
 *     by signer key: a proof signed by the successor key cannot predate
 *     that key's creation at epoch init, which the link proves happened
 *     after the referenced predecessor existed. Predecessor-side coverage
 *     is a directed path to (or identity with) the referenced predecessor
 *     — hash-linked — or a strictly smaller parseable counter, which
 *     downgrades the whole answer to the assumption-dependent tier.
 *   - "anchor-bounds": strict block separation between verified segment
 *     bounds; always assumption-dependent (anchor freshness). If BOTH
 *     directions satisfy strict separation the evidence is contradictory
 *     and answers nothing.
 * Epoch pairs supported by neither are concurrent-or-unordered, and the
 * honest answer is "unordered", never a coin flip.
 */

import type {
  AuditResult,
  ChainPartition,
  ObservedProof,
  SegmentBound,
  TemporalSegment,
} from "@mikeargento/bitgraph-audit";
import type { EvidenceTier, OrderResult } from "./types.js";

/**
 * Canonical strict-decimal counter grammar, mirroring audit's own
 * parseCounter. Every other spelling BigInt would accept ("", "0x10",
 * "-3", " 7 ") is NO counter evidence, exactly as audit treats it.
 */
export function parseCounter(value: string | undefined): bigint | undefined {
  if (value === undefined || value.length === 0 || !/^[0-9]+$/.test(value)) return undefined;
  return BigInt(value);
}

function unordered(detail: string): OrderResult {
  return { relation: "unordered", assumptionDependent: false, weaker: false, detail };
}

function partitionOf(audit: AuditResult, proofHash: string): ChainPartition | undefined {
  return audit.reconstruction.partitions.find((p) => p.memberProofHashes.includes(proofHash));
}

function segmentOf(audit: AuditResult, proofHash: string): TemporalSegment | undefined {
  return audit.temporal.segments.find((s) => s.memberProofHashes.includes(proofHash));
}

function proofsByHash(audit: AuditResult): Map<string, ObservedProof> {
  return new Map(audit.ingest.proofs.map((p) => [p.proofHash, p]));
}

/**
 * True when `ancestor` lies on the directed prevB64 chain above
 * `descendant`, walking only proofs observed in the bundle and confined to
 * one partition. Identity does not count.
 */
function isDirectedAncestor(
  ancestor: ObservedProof,
  descendant: ObservedProof,
  partition: ChainPartition,
  byChainHash: Map<string, ObservedProof>
): boolean {
  const members = new Set(partition.memberProofHashes);
  const visited = new Set<string>();
  let current: ObservedProof | undefined = descendant;
  while (current !== undefined) {
    const prev = current.prevB64;
    if (prev === undefined) return false;
    const parent = byChainHash.get(prev);
    if (parent === undefined || !members.has(parent.proofHash)) return false;
    if (visited.has(parent.proofHash)) return false; // cycle guard
    visited.add(parent.proofHash);
    if (parent.proofHash === ancestor.proofHash) return true;
    current = parent;
  }
  return false;
}

function chainHashIndex(audit: AuditResult, partition: ChainPartition): Map<string, ObservedProof> {
  const byHash = proofsByHash(audit);
  const index = new Map<string, ObservedProof>();
  for (const memberHash of partition.memberProofHashes) {
    const proof = byHash.get(memberHash);
    if (proof !== undefined) index.set(proof.chainHash, proof);
  }
  return index;
}

// ---------------------------------------------------------------------------
// Epoch lineage at recording granularity
// ---------------------------------------------------------------------------

/**
 * Try to prove `a` precedes `b` through a chain of hard epochLink edges.
 *
 * A usable first edge references an observed predecessor proof P in a's
 * own partition, with a covering P (identity, directed path, or strictly
 * smaller parseable counter — the last downgrades the tier). Every
 * subsequent edge must be anchored in the partition the previous edge's
 * via proof belongs to; reaching b's partition completes the proof, since
 * any proof of that partition postdates its key's creation at init.
 */
function lineagePrecedes(
  a: ObservedProof,
  partA: ChainPartition,
  b: ObservedProof,
  partB: ChainPartition,
  audit: AuditResult
): { tier: EvidenceTier } | undefined {
  const byHash = proofsByHash(audit);
  const edges = audit.reconstruction.epochRelationships.edges.filter(
    (e) => e.hardEdge && e.predecessorProofHash !== undefined
  );
  const partitionKeyOf = (p: ChainPartition): string => JSON.stringify(p.key);
  const partitionByProofHash = (hash: string): ChainPartition | undefined =>
    partitionOf(audit, hash);

  // First hops out of a's partition, each with the tier its coverage rests on.
  interface State {
    partitionKey: string;
    tier: EvidenceTier;
  }
  const queue: State[] = [];
  const chainIndexA = chainHashIndex(audit, partA);
  const ca = parseCounter(a.counter);
  for (const edge of edges) {
    const pred = byHash.get(edge.predecessorProofHash as string);
    if (pred === undefined) continue;
    const predPartition = partitionByProofHash(pred.proofHash);
    if (predPartition !== partA) continue;
    let hopTier: EvidenceTier | undefined;
    if (pred.proofHash === a.proofHash || isDirectedAncestor(a, pred, partA, chainIndexA)) {
      hopTier = "hash-linked";
    } else {
      const cp = parseCounter(pred.counter);
      if (ca !== undefined && cp !== undefined && ca < cp) hopTier = "assumption-dependent";
    }
    if (hopTier === undefined) continue;
    const viaPartition = partitionByProofHash(edge.viaProofHash);
    if (viaPartition === undefined) continue;
    queue.push({ partitionKey: partitionKeyOf(viaPartition), tier: hopTier });
  }

  // BFS over subsequent hops. Later hops are free of counter assumptions:
  // the next edge's predecessor proof is signed by the current partition's
  // key, so it postdates that key's creation.
  const bestTierByPartition = new Map<string, EvidenceTier>();
  const targetKey = partitionKeyOf(partB);
  let best: EvidenceTier | undefined;
  while (queue.length > 0) {
    const state = queue.shift() as State;
    const seen = bestTierByPartition.get(state.partitionKey);
    if (seen === "hash-linked" || seen === state.tier) continue;
    if (seen === undefined || state.tier === "hash-linked") {
      bestTierByPartition.set(state.partitionKey, state.tier);
    }
    if (state.partitionKey === targetKey) {
      if (best === undefined || state.tier === "hash-linked") best = state.tier;
      if (best === "hash-linked") break;
      continue;
    }
    for (const edge of edges) {
      const pred = byHash.get(edge.predecessorProofHash as string);
      if (pred === undefined) continue;
      const predPartition = partitionByProofHash(pred.proofHash);
      if (predPartition === undefined || partitionKeyOf(predPartition) !== state.partitionKey) {
        continue;
      }
      const viaPartition = partitionByProofHash(edge.viaProofHash);
      if (viaPartition === undefined) continue;
      queue.push({ partitionKey: partitionKeyOf(viaPartition), tier: state.tier });
    }
  }
  return best === undefined ? undefined : { tier: best };
}

// ---------------------------------------------------------------------------
// Anchor bounds
// ---------------------------------------------------------------------------

/**
 * Strict precedence between two one-sided anchor bounds. Equality proves
 * nothing: A precedes the anchor COMMIT that consumed block N, B follows
 * the MINING of block N, and the gap between mining and commit is exactly
 * where the two could swap.
 */
function boundsStrictlyOrdered(upper: SegmentBound, lower: SegmentBound): boolean {
  if (upper.blockNumber !== undefined && lower.blockNumber !== undefined) {
    return BigInt(upper.blockNumber) < BigInt(lower.blockNumber);
  }
  // Verified witness timestamps; Ethereum block timestamps are strictly
  // increasing, so strict timestamp inequality is strict block inequality.
  return upper.timestamp < lower.timestamp;
}

function anchorPrecedes(
  firstSegment: TemporalSegment,
  secondSegment: TemporalSegment
): { weaker: boolean; upper: SegmentBound; lower: SegmentBound } | undefined {
  let best: { weaker: boolean; upper: SegmentBound; lower: SegmentBound } | undefined;
  for (const upper of firstSegment.upperBounds) {
    for (const lower of secondSegment.lowerBounds) {
      if (!boundsStrictlyOrdered(upper, lower)) continue;
      const weaker = upper.weaker || lower.weaker;
      if (best === undefined || (best.weaker && !weaker)) {
        best = { weaker, upper, lower };
      }
    }
  }
  return best;
}

function describeBound(bound: SegmentBound): string {
  return bound.blockNumber !== undefined ? `block ${bound.blockNumber}` : `t=${bound.timestamp}`;
}

// ---------------------------------------------------------------------------
// compare
// ---------------------------------------------------------------------------

/**
 * Compare two resolved recordings. Pure over the AuditResult; no network,
 * no clock. The returned tier is what the answer actually rests on and is
 * what the evidence floor gates.
 */
export function compare(a: ObservedProof, b: ObservedProof, audit: AuditResult): OrderResult {
  if (a.proofHash === b.proofHash) {
    return {
      relation: "same",
      assumptionDependent: false,
      weaker: false,
      detail: "both roles resolved to the identical recording",
    };
  }

  const partA = partitionOf(audit, a.proofHash);
  const partB = partitionOf(audit, b.proofHash);

  if (partA === undefined || partB === undefined) {
    return unordered(
      "at least one recording is observed-but-unchained (no counter or epochId): it holds no causal position to compare"
    );
  }

  // -------------------------------------------------------------------
  // Same partition: a directed prevB64 path decides; counters corroborate
  // or, absent a path, carry the answer at the weaker tier.
  // -------------------------------------------------------------------
  if (partA === partB) {
    const chainIndex = chainHashIndex(audit, partA);
    const aBeforeB = isDirectedAncestor(a, b, partA, chainIndex);
    const bBeforeA = isDirectedAncestor(b, a, partA, chainIndex);
    const ca = parseCounter(a.counter);
    const cb = parseCounter(b.counter);

    if (aBeforeB && bBeforeA) {
      return unordered("prevB64 links form a cycle between these recordings: an anomaly, not an order");
    }
    if (aBeforeB || bBeforeA) {
      const relation = aBeforeB ? ("before" as const) : ("after" as const);
      // A verified path contradicted by the counters is an anomaly:
      // both cannot be honest, so neither answers.
      if (ca !== undefined && cb !== undefined && (aBeforeB ? ca >= cb : cb >= ca)) {
        return unordered(
          "a verified prevB64 path contradicts the commit counters: an anomaly, not an order"
        );
      }
      return {
        relation,
        basis: "chain-link",
        tier: "hash-linked",
        assumptionDependent: false,
        weaker: false,
        detail: `a directed prevB64 path through observed proofs connects the recordings; the path decides the direction`,
      };
    }

    if (ca === undefined || cb === undefined) {
      return unordered(
        "no prevB64 path connects the recordings and at least one carries no parseable strict-decimal commit counter"
      );
    }
    if (ca === cb) {
      return unordered(
        "two distinct recordings claim the same commit counter in one partition: an anomaly, not an order"
      );
    }
    return {
      relation: ca < cb ? "before" : "after",
      basis: "counter-order",
      tier: "assumption-dependent",
      assumptionDependent: true,
      weaker: true,
      detail: `no prevB64 path in the bundle connects the recordings; commit counters ${a.counter} vs ${b.counter} rest on the authority's counter discipline`,
    };
  }

  // -------------------------------------------------------------------
  // Different partitions. Counters are never comparable across
  // partitions; order can only come through covered epoch lineage or
  // anchor bounds.
  // -------------------------------------------------------------------
  if (a.epochId !== undefined && b.epochId !== undefined && a.epochId === b.epochId) {
    return unordered(
      "same epochId under a different signer key or chain: counters are not comparable and no cross-partition evidence orders them"
    );
  }

  const lineageForward = lineagePrecedes(a, partA, b, partB, audit);
  const lineageBackward = lineagePrecedes(b, partB, a, partA, audit);
  if (lineageForward !== undefined && lineageBackward !== undefined) {
    return unordered(
      "epochLink lineage evidence runs in both directions between these recordings: contradictory, an anomaly, not an order"
    );
  }
  const lineage = lineageForward ?? lineageBackward;
  if (lineage !== undefined) {
    const relation = lineageForward !== undefined ? ("before" as const) : ("after" as const);
    const assumptionDependent = lineage.tier === "assumption-dependent";
    return {
      relation,
      basis: "epoch-lineage",
      tier: lineage.tier,
      assumptionDependent,
      weaker: assumptionDependent,
      detail: assumptionDependent
        ? "hard epochLink succession covers this pair, with the predecessor-side coverage resting on counter discipline"
        : "hard epochLink succession covers this pair: the earlier recording precedes the referenced predecessor by hash links, and the later one is signed by a key created after it",
    };
  }

  const segA = segmentOf(audit, a.proofHash);
  const segB = segmentOf(audit, b.proofHash);
  if (segA !== undefined && segB !== undefined) {
    const forward = anchorPrecedes(segA, segB);
    const backward = anchorPrecedes(segB, segA);
    if (forward !== undefined && backward !== undefined) {
      return unordered(
        "anchor bounds satisfy strict precedence in both directions: contradictory evidence, an anomaly, not an order"
      );
    }
    const hit = forward ?? backward;
    if (hit !== undefined) {
      return {
        relation: forward !== undefined ? "before" : "after",
        basis: "anchor-bounds",
        tier: "assumption-dependent",
        assumptionDependent: true,
        weaker: hit.weaker,
        detail: `not-after anchor ${describeBound(hit.upper)} strictly precedes not-before anchor ${describeBound(hit.lower)}; rests on the anchor-freshness assumption`,
      };
    }
  }

  return unordered(
    `epochs ${a.epochId ?? "(none)"} and ${b.epochId ?? "(none)"} are concurrent-or-unordered for this pair: no covering lineage and no strict anchor-bound separation`
  );
}
