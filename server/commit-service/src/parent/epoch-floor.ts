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
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";

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

// ---------------------------------------------------------------------------
// The genesis transaction (bitgraph-epoch-genesis/1, 2026-10-23): the epoch opens with a Base WRITE, not a read.
//
// A block read is the host's choice, so an old block makes the floor loose and nothing in the proofs says how old;
// a patient host could label epochs out of order. The ceiling writer (src/ceiling/genesis.ts) holds the Base key, so
// the parent asks it: a request file naming the epoch goes into the shared genesis directory, the writer sends one
// self-addressed transaction carrying "BGE1" and the epoch id, and once it is mined writes the result file. The
// parent binds that file's SHA-256 as the epoch's first BitGraph. The transaction cannot predate the epoch's key
// (the id is derived from it) and the first BitGraph cannot predate the transaction's block, so the epoch is pinned
// from both sides on Base alone. When the writer does not answer in time, the block read above is the fallback.
// ---------------------------------------------------------------------------

export const EPOCH_GENESIS_REQUEST_FORMAT = "bitgraph-epoch-genesis-request/1";
export const EPOCH_GENESIS_FORMAT = "bitgraph-epoch-genesis/1";

/** Where requests and results are exchanged with the ceiling writer (its CEILING_GENESIS_DIR). Null = off. */
export function epochGenesisDir(): string | null {
  const d = process.env["EPOCH_GENESIS_DIR"];
  return d && d.trim() ? d.trim() : null;
}

const safeName = (b64: string): string => b64.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

/** Ask the writer for this epoch's genesis transaction. Idempotent: an existing request is left alone. */
export function requestEpochGenesis(dir: string, epochId: string): void {
  mkdirSync(dir, { recursive: true });
  const path = join(dir, `${safeName(epochId)}.request.json`);
  if (existsSync(path) || existsSync(join(dir, `${safeName(epochId)}.json`))) return;
  const tmp = `${path}.tmp-${process.pid}`;
  writeFileSync(tmp, JSON.stringify({ format: EPOCH_GENESIS_REQUEST_FORMAT, epochId, requestedAt: new Date().toISOString() }, null, 2) + "\n", { mode: 0o600 });
  renameSync(tmp, path);
}

/** The result file's text once the writer has it, checked to name this epoch; null when not there yet or malformed. */
export function readEpochGenesis(dir: string, epochId: string): string | null {
  const path = join(dir, `${safeName(epochId)}.json`);
  if (!existsSync(path)) return null;
  const text = readFileSync(path, "utf8");
  try {
    const o = JSON.parse(text) as { format?: string; epochId?: string; txHash?: string; blockNumber?: number };
    if (o.format !== EPOCH_GENESIS_FORMAT || o.epochId !== epochId || typeof o.txHash !== "string" || !Number.isSafeInteger(o.blockNumber)) return null;
  } catch { return null; }
  return text;
}

/** Wait for the writer's result, polling, up to `waitMs`. Null on timeout. */
export async function awaitEpochGenesis(dir: string, epochId: string, waitMs: number, pollMs = 1000): Promise<string | null> {
  const deadline = Date.now() + waitMs;
  for (;;) {
    const text = readEpochGenesis(dir, epochId);
    if (text) return text;
    if (Date.now() > deadline) return null;
    await new Promise((r) => setTimeout(r, pollMs));
  }
}
