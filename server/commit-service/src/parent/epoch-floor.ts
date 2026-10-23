/**
 * The epoch's first BitGraph: a fresh read of the latest Base block (Mike, 2026-10-18: "The epochs can't link. The
 * best way to handle this is to write in the first bitgraph as a read of the latest base block. That anchors the new
 * epoch in wall clock time and differentiates it from yesterdays and tomorrows").
 *
 * Epochs are not chained: each stands on its own key and attestation. Its first BitGraph binds epoch-floor.json, the
 * latest Base block (number, hash, time) and this epoch's id, so:
 *   - the epoch began after that block existed (a block hash cannot be known before its block), in public time;
 *   - the file names the epoch, so no two epochs share a starting record.
 * A host that read an old block would only make the floor earlier, never false; the attestation's own time is in the
 * proof beside it.
 *
 * Only when the enclave reports counter 0 (a fresh epoch, nothing bound yet), and only once: a host restart mid-epoch
 * finds the counter past 0 and binds nothing. The file and its proof are kept in the ledger bucket, the file under
 * epoch-floors/<epoch>.json (create-only, Object Lock like the proofs), so anyone can check it against Base.
 */

import { createHash } from "node:crypto";

export interface EpochFloorBlock { number: number; hash: string; timestamp: number }

const DEFAULT_RPCS = ["https://mainnet.base.org"];

/** The latest Base block, from the first RPC that answers. */
export async function latestBaseBlock(rpcs: readonly string[] = (process.env["BASE_FLOOR_RPC_URLS"] ?? "").split(",").map((s) => s.trim()).filter(Boolean)): Promise<EpochFloorBlock> {
  const urls = rpcs.length > 0 ? rpcs : DEFAULT_RPCS;
  let last: unknown = null;
  for (const url of urls) {
    try {
      const res = await fetch(url, {
        method: "POST", headers: { "content-type": "application/json" }, signal: AbortSignal.timeout(8000),
        body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "eth_getBlockByNumber", params: ["latest", false] }),
      });
      const r = ((await res.json()) as { result?: { number?: string; hash?: string; timestamp?: string } }).result;
      if (r?.number && r.hash && r.timestamp && /^0x[0-9a-f]{64}$/i.test(r.hash)) {
        return { number: parseInt(r.number, 16), hash: r.hash.toLowerCase(), timestamp: parseInt(r.timestamp, 16) };
      }
      last = new Error(`${url}: no block in the answer`);
    } catch (e) { last = e; }
  }
  throw last instanceof Error ? last : new Error("no Base RPC answered");
}

/** epoch-floor.json: the bytes the epoch's first BitGraph binds. */
export function epochFloorFile(epochId: string, block: EpochFloorBlock): string {
  return JSON.stringify({
    format: "bitgraph-epoch-floor/1",
    epochId,
    chain: "base-mainnet",
    chainId: 8453,
    number: block.number,
    hash: block.hash,
    timestamp: block.timestamp,
    note: "The first BitGraph of this epoch. The epoch began after this Base block existed.",
  }, null, 2) + "\n";
}

export const sha256B64 = (text: string): string => createHash("sha256").update(text, "utf8").digest("base64");
