import { NextRequest, NextResponse } from "next/server";
import { S3Client, ListObjectsV2Command, GetObjectCommand } from "@aws-sdk/client-s3";

// Read-only explorer feed for the CURRENT epoch. Returns aggregate, safe
// per-entry fields only (counter, type, short hash, link digest, anchor block).
// Never returns attestation, signatures, agency, or any operator/clock detail.
// See the disclosure audit: the per-proof page already carries the rest; this
// surface deliberately exposes only the spine.

export const dynamic = "force-dynamic";

const region = (process.env.LEDGER_REGION || "us-east-2").trim();
const bucket = (process.env.LEDGER_BUCKET || "occ-ledger-prod").trim();
const s3 = new S3Client({ region });

const PAGE = 25;
const pad = (n: number) => String(n).padStart(12, "0");
const toSafe = (b64: string) => b64.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

// ── tiny in-memory caches (warm-instance scoped) ───────────────────────────
let epochCache: { epoch: string; at: number } | null = null;
const headCache = new Map<string, { head: number; at: number }>();
const EPOCH_TTL = 60_000;
const HEAD_TTL = 12_000;

/** Current epoch: ask the enclave (it mints epochs; one call), fall back to a
 *  PAGINATED newest-born scan of the ledger while the boundary is rotating.
 *  The old single-page MaxKeys:200 listing was a time bomb under daily epoch
 *  rotation: past 200 epoch prefixes (~2027-01) the current epoch could sort
 *  off the page and the Roll would silently pin to a stale epoch. */
async function getCurrentEpoch(now: number): Promise<string | null> {
  if (epochCache && now - epochCache.at < EPOCH_TTL) return epochCache.epoch;
  try {
    const r = await fetch("https://nitro.occproof.com/key", { signal: AbortSignal.timeout(4000) });
    if (r.ok) {
      const k = (await r.json()) as { epochId?: string };
      if (k.epochId) {
        const epoch = k.epochId.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
        epochCache = { epoch, at: now };
        return epoch;
      }
    }
  } catch { /* rotating or unreachable: fall through */ }
  const prefixes: string[] = [];
  let token: string | undefined;
  do {
    const pe = await s3.send(new ListObjectsV2Command({ Bucket: bucket, Prefix: "proofs/", Delimiter: "/", ContinuationToken: token }));
    for (const cp of pe.CommonPrefixes || []) if (cp.Prefix) prefixes.push(cp.Prefix);
    token = pe.NextContinuationToken;
  } while (token);
  const born = await Promise.all(prefixes.map(async (pfx) => {
    const first = await s3.send(new ListObjectsV2Command({ Bucket: bucket, Prefix: pfx, MaxKeys: 1 }));
    return { epoch: pfx.replace("proofs/", "").replace(/\/$/, ""), born: first.Contents?.[0]?.LastModified?.getTime() ?? 0 };
  }));
  let best: { epoch: string; born: number } | null = null;
  for (const b of born) if (!best || b.born > best.born) best = b;
  if (!best) return null;
  epochCache = { epoch: best.epoch, at: now };
  return best.epoch;
}

/** Highest counter under proofs/{epoch}/ via StartAfter binary search (~log2, bounded). */
async function getHead(epoch: string, now: number): Promise<number> {
  const cached = headCache.get(epoch);
  if (cached && now - cached.at < HEAD_TTL) return cached.head;
  const prefix = `proofs/${epoch}/`;
  const has = async (n: number) => {
    const r = await s3.send(new ListObjectsV2Command({ Bucket: bucket, Prefix: prefix, StartAfter: `${prefix}${pad(n)}`, MaxKeys: 1 }));
    return (r.Contents?.length ?? 0) > 0;
  };
  let lo = 0, cur = 1024, hi = 1_000_000_000;
  while (cur < hi && (await has(cur))) { lo = cur; cur *= 4; }
  hi = Math.min(hi, cur);
  while (hi - lo > 1) { const mid = (lo + hi) >> 1; if (await has(mid)) lo = mid; else hi = mid; }
  const head = Math.max(lo, 1);
  headCache.set(epoch, { head, at: now });
  return head;
}

