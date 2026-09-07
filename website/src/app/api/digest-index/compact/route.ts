import { NextRequest, NextResponse } from "next/server";
import { timingSafeEqual } from "node:crypto";
import { GetObjectCommand, ListObjectsV2Command, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { canon, DigestFilter } from "@/lib/digest-filter";
import { JOURNAL_PREFIX } from "@/lib/digest-index";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * GET /api/digest-index/compact: fold the journal into the published filter.
 *
 * The lookup answers "certainly not on record" from a filter held in function
 * memory, and every by-digest write journals its digests so the filter can
 * never reject something the ledger holds. Loading folds that journal, and
 * because folding happens inside a request it gives up past a cap and the
 * index switches itself off until someone compacts. How fast that happens is
 * the anchor interval: at 12s, two writers journal every anchor and the window
 * fills in a few hours. This is what keeps it from ever getting there.
 *
 * Nothing here changes what an answer means. Compaction only moves work from
 * the request path to a schedule; with this route never called, the index
 * still behaves correctly, just slower and then off.
 *
 * ⚠️ Two ordering rules make a half-finished run safe:
 *
 *   1. The filter is written BEFORE the meta. The pair is read as "the filter
 *      contains everything up to meta.cutoff", so a new filter beside an old
 *      meta is harmless (some journals get folded twice), while an old filter
 *      beside a new meta would skip journals and produce false negatives.
 *   2. The cutoff published is the stamp of the last journal actually folded,
 *      never the clock. A journal that arrives mid-run is simply left for the
 *      next one.
 */

const BASE_KEY = "digest-index/filter.bin";
const META_KEY = "digest-index/meta.json";
const LOCK_KEY = "digest-index/compact-lock.json";
/** Journals folded in one run. Well past an hour's worth at a 12s anchor interval. */
const MAX_JOURNALS = 20_000;
/** Journal reads in flight. */
const CONCURRENCY = 48;
/** Stop folding at this point and publish what landed, so a run never runs out of time mid-write. */
const FOLD_BUDGET_MS = 35_000;
/** A run this recent means another one is in flight; skip rather than race it. */
const LOCK_TTL_MS = 5 * 60_000;

interface Meta { builtAt: number; n: number; capacity?: number; m: number; k: number; cutoff: number; compactedAt?: number }

function authorized(req: NextRequest): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  const given = req.headers.get("authorization") ?? "";
  const want = `Bearer ${secret}`;
  // Same length or timingSafeEqual throws; compare the bytes, not the string.
  const a = Buffer.from(given);
  const b = Buffer.from(want);
  return a.length === b.length && timingSafeEqual(a, b);
}

