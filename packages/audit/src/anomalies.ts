// Copyright (c) 2024-2026 Mike Argento. Licensed under the MIT License. See LICENSE.

/**
 * bitgraph-audit anomaly classification
 *
 * Classifies the reconstructed record with stable machine-readable codes
 * and builds divergence records for every conflict between valid proofs.
 *
 * The G2 two-position rule governs the gap logic: every proof consumes TWO
 * counter positions, its slotCounter N and its commit counter M with
 * N < M (usually M = N + 1, but the enclave guarantees only the strict
 * inequality, and concurrent slot allocation can interleave). A position
 * within a partition's observed [min, max] range is EXPLAINED when it
 * appears as any observed proof's commit counter OR any observed proof's
 * slotCounter. Only unexplained positions are reported, always as
 * unexplained from the supplied evidence (a proof absent from the bundle
 * OR a slot that was allocated but never committed, indistinguishable
 * offline), never as asserted authority failure. Anchor proofs are
 * ordinary chain members; their positions count normally.
 *
 * Dimension discipline: verification status and chain topology stay
 * separate throughout. Topology anomalies are computed over all observed
 * members regardless of verification outcome (with statuses reported
 * alongside), a verifier failure is never reinterpreted as a chain
 * anomaly, and a chain observation never changes a verification result.
 * Divergence parties, however, must be valid: conflicts are declared
 * between valid proofs only (per their definitions), and cryptographically
 * invalid proofs appear as observed context, never as competing branches.
 *
 * Run after verifyObservedProofs and reconstructChains. Isolated validity
 * rechecks reset the verify package's module-level epoch link state (see
 * validity.ts).
 */

import type {
  AnomalyReport,
  ChainAnomaly,
  ChainPartition,
  DivergenceParty,
  DivergenceRecord,
  EpochLineageEdge,
  IngestResult,
  ObservedProof,
  PartitionKey,
  ReconstructionResult,
  UnexplainedPositionsDetail,
} from "./types.js";
import { byCounterThenHash, isIntrinsicallyValid, parseCounter, pushMap } from "./validity.js";

/**
 * Cap on the flat unexplained-position list. Ranges and the total count
 * are always complete; only the flat list truncates, with the truncated
 * flag set.
 */
const MAX_LISTED_POSITIONS = 10_000;

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Classify anomalies and build divergence records over a reconstructed
 * bundle. Read-only over its inputs. Deterministic: anomalies follow
 * partition order, then a fixed per-partition analysis order (gaps,
 * counter collisions, slot collisions, cross-kind position reuse,
 * predecessor reuse, chain breaks, multiple genesis, slot order), then
 * epoch link anomalies.
 */
export async function classifyAnomalies(
  ingest: IngestResult,
  reconstruction: ReconstructionResult
): Promise<AnomalyReport> {
  const anomalies: ChainAnomaly[] = [];
  const divergences: DivergenceRecord[] = [];

  const byHash = new Map<string, ObservedProof>(ingest.proofs.map((p) => [p.proofHash, p]));
  const partitionOf = new Map<string, PartitionKey>();
  for (const partition of reconstruction.partitions) {
    for (const hash of partition.memberProofHashes) partitionOf.set(hash, partition.key);
  }

  for (const partition of reconstruction.partitions) {
    const members = partition.memberProofHashes.map((h) => byHash.get(h) as ObservedProof);
    analyzeGaps(partition, members, anomalies);
    await analyzeCollisions(partition, members, "counter", anomalies, divergences);
    await analyzeCollisions(partition, members, "slot", anomalies, divergences);
    await analyzeCrossKindPositionReuse(partition, members, anomalies, divergences);
    await analyzePredecessorReuse(partition, members, byHash, anomalies, divergences);
    analyzeChainBreaks(partition, members, byHash, partitionOf, anomalies);
    await analyzeMultipleGenesis(partition, members, anomalies, divergences);
    analyzeSlotOrder(partition, members, anomalies);
  }

  await analyzeEpochLinks(reconstruction.epochRelationships.edges, byHash, anomalies, divergences);

  return { anomalies, divergences };
}

// ---------------------------------------------------------------------------
// G2 gap logic
// ---------------------------------------------------------------------------