type Entry = {
  counter: number;
  type: "proof" | "anchor" | "interval";
  digest: string;
  hashShort: string;
  blockNumber: number | null;
  etherscanUrl: string | null;
  isNew?: true;
  // Wall-clock write time (S3 LastModified, epoch ms) — the recording moment,
  // shown on each roll row. The precise ETH window lives on the proof page.
  at?: number;
  // URL-safe epochId. Counters repeat across epochs, so day rolls (which can
  // span epochs) need it for row identity and to pin proof links to the exact
  // position. Present on every entry; the live feed just doesn't need it.
  ep?: string;
};

// File rows arrive stamped "new!" while their ledger write is under this old;
// the client drops the tag on its own 30s timer. Both this and the row's `at`
// time come from S3 LastModified, already in the LIST responses (no extra
// calls). Files only for "new!": anchors and intervals are the clock.
const NEW_MS = 30_000;

function toEntry(p: Record<string, unknown>, lastModifiedMs?: number): Entry | null {
  const commit = (p.commit as Record<string, unknown>) || {};
  const artifact = (p.artifact as Record<string, unknown>) || {};
  const attribution = (p.attribution as Record<string, unknown>) || {};
  const counter = parseInt(String(commit.counter ?? "0"), 10);
  if (!counter) return null;
  const isAnchor = attribution.name === "Ethereum Anchor";
  // An interval recurrence re-commits an anchor's exact block-hash bytes 25
  // anchors later. Same artifact digest, new causal position, distinct label.
  const isInterval = attribution.name === "Interval";
  const digestB64 = String(artifact.digestB64 || "");
  const proofHash = String((p.proofHash as string) || commit.prevB64 || digestB64 || "");
  let blockNumber: number | null = null;
  let etherscanUrl: string | null = null;
  if (isAnchor || isInterval) {
    const meta = ((p.metadata as Record<string, unknown>)?.interval as { originalBlockNumber?: number }) || null;
    etherscanUrl = (attribution.title as string) || null;
    const m = (etherscanUrl || "").match(/\/block\/(\d+)/);
    blockNumber = m ? parseInt(m[1], 10) : (meta?.originalBlockNumber ?? null);
  }
  const isNew = !isAnchor && !isInterval && !!lastModifiedMs && Date.now() - lastModifiedMs < NEW_MS;
  const epochId = String(commit.epochId || "");
  return {
    counter,
    type: isAnchor ? "anchor" : isInterval ? "interval" : "proof",
    digest: toSafe(digestB64),
    hashShort: toSafe(proofHash).slice(0, 10),
    blockNumber,
    etherscanUrl,
    ...(isNew ? { isNew: true as const } : {}),
    ...(lastModifiedMs ? { at: lastModifiedMs } : {}),
    ...(epochId ? { ep: toSafe(epochId) } : {}),
  };
}

/** Files-only feed: the `limit` highest-counter NON-anchor proofs at or below
 *  `top`. Anchor commits are enumerated in the anchors/{epoch}/{counter}.json
 *  index (verified 1:1 with anchor proofs' commit counters), so a LIST of that
 *  prefix identifies them without GETting each proof; only the difference is
 *  fetched. Scans at most SCAN_BUDGET counters per request and returns
 *  `floor`, the lowest counter scanned, as the resume cursor: on an
 *  anchor-only stretch a page may carry zero entries while paging continues. */