export async function GET(req: NextRequest) {
  if (!process.env.CRON_SECRET) {
    // Refuse rather than run open: this route lists and reads thousands of
    // objects and republishes a multi-megabyte filter, so an unset secret must
    // mean closed, never public.
    return NextResponse.json({ error: "CRON_SECRET is not set" }, { status: 503 });
  }
  if (!authorized(req)) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const Bucket = process.env.LEDGER_BUCKET;
  if (!Bucket) return NextResponse.json({ error: "LEDGER_BUCKET is not set" }, { status: 503 });
  const s3 = new S3Client({ region: process.env.LEDGER_REGION || "us-east-2" });
  const started = Date.now();

  const read = async (Key: string): Promise<Buffer | null> => {
    try {
      const r = await s3.send(new GetObjectCommand({ Bucket, Key }));
      const b = await r.Body?.transformToByteArray();
      return b ? Buffer.from(b) : null;
    } catch { return null; }
  };

  try {
    // Advisory only. Vercel fires this once an hour and a run takes seconds, so
    // two at once is not a thing that happens; this is here so a retry or a
    // manual call while one is running skips instead of interleaving its
    // writes with the other's.
    const lock = await read(LOCK_KEY);
    if (lock) {
      const at = Number(JSON.parse(lock.toString("utf8")).at ?? 0);
      if (Number.isFinite(at) && started - at < LOCK_TTL_MS) {
        return NextResponse.json({ skipped: "another compaction is in flight", since: new Date(at).toISOString() });
      }
    }
    await s3.send(new PutObjectCommand({ Bucket, Key: LOCK_KEY, Body: JSON.stringify({ at: started }), ContentType: "application/json" }));

    const metaBytes = await read(META_KEY);
    const baseBytes = await read(BASE_KEY);
    if (!metaBytes || !baseBytes) {
      return NextResponse.json({ error: "no published filter; run a full build first" }, { status: 409 });
    }
    const meta = JSON.parse(metaBytes.toString("utf8")) as Meta;
    const filter = DigestFilter.parse(new Uint8Array(baseBytes));
    if (!filter || typeof meta.cutoff !== "number") {
      return NextResponse.json({ error: "the published filter did not parse" }, { status: 409 });
    }

    // Journal keys carry a zero-padded millisecond stamp, so listing after the
    // cutoff returns exactly what the base has not heard about, oldest first.
    const after = `${JOURNAL_PREFIX}${String(meta.cutoff).padStart(13, "0")}`;
    const keys: string[] = [];
    let token: string | undefined;
    do {
      const listed = await s3.send(new ListObjectsV2Command({ Bucket, Prefix: JOURNAL_PREFIX, StartAfter: after, ContinuationToken: token, MaxKeys: 1000 }));
      for (const o of listed.Contents ?? []) if (o.Key) keys.push(o.Key);
      token = keys.length >= MAX_JOURNALS ? undefined : (listed.IsTruncated ? listed.NextContinuationToken : undefined);
    } while (token);
    if (keys.length === 0) {
      return NextResponse.json({ folded: 0, cutoff: new Date(meta.cutoff).toISOString(), note: "nothing to compact" });
    }

    // Fold in order-independent parallel, but only CLAIM a prefix of the keys:
    // the cutoff must be the last journal that is definitely folded, so a
    // worker stopping on the budget cannot leave a hole behind an advanced
    // cutoff. Tracking the highest fully-folded prefix does that.
    const folded = new Array<boolean>(keys.length).fill(false);
    let added = 0;
    let next = 0;
    let stop = false;
    await Promise.all(Array.from({ length: Math.min(CONCURRENCY, keys.length) }, async () => {
      while (!stop) {
        const i = next++;
        if (i >= keys.length) return;
        if (Date.now() - started > FOLD_BUDGET_MS) { stop = true; return; }
        const bytes = await read(keys[i]);
        if (!bytes) { stop = true; return; }
        try {
          const entry = JSON.parse(bytes.toString("utf8")) as { digests?: unknown };
          if (!Array.isArray(entry.digests)) { stop = true; return; }
          for (const d of entry.digests) if (typeof d === "string") { filter.add(canon(d)); added++; }
        } catch { stop = true; return; }
        folded[i] = true;
      }
    }));

    // The longest unbroken run from the start is what the new cutoff may claim.
    let contiguous = 0;
    while (contiguous < folded.length && folded[contiguous]) contiguous++;
    if (contiguous === 0) {
      return NextResponse.json({ error: "no journal could be read", listed: keys.length }, { status: 502 });
    }
    const lastKey = keys[contiguous - 1];
    const cutoff = Number(lastKey.slice(JOURNAL_PREFIX.length).split("-")[0]);
    if (!Number.isFinite(cutoff) || cutoff < meta.cutoff) {
      return NextResponse.json({ error: "refusing to publish a cutoff that does not move forward" }, { status: 500 });
    }

    // Filter first, meta second. See the header.
    await s3.send(new PutObjectCommand({ Bucket, Key: BASE_KEY, Body: filter.serialize(), ContentType: "application/octet-stream" }));
    await s3.send(new PutObjectCommand({
      Bucket,
      Key: META_KEY,
      Body: JSON.stringify({ ...meta, builtAt: Date.now(), n: meta.n + added, cutoff, compactedAt: Date.now() }, null, 2),
      ContentType: "application/json",
    }));

    return NextResponse.json({
      folded: contiguous,
      listed: keys.length,
      digestsAdded: added,
      cutoff: new Date(cutoff).toISOString(),
      tookMs: Date.now() - started,
      ...(contiguous < keys.length ? { note: "stopped on the budget; the rest is left for the next run" } : {}),
    });
  } catch (e) {
    console.error("[api/digest-index/compact] failed:", e instanceof Error ? e.message : String(e));
    return NextResponse.json({ error: "compaction failed" }, { status: 500 });
  }
}