function analyzeGaps(
  partition: ChainPartition,
  members: ObservedProof[],
  anomalies: ChainAnomaly[]
): void {
  // Explained positions: every observed commit counter and every observed
  // slot counter (two positions per proof, never deduplicated against
  // each other).
  const explained = new Set<bigint>();
  for (const m of members) {
    const commit = parseCounter(m.counter);
    if (commit !== undefined) explained.add(commit);
    const slot = parseCounter(m.slotCounter);
    if (slot !== undefined) explained.add(slot);
  }
  if (explained.size < 2) return; // no interior positions can exist

  const sorted = [...explained].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
  const ranges: Array<{ start: string; end: string }> = [];
  const positions: string[] = [];
  let count = 0n;
  for (let i = 1; i < sorted.length; i++) {
    const low = (sorted[i - 1] as bigint) + 1n;
    const high = (sorted[i] as bigint) - 1n;
    if (low > high) continue;
    ranges.push({ start: String(low), end: String(high) });
    count += high - low + 1n;
    for (let p = low; p <= high && positions.length < MAX_LISTED_POSITIONS; p++) {
      positions.push(String(p));
    }
  }
  if (ranges.length === 0) return;

  const detail: UnexplainedPositionsDetail = {
    count: String(count),
    ranges,
    positions,
    truncated: count > BigInt(positions.length),
  };
  const min = String(sorted[0] as bigint);
  const max = String(sorted[sorted.length - 1] as bigint);
  anomalies.push({
    code: "unexplained-counter-positions",
    partition: partition.key,
    proofHashes: [],
    message:
      `${count} counter position${count === 1n ? "" : "s"} within the observed range [${min}, ${max}] ` +
      `of this partition ${count === 1n ? "is" : "are"} neither a commit position nor a referenced slot position ` +
      `in the supplied bundle. Such ${count === 1n ? "a position" : "positions"} may mean a proof is absent ` +
      `from the bundle, or a slot that was allocated but never committed (a routine, benign occurrence); ` +
      `this offline audit cannot distinguish the two. It does not, by itself, establish that the authority ` +
      `failed to create or withheld any proof.`,
    details: detail as unknown as Record<string, unknown>,
  });
}

// ---------------------------------------------------------------------------
// Collisions
// ---------------------------------------------------------------------------

async function analyzeCollisions(
  partition: ChainPartition,
  members: ObservedProof[],
  kind: "counter" | "slot",
  anomalies: ChainAnomaly[],
  divergences: DivergenceRecord[]
): Promise<void> {
  const groups = new Map<string, ObservedProof[]>();
  for (const m of members) {
    const raw = kind === "counter" ? m.counter : m.slotCounter;
    if (raw === undefined) continue;
    const parsed = parseCounter(raw);
    pushMap(groups, parsed !== undefined ? String(parsed) : `raw:${raw}`, m);
  }

  for (const [groupKey, group] of sortGroupKeys(groups)) {
    if (group.length < 2) continue;
    const { parties, context } = await splitByValidity(group);
    // Collisions are defined between valid non-identical proofs. Invalid
    // proofs sharing a position stay on the verification dimension.
    if (parties.length < 2) continue;

    const position = groupKey.startsWith("raw:") ? groupKey.slice(4) : groupKey;
    const code = kind === "counter" ? "counter-collision" : "slot-collision";
    anomalies.push({
      code,
      partition: partition.key,
      proofHashes: group.map((m) => m.proofHash),
      message:
        kind === "counter"
          ? `${parties.length} distinct valid proofs claim commit counter ${position} in one partition. ` +
            `The audit does not choose between them; all parties are preserved for adjudication.`
          : `${parties.length} distinct valid proofs reference slot counter ${position} in one partition. ` +
            `A slot position is consumed exactly once; all parties are preserved for adjudication.`,
      details: {
        position,
        validParties: parties.map((m) => m.proofHash),
        invalidObserved: context.map((m) => m.proofHash),
      },
    });
    divergences.push({
      kind: code,
      partition: partition.key,
      contested: kind === "counter" ? { counter: position } : { slotCounter: position },
      parties: parties.map(toParty),
      invalidContext: context.map(toParty),
      explanation:
        kind === "counter"
          ? `Two or more independently valid proof objects claim commit counter ${position} in the same ` +
            `signer, epoch, and chain partition. A commit counter position can be consumed only once, so at ` +
            `most one of these can belong to the authoritative sequence. The audit tool does not choose ` +
            `between them; every party and its predecessor relationship is preserved for adjudication.`
          : `Two or more independently valid proof objects reference slot counter ${position} in the same ` +
            `signer, epoch, and chain partition. A slot position is allocated once and consumed by one ` +
            `commit, so at most one of these can belong to the authoritative sequence. The audit tool does ` +
            `not choose between them.`,
    });
  }
}

