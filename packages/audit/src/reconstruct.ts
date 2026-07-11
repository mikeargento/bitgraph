// Copyright (c) 2024-2026 Mike Argento. Licensed under the MIT License. See LICENSE.

/**
 * bitgraph-audit causal reconstruction
 *
 * Rebuilds the observed causal record from an ingested bundle:
 *
 *   1. Partition observed proofs by (signer publicKeyB64, epochId,
 *      chainId) per G6. Multiple signer lineages are never merged.
 *      Chainless proofs (neither counter nor epochId) stay outside
 *      partitions as observed-but-unchained; proofs missing a signer key
 *      cannot join a lineage and are listed as unpartitioned.
 *   2. Within each partition, reconstruct chain components from prevB64
 *      hash links as the PRIMARY evidence: an edge exists exactly when a
 *      proof's prevB64 equals the canonical proof hash of another member
 *      (the hash computeProofHash returns over the full canonical signed
 *      body, which is what the enclave writes into prevB64). Counters are
 *      ordering and anomaly evidence, never the reconstruction mechanism.
 *   3. Derive epoch relationships per G1: epochs are independent chains;
 *      cross-epoch ordering comes ONLY from verified epochLink lineage
 *      (hard edges), with a typed extension point for anchor-derived
 *      one-sided bounds (populated by the anchor analysis stage). Epochs
 *      with neither are observed-but-unordered, which is never divergence.
 *
 * Verification status and chain topology stay separate dimensions:
 * reconstruction includes verifier-failed proofs as observed members and
 * never reinterprets a verification failure as a chain anomaly (or the
 * reverse). Validity enters exactly once, and conservatively: an epoch
 * lineage edge counts as hard ordering evidence only when both endpoint
 * proofs are intrinsically valid.
 *
 * Run this after verifyObservedProofs. Isolated validity rechecks reset
 * the verify package's module-level epoch link state (see validity.ts).
 */

import type {
  ChainComponent,
  ChainPartition,
  EpochLineageEdge,
  EpochLinkFields,
  EpochRecord,
  EpochRelationshipResult,
  IngestResult,
  ObservedProof,
  PartitionKey,
  ReconstructionResult,
} from "./types.js";
import { byCounterThenHash, isIntrinsicallyValid, parseCounter, pushMap } from "./validity.js";

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Reconstruct partitions, chain components, and epoch relationships from
 * an ingested bundle. Read-only over the ingest result. Deterministic:
 * the same bundle always produces the same structures in the same order.
 */
export async function reconstructChains(ingest: IngestResult): Promise<ReconstructionResult> {
  // -----------------------------------------------------------------------
  // 1. Partition per G6.
  // -----------------------------------------------------------------------
  const unchained: string[] = [];
  const unpartitioned: string[] = [];
  const partitionsByKey = new Map<string, { key: PartitionKey; members: ObservedProof[] }>();

  for (const proof of ingest.proofs) {
    if (proof.chainless) {
      unchained.push(proof.proofHash);
      continue;
    }
    if (proof.publicKeyB64 === undefined) {
      unpartitioned.push(proof.proofHash);
      continue;
    }
    const key: PartitionKey = {
      publicKeyB64: proof.publicKeyB64,
      ...(proof.epochId !== undefined ? { epochId: proof.epochId } : {}),
      chainId: proof.chainId,
    };
    const mapKey = JSON.stringify([key.publicKeyB64, key.epochId ?? null, key.chainId]);
    const existing = partitionsByKey.get(mapKey);
    if (existing === undefined) partitionsByKey.set(mapKey, { key, members: [proof] });
    else existing.members.push(proof);
  }

  const sortedEntries = [...partitionsByKey.values()].sort((a, b) =>
    comparePartitionKeys(a.key, b.key)
  );

  // -----------------------------------------------------------------------
  // 2. Reconstruct components per partition from hash links.
  // -----------------------------------------------------------------------
  const partitions: ChainPartition[] = [];
  /** Member hashes that have an in-partition successor (for terminal checks). */
  const hasInPartitionSuccessor = new Set<string>();
  /** proofHash -> partition map key, for cross-partition lookups. */
  const partitionOf = new Map<string, PartitionKey>();

  for (const entry of sortedEntries) {
    const partition = buildPartition(entry.key, entry.members, hasInPartitionSuccessor);
    partitions.push(partition);
    for (const hash of partition.memberProofHashes) partitionOf.set(hash, entry.key);
  }

  // -----------------------------------------------------------------------
  // 3. Epoch relationships per G1.
  // -----------------------------------------------------------------------
  const epochRelationships = await buildEpochRelationships(
    ingest,
    partitions,
    hasInPartitionSuccessor,
    partitionOf
  );

  return {
    partitions,
    unchainedProofHashes: unchained,
    unpartitionedProofHashes: unpartitioned,
    epochRelationships,
  };
}