const SCAN_BUDGET = 4000;
async function listRecentFiles(epoch: string, top: number, limit: number, lowBound = 1): Promise<{ entries: Entry[]; floor: number }> {
  const proofsPrefix = `proofs/${epoch}/`;
  const anchorsPrefix = `anchors/${epoch}/`;
  const found: Entry[] = [];
  let cursor = top;
  let scanned = 0;
  while (cursor >= lowBound && scanned < SCAN_BUDGET && found.length < limit) {
    const start = Math.max(lowBound - 1, cursor - Math.min(1000, cursor));
    const inWindow = (n: number) => !isNaN(n) && n > start && n <= cursor;
    const [pr, ar] = await Promise.all([
      s3.send(new ListObjectsV2Command({ Bucket: bucket, Prefix: proofsPrefix, StartAfter: `${proofsPrefix}${pad(start)}`, MaxKeys: 1000 })),
      s3.send(new ListObjectsV2Command({ Bucket: bucket, Prefix: anchorsPrefix, StartAfter: `${anchorsPrefix}${pad(start)}`, MaxKeys: 1000 })),
    ]);
    const anchorCounters = new Set(
      (ar.Contents || [])
        .map((o) => parseInt((o.Key!.split("/").pop() || "").replace(".json", ""), 10))
        .filter(inWindow),
    );
    const fileKeys = (pr.Contents || [])
      .map((o) => ({ key: o.Key!, counter: parseInt((o.Key!.split("/").pop() || "").split("-")[0], 10), lm: o.LastModified?.getTime() }))
      .filter((x) => inWindow(x.counter) && !anchorCounters.has(x.counter))
      .sort((a, b) => b.counter - a.counter);
    const objs = await Promise.all(fileKeys.map(async ({ key, lm }) => {
      try {
        const r = await s3.send(new GetObjectCommand({ Bucket: bucket, Key: key }));
        const body = await r.Body?.transformToString();
        return body ? { json: JSON.parse(body) as Record<string, unknown>, lm } : null;
      } catch { return null; }
    }));
    for (const o of objs) {
      const e = o ? toEntry(o.json, o.lm) : null;
      // Belt and suspenders: the anchors/ index is authoritative for skipping,
      // but if an index write ever went missing the proof itself still says
      // what it is.
      if (e && e.type === "proof") found.push(e);
    }
    scanned += cursor - start;
    cursor = start;
  }
  found.sort((a, b) => b.counter - a.counter);
  return { entries: found.slice(0, limit), floor: cursor + 1 };
}

/** The `limit` highest-counter proofs at or below `top`. One LIST + `limit` GETs.
 *  Counters step by ~2 (slot + commit per event), so the LIST window is widened. */
async function listRecent(epoch: string, top: number, limit: number, lowBound = 1): Promise<Entry[]> {
  const prefix = `proofs/${epoch}/`;
  const start = Math.max(lowBound - 1, 0, top - limit * 2 - 16);
  const res = await s3.send(new ListObjectsV2Command({
    Bucket: bucket, Prefix: prefix, StartAfter: `${prefix}${pad(start)}`, MaxKeys: limit * 2 + 24,
  }));
  const keys = (res.Contents || [])
    .map((o) => ({ key: o.Key!, counter: parseInt((o.Key!.split("/").pop() || "").split("-")[0], 10), lm: o.LastModified?.getTime() }))
    .filter((x) => x.key && !isNaN(x.counter) && x.counter <= top && x.counter >= lowBound)
    .sort((a, b) => b.counter - a.counter)
    .slice(0, limit);
  const objs = await Promise.all(keys.map(async ({ key, lm }) => {
    try {
      const r = await s3.send(new GetObjectCommand({ Bucket: bucket, Key: key }));
      const body = await r.Body?.transformToString();
      return body ? { json: JSON.parse(body) as Record<string, unknown>, lm } : null;
    } catch { return null; }
  }));
  return objs
    .map((o) => (o ? toEntry(o.json, o.lm) : null))
    .filter((e): e is Entry => e !== null)
    .sort((a, b) => b.counter - a.counter);
}

// ── Day rolls ───────────────────────────────────────────────────────────────
// A UTC calendar day resolved to (epoch, counter-range) segments via the
// anchors-by-time/ index: keys are ISO-timestamp-prefixed so lexicographic
// order IS chronological, and each object carries its epoch + counter. Anchors
// are the protocol's clock, so "the recordings between the day's first and
// last anchor" is the honest day boundary (±one 12s anchor interval of fuzz at
// the edges). One mechanism covers post-rotation days (one epoch per day),
// mid-day restarts (several segments), and pre-rotation epochs spanning many
// days (a slice of one epoch). Epochs deliberately have NO ordinal numbers —
// they relate only through anchors — so days are named by date, never "#47".

type DaySeg = { epoch: string; min: number; max: number };

// Sealed days never change; cache resolved segments for the instance lifetime.
const daySegCache = new Map<string, DaySeg[]>();

function nextDayStr(day: string): string {
  const [y, m, d] = day.split("-").map((x) => parseInt(x, 10));
  return new Date(Date.UTC(y, m - 1, d + 1)).toISOString().slice(0, 10);
}

async function getAnchorRef(key: string): Promise<{ epoch: string; counter: number } | null> {
  try {
    const r = await s3.send(new GetObjectCommand({ Bucket: bucket, Key: key }));
    const body = await r.Body?.transformToString();
    if (!body) return null;
    const p = JSON.parse(body) as { commit?: { epochId?: string; counter?: string } };
    const epoch = toSafe(String(p.commit?.epochId || ""));
    const counter = parseInt(String(p.commit?.counter ?? "0"), 10);
    return epoch && counter ? { epoch, counter } : null;
  } catch { return null; }
}