// ---------------------------------------------------------------------------
// Cross-kind position reuse (one causal position double-allocated)
// ---------------------------------------------------------------------------

/**
 * A single causal position is consumed exactly once: reserved as a slot and
 * later consumed by exactly one commit. The same-kind collision checks
 * above catch two commits at one counter or two slots at one counter. This
 * catches the cross-kind case the collision checks miss: one proof's commit
 * counter equal to a DIFFERENT proof's slotCounter in the same partition,
 * a double-allocation of one position that only enclave malfunction,
 * replay, or compromise can produce. A single proof whose own commit and
 * slot share a position is slot-order-violation, handled separately, and is
 * never flagged here. Only intrinsically valid, distinct proofs are
 * declared parties, consistent with the module's other divergences.
 */
async function analyzeCrossKindPositionReuse(
  partition: ChainPartition,
  members: ObservedProof[],
  anomalies: ChainAnomaly[],
  divergences: DivergenceRecord[]
): Promise<void> {
  const commitAt = new Map<string, ObservedProof[]>();
  const slotAt = new Map<string, ObservedProof[]>();
  for (const m of members) {
    const commit = parseCounter(m.counter);
    if (commit !== undefined) pushMap(commitAt, String(commit), m);
    const slot = parseCounter(m.slotCounter);
    if (slot !== undefined) pushMap(slotAt, String(slot), m);
  }

  const positions = [...commitAt.keys()]
    .filter((p) => slotAt.has(p))
    .sort((a, b) => (BigInt(a) < BigInt(b) ? -1 : BigInt(a) > BigInt(b) ? 1 : 0));

  for (const position of positions) {
    const committers = commitAt.get(position) as ObservedProof[];
    const slotters = slotAt.get(position) as ObservedProof[];

    // Divergence parties must be intrinsically valid, as everywhere in this
    // module. Invalid proofs sharing the position stay on the verification
    // dimension and appear only as context.
    const validCommitters: ObservedProof[] = [];
    for (const m of committers) if (await isIntrinsicallyValid(m)) validCommitters.push(m);
    const validSlotters: ObservedProof[] = [];
    for (const m of slotters) if (await isIntrinsicallyValid(m)) validSlotters.push(m);

    // A double-allocation requires a valid commit-side proof and a valid
    // slot-side proof that are DIFFERENT objects. One proof committing and
    // reserving the same position is slot-order-violation, not this.
    const distinctCrossPair = validCommitters.some((c) =>
      validSlotters.some((s) => s.proofHash !== c.proofHash)
    );
    if (!distinctCrossPair) continue;

    const partyMap = new Map<string, ObservedProof>();
    for (const m of [...validCommitters, ...validSlotters]) partyMap.set(m.proofHash, m);
    const parties = [...partyMap.values()];

    const involvedMap = new Map<string, ObservedProof>();
    for (const m of [...committers, ...slotters]) involvedMap.set(m.proofHash, m);
    const context = [...involvedMap.values()].filter((m) => !partyMap.has(m.proofHash));

    anomalies.push({
      code: "cross-kind-position-reuse",
      partition: partition.key,
      proofHashes: [...involvedMap.keys()],
      message:
        `Counter position ${position} is committed by one proof and reserved as a slot by a ` +
        `different proof in the same partition. A single causal position is consumed once, as a ` +
        `slot or as a commit, never both across distinct proofs. The audit does not choose between ` +
        `them; all parties are preserved for adjudication.`,
      details: {
        position,
        commitParties: validCommitters.map((m) => m.proofHash),
        slotParties: validSlotters.map((m) => m.proofHash),
        validParties: parties.map((m) => m.proofHash),
        invalidObserved: context.map((m) => m.proofHash),
      },
    });
    divergences.push({
      kind: "cross-kind-position-reuse",
      partition: partition.key,
      contested: { position },
      parties: parties.map(toParty),
      invalidContext: context.map(toParty),
      explanation:
        `Two or more independently valid proof objects allocate counter position ${position} in the ` +
        `same signer, epoch, and chain partition through different roles: at least one commits at it ` +
        `and at least one reserves it as a slot. Each position in a chain is consumed exactly once, so ` +
        `at most one of these allocations can belong to the authoritative sequence. This pattern only ` +
        `arises through enclave malfunction, replay, or compromise. The audit tool does not choose ` +
        `between them; every party is preserved for adjudication.`,
    });
  }
}

