// Copyright (c) 2024-2026 Mike Argento. All rights reserved.

/**
 * The Roll index: chunk storage over the existing ledger bucket.
 *
 * Flat objects plus CDN caching, no database. Three kinds of object, all under
 * `roll/v1/` and all DERIVED — the Object-Locked `proofs/` prefix stays the
 * only authority, and `scripts/rebuild-roll-index.mjs` reconstructs every one
 * of these from it. If the index and the ledger ever disagree, the ledger wins
 * and the index is rebuilt.
 *
 *   roll/v1/{epoch}/c/{from}-{to}.json   sealed chunk, immutable forever
 *   roll/v1/{epoch}/state.json           { sealedThrough } — a floor, monotonic
 *
 * There is deliberately no head object. The head must never be cached, and a
 * stored head is a cache with no expiry: it would be wrong for exactly as long
 * as whatever failed to update it. It is computed instead, cheaply, by walking
 * forward from `sealedThrough` — which is a floor, so a stale one costs a few
 * extra LIST pages and can never produce a wrong answer.
 *
 * WHY SEALING HAPPENS ON FIRST READ RATHER THAN AT COMMIT
 *
 * The plan called for appending at commit time, and the commit path does know
 * everything needed. It writes from two places this codebase does not deploy
 * with the site: the EC2 parent (`server/commit-service/`, marked Don't Touch,
 * a systemd service on the enclave host) and the anchor service on Railway.
 * Putting index writes there buys freshness at the cost of two more deploy
 * surfaces, and anchors — 6353 of today's 16911 objects — come from the one
 * this repo touches least.
 *
 * Sealing on first read gets the same end state without touching either. A
 * sealed chunk is built once from the ledger and is immutable from then on, so
 * the work is paid once per 2048 counters instead of once per page view, and
 * the rebuild script pre-builds them so a visitor normally never pays it at
 * all. The invariant the plan actually cared about — that a failed index write
 * can never block or fail a commit — holds trivially here: the commit path is
 * not modified.
 */
import { S3Client, GetObjectCommand, PutObjectCommand, ListObjectsV2Command } from "@aws-sdk/client-s3";
import {
  CHUNK_PREFIX, CHUNK_WIDTH, chunkKey, chunkRange, isSealed, tailChunkIndex,
  type Chunk, type RollRow,
} from "./roll-chunks";

const region = (process.env.LEDGER_REGION || "us-east-2").trim();
const bucket = (process.env.LEDGER_BUCKET || "occ-ledger-prod").trim();
const s3 = new S3Client({ region });

const pad = (n: number) => String(n).padStart(12, "0");
const toSafe = (b64: string) => b64.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

async function getJson<T>(key: string): Promise<T | null> {
  try {
    const r = await s3.send(new GetObjectCommand({ Bucket: bucket, Key: key }));
    const body = await r.Body?.transformToString();
    return body ? (JSON.parse(body) as T) : null;
  } catch {
    return null;
  }
}

/** Writes go ONLY under roll/v1/. Nothing here can touch proofs/, and none of
 *  it carries an Object Lock: derived state must stay deletable, or a bug
 *  becomes permanent (the reason the day-segment map was never put here). */
async function putJson(key: string, value: unknown): Promise<void> {
  if (!key.startsWith(`${CHUNK_PREFIX}/`)) throw new Error(`roll-index: refusing to write outside ${CHUNK_PREFIX}/: ${key}`);
  await s3.send(new PutObjectCommand({
    Bucket: bucket, Key: key, Body: JSON.stringify(value), ContentType: "application/json",
  }));
}

// ── the display record ─────────────────────────────────────────────────────

/** Everything a Roll row shows, and nothing else. The commit path already knows
 *  all of it at write time; this is the same extraction, done from the stored
 *  proof. Returns null for anything without a counter, which cannot be placed. */
