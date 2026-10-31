// Copyright (c) Argento Computing Inc. All rights reserved. See LICENSE.

/**
 * The block timeline in the public ledger: every count accounted for.
 *
 * Block reads take counts on the same sequence as files, but only files have a per-proof object (proofs/...), so the
 * ledger's file rows alone would show gaps where the reads are. The reads are in the enclave host's timeline batches
 * (timeline/<epoch>/<first>-<last>-<records>.jsonl.gz, one object a minute), and a listing of those keys is enough to
 * say what fills each gap: a batch holds every record from first to last exactly when records = (last - first)/2 + 1.
 *
 * Between two file rows the ledger shows one collapsed row for the records in between:
 *   recorded    every count is in a complete batch: block reads (and the epoch's genesis record, which has its own row)
 *   uploading   past the newest uploaded batch: the host uploads once a minute
 *   missing     a count no batch holds, inside what has been uploaded, or a batch with fewer records than its span
 *   unlisted    the epoch has no timeline batches at all (it ran before the timeline)
 * Opening the row reads the batches it covers and lists each read: its chain, block number and the enclave's time.
 */

import { unstable_cache } from "next/cache";
import { gunzipSync } from "node:zlib";
import { getObjectBytes, listKeysUnderPrefix } from "@/lib/s3";
import { recordedMsOf } from "@/lib/recorded-time";
import { liveBatch, parseBatchKey, type TimelineBatchKey, type TimelineRead } from "@/lib/timeline-ledger-core";

export { interleaveEpoch, interleaveDay, spanState, parseBatchKey, liveBatch, type ReadsRow, type TimelineRead, type TimelineBatchKey } from "@/lib/timeline-ledger-core";

/** The epoch's batch keys. A closed epoch's never change; today's are re-listed every 15 s at most. */
export const batchKeysOf = unstable_cache(async (epoch: string): Promise<TimelineBatchKey[]> => {
  const prefix = `timeline/${epoch}/`;
  return (await listKeysUnderPrefix(prefix, 50_000)).map((k) => parseBatchKey(prefix, k)).filter((b): b is TimelineBatchKey => b !== null);
}, ["timeline-ledger-batches-v1"], { revalidate: 15 });

const batchLines = unstable_cache(async (key: string): Promise<string[]> => {
  const bytes = await getObjectBytes(key);
  return bytes ? gunzipSync(bytes).toString("utf8").split("\n").filter(Boolean) : [];
}, ["timeline-ledger-batch-v1"], { revalidate: false });

const LIVE_URL = process.env.TIMELINE_LIVE_URL || "https://nitro.occproof.com/timeline/recent";

/**
 * The enclave host's records of `epoch` after count `after` that are not in an uploaded batch yet: the last minute or
 * so of the timeline. Empty when the host does not answer within 3 s; the ledger then shows what is uploaded.
 */
export async function liveRecords(epoch: string, after: number): Promise<TimelineRead[]> {
  try {
    const r = await fetch(`${LIVE_URL}?epoch=${epoch}&after=${after}`, { cache: "no-store", signal: AbortSignal.timeout(3000) });
    if (!r.ok) return [];
    const j = (await r.json()) as { records?: TimelineRead[] };
    return Array.isArray(j.records) ? j.records.filter((x) => typeof x.counter === "number" && x.counter > after) : [];
  } catch {
    return [];
  }
}

/** The epoch's uploaded batch keys and, when `live`, the host's records after the newest of them as one live span. */
export async function batchKeysWithLive(epoch: string, live: boolean): Promise<TimelineBatchKey[]> {
  const batches = await batchKeysOf(epoch);
  if (!live) return batches;
  const uploaded = batches.reduce((m, b) => Math.max(m, b.last), 0);
  const lb = liveBatch(epoch, (await liveRecords(epoch, uploaded)).map((r) => r.counter));
  return lb ? [...batches, lb] : batches;
}

/** The records with payload counts from..to, newest first, read from the batches that hold them (at most `limit`), and
 *  past the newest uploaded batch from the host's live records. */
export async function readsBetween(epoch: string, from: number, to: number, limit = 2000): Promise<{ reads: TimelineRead[]; truncated: boolean }> {
  const all = await batchKeysOf(epoch);
  const uploaded = all.reduce((m, b) => Math.max(m, b.last), 0);
  const batches = all.filter((b) => b.last >= from && b.first <= to).sort((a, b) => b.first - a.first);
  const reads: TimelineRead[] = [];
  if (to > uploaded) {
    for (const r of (await liveRecords(epoch, Math.max(uploaded, from - 2))).reverse()) {
      if (r.counter < from || r.counter > to) continue;
      reads.push(r);
      if (reads.length >= limit) return { reads, truncated: true };
    }
  }
  for (const b of batches) {
    for (const raw of (await batchLines(b.key)).reverse()) {
      let line: { kind?: string; proof?: { commit?: { counter?: string } }; blockFile?: string };
      try { line = JSON.parse(raw); } catch { continue; }
      const counter = Number(line.proof?.commit?.counter ?? NaN);
      if (!(counter >= from && counter <= to)) continue;
      const kind = line.kind === "block" || line.kind === "genesis" ? line.kind : "file";
      const read: TimelineRead = { counter, kind, recordedMs: recordedMsOf(line.proof as never) };
      if (kind === "block" && line.blockFile) {
        try {
          const f = JSON.parse(line.blockFile) as { chain?: string; number?: number };
          if (typeof f.chain === "string") read.chain = f.chain;
          if (typeof f.number === "number") read.number = f.number;
        } catch { /* listed without its block */ }
      }
      reads.push(read);
      if (reads.length >= limit) return { reads, truncated: true };
    }
  }
  reads.sort((a, b) => b.counter - a.counter);
  return { reads, truncated: false };
}

/** One record of the timeline by its count: from the uploaded batches, else (the last minute) from the enclave host. */
export async function timelineRecordAt(epoch: string, counter: number): Promise<{ kind: string; proof: Record<string, unknown> & { artifact: { digestB64: string } }; blockFile?: string; genesisFile?: string } | null> {
  const batch = (await batchKeysOf(epoch)).find((b) => b.first <= counter && b.last >= counter);
  const parse = (raw: string) => { try { return JSON.parse(raw) as { kind: string; proof: Record<string, unknown> & { artifact: { digestB64: string }; commit?: { counter?: string } }; blockFile?: string; genesisFile?: string }; } catch { return null; } };
  if (batch) {
    for (const raw of await batchLines(batch.key)) {
      const l = parse(raw);
      if (l && Number(l.proof?.commit?.counter) === counter) return l;
    }
    return null;
  }
  try {
    const r = await fetch(`${LIVE_URL}?epoch=${epoch}&after=${counter - 2}&full=1`, { cache: "no-store", signal: AbortSignal.timeout(3000) });
    if (!r.ok) return null;
    const j = (await r.json()) as { lines?: Array<{ kind: string; proof: Record<string, unknown> & { artifact: { digestB64: string }; commit?: { counter?: string } }; blockFile?: string; genesisFile?: string }> };
    return j.lines?.find((l) => Number(l.proof?.commit?.counter) === counter) ?? null;
  } catch {
    return null;
  }
}
