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
import { getCurrentEpoch, getObjectText, listEpochsWithBirth, listKeysUnderPrefix, runPool } from "@/lib/s3";
import { recordedMsOf } from "@/lib/recorded-time";

/** Enclave v11's first epoch (2026-10-17 02:22 UTC): the ledger starts here. */
export const LEDGER_START_MS = Date.UTC(2026, 9, 17, 2, 22);
export const LEDGER_FIRST_DAY = "2026-10-17";
const MAIN = "bitgraph:main";
const MAX_ROWS = 1000;

export interface LedgerRow {
  /** The payload's count: the BitGraph's number. */
  counter: string;
  /** The nonce's count, one before. */
  nonceCounter: string | null;
  /** The enclave's signed time (attestation timestamp), ms. */
  recordedMs: number | null;
  /** The proof hash, URL-safe base64, from the ledger key. */
  proofHash: string;
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

async function readRows(epoch: string): Promise<LedgerRow[]> {
  const keys = (await listKeysUnderPrefix(`proofs/${epoch}/`)).slice(-MAX_ROWS * 2);
  const rows: LedgerRow[] = [];
  await runPool(keys, 16, async (key) => {
    const m = key.match(/\/(\d{12})-([A-Za-z0-9_-]{43})\.json$/);
    if (!m) return;
    const text = await getObjectText(key);
    if (!text) return;
    let proof: { commit?: { chainId?: string; counter?: string; slotCounter?: string }; attribution?: { name?: string } };
    try { proof = JSON.parse(text); } catch { return; }
    if (proof.commit?.chainId !== MAIN) return;
    rows.push({
      counter: String(Number(m[1])),
      nonceCounter: proof.commit?.slotCounter ?? null,
      recordedMs: recordedMsOf(proof),
      proofHash: m[2]!,
      anchor: proof.attribution?.name === "Ethereum Anchor",
    });
  });
  return rows;
}

const pastRows = unstable_cache(readRows, ["running-ledger-rows-v1"], { revalidate: 86_400 });
const liveRows = unstable_cache(readRows, ["running-ledger-live-v1"], { revalidate: 10 });

/** The day's BitGraphs on bitgraph:main, newest first. Throws when the ledger cannot be read. */
export async function rowsForDay(day: string): Promise<LedgerRow[]> {
  const today = new Date().toISOString().slice(0, 10);
  const epochs = await epochsForDay(day);
  const lists = await Promise.all(epochs.map((e) => (day === today ? liveRows(e) : pastRows(e))));
  return lists.flat().sort((a, b) => (b.recordedMs ?? 0) - (a.recordedMs ?? 0) || Number(b.counter) - Number(a.counter)).slice(0, MAX_ROWS);
}

/** How many BitGraphs today has so far: the live page's cheap poll. */
export async function countToday(): Promise<{ day: string; count: number }> {
  const day = new Date().toISOString().slice(0, 10);
  const epochs = await epochsForDay(day);
  let count = 0;
  for (const e of epochs) count += (await listKeysUnderPrefix(`proofs/${e}/`)).length;
  return { day, count };
}