// ---------------------------------------------------------------------------
// Partition and component construction
// ---------------------------------------------------------------------------

function comparePartitionKeys(a: PartitionKey, b: PartitionKey): number {
  if (a.chainId !== b.chainId) return a.chainId < b.chainId ? -1 : 1;
  const ea = a.epochId ?? "";
  const eb = b.epochId ?? "";
  if (ea !== eb) return ea < eb ? -1 : 1;
  if (a.publicKeyB64 !== b.publicKeyB64) return a.publicKeyB64 < b.publicKeyB64 ? -1 : 1;
  return 0;
}

function buildPartition(
  key: PartitionKey,
  members: ObservedProof[],
  hasInPartitionSuccessor: Set<string>
): ChainPartition {
  // Predecessor lookup is keyed by the CHAIN hash, not the identity hash:
  // commit.prevB64 references sha256(canonicalize(whole predecessor proof)),
  // which is computeChainHash, not the signed-body computeProofHash. Keying by
  // proofHash here would fail to link every real chain.
  const byChainHash = new Map<string, ObservedProof>(members.map((m) => [m.chainHash, m]));

  // Hash-link edges: successor's prevB64 equals a member's chain hash.
  const successors = new Map<string, ObservedProof[]>();
  const resolvedPrev = new Set<string>(); // member hashes whose prevB64 resolved in-partition

  // Union-find over member hashes.
  const parent = new Map<string, string>();
  for (const m of members) parent.set(m.proofHash, m.proofHash);
  const find = (x: string): string => {
    let root = x;
    while ((parent.get(root) as string) !== root) root = parent.get(root) as string;
    // Path compression.
    let cursor = x;
    while (cursor !== root) {
      const next = parent.get(cursor) as string;
      parent.set(cursor, root);
      cursor = next;
    }
    return root;
  };
  const union = (a: string, b: string): void => {
    const ra = find(a);
    const rb = find(b);
    if (ra !== rb) parent.set(ra, rb);
  };

  for (const m of members) {
    if (m.prevB64 === undefined) continue;
    const pred = byChainHash.get(m.prevB64);
    if (pred === undefined || pred.proofHash === m.proofHash) continue;
    resolvedPrev.add(m.proofHash);
    pushMap(successors, pred.proofHash, m);
    hasInPartitionSuccessor.add(pred.proofHash);
    union(pred.proofHash, m.proofHash);
  }

  // Group members into connected components.
  const membersByRoot = new Map<string, ObservedProof[]>();
  for (const m of members) pushMap(membersByRoot, find(m.proofHash), m);

  const components: ChainComponent[] = [];
  for (const componentMembers of membersByRoot.values()) {
    components.push(buildComponent(componentMembers, successors, resolvedPrev));
  }
  components.sort(compareComponents);

  const memberProofHashes = [...members].sort(byCounterThenHash).map((m) => m.proofHash);
  return { key, memberProofHashes, components };
}

function buildComponent(
  componentMembers: ObservedProof[],
  successors: Map<string, ObservedProof[]>,
  resolvedPrev: Set<string>
): ChainComponent {
  const sorted = [...componentMembers].sort(byCounterThenHash);
  const genesis = sorted.filter((m) => m.prevB64 === undefined);
  const broken = sorted.filter((m) => m.prevB64 !== undefined && !resolvedPrev.has(m.proofHash));
  const terminals = sorted.filter((m) => (successors.get(m.proofHash) ?? []).length === 0);

  // Link-order traversal: deterministic iterative DFS from genesis and
  // broken-link entry points, following successor hash links, branches
  // ordered by counter then hash. Iterative so long chains never hit
  // recursion limits.
  const visited = new Set<string>();
  const order: string[] = [];
  const visitFrom = (startHash: string): void => {
    const stack: string[] = [startHash];
    while (stack.length > 0) {
      const hash = stack.pop() as string;
      if (visited.has(hash)) continue;
      visited.add(hash);
      order.push(hash);
      const next = [...(successors.get(hash) ?? [])].sort(byCounterThenHash);
      for (let i = next.length - 1; i >= 0; i--) stack.push((next[i] as ObservedProof).proofHash);
    }
  };
  for (const start of [...genesis, ...broken]) visitFrom(start.proofHash);
  // Defensive completeness: prevB64 links cannot form cycles among
  // observed members (a cycle needs a proof whose canonical SHA-256 hash
  // appears inside its own signed body, a hash fixpoint), so every member
  // is reachable from an entry point. Cover any leftovers anyway.
  for (const m of sorted) {
    if (!visited.has(m.proofHash)) visitFrom(m.proofHash);
  }

  // Counter evidence over both position kinds (G2: a proof spans two
  // positions, its slotCounter and its commit counter).
  let min: bigint | undefined;
  let max: bigint | undefined;
  for (const m of componentMembers) {
    for (const value of [m.counter, m.slotCounter]) {
      const n = parseCounter(value);
      if (n === undefined) continue;
      if (min === undefined || n < min) min = n;
      if (max === undefined || n > max) max = n;
    }
  }

  return {
    memberProofHashes: order,
    genesisProofHashes: genesis.map((m) => m.proofHash),
    brokenLinkProofHashes: broken.map((m) => m.proofHash),
    terminalProofHashes: terminals.map((m) => m.proofHash),
    hasCounterEvidence: min !== undefined,
    ...(min !== undefined && max !== undefined
      ? { positionRange: { min: String(min), max: String(max) } }
      : {}),
  };
}