/** Contiguous same-epoch runs of the day's anchor keys. Epoch keys are never
 *  reused (fresh keypair per boot), so equal epochs at both ends of a span
 *  mean the whole span is that epoch — binary splitting only happens on the
 *  rare day containing a restart, costing ~log2(anchors) GETs per boundary. */
async function splitSegs(
  keys: string[], i: number, j: number,
  ai: { epoch: string; counter: number }, aj: { epoch: string; counter: number },
): Promise<DaySeg[]> {
  if (ai.epoch === aj.epoch) return [{ epoch: ai.epoch, min: ai.counter, max: aj.counter }];
  if (j - i === 1) return [
    { epoch: ai.epoch, min: ai.counter, max: ai.counter },
    { epoch: aj.epoch, min: aj.counter, max: aj.counter },
  ];
  const mid = (i + j) >> 1;
  const am = await getAnchorRef(keys[mid]);
  if (!am) return [{ epoch: ai.epoch, min: ai.counter, max: ai.counter }, { epoch: aj.epoch, min: aj.counter, max: aj.counter }];
  const [left, right] = await Promise.all([splitSegs(keys, i, mid, ai, am), splitSegs(keys, mid, j, am, aj)]);
  // The middle anchor appears in both halves; merge the shared segment.
  const merged = [...left];
  for (const seg of right) {
    const lastIdx = merged.length - 1;
    if (merged[lastIdx].epoch === seg.epoch) {
      merged[lastIdx] = { epoch: seg.epoch, min: Math.min(merged[lastIdx].min, seg.min), max: Math.max(merged[lastIdx].max, seg.max) };
    } else merged.push(seg);
  }
  return merged;
}

async function daySegments(day: string): Promise<DaySeg[]> {
  const cached = daySegCache.get(day);
  if (cached) return cached;
  const prefix = "anchors-by-time/";
  const endExcl = `${prefix}${nextDayStr(day)}T`;
  const keys: string[] = [];
  let token: string | undefined;
  // ~7,200 anchors per day at 12s cadence → a handful of keys-only pages;
  // paginated with an early stop (the 200-epoch listing lesson).
  for (let page = 0; page < 12; page++) {
    const r = await s3.send(new ListObjectsV2Command({
      Bucket: bucket, Prefix: prefix, MaxKeys: 1000,
      ...(token ? { ContinuationToken: token } : { StartAfter: `${prefix}${day}T` }),
    }));
    let past = false;
    for (const o of r.Contents || []) {
      if (!o.Key) continue;
      if (o.Key >= endExcl) { past = true; break; }
      keys.push(o.Key);
    }
    token = r.NextContinuationToken;
    if (past || !token) break;
  }
  if (keys.length === 0) { daySegCache.set(day, []); return []; }
  const [first, last] = await Promise.all([getAnchorRef(keys[0]), getAnchorRef(keys[keys.length - 1])]);
  if (!first || !last) return [];
  const segs = keys.length === 1 || first.epoch === last.epoch
    ? [{ epoch: first.epoch, min: first.counter, max: last.counter }]
    : await splitSegs(keys, 0, keys.length - 1, first, last);
  if (daySegCache.size > 64) daySegCache.clear();
  daySegCache.set(day, segs);
  return segs;
}