export function rowFromProof(p: Record<string, unknown>, lastModifiedMs?: number): RollRow | null {
  const commit = (p.commit as Record<string, unknown>) || {};
  const artifact = (p.artifact as Record<string, unknown>) || {};
  const attribution = (p.attribution as Record<string, unknown>) || {};
  const c = parseInt(String(commit.counter ?? "0"), 10);
  if (!c) return null;
  const name = attribution.name;
  const t: RollRow["t"] = name === "Ethereum Anchor" ? "a" : name === "Interval" ? "i" : "p";
  const digestB64 = String(artifact.digestB64 || "");
  const proofHash = String((p.proofHash as string) || commit.prevB64 || digestB64 || "");
  let b: number | undefined;
  if (t !== "p") {
    const meta = ((p.metadata as Record<string, unknown>)?.interval as { originalBlockNumber?: number }) || null;
    const m = String(attribution.title || "").match(/\/block\/(\d+)/);
    b = m ? parseInt(m[1], 10) : meta?.originalBlockNumber;
  }
  return {
    c, t,
    d: toSafe(digestB64),
    h: toSafe(proofHash).slice(0, 10),
    ...(b != null ? { b } : {}),
    ...(lastModifiedMs ? { at: lastModifiedMs } : {}),
  };
}

// ── the head ───────────────────────────────────────────────────────────────

type State = { sealedThrough: number };

const stateKey = (epoch: string) => `${CHUNK_PREFIX}/${epoch}/state.json`;

/**
 * Highest counter in the epoch.
 *
 * Bounded forward walk from `sealedThrough`, which is a floor and therefore
 * safe to be stale: a low floor only means more pages. The old code walked from
 * ZERO with a 12-page cap, and once the epoch outgrew 12000 objects it threw
 * away the answer it had computed and paid for a 20-probe binary search on top
 * — 3.2s measured, to learn one number. From a floor one chunk back the walk is
 * one or two pages.
 *
 * PAGES is a safety rail, not a budget: unlike the old cap, running out here
 * returns the highest counter actually SEEN, which is a floor, never a wrong
 * head. A floor makes the client say it is behind. The old cap made it lie.
 */
const HEAD_WALK_PAGES = 40;

export async function computeHead(epoch: string): Promise<number> {
  const state = await getJson<State>(stateKey(epoch));
  const floor = Math.max(0, state?.sealedThrough ?? 0);
  const prefix = `proofs/${epoch}/`;
  let head = floor;
  let token: string | undefined;
  let startAfter: string | undefined = floor > 0 ? `${prefix}${pad(floor)}` : undefined;
  for (let page = 0; page < HEAD_WALK_PAGES; page++) {
    const r: { Contents?: Array<{ Key?: string }>; NextContinuationToken?: string } = await s3.send(new ListObjectsV2Command({
      Bucket: bucket, Prefix: prefix, MaxKeys: 1000,
      ...(token ? { ContinuationToken: token } : startAfter ? { StartAfter: startAfter } : {}),
    }));
    const contents = r.Contents || [];
    if (contents.length) {
      const last = contents[contents.length - 1].Key || "";
      const n = parseInt((last.split("/").pop() || "").split("-")[0], 10);
      if (!isNaN(n) && n > head) head = n;
    }
    token = r.NextContinuationToken;
    startAfter = undefined;
    if (!token) break;
  }
  return head;
}

// ── chunks ─────────────────────────────────────────────────────────────────

/**
 * Every stored row in [from, to], read from the ledger.
 *
 * This is the expensive operation the whole design exists to amortise: one LIST
 * per 1000 keys plus one GET per object. A 2048-counter chunk is ~1024 objects.
 * It runs once per chunk, ever — from the rebuild script normally, or from the
 * first reader of a chunk the script has not reached yet.
 */
