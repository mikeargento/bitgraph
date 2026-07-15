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

/** Current epoch = the one whose first object was written most recently
 *  (a new epoch is born at counter 1 on every TEE restart). ~1 cheap LIST/epoch. */
async function getCurrentEpoch(now: number): Promise<string | null> {
  if (epochCache && now - epochCache.at < EPOCH_TTL) return epochCache.epoch;
  const pe = await s3.send(new ListObjectsV2Command({ Bucket: bucket, Prefix: "proofs/", Delimiter: "/", MaxKeys: 200 }));
  const prefixes = (pe.CommonPrefixes || []).map((p) => p.Prefix!).filter(Boolean);
  // Probe every epoch's first-object timestamp in parallel (newest-born = current).
  // Sequential here was a meaningful slice of cold-start latency.
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
  type: "proof" | "anchor" | "interval" | "interval-open" | "interval-close";
  digest: string;
  hashShort: string;
  blockNumber: number | null;
  etherscanUrl: string | null;
};

function toEntry(p: Record<string, unknown>): Entry | null {
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
  return {
    counter,
    type: isAnchor ? "anchor" : isInterval ? "interval" : "proof",
    digest: toSafe(digestB64),
    hashShort: toSafe(proofHash).slice(0, 10),
    blockNumber,
    etherscanUrl,
  };
}

/** The `limit` highest-counter proofs at or below `top`. One LIST + `limit` GETs.
 *  Counters step by ~2 (slot + commit per event), so the LIST window is widened. */
async function listRecent(epoch: string, top: number, limit: number): Promise<Entry[]> {
  const prefix = `proofs/${epoch}/`;
  const start = Math.max(0, top - limit * 2 - 16);
  const res = await s3.send(new ListObjectsV2Command({
    Bucket: bucket, Prefix: prefix, StartAfter: `${prefix}${pad(start)}`, MaxKeys: limit * 2 + 24,
  }));
  const keys = (res.Contents || [])
    .map((o) => ({ key: o.Key!, counter: parseInt((o.Key!.split("/").pop() || "").split("-")[0], 10) }))
    .filter((x) => x.key && !isNaN(x.counter) && x.counter <= top)
    .sort((a, b) => b.counter - a.counter)
    .slice(0, limit);
  const objs = await Promise.all(keys.map(async ({ key }) => {
    try {
      const r = await s3.send(new GetObjectCommand({ Bucket: bucket, Key: key }));
      const body = await r.Body?.transformToString();
      return body ? (JSON.parse(body) as Record<string, unknown>) : null;
    } catch { return null; }
  }));
  return objs
    .map((o) => (o ? toEntry(o) : null))
    .filter((e): e is Entry => e !== null)
    .sort((a, b) => b.counter - a.counter);
}

/* ── User interval labels ──────────────────────────────────────────────────
 * Marker positions are relabeled from the intervals/ registry, the
 * authoritative source: the deployed enclave does not echo commit metadata
 * into proofs, and a client-supplied tag would be spoofable anyway. Costs one
 * tiny GET per unique file digest per page, softened by an in-instance TTL
 * cache. Labels are per-ROLE (open/close position), which never changes once
 * assigned, so short caching can only delay a label, never falsify one. */

type IntervalEnd = { epochId: string; counter: string };
type IntervalEnds = { opened: IntervalEnd; closed: IntervalEnd | null } | null;
const intervalCache = new Map<string, { rec: IntervalEnds; at: number }>();
const INTERVAL_TTL = 30_000;

async function getIntervalEnds(safeDigest: string, now: number): Promise<IntervalEnds> {
  const hit = intervalCache.get(safeDigest);
  if (hit && now - hit.at < INTERVAL_TTL) return hit.rec;
  let rec: IntervalEnds = null;
  try {
    const r = await s3.send(new GetObjectCommand({ Bucket: bucket, Key: `intervals/${safeDigest}.json` }));
    const body = await r.Body?.transformToString();
    if (body) {
      const j = JSON.parse(body) as { opened: IntervalEnd; closed?: IntervalEnd | null };
      rec = { opened: j.opened, closed: j.closed ?? null };
    }
  } catch { /* NoSuchKey — not an interval */ }
  intervalCache.set(safeDigest, { rec, at: now });
  return rec;
}

async function labelIntervals(entries: Entry[], epoch: string, now: number): Promise<void> {
  const digests = [...new Set(entries.filter((e) => e.type === "proof" && e.digest).map((e) => e.digest))];
  if (digests.length === 0) return;
  const recs = new Map(await Promise.all(digests.map(async (d) => [d, await getIntervalEnds(d, now)] as const)));
  for (const e of entries) {
    if (e.type !== "proof") continue;
    const rec = recs.get(e.digest);
    if (!rec) continue;
    const matches = (end: IntervalEnd | null) =>
      !!end && toSafe(end.epochId) === epoch && parseInt(end.counter, 10) === e.counter;
    if (matches(rec.opened)) e.type = "interval-open";
    else if (matches(rec.closed)) e.type = "interval-close";
  }
}

export async function GET(req: NextRequest) {
  try {
    const now = Date.now();
    const beforeParam = req.nextUrl.searchParams.get("before");
    const epoch = await getCurrentEpoch(now);
    if (!epoch) return NextResponse.json({ error: "no epoch" }, { status: 404 });

    const head = await getHead(epoch, now);
    let top = head;
    if (beforeParam) {
      const b = parseInt(beforeParam, 10);
      if (isNaN(b)) return NextResponse.json({ error: "bad cursor" }, { status: 400 });
      top = Math.min(b - 1, head);
    }

    const entries = top < 1 ? [] : await listRecent(epoch, top, PAGE);
    await labelIntervals(entries, epoch, now);
    const nextBefore = entries.length ? entries[entries.length - 1].counter : null;

    return NextResponse.json(
      { epoch, head, entries, nextBefore, hasMore: nextBefore != null && nextBefore > 1 },
      {
        headers: {
          "Cache-Control": beforeParam
            ? "public, s-maxage=300, stale-while-revalidate=600"
            : "public, s-maxage=5, stale-while-revalidate=10",
        },
      },
    );
  } catch (e) {
    console.error("GET /api/explorer error:", e);
    return NextResponse.json({ error: "failed" }, { status: 500 });
  }
}