// ---------------------------------------------------------------------------
// Predecessor reuse (forks)
// ---------------------------------------------------------------------------

async function analyzePredecessorReuse(
  partition: ChainPartition,
  members: ObservedProof[],
  byHash: Map<string, ObservedProof>,
  anomalies: ChainAnomaly[],
  divergences: DivergenceRecord[]
): Promise<void> {
  const byPrev = new Map<string, ObservedProof[]>();
  for (const m of members) {
    if (m.prevB64 === undefined) continue;
    pushMap(byPrev, m.prevB64, m);
  }

  for (const [prevB64, claimants] of sortGroupKeys(byPrev)) {
    if (claimants.length < 2) continue;
    const { parties, context } = await splitByValidity(claimants);
    if (parties.length < 2) continue;

    const predecessorObserved = byHash.has(prevB64);
    anomalies.push({
      code: "predecessor-reuse",
      partition: partition.key,
      proofHashes: claimants.map((m) => m.proofHash),
      message:
        `${parties.length} distinct valid proofs claim the same predecessor hash: a detectable fork. ` +
        `All branches are preserved; the audit does not choose between them.`,
      details: {
        prevB64,
        predecessorObserved,
        validParties: parties.map((m) => m.proofHash),
        invalidObserved: context.map((m) => m.proofHash),
      },
    });
    divergences.push({
      kind: "predecessor-reuse",
      partition: partition.key,
      contested: { prevB64 },
      parties: parties.map(toParty),
      invalidContext: context.map(toParty),
      explanation:
        `Two or more independently valid proof objects name the same predecessor proof in their prevB64 ` +
        `hash link. Each proof has exactly one successor in an intact chain, so this is a fork: the ` +
        `history diverges into multiple branches at that predecessor` +
        `${predecessorObserved ? ", which is itself observed in the bundle" : ", which is absent from the bundle"}. ` +
        `All branches are shown; the audit tool does not select one.`,
    });
  }
}

// ---------------------------------------------------------------------------
// Chain breaks
// ---------------------------------------------------------------------------

function analyzeChainBreaks(
  partition: ChainPartition,
  members: ObservedProof[],
  byHash: Map<string, ObservedProof>,
  partitionOf: Map<string, PartitionKey>,
  anomalies: ChainAnomaly[]
): void {
  const memberHashes = new Set(members.map((m) => m.proofHash));
  for (const m of [...members].sort(byCounterThenHash)) {
    if (m.prevB64 === undefined) continue;
    if (memberHashes.has(m.prevB64)) continue; // resolved in-partition

    if (!isStrict32ByteBase64(m.prevB64)) {
      anomalies.push({
        code: "chain-break-malformed",
        partition: partition.key,
        proofHashes: [m.proofHash],
        message:
          "commit.prevB64 is not standard base64 of 32 bytes, so it can never match a canonical proof " +
          "hash. The predecessor link is unusable as reconstruction evidence.",
        details: { prevB64: m.prevB64 },
      });
      continue;
    }

    const elsewhere = byHash.get(m.prevB64);
    if (elsewhere !== undefined) {
      const otherKey = partitionOf.get(elsewhere.proofHash);
      anomalies.push({
        code: "chain-break-cross-partition",
        partition: partition.key,
        proofHashes: [m.proofHash, elsewhere.proofHash],
        message:
          "commit.prevB64 resolves to an observed proof outside this proof's own signer, epoch, and " +
          "chain partition. prevB64 never bridges partitions (each epoch and chain keeps its own hash " +
          "chain), so this link does not join the two.",
        details: {
          prevB64: m.prevB64,
          predecessorProofHash: elsewhere.proofHash,
          predecessorPartition:
            otherKey !== undefined
              ? {
                  publicKeyB64: otherKey.publicKeyB64,
                  ...(otherKey.epochId !== undefined ? { epochId: otherKey.epochId } : {}),
                  chainId: otherKey.chainId,
                }
              : "unchained-or-unpartitioned",
        },
      });
      continue;
    }

    anomalies.push({
      code: "chain-break-missing",
      partition: partition.key,
      proofHashes: [m.proofHash],
      message:
        "commit.prevB64 references a predecessor proof that is absent from the supplied bundle. The " +
        "chain cannot be reconstructed across this link from the supplied evidence; this does not, by " +
        "itself, establish that the predecessor never existed.",
      details: { prevB64: m.prevB64 },
    });
  }
}