export async function buildRowsFromLedger(epoch: string, from: number, to: number): Promise<RollRow[]> {
  const prefix = `proofs/${epoch}/`;
  const keys: Array<{ key: string; lm?: number }> = [];
  let token: string | undefined;
  let startAfter: string | undefined = `${prefix}${pad(from - 1)}`;
  for (let page = 0; page < 8; page++) {
    const r: { Contents?: Array<{ Key?: string; LastModified?: Date }>; NextContinuationToken?: string } = await s3.send(new ListObjectsV2Command({
      Bucket: bucket, Prefix: prefix, MaxKeys: 1000,
      ...(token ? { ContinuationToken: token } : { StartAfter: startAfter }),
    }));
    let past = false;
    for (const o of r.Contents || []) {
      const n = parseInt(((o.Key || "").split("/").pop() || "").split("-")[0], 10);
      if (isNaN(n)) continue;
      if (n > to) { past = true; break; }
      if (n >= from) keys.push({ key: o.Key!, lm: o.LastModified?.getTime() });
    }
    token = r.NextContinuationToken;
    startAfter = undefined;
    if (past || !token) break;
  }
  const rows: RollRow[] = [];
  const BATCH = 64;
  for (let i = 0; i < keys.length; i += BATCH) {
    const batch = keys.slice(i, i + BATCH);
    const got = await Promise.all(batch.map(async ({ key, lm }) => {
      try {
        const r = await s3.send(new GetObjectCommand({ Bucket: bucket, Key: key }));
        const body = await r.Body?.transformToString();
        return body ? rowFromProof(JSON.parse(body), lm) : null;
      } catch { return null; }
    }));
    for (const row of got) if (row) rows.push(row);
  }
  rows.sort((a, b) => b.c - a.c);
  return rows;
}

/** Raise the sealed floor. Monotonic: never lowered, so a concurrent writer
 *  racing with a lower value cannot undo progress. */
async function raiseSealedThrough(epoch: string, to: number): Promise<void> {
  const cur = await getJson<State>(stateKey(epoch));
  if ((cur?.sealedThrough ?? 0) >= to) return;
  await putJson(stateKey(epoch), { sealedThrough: to } satisfies State);
}

/**
 * A sealed chunk, built and stored if it does not exist yet.
 *
 * Only ever called for chunks the head has passed, so what it writes can never
 * change afterwards. `write: false` lets a reader use a chunk without
 * materialising it (the rebuild script owns writing, and a serverless request
 * that is about to be killed should not leave a half-written object).
 */
export async function getSealedChunk(
  epoch: string, i: number, opts: { write?: boolean } = {},
): Promise<Chunk> {
  const key = chunkKey(epoch, i);
  const existing = await getJson<Chunk>(key);
  if (existing && existing.rows) return existing;
  const { from, to } = chunkRange(i);
  const rows = await buildRowsFromLedger(epoch, from, to);
  const chunk: Chunk = { epoch, from, to, rows };
  if (opts.write !== false) {
    await putJson(key, chunk);
    await raiseSealedThrough(epoch, to);
  }
  return chunk;
}

/** The live chunk: everything from its floor up to the head. Read straight from
 *  the ledger every time and never stored, because it is the one range that can
 *  still change. Bounded by one chunk width, so it is ~2 LISTs and the GETs for
 *  that range, not a scan of the epoch. */
export async function getTailChunk(epoch: string, head: number): Promise<Chunk> {
  const i = tailChunkIndex(head);
  const { from, to } = chunkRange(i);
  const rows = await buildRowsFromLedger(epoch, from, Math.min(to, head));
  return { epoch, from, to, rows };
}

/** Chunk `i` however it is available: sealed if the head has passed it, live
 *  otherwise. The caller does not have to know which. */
export async function getChunk(
  epoch: string, i: number, head: number, opts: { write?: boolean } = {},
): Promise<Chunk> {
  return isSealed(i, head) ? getSealedChunk(epoch, i, opts) : getTailChunk(epoch, head);
}

export { CHUNK_WIDTH, chunkRange, chunkKey, isSealed, tailChunkIndex };