function compareComponents(a: ChainComponent, b: ChainComponent): number {
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
// Epoch relationships (G1)
// ---------------------------------------------------------------------------

async function buildEpochRelationships(
  ingest: IngestResult,
  partitions: ChainPartition[],
  hasInPartitionSuccessor: Set<string>,
  partitionOf: Map<string, PartitionKey>
): Promise<EpochRelationshipResult> {
  // Epoch inventory from partitioned proofs.
  const epochAccum = new Map<
    string,
    { chainIds: Set<string>; publicKeys: Set<string>; proofCount: number }
  >();
  for (const partition of partitions) {
    const epochId = partition.key.epochId;
    if (epochId === undefined) continue;
    let accum = epochAccum.get(epochId);
    if (accum === undefined) {
      accum = { chainIds: new Set(), publicKeys: new Set(), proofCount: 0 };
      epochAccum.set(epochId, accum);
    }
    accum.chainIds.add(partition.key.chainId);
    accum.publicKeys.add(partition.key.publicKeyB64);
    accum.proofCount += partition.memberProofHashes.length;
  }

  // Keyed by CHAIN hash: epochLink.prevProofHashB64 references the predecessor
  // terminal proof's chain hash (the same whole-proof hash the enclave writes
  // into prevB64), not its signed-body identity hash.
  const byChainHash = new Map<string, ObservedProof>(ingest.proofs.map((p) => [p.chainHash, p]));

  // Analyze every observed epochLink, in observation order.
  const edges: EpochLineageEdge[] = [];
  for (const proof of ingest.proofs) {
    if (!proof.hasEpochLink) continue;
    const link = extractEpochLink(proof);
    if (link === null) continue; // malformed shape; the verification dimension reports it
    edges.push(
      await analyzeEdge(link, proof, byChainHash, epochAccum, hasInPartitionSuccessor, partitionOf)
    );
  }

  // Transitive ordering over hard edges only.
  const orderedPairs = deriveOrderedPairs(edges);

  // Epoch records.
  const linkedEpochs = new Set<string>();
  const directPredecessors = new Map<string, Set<string>>();
  const directSuccessors = new Map<string, Set<string>>();
  for (const edge of edges) {
    if (!edge.hardEdge) continue;
    linkedEpochs.add(edge.fromEpochId);
    linkedEpochs.add(edge.toEpochId);
    addToSetMap(directPredecessors, edge.toEpochId, edge.fromEpochId);
    addToSetMap(directSuccessors, edge.fromEpochId, edge.toEpochId);
  }

  const epochs: EpochRecord[] = [...epochAccum.entries()]
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([epochId, accum]) => ({
      epochId,
      chainIds: [...accum.chainIds].sort(),
      publicKeysB64: [...accum.publicKeys].sort(),
      proofCount: accum.proofCount,
      ordering: linkedEpochs.has(epochId) ? ("linked" as const) : ("observed-but-unordered" as const),
      linkedPredecessorEpochIds: [...(directPredecessors.get(epochId) ?? [])].sort(),
      linkedSuccessorEpochIds: [...(directSuccessors.get(epochId) ?? [])].sort(),
    }));

  return { epochs, edges, orderedPairs };
}

/** Extract the six declared epochLink fields; null when any is not a string. */
function extractEpochLink(proof: ObservedProof): EpochLinkFields | null {
  const commit = (proof.proof as unknown as Record<string, unknown>)["commit"];
  if (commit === null || typeof commit !== "object") return null;
  const raw = (commit as Record<string, unknown>)["epochLink"];
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) return null;
  const link = raw as Record<string, unknown>;
  const fields = [
    "prevEpochId",
    "prevPublicKeyB64",
    "prevCounter",
    "prevProofHashB64",
    "toEpochId",
    "toPublicKeyB64",
  ] as const;
  const out: Record<string, string> = {};
  for (const field of fields) {
    const value = link[field];
    if (typeof value !== "string" || value.length === 0) return null;
    out[field] = value;
  }
  return out as unknown as EpochLinkFields;
}