export async function GET(req: NextRequest) {
  try {
    const now = Date.now();
    const beforeParam = req.nextUrl.searchParams.get("before");
    const filesOnly = req.nextUrl.searchParams.get("files") === "1";
    const dayParam = req.nextUrl.searchParams.get("day");

    if (dayParam) {
      // Sealed UTC days only; the live Roll is the plain (no-day) feed.
      const todayUTC = new Date(now).toISOString().slice(0, 10);
      if (!/^\d{4}-\d{2}-\d{2}$/.test(dayParam) || dayParam >= todayUTC) {
        return NextResponse.json({ error: "bad day" }, { status: 400 });
      }
      // Newest segment first: the roll reads newest-first within the day too.
      const ordered = [...await daySegments(dayParam)].reverse();
      const sealedCache = { headers: { "Cache-Control": "public, s-maxage=86400, stale-while-revalidate=2592000" } };
      if (ordered.length === 0) {
        return NextResponse.json({ day: dayParam, entries: [], nextBefore: null, hasMore: false }, sealedCache);
      }
      // Cursor: before=<counter> scoped by bepoch=<epoch>, since counters
      // repeat across epochs. No cursor → start at the newest segment's top.
      let segIdx = 0;
      let top: number;
      if (beforeParam) {
        const b = parseInt(beforeParam, 10);
        const bepoch = req.nextUrl.searchParams.get("bepoch") || "";
        segIdx = ordered.findIndex((s) => s.epoch === bepoch);
        if (isNaN(b) || segIdx < 0) return NextResponse.json({ error: "bad cursor" }, { status: 400 });
        top = Math.min(b - 1, ordered[segIdx].max);
        if (top < ordered[segIdx].min) { segIdx++; top = segIdx < ordered.length ? ordered[segIdx].max : 0; }
      } else {
        top = ordered[0].max;
      }
      const entries: Entry[] = [];
      let nextBefore: number | null = null;
      let nextEpoch: string | null = null;
      while (segIdx < ordered.length && entries.length < PAGE) {
        const seg = ordered[segIdx];
        const want = PAGE - entries.length;
        if (filesOnly) {
          const r = await listRecentFiles(seg.epoch, top, want, seg.min);
          entries.push(...r.entries);
          if (r.floor > seg.min) { nextBefore = r.floor; nextEpoch = seg.epoch; break; }
        } else {
          const es = await listRecent(seg.epoch, top, want, seg.min);
          entries.push(...es);
          const lowest = es.length ? es[es.length - 1].counter : seg.min;
          if (entries.length >= PAGE && lowest > seg.min) { nextBefore = lowest; nextEpoch = seg.epoch; break; }
        }
        segIdx++;
        if (segIdx < ordered.length) {
          const nseg = ordered[segIdx];
          top = nseg.max;
          if (entries.length >= PAGE) { nextBefore = nseg.max + 1; nextEpoch = nseg.epoch; break; }
        }
      }
      return NextResponse.json(
        { day: dayParam, entries, nextBefore, nextEpoch, hasMore: nextBefore != null },
        sealedCache,
      );
    }
    const epoch = await getCurrentEpoch(now);
    if (!epoch) return NextResponse.json({ error: "no epoch" }, { status: 404 });

    const head = await getHead(epoch, now);
    let top = head;
    if (beforeParam) {
      const b = parseInt(beforeParam, 10);
      if (isNaN(b)) return NextResponse.json({ error: "bad cursor" }, { status: 400 });
      top = Math.min(b - 1, head);
    }

    let entries: Entry[];
    let nextBefore: number | null;
    if (filesOnly) {
      // The cursor is the scan floor, not the last entry: an anchor-only
      // stretch legitimately yields an empty page that still advances.
      const r = top < 1 ? { entries: [], floor: 1 } : await listRecentFiles(epoch, top, PAGE);
      entries = r.entries;
      nextBefore = r.floor > 1 ? r.floor : null;
    } else {
      entries = top < 1 ? [] : await listRecent(epoch, top, PAGE);
      nextBefore = entries.length ? entries[entries.length - 1].counter : null;
    }

    return NextResponse.json(
      { epoch, head, entries, nextBefore, hasMore: nextBefore != null && nextBefore > 1 },
      {
        headers: {
          // The long stale-while-revalidate is the point, not s-maxage. Traffic
          // here is sparse, so a 10s SWR window meant the edge copy had almost
          // always expired by the next visitor and nearly every Roll open paid a
          // cold function invocation plus S3 LISTs. With an hour of SWR the edge
          // always has something to hand back instantly and refreshes behind the
          // request, so the page paints immediately and is corrected in place.
          //
          // Serving a slightly stale head page is safe: a recording the visitor
          // just made is prepended locally from the bitgraph:recorded event, not
          // read back from this feed, and the 12s live poll reconciles the rest.
          // s-maxage stays short so that poll still sees new rows promptly.
          //
          // Cursor pages are effectively immutable (older counters never change),
          // so they cache hard.
          "Cache-Control": beforeParam
            ? "public, s-maxage=3600, stale-while-revalidate=86400"
            : "public, s-maxage=15, stale-while-revalidate=3600",
        },
      },
    );
  } catch (e) {
    console.error("GET /api/explorer error:", e);
    return NextResponse.json({ error: "failed" }, { status: 500 });
  }
}