function isStrict32ByteBase64(value: string): boolean {
  if (value.length === 0) return false;
  const decoded = Buffer.from(value, "base64");
  return decoded.length === 32 && decoded.toString("base64") === value;
}

// ---------------------------------------------------------------------------
// Multiple genesis
// ---------------------------------------------------------------------------

async function analyzeMultipleGenesis(
  partition: ChainPartition,
  members: ObservedProof[],
  anomalies: ChainAnomaly[],
  divergences: DivergenceRecord[]
): Promise<void> {
  // A single proof without prevB64 is the epoch genesis: normal per G1,
  // never an anomaly.
  const genesis = [...members.filter((m) => m.prevB64 === undefined)].sort(byCounterThenHash);
  if (genesis.length < 2) return;

  const { parties, context } = await splitByValidity(genesis);
  anomalies.push({
    code: "multiple-genesis",
    partition: partition.key,
    proofHashes: genesis.map((m) => m.proofHash),
    message:
      `${genesis.length} proofs in one partition carry no prevB64 link. An epoch has exactly one first ` +
      `proof, so at most one of these can be the genesis of this partition's chain.`,
    details: {
      validParties: parties.map((m) => m.proofHash),
      invalidObserved: context.map((m) => m.proofHash),
    },
  });

  if (parties.length < 2) return;
  divergences.push({
    kind: "multiple-genesis",
    partition: partition.key,
    contested: {
      ...(partition.key.epochId !== undefined ? { epochId: partition.key.epochId } : {}),
      chainId: partition.key.chainId,
    },
    parties: parties.map(toParty),
    invalidContext: context.map(toParty),
    explanation:
      "Two or more independently valid proof objects in the same signer, epoch, and chain partition " +
      "carry no predecessor link, each presenting itself as the first proof of the chain. An epoch has " +
      "exactly one first proof, so at most one of these can be the genesis. The audit tool does not " +
      "choose between them.",
  });
}

// ---------------------------------------------------------------------------
// Slot ordering
// ---------------------------------------------------------------------------

function analyzeSlotOrder(
  partition: ChainPartition,
  members: ObservedProof[],
  anomalies: ChainAnomaly[]
): void {
  for (const m of [...members].sort(byCounterThenHash)) {
    const slot = parseCounter(m.slotCounter);
    const commit = parseCounter(m.counter);
    if (slot === undefined || commit === undefined) continue;
    if (slot < commit) continue;
    anomalies.push({
      code: "slot-order-violation",
      partition: partition.key,
      proofHashes: [m.proofHash],
      message:
        "commit.slotCounter is not strictly less than commit.counter. The slot must be allocated " +
        "before the commit that consumes it, so this proof's declared positions contradict the " +
        "nonce-first construction order.",
      details: {
        slotCounter: m.slotCounter as string,
        counter: m.counter as string,
      },
    });
  }
}

// ---------------------------------------------------------------------------
// Epoch link anomalies
// ---------------------------------------------------------------------------