async function analyzeEdge(
  link: EpochLinkFields,
  viaProof: ObservedProof,
  byChainHash: Map<string, ObservedProof>,
  epochAccum: Map<string, { chainIds: Set<string>; publicKeys: Set<string>; proofCount: number }>,
  hasInPartitionSuccessor: Set<string>,
  partitionOf: Map<string, PartitionKey>
): Promise<EpochLineageEdge> {
  const viaProofValid = await isIntrinsicallyValid(viaProof);
  const predecessor = byChainHash.get(link.prevProofHashB64);

  if (predecessor === undefined) {
    const priorEpochObserved = epochAccum.has(link.prevEpochId);
    return {
      fromEpochId: link.prevEpochId,
      toEpochId: link.toEpochId,
      viaProofHash: viaProof.proofHash,
      link,
      resolution: priorEpochObserved ? "terminal-missing" : "dangling",
      viaProofValid,
      hardEdge: false,
    };
  }

  const inconsistencies: string[] = [];
  if (predecessor.epochId !== link.prevEpochId) {
    inconsistencies.push(
      `the referenced proof's epochId (${predecessor.epochId ?? "absent"}) does not match epochLink.prevEpochId (${link.prevEpochId})`
    );
  }
  if (predecessor.publicKeyB64 !== link.prevPublicKeyB64) {
    inconsistencies.push(
      "the referenced proof's signer key does not match epochLink.prevPublicKeyB64"
    );
  }
  if (!countersEqual(predecessor.counter, link.prevCounter)) {
    inconsistencies.push(
      `the referenced proof's counter (${predecessor.counter ?? "absent"}) does not match epochLink.prevCounter (${link.prevCounter})`
    );
  }

  const predecessorValid = await isIntrinsicallyValid(predecessor);
  const metadataConsistent = inconsistencies.length === 0;
  const predecessorPartitioned = partitionOf.has(predecessor.proofHash);

  return {
    fromEpochId: link.prevEpochId,
    toEpochId: link.toEpochId,
    viaProofHash: viaProof.proofHash,
    link,
    resolution: "matched",
    predecessorProofHash: predecessor.proofHash,
    metadataConsistent,
    ...(metadataConsistent ? {} : { inconsistencies }),
    ...(predecessorPartitioned
      ? { referencedProofIsTerminal: !hasInPartitionSuccessor.has(predecessor.proofHash) }
      : {}),
    viaProofValid,
    predecessorValid,
    hardEdge: metadataConsistent && viaProofValid && predecessorValid,
  };
}

function countersEqual(a: string | undefined, b: string): boolean {
  if (a === undefined) return false;
  if (a === b) return true;
  const na = parseCounter(a);
  const nb = parseCounter(b);
  return na !== undefined && nb !== undefined && na === nb;
}

/**
 * Transitive closure over hard edges. Pairs reachable in both directions
 * (only a lineage cycle produces this) are removed: contradictory
 * ordering evidence is never asserted either way. The cycle itself is
 * classified by the anomaly stage.
 */
function deriveOrderedPairs(
  edges: EpochLineageEdge[]
): Array<{ beforeEpochId: string; afterEpochId: string }> {
  const adjacency = new Map<string, Set<string>>();
  const nodes = new Set<string>();
  for (const edge of edges) {
    if (!edge.hardEdge) continue;
    addToSetMap(adjacency, edge.fromEpochId, edge.toEpochId);
    nodes.add(edge.fromEpochId);
    nodes.add(edge.toEpochId);
  }

  const pairs = new Set<string>();
  for (const start of nodes) {
    // Iterative DFS reachability.
    const reached = new Set<string>();
    const stack = [...(adjacency.get(start) ?? [])];
    while (stack.length > 0) {
      const node = stack.pop() as string;
      if (reached.has(node)) continue;
      reached.add(node);
      for (const next of adjacency.get(node) ?? []) stack.push(next);
    }
    for (const node of reached) {
      if (node !== start) pairs.add(`${start} ${node}`);
    }
  }

  const result: Array<{ beforeEpochId: string; afterEpochId: string }> = [];
  for (const pair of pairs) {
    const [before, after] = pair.split(" ") as [string, string];
    if (pairs.has(`${after} ${before}`)) continue; // contradictory: assert neither
    result.push({ beforeEpochId: before, afterEpochId: after });
  }
  result.sort((a, b) =>
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
  return result;
}

function addToSetMap(map: Map<string, Set<string>>, key: string, value: string): void {
  const set = map.get(key);
  if (set === undefined) map.set(key, new Set([value]));
  else set.add(value);
}
