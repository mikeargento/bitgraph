// Copyright (c) Argento Computing Inc. All rights reserved. See LICENSE.

/**
 * The running ledger (Mike, 2026-10-17: "a running ledger like the base one"):
 * every BitGraph made from enclave v11 on, newest first, one UTC day per page.
 *
 * Private by construction (Mike, same night: "its private since the hash is the
 * lookup"): a row carries the position, the two counts, the enclave's signed
 * time and the proof hash, NEVER the file's SHA-256. The proof page is
 * addressed by the file's hash, so the list cannot open anyone's record; a
 * BitGraph is found only by someone who holds its bits (the 2026-10-09 ruling
 * against a browsable gallery stands).
 *
 * Only bitgraph:main is listed: the sequence where every BitGraph is one
 * atomic action, two counts, so the counter runs straight through.
 */

import { unstable_cache } from "next/cache";
import { getCurrentEpoch, getObjectText, listEpochsWithBirth, listKeysAfter, listKeysUnderPrefix, runPool } from "@/lib/s3";
import { recordedMsOf } from "@/lib/recorded-time";

/** Enclave v11's first epoch (2026-10-17 02:22 UTC): the ledger starts here. */
export const LEDGER_START_MS = Date.UTC(2026, 9, 17, 2, 22);
export const LEDGER_FIRST_DAY = "2026-10-17";
const MAIN = "bitgraph:main";

export interface LedgerRow {
  /** The ledger key (proofs/<epoch>/<count>-<proofHash>.json): where the row sits in the day. */
  key: string;
  /** The payload's count: the BitGraph's number. */
  counter: string;
  /** The nonce's count, one before. */
  nonceCounter: string | null;
  /** The enclave's signed time (attestation timestamp), ms. */
  recordedMs: number | null;
  /** The proof hash, URL-safe base64, from the ledger key. */
  proofHash: string;
  /** The bound content's SHA-256, URL-safe base64: the proof page's address. Public since 2026-10-17 (Mike: every
   *  row links to its proof; a hash cannot be turned back into the file). */
  digest: string | null;
  /** True for the anchor service's binds (none from enclave v12 on). */
  anchor: boolean;
}

/** The UTC day an epoch belongs to: rotation runs at 23:59, so a few minutes after birth. */
function dayOfBirth(born: number): string {
  return new Date(born + 5 * 60_000).toISOString().slice(0, 10);
}

const epochsSinceStart = unstable_cache(
  async () => (await listEpochsWithBirth()).filter((e) => e.born >= LEDGER_START_MS - 60_000),
  ["running-ledger-epochs-v1"],
  { revalidate: 300 },
);

/** Every epoch whose day is `day` (normally one; two on a day the enclave was restarted by hand). */
export async function epochsForDay(day: string): Promise<string[]> {
  const today = new Date().toISOString().slice(0, 10);
  const all = await epochsSinceStart();
  const out = all.filter((e) => dayOfBirth(e.born) === day).map((e) => e.epoch);
  if (day === today) {
    // The current epoch may be minutes old and not yet in the cached index.
    const cur = await getCurrentEpoch();
    if (cur && !out.includes(cur)) out.push(cur);
  }
  return out;
}

/** One proof's row, read once and kept: a proof never changes, so its row is cached for good. Null when the key is
 *  not a bitgraph:main proof. */
const rowOfKey = unstable_cache(async (key: string): Promise<LedgerRow | null> => {
  const m = key.match(/\/(\d{12})-([A-Za-z0-9_-]{43})\.json$/);
  if (!m) return null;
  const text = await getObjectText(key);
  if (!text) return null;
  let proof: { commit?: { chainId?: string; counter?: string; slotCounter?: string }; attribution?: { name?: string }; artifact?: { digestB64?: string } };
  try { proof = JSON.parse(text); } catch { return null; }
  if (proof.commit?.chainId !== MAIN) return null;
  return {
    key,
    counter: String(Number(m[1])),
    nonceCounter: proof.commit?.slotCounter ?? null,
    recordedMs: recordedMsOf(proof),
    proofHash: m[2]!,
    digest: proof.artifact?.digestB64 ? proof.artifact.digestB64.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "") : null,
    anchor: proof.attribution?.name === "Ethereum Anchor",
  };
}, ["running-ledger-row-v3"], { revalidate: false });

async function rowsOfKeys(keys: string[]): Promise<LedgerRow[]> {
  const rows: Array<LedgerRow | null> = new Array(keys.length).fill(null);
  await runPool(keys.map((k, i) => ({ k, i })), 24, async ({ k, i }) => { rows[i] = await rowOfKey(k); });
  return rows.filter((r): r is LedgerRow => r !== null).reverse(); // newest first
}

/** Every proof key of the day, oldest first: the day's epochs in birth order, each epoch's keys in count order.
 *  A past day is listed once and kept; today is listed fresh. */
const pastDayKeys = unstable_cache(async (day: string) => {
  const epochs = await epochsForDay(day);
  return (await Promise.all(epochs.map((e) => listKeysUnderPrefix(`proofs/${e}/`)))).flat();
}, ["running-ledger-daykeys-v1"], { revalidate: 86_400 });
async function dayKeys(day: string): Promise<string[]> {
  if (day !== new Date().toISOString().slice(0, 10)) return pastDayKeys(day);
  const epochs = await epochsForDay(day);
  return (await Promise.all(epochs.map((e) => listKeysUnderPrefix(`proofs/${e}/`)))).flat();
}

export interface LedgerPage {
  rows: LedgerRow[];
  /** The newest key of the day so far (the live poll asks for rows after it), and whether older rows remain. */
  newestKey: string | null;
  hasOlder: boolean;
}

/** The newest `limit` BitGraphs of the day, newest first; with `beforeKey`, the `limit` before that key. */
export async function ledgerPage(day: string, limit = 200, beforeKey?: string): Promise<LedgerPage> {
  const keys = await dayKeys(day);
  const end = beforeKey ? keys.indexOf(beforeKey) : keys.length;
  const stop = end < 0 ? keys.length : end;
  const start = Math.max(0, stop - limit);
  return { rows: await rowsOfKeys(keys.slice(start, stop)), newestKey: keys[keys.length - 1] ?? null, hasOlder: start > 0 };
}

/** Today's BitGraphs made after `afterKey`, newest first: the live page's poll. It lists only what follows the key
 *  (its own epoch from that key on, and any newer epoch of the day), so it costs the same however long the day is. */
export async function rowsAfter(afterKey: string | null, limit = 1000): Promise<{ rows: LedgerRow[]; newestKey: string | null }> {
  const day = new Date().toISOString().slice(0, 10);
  const epochs = await epochsForDay(day);
  const afterEpoch = afterKey?.split("/")[1] ?? null;
  const from = afterEpoch ? epochs.indexOf(afterEpoch) : -1;
  const keys: string[] = [];
  for (let i = Math.max(0, from); i < epochs.length && keys.length < limit; i++) {
    const e = epochs[i]!;
    keys.push(...(await listKeysAfter(`proofs/${e}/`, e === afterEpoch ? afterKey ?? undefined : undefined, limit - keys.length)));
  }
  return { rows: await rowsOfKeys(keys), newestKey: keys[keys.length - 1] ?? afterKey };
}