async function analyzeEpochLinks(
  edges: EpochLineageEdge[],
  byHash: Map<string, ObservedProof>,
  anomalies: ChainAnomaly[],
  divergences: DivergenceRecord[]
): Promise<void> {
  // Per-edge resolutions, in edge (observation) order.
  for (const edge of edges) {
    if (edge.resolution === "terminal-missing") {
      anomalies.push({
        code: "epochlink-terminal-missing",
        proofHashes: [edge.viaProofHash],
        message:
          "commit.epochLink references a prior epoch that is observed in the bundle, but the referenced " +
          "terminal proof is absent from the bundle. The lineage claim cannot be confirmed from the " +
          "supplied evidence; this does not, by itself, establish that the terminal never existed.",
        details: { link: { ...edge.link } },
      });
    } else if (edge.resolution === "dangling") {
      anomalies.push({
        code: "epochlink-dangling",
        proofHashes: [edge.viaProofHash],
        message:
          "commit.epochLink references a prior epoch and terminal proof, neither of which is observed " +
          "in the bundle. The lineage claim dangles into unobserved history; it cannot be confirmed from " +
          "the supplied evidence.",
        details: { link: { ...edge.link } },
      });
    } else if (edge.metadataConsistent === false) {
      anomalies.push({
        code: "epochlink-mismatch",
        proofHashes: [
          edge.viaProofHash,
          ...(edge.predecessorProofHash !== undefined ? [edge.predecessorProofHash] : []),
        ],
        message:
          "commit.epochLink's prevProofHashB64 matches an observed proof, but the link's declared " +
          "epoch, signer key, or counter disagrees with that proof. The hash reference and the declared " +
          "metadata cannot both be right.",
        details: {
          link: { ...edge.link },
          inconsistencies: edge.inconsistencies ?? [],
        },
      });
    }
  }

  // Forks: one predecessor tuple consumed by two or more distinct
  // successor epochs (the canonical verifier's single-successor
  // invariant, applied to the observed record).
  const byTuple = new Map<string, EpochLineageEdge[]>();
  for (const edge of edges) {
    pushMap(
      byTuple,
      `${edge.link.prevEpochId}|${edge.link.prevCounter}|${edge.link.prevProofHashB64}`,
      edge
    );
  }
  for (const [, group] of sortGroupKeys(byTuple)) {
    const successorEpochs = new Set(group.map((e) => e.link.toEpochId));
    if (successorEpochs.size < 2) continue;

    const viaProofs = group.map((e) => byHash.get(e.viaProofHash) as ObservedProof);
    const { parties, context } = await splitByValidity(viaProofs);
    const sample = (group[0] as EpochLineageEdge).link;
    anomalies.push({
      code: "epochlink-fork",
      proofHashes: group.map((e) => e.viaProofHash),
      message:
        `The same predecessor terminal (epoch ${sample.prevEpochId}, counter ${sample.prevCounter}) is ` +
        `consumed by genesis proofs of ${successorEpochs.size} distinct successor epochs. A predecessor ` +
        `may be consumed by at most one successor epoch, so this is a detectable fork at the epoch ` +
        `boundary. All branches are preserved.`,
      details: {
        prevEpochId: sample.prevEpochId,
        prevCounter: sample.prevCounter,
        prevProofHashB64: sample.prevProofHashB64,
        successorEpochIds: [...successorEpochs].sort(),
        validParties: parties.map((m) => m.proofHash),
        invalidObserved: context.map((m) => m.proofHash),
      },
    });

    if (parties.length < 2) continue;
    divergences.push({
      kind: "epochlink-fork",
      contested: {
        prevEpochId: sample.prevEpochId,
        prevCounter: sample.prevCounter,
        prevProofHashB64: sample.prevProofHashB64,
      },
      parties: parties.map(toParty),
      invalidContext: context.map(toParty),
      explanation:
        "Two or more independently valid epoch-genesis proofs consume the same terminal proof of a " +
        "prior epoch through their epochLink. The single-successor rule allows a terminal to be " +
        "consumed by exactly one successor epoch, so at most one of these lineages can be the " +
        "authoritative continuation. Note that whichever party verified second in this run carries a " +
        "fork-detection failure from the canonical verifier; that ordering is an artifact of " +
        "verification order, not evidence of which branch is authoritative. The audit tool does not " +
        "choose between them.",
    });
  }

  // Cycles: the claimed lineage graph must be acyclic; a cycle means the
  // epochs' ordering claims contradict each other. Detected over all
  // matched edges regardless of validity, because the contradiction is a
  // property of the observed claims.
  const adjacency = new Map<string, Set<string>>();
  for (const edge of edges) {
    if (edge.resolution !== "matched") continue;
    const set = adjacency.get(edge.fromEpochId);
    if (set === undefined) adjacency.set(edge.fromEpochId, new Set([edge.toEpochId]));
    else set.add(edge.toEpochId);
  }
  for (const cycle of findCycles(adjacency)) {
    const involved = edges
      .filter(
        (e) =>
          e.resolution === "matched" &&
          cycle.includes(e.fromEpochId) &&
          cycle.includes(e.toEpochId)
      )
      .map((e) => e.viaProofHash);
    anomalies.push({
      code: "epochlink-cycle",
      proofHashes: involved,
      message:
        `Epoch lineage links form a cycle among ${cycle.length} epochs. Each link claims its successor ` +
        `epoch came after its predecessor, so a cycle means these ordering claims contradict each ` +
        `other; no ordering is asserted for the epochs involved.`,
      details: { epochIds: cycle },
    });
  }
}

