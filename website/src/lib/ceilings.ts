/**
 * Base ceilings: reading what the ceiling writer publishes.
 *
 * The writer (server/commit-service/src/ceiling/) puts two kinds of object
 * under `ceilings/` in the ledger bucket:
 *
 *   ceilings/<safe proofHash>.ceiling.json      one per record (bitgraph-ceiling/1)
 *   ceilings/writes/<UTC day>/<block>-<tx>.json  one per Base transaction
 *
 * Both are UNSIGNED and trusted for nothing: every value in them is bound to
 * a Base transaction a reader can open on Basescan, and the sidecar is fully
 * checkable offline with verifyCeiling. This module only reads and shapes.
 *
 * CEILINGS_LOCAL_DIR (development only) reads the same layout from disk, so
 * the page can be previewed from a writer's state directory.
 */

import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import { getObjectText, listKeysUnderPrefix, runPool } from "@/lib/s3";

/** The declared writer. Anything signed by another address is not ours. */
export const CEILING_WRITER = "0xf3972408D853c975F86351C311f4310220bbF2a3";
export const CEILING_CHAIN_ID = 8453;
export const BASESCAN = "https://basescan.org";

export type CeilingStatus = "pending" | "included" | "safe" | "finalized" | "dropped";

export interface CeilingWrite {
  txHash: string;
  blockNumber: number;
  blockHash: string;
  blockTimestamp: number;
  status: CeilingStatus;
  records: number;
  firstPos: string;
  lastPos: string;
  epochId: string;
  fees: { l2Wei: string; l1Wei: string; totalWei: string };
  items: Array<{ proofHash: string; position: string; digestB64?: string }>;
}

const LOCAL = process.env.NODE_ENV !== "production" ? process.env.CEILINGS_LOCAL_DIR : undefined;

async function readKey(key: string): Promise<string | null> {
  if (LOCAL) {
    try { return await readFile(join(LOCAL, key.replace(/^ceilings\//, "")), "utf8"); } catch { return null; }
  }
  return getObjectText(key);
}

async function listKeys(prefix: string): Promise<string[]> {
  if (LOCAL) {
    const dir = join(LOCAL, prefix.replace(/^ceilings\//, ""));
    try { return (await readdir(dir)).filter((f) => f.endsWith(".json")).map((f) => `${prefix}${f}`).sort(); } catch { return []; }
  }
  return listKeysUnderPrefix(prefix);
}

/** Standard base64 to the ledger's URL-safe, unpadded form. */
export function safeB64(b64: string): string {
  return b64.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/** One record's sidecar, raw JSON text, or null when none has been written. */
export async function readSidecarText(proofHashB64: string): Promise<string | null> {
  if (!/^[A-Za-z0-9+/_-]{43}=?$/.test(proofHashB64)) return null;
  return readKey(`ceilings/${safeB64(proofHashB64)}.ceiling.json`);
}

/**
 * Writes left off the Ceilings list (Mike, 2026-09-29: "remove that 46 its a
 * glitch"). The first write was the catch-up of 46 records queued while the
 * writer waited to be funded. It is on Base for good and its records' ceilings
 * are valid: their proof pages and its own detail page still show it. Only the
 * day list skips it, so the list starts at the second write.
 */
const HIDDEN_FROM_LIST = new Set([
  "0xa0bef4c46258df4044149dd2f55a771793d1f06e21770f14d187af3783e5de0d",
]);

/** Every write whose block falls on `day` (UTC), newest first. */
export async function writesForDay(day: string, opts: { includeHidden?: boolean } = {}): Promise<CeilingWrite[]> {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) return [];
  const keys = await listKeys(`ceilings/writes/${day}/`);
  const settled = await runPool(keys, 16, async (k) => JSON.parse((await readKey(k)) ?? "null") as CeilingWrite | null);
  const out: CeilingWrite[] = [];
  for (const r of settled) {
    if (r.status !== "fulfilled" || !r.value) continue;
    if (!opts.includeHidden && HIDDEN_FROM_LIST.has(r.value.txHash.toLowerCase())) continue;
    out.push(r.value);
  }
  return out.sort((a, b) => b.blockNumber - a.blockNumber);
}
