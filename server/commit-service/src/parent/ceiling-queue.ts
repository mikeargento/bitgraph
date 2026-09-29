// Copyright (c) Argento Computing Inc. All rights reserved. See LICENSE.

/**
 * The parent's only part in the ceiling: append one line per new record to a
 * local file, after the proof exists, without waiting. The writer
 * (src/ceiling/) is a separate process that holds the Base key and reads this
 * file; the parent never sees the key and never talks to Base.
 *
 * Off unless CEILING_QUEUE_PATH is set. Anchor proofs are not queued: they
 * arrive every ~12 s with no record in them, and a ceiling is for records.
 */

import { appendFile } from "node:fs/promises";
import type { BitGraphProof } from "bitgraph";

const QUEUE_PATH = process.env["CEILING_QUEUE_PATH"];

export interface CeilingQueueItem {
  proofHash: string;
  /** artifact.digestB64: where the record's proof page lives (/proof/<digest>). Absent on items queued before 09-29 evening. */
  digestB64?: string;
  /** commit.counter: a position on (epochId, chainId). */
  position: string;
  epochId: string;
  chainId: string;
  /** Server time, informational only. */
  committedAt: string;
  /** The proof's signed floor (commit.slotAnchor), so the writer can fetch its header. */
  floor: { blockNumber: number; blockHash: string } | null;
}

export function ceilingQueueEnabled(): boolean {
  return Boolean(QUEUE_PATH);
}

export function ceilingItems(proofs: BitGraphProof[], committedAt: Date): CeilingQueueItem[] {
  const out: CeilingQueueItem[] = [];
  for (const p of proofs) {
    const proofHash = (p as BitGraphProof & { proofHash?: string }).proofHash;
    // slotAnchor is declared here too: the host builds against an older published type.
    const commit = p.commit as BitGraphProof["commit"] & {
      chainId?: string;
      anchor?: unknown;
      slotAnchor?: { counter: string; blockNumber: number; blockHash: string };
    };
    if (!proofHash || !commit.counter || !commit.epochId) continue;
    if (commit.anchor || p.attribution?.name === "Ethereum Anchor") continue;
    out.push({
      proofHash,
      digestB64: p.artifact.digestB64,
      position: commit.counter,
      epochId: commit.epochId,
      chainId: commit.chainId ?? "",
      committedAt: committedAt.toISOString(),
      floor: commit.slotAnchor ? { blockNumber: commit.slotAnchor.blockNumber, blockHash: commit.slotAnchor.blockHash } : null,
    });
  }
  return out;
}

/** Fire and forget. A failure is logged and costs that record its ceiling, never the commit. */
export function enqueueCeiling(proofs: BitGraphProof[]): void {
  if (!QUEUE_PATH) return;
  const items = ceilingItems(proofs, new Date());
  if (items.length === 0) return;
  const lines = items.map((i) => JSON.stringify(i)).join("\n") + "\n";
  appendFile(QUEUE_PATH, lines, { encoding: "utf8", mode: 0o600 }).catch((e: unknown) => {
    console.warn(`[parent] ceiling queue append failed: ${e instanceof Error ? e.message : String(e)}`);
  });
}