/**
 * Find simple cycles in the epoch lineage graph via iterative DFS with
 * an explicit path stack. Returns each cycle once, rotated so the
 * lexicographically smallest epochId leads, sorted deterministically.
 */
function findCycles(adjacency: Map<string, Set<string>>): string[][] {
  const cycles = new Map<string, string[]>();
  const visited = new Set<string>();

  const nodes = [...adjacency.keys()].sort();
  for (const start of nodes) {
    if (visited.has(start)) continue;
    // Iterative DFS tracking the current path.
    const path: string[] = [];
    const onPath = new Set<string>();
    const iterators = new Map<string, string[]>();
    const stack: string[] = [start];
    while (stack.length > 0) {
      const node = stack[stack.length - 1] as string;
      if (!onPath.has(node)) {
        onPath.add(node);
        path.push(node);
        iterators.set(node, [...(adjacency.get(node) ?? [])].sort());
      }
      const pending = iterators.get(node) as string[];
      const next = pending.shift();
      if (next === undefined) {
        stack.pop();
        onPath.delete(node);
        path.pop();
        visited.add(node);
        continue;
      }
      if (onPath.has(next)) {
        // Back edge: extract the cycle from the path.
        const fromIndex = path.indexOf(next);
        const cycle = path.slice(fromIndex);
        const canonical = canonicalizeCycle(cycle);
        cycles.set(canonical.join("|"), canonical);
        continue;
      }
      if (!visited.has(next)) stack.push(next);
    }
  }

  return [...cycles.values()].sort((a, b) => {
    const ja = a.join("|");
    const jb = b.join("|");
    return ja < jb ? -1 : ja > jb ? 1 : 0;
  });
}

function canonicalizeCycle(cycle: string[]): string[] {
  let minIndex = 0;
  for (let i = 1; i < cycle.length; i++) {
    if ((cycle[i] as string) < (cycle[minIndex] as string)) minIndex = i;
  }
  return [...cycle.slice(minIndex), ...cycle.slice(0, minIndex)];
}

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

async function splitByValidity(
  group: ObservedProof[]
): Promise<{ parties: ObservedProof[]; context: ObservedProof[] }> {
  const parties: ObservedProof[] = [];
  const context: ObservedProof[] = [];
  for (const m of group) {
    if (await isIntrinsicallyValid(m)) parties.push(m);
    else context.push(m);
  }
  return { parties, context };
}

function toParty(m: ObservedProof): DivergenceParty {
  const verification = m.verification;
  return {
    proofHash: m.proofHash,
    sourcePaths: m.sources.map((s) => s.path),
    ...(verification !== undefined
      ? {
          verificationTier: verification.tier,
          verificationStatus: verification.status,
          ...(verification.reason !== undefined ? { verificationReason: verification.reason } : {}),
        }
      : {}),
    ...(m.counter !== undefined ? { counter: m.counter } : {}),
    ...(m.slotCounter !== undefined ? { slotCounter: m.slotCounter } : {}),
    ...(m.prevB64 !== undefined ? { prevB64: m.prevB64 } : {}),
    ...(m.publicKeyB64 !== undefined ? { publicKeyB64: m.publicKeyB64 } : {}),
    ...(m.epochId !== undefined ? { epochId: m.epochId } : {}),
    chainId: m.chainId,
    ...(m.measurement !== undefined ? { measurement: m.measurement } : {}),
  };
}

/** Deterministic group iteration: numeric keys ascending, then raw keys. */
function sortGroupKeys<V>(groups: Map<string, V>): Array<[string, V]> {
  return [...groups.entries()].sort(([a], [b]) => {
    const na = /^[0-9]+$/.test(a) ? BigInt(a) : undefined;
    const nb = /^[0-9]+$/.test(b) ? BigInt(b) : undefined;
    if (na !== undefined && nb !== undefined && na !== nb) return na < nb ? -1 : 1;
    if (na !== undefined && nb === undefined) return -1;
    if (na === undefined && nb !== undefined) return 1;
    return a < b ? -1 : a > b ? 1 : 0;
  });
}
