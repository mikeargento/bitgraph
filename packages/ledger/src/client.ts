/**
 * BitGraph Ledger Client — lightweight wrapper for use by services.
 *
 * When LEDGER_BUCKET is set: stores proofs and anchors to S3 with Object Lock.
 * When LEDGER_BUCKET is not set: no-op (proofs still work, just not persisted to S3).
 */

import { Ledger } from "./s3.js";
import type { StoredProof, StoredAnchor } from "./types.js";

let ledger: Ledger | null = null;

const bucket = process.env.LEDGER_BUCKET;
if (bucket) {
  ledger = new Ledger({ bucket, region: process.env.LEDGER_REGION || "us-east-2" });
  console.log(`[ledger] S3 persistence enabled: ${bucket}`);
} else {
  console.log("[ledger] S3 persistence disabled (no LEDGER_BUCKET)");
}

/**
 * Persist a proof to the immutable ledger.
 * No-op if LEDGER_BUCKET is not configured.
 */
export async function persistProof(proof: Record<string, unknown>): Promise<StoredProof | null> {
  if (!ledger) return null;
  try {
    const stored = await ledger.storeProof(proof);
    console.log(`[ledger] proof stored: counter=${stored.commit.counter} hash=${stored.proofHash.slice(0, 16)}...`);
    return stored;
  } catch (err) {
    console.error("[ledger] failed to store proof:", (err as Error).message);
    return null;
  }
}

/**
 * Persist an Ethereum front anchor to the immutable ledger.
 * No-op if LEDGER_BUCKET is not configured.
 */
export async function persistAnchor(
  proof: Record<string, unknown>,
  ethereum: { blockNumber: number; blockHash: string }
): Promise<StoredAnchor | null> {
  if (!ledger) return null;
  try {
    // First store the proof
    const storedProof = await ledger.storeProof(proof);

    // Then store the anchor record
    const storedAnchor = await ledger.storeAnchor(storedProof, ethereum);
    console.log(`[ledger] anchor stored: block=${ethereum.blockNumber} counter=${storedAnchor.counter}`);
    return storedAnchor;
  } catch (err) {
    console.error("[ledger] failed to store anchor:", (err as Error).message);
    return null;
  }
}

/** Check if ledger persistence is enabled. */
export function isEnabled(): boolean {
  return ledger !== null;
}
