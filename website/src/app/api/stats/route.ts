import { NextRequest, NextResponse } from "next/server";
import { S3Client, ListObjectsV2Command, GetObjectCommand } from "@aws-sdk/client-s3";

// Read-only range statistics over the CURRENT epoch's spine. Everything here
// is derived from S3 key NAMES (proofs/{epoch}/{counter}-{hash}.json and
// anchors/{epoch}/{counter}-*.json); the only object GETs are the handful of
// anchors whose block times bound the range, the peak window, and the longest
// quiet stretch. Same disclosure surface as the explorer: counters, digests,
// counts, anchor blocks. No signatures, attestation, or operator detail.

export const dynamic = "force-dynamic";

const region = (process.env.LEDGER_REGION || "us-east-2").trim();
const bucket = (process.env.LEDGER_BUCKET || "occ-ledger-prod").trim();
const s3 = new S3Client({ region });

const pad = (n: number) => String(n).padStart(12, "0");
const toSafe = (b64: string) => b64.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

// A range larger than this many counters is truncated (totals stay exact up
// to the cap; rhythm is skipped). ~60 LIST pages, still one-request cheap.
const MAX_RANGE_KEYS = 60_000;

// Non-current epochs are sealed history (a head never moves after the TEE
// restarts), so their heads cache without expiry; only the live epoch's head
// refreshes on anchor cadence.
let epochsCache: { list: Array<{ epoch: string; born: number }>; at: number } | null = null;
const headCache = new Map<string, { head: number; at: number; stable: boolean }>();
const EPOCHS_TTL = 300_000;
const HEAD_TTL = 12_000;

/** Every epoch with its first-object write time, newest-born first. */
async function getEpochList(now: number): Promise<Array<{ epoch: string; born: number }>> {
  if (epochsCache && now - epochsCache.at < EPOCHS_TTL) return epochsCache.list;
  const pe = await s3.send(new ListObjectsV2Command({ Bucket: bucket, Prefix: "proofs/", Delimiter: "/", MaxKeys: 200 }));
  const prefixes = (pe.CommonPrefixes || []).map((p) => p.Prefix!).filter(Boolean);
  const born = await Promise.all(prefixes.map(async (pfx) => {
    const first = await s3.send(new ListObjectsV2Command({ Bucket: bucket, Prefix: pfx, MaxKeys: 1 }));
    return { epoch: pfx.replace("proofs/", "").replace(/\/$/, ""), born: first.Contents?.[0]?.LastModified?.getTime() ?? 0 };
  }));
  born.sort((a, b) => b.born - a.born);
  epochsCache = { list: born, at: now };
  return born;
}

async function getCurrentEpoch(now: number): Promise<string | null> {
  const list = await getEpochList(now);
  return list[0]?.epoch ?? null;
}

async function getHead(epoch: string, now: number, isCurrent: boolean): Promise<number> {
  const cached = headCache.get(epoch);
  if (cached && (cached.stable || now - cached.at < HEAD_TTL)) return cached.head;
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
  headCache.set(epoch, { head, at: now, stable: !isCurrent });
  return head;
}

/** [counter, filename, writeTimeMs] tuples under a prefix within [from, to],
 *  capped. The write time is the S3 LastModified — the server clock, seconds
 *  from the commit, free with the LIST. It feeds the timeline's fill only;
 *  every stated time bound still comes from Ethereum block times. */
async function listRange(prefix: string, from: number, to: number, cap: number): Promise<{ items: Array<[number, string, number]>; truncated: boolean }> {
  const items: Array<[number, string, number]> = [];
  let token: string | undefined;
  do {
    const res = await s3.send(new ListObjectsV2Command({
      Bucket: bucket,
      Prefix: prefix,
      StartAfter: `${prefix}${pad(from - 1)}~`, // '~' sorts after any digit/dash suffix of the padded counter
      ContinuationToken: token,
      MaxKeys: 1000,
    }));
    for (const obj of res.Contents || []) {
      const filename = (obj.Key || "").split("/").pop() || "";
      const c = parseInt(filename.split("-")[0], 10);
      if (isNaN(c)) continue;
      if (c > to) return { items, truncated: false };
      if (c >= from) items.push([c, filename, obj.LastModified?.getTime() ?? 0]);
      if (items.length >= cap) return { items, truncated: true };
    }
    token = res.IsTruncated ? res.NextContinuationToken : undefined;
  } while (token);
  return { items, truncated: false };
}

/** Fetch + parse one object as JSON, or null. */
async function getJson(key: string): Promise<Record<string, unknown> | null> {
  try {
    const g = await s3.send(new GetObjectCommand({ Bucket: bucket, Key: key }));
    const body = await g.Body?.transformToString();
    return body ? (JSON.parse(body) as Record<string, unknown>) : null;
  } catch { return null; }
}

/** Run tasks with bounded concurrency, preserving order. */
async function mapLimit<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const out = new Array<R>(items.length);
  let i = 0;
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (i < items.length) {
      const idx = i++;
      out[idx] = await fn(items[idx]);
    }
  }));
  return out;
}

// Ethereum block time by number, via public RPC (the current epoch's stored
// anchors carry block number + hash but not the timestamp). Warm-instance
// cached; only the handful of range/peak/quiet boundary anchors are resolved.
// Successes cache forever (block times are immutable); failures are NEVER
// cached — a transient outage of all three RPCs must not null this block's
// time for the instance lifetime (and, via settled Cache-Control, the CDN).
const blockTimeCache = new Map<number, string>();
async function blockTimeByNumber(blockNumber: number): Promise<string | null> {
  const hit = blockTimeCache.get(blockNumber);
  if (hit) return hit;
  for (const endpoint of ["https://ethereum-rpc.publicnode.com", "https://cloudflare-eth.com", "https://rpc.ankr.com/eth"]) {
    try {
      const r = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ jsonrpc: "2.0", method: "eth_getBlockByNumber", params: ["0x" + blockNumber.toString(16), false], id: 1 }),
        signal: AbortSignal.timeout(2500),
      });
      if (!r.ok) continue;
      const j = await r.json() as { result?: { timestamp?: string } };
      if (j.result?.timestamp) {
        const time = new Date(parseInt(j.result.timestamp, 16) * 1000).toISOString();
        blockTimeCache.set(blockNumber, time);
        return time;
      }
    } catch { /* try next */ }
  }
  return null;
}

/** Block time (ISO) of one anchor: stored fields first, RPC fallback. */
async function anchorTime(epoch: string, counter: number): Promise<string | null> {
  try {
    const prefix = `anchors/${epoch}/`;
    const l = await s3.send(new ListObjectsV2Command({ Bucket: bucket, Prefix: `${prefix}${pad(counter)}`, MaxKeys: 1 }));
    const key = l.Contents?.[0]?.Key;
    if (!key) return null;
    const a = await getJson(key);
    if (!a) return null;
    const proof = (a.proof as Record<string, unknown>) || a;
    const meta = ((proof.metadata || a.metadata) as { anchor?: { blockTimeISO?: string; blockTime?: number } } | undefined)?.anchor;
    const eth = (a.ethereum || proof.ethereum) as { blockNumber?: number; blockTimeISO?: string; blockTime?: number } | undefined;
    const stored = meta?.blockTimeISO
      ?? eth?.blockTimeISO
      ?? (meta?.blockTime ? new Date(meta.blockTime * 1000).toISOString() : null)
      ?? (eth?.blockTime ? new Date(eth.blockTime * 1000).toISOString() : null);
    if (stored) return stored;
    if (eth?.blockNumber) return blockTimeByNumber(eth.blockNumber);
    return null;
  } catch { return null; }
}

/** Resolve a wall-clock instant to a counter via the anchors-by-time index
 *  (keys are ISO-with-dashes + block number, lexicographically sorted): the
 *  first anchor at or after the instant. "future" = no anchor exists yet at
 *  that time (caller uses head); "preEpoch" = the resolved anchor belongs to
 *  an earlier epoch (caller clamps to 1). */
async function counterAtTime(epoch: string, t: Date): Promise<number | "future" | "preEpoch"> {
  const ts = t.toISOString().replace(/[:.]/g, "-");
  const l = await s3.send(new ListObjectsV2Command({
    Bucket: bucket,
    Prefix: "anchors-by-time/",
    StartAfter: `anchors-by-time/${ts}`,
    MaxKeys: 1,
  }));
  const key = l.Contents?.[0]?.Key;
  if (!key) return "future";
  try {
    const g = await s3.send(new GetObjectCommand({ Bucket: bucket, Key: key }));
    const body = await g.Body?.transformToString();
    if (!body) return "future";
    const a = JSON.parse(body) as { commit?: { counter?: string; epochId?: string } };
    if (!a.commit?.counter || !a.commit?.epochId) return "future";
    if (toSafe(a.commit.epochId) !== epoch) return "preEpoch";
    return parseInt(a.commit.counter, 10);
  } catch { return "future"; }
}

export async function GET(req: NextRequest) {
  try {
    const now = Date.now();
    const epochList = await getEpochList(now);
    const currentEpoch = epochList[0]?.epoch ?? null;
    if (!currentEpoch) return NextResponse.json({ error: "no epoch" }, { status: 404 });

    // ?epoch= selects a past (sealed) epoch; time-based ranges only make
    // sense against the live one, so past epochs take counters or the whole
    // epoch. The param must name a real epoch — no free-form prefixes.
    const q = req.nextUrl.searchParams;
    const epochParam = q.get("epoch");
    if (epochParam && !epochList.some((e) => e.epoch === epochParam)) {
      return NextResponse.json({ error: "unknown epoch" }, { status: 404 });
    }
    const epoch = epochParam || currentEpoch;
    const isCurrent = epoch === currentEpoch;
    const head = await getHead(epoch, now, isCurrent);

    // Range flags: `clamped` = the requested start predates this epoch (range
    // starts at its birth instead); `empty` = no anchors exist in the
    // requested window at all (nothing to show; from>to yields zero listings).
    let from = 1;
    let to = head;
    let clamped = false;
    let empty = false;
    const resolveTime = async (iso: string): Promise<number | "future" | "preEpoch" | null> => {
      const t = new Date(iso);
      return isNaN(t.getTime()) ? null : counterAtTime(epoch, t);
    };
    const hoursParam = q.get("hours");
    if (!isCurrent && (hoursParam || q.get("fromTime") || q.get("toTime"))) {
      return NextResponse.json({ error: "time ranges apply to the current epoch only" }, { status: 400 });
    }
    if (hoursParam) {
      const hours = parseFloat(hoursParam);
      if (!isFinite(hours) || hours <= 0 || hours > 24 * 365) {
        return NextResponse.json({ error: "bad hours" }, { status: 400 });
      }
      const c = await counterAtTime(epoch, new Date(now - hours * 3600_000));
      if (c === "preEpoch") clamped = true;       // window starts before the epoch's birth
      else if (c === "future") { from = 1; to = 0; empty = true; } // no anchor in the window: anchoring is stalled or the window is inside the current gap
      else from = Math.min(c, head);
    } else if (q.get("fromTime") || q.get("toTime")) {
      const [f, t] = await Promise.all([
        q.get("fromTime") ? resolveTime(q.get("fromTime")!) : Promise.resolve(null),
        q.get("toTime") ? resolveTime(q.get("toTime")!) : Promise.resolve(null),
      ]);
      if ((q.get("fromTime") && f === null) || (q.get("toTime") && t === null)) {
        return NextResponse.json({ error: "bad time" }, { status: 400 });
      }
      if (f === "preEpoch") clamped = true;                    // explicit start before the epoch: begin at #1
      else if (f === "future") { from = 1; to = 0; empty = true; } // start beyond the newest anchor: nothing yet
      else if (typeof f === "number") from = Math.min(f, head);
      if (!empty) {
        if (t === "preEpoch") { from = 1; to = 0; empty = true; } // whole window predates the epoch
        else if (typeof t === "number") to = Math.min(Math.max(t, from), head);
        // t === "future" (or absent): the window runs to the live head.
      }
    } else if (q.get("from") || q.get("to")) {
      const f = parseInt(q.get("from") || "1", 10);
      const t = parseInt(q.get("to") || String(head), 10);
      if (isNaN(f) || isNaN(t) || f < 1 || t < f) {
        return NextResponse.json({ error: "bad range" }, { status: 400 });
      }
      from = Math.min(f, head);
      to = Math.min(t, head);
    }

    const safeEpoch = epoch; // epoch ids from prefixes are already url-safe
    const [proofsRes, anchorsRes] = await Promise.all([
      listRange(`proofs/${safeEpoch}/`, from, to, MAX_RANGE_KEYS),
      listRange(`anchors/${safeEpoch}/`, from, to, MAX_RANGE_KEYS),
    ]);
    // When either listing hits its cap, align BOTH datasets to the same
    // counter horizon: the two prefixes have different densities, so their
    // caps land at different counters, and unaligned totals would count files
    // and anchors over different sub-windows of the range.
    let coveredTo = to;
    if (proofsRes.truncated || anchorsRes.truncated) {
      const pMax = proofsRes.truncated && proofsRes.items.length ? proofsRes.items[proofsRes.items.length - 1][0] : Infinity;
      const aMax = anchorsRes.truncated && anchorsRes.items.length ? anchorsRes.items[anchorsRes.items.length - 1][0] : Infinity;
      coveredTo = Math.min(pMax, aMax, to);
      proofsRes.items = proofsRes.items.filter(([c]) => c <= coveredTo);
      anchorsRes.items = anchorsRes.items.filter(([c]) => c <= coveredTo);
    }
    const truncated = coveredTo < to;
    const anchorCounters = anchorsRes.items.map(([c]) => c).sort((a, b) => a - b);
    const anchorSet = new Set(anchorCounters);

    // The hash in proof key names is the PROOF hash (unique per position), so
    // artifact digests require reading the objects. File commits are sparse
    // relative to anchors; reads are capped and flagged when sampled. The
    // same reads classify SYSTEM proofs that live under proofs/ without an
    // anchors/ entry (legacy interval checkpoints, orphaned duplicate-era
    // anchors) so past epochs don't count them as user files.
    const MAX_DIGEST_READS = 500;
    const fileKeys = proofsRes.items.filter(([c]) => !anchorSet.has(c));
    const digestSample = fileKeys.slice(0, MAX_DIGEST_READS);
    const digestsCapped = fileKeys.length > digestSample.length;
    const inspected = await mapLimit(digestSample, 12, async ([c, filename]) => {
      const obj = await getJson(`proofs/${safeEpoch}/${filename}`);
      const d = (obj?.artifact as { digestB64?: string } | undefined)?.digestB64;
      const attrName = (obj?.attribution as { name?: string } | undefined)?.name;
      const system = attrName === "Ethereum Anchor" || attrName === "Interval";
      return { counter: c, digest: d ? toSafe(d) : null, system };
    });
    const systemCounters = new Set(inspected.filter((i) => i.system).map((i) => i.counter));
    const digestByCounter = inspected.filter((i) => !i.system).map((i) => [i.counter, i.digest] as const);
    const fileCommits = fileKeys.length - systemCounters.size;
    const mtimeByCounter = new Map(fileKeys.map(([c, , m]) => [c, m] as const));
    const digestCounts = new Map<string, { count: number; first: number; last: number; positions: Array<{ counter: number; t: string | null }> }>();
    for (const [c, digest] of digestByCounter) {
      if (!digest) continue;
      const m = mtimeByCounter.get(c);
      const pos = { counter: c, t: m ? new Date(m).toISOString() : null };
      const cur = digestCounts.get(digest);
      if (cur) {
        cur.count++;
        cur.last = Math.max(cur.last, c);
        cur.first = Math.min(cur.first, c);
        if (cur.positions.length < 16) cur.positions.push(pos);
      } else {
        digestCounts.set(digest, { count: 1, first: c, last: c, positions: [pos] });
      }
    }
    const recurring = [...digestCounts.entries()].filter(([, v]) => v.count > 1);
    recurring.sort((a, b) => b[1].count - a[1].count || a[1].first - b[1].first);
    const recurrences = recurring.slice(0, 5).map(([digest, v]) => ({
      digest, count: v.count, firstCounter: v.first, lastCounter: v.last,
      positions: [...v.positions].sort((a, b) => a.counter - b.counter),
    }));

    // Rhythm: bucket file commits between consecutive in-range anchors, then
    // fetch block times only for the few anchors that bound what we report.
    let span: { fromTime: string | null; toTime: string | null; durationSec: number | null } | null = null;
    let peak: { commits: number; fromCounter: number; toCounter: number; fromTime: string | null; toTime: string | null } | null = null;
    let quiet: { fromCounter: number; toCounter: number; fromTime: string | null; toTime: string | null; durationSec: number | null } | null = null;

    if (!truncated && anchorCounters.length >= 2) {
      const commitsSorted = proofsRes.items.map(([c]) => c).filter((c) => !anchorSet.has(c) && !systemCounters.has(c)).sort((a, b) => a - b);
      // commits per bucket i = between anchorCounters[i] and anchorCounters[i+1]
      const buckets = new Array<number>(anchorCounters.length - 1).fill(0);
      let bi = 0;
      for (const c of commitsSorted) {
        if (c < anchorCounters[0]) continue;
        while (bi < buckets.length && c > anchorCounters[bi + 1]) bi++;
        if (bi >= buckets.length) break;
        buckets[bi]++;
      }
      let peakIdx = -1;
      for (let i = 0; i < buckets.length; i++) if (peakIdx < 0 || buckets[i] > buckets[peakIdx]) peakIdx = i;
      // Longest run of empty buckets = the quiet stretch.
      let qStart = -1, qLen = 0, curStart = -1, curLen = 0;
      for (let i = 0; i <= buckets.length; i++) {
        if (i < buckets.length && buckets[i] === 0) {
          if (curStart < 0) curStart = i;
          curLen++;
        } else {
          if (curLen > qLen) { qLen = curLen; qStart = curStart; }
          curStart = -1; curLen = 0;
        }
      }

      const wanted = new Set<number>([anchorCounters[0], anchorCounters[anchorCounters.length - 1]]);
      if (peakIdx >= 0 && buckets[peakIdx] > 0) { wanted.add(anchorCounters[peakIdx]); wanted.add(anchorCounters[peakIdx + 1]); }
      if (qStart >= 0) { wanted.add(anchorCounters[qStart]); wanted.add(anchorCounters[qStart + qLen]); }
      const times = new Map<number, string | null>();
      await Promise.all([...wanted].map(async (c) => times.set(c, await anchorTime(epoch, c))));
      const dur = (a: string | null | undefined, b: string | null | undefined) =>
        a && b ? Math.round((new Date(b).getTime() - new Date(a).getTime()) / 1000) : null;

      const firstA = anchorCounters[0], lastA = anchorCounters[anchorCounters.length - 1];
      span = { fromTime: times.get(firstA) ?? null, toTime: times.get(lastA) ?? null, durationSec: dur(times.get(firstA), times.get(lastA)) };
      if (peakIdx >= 0 && buckets[peakIdx] > 0) {
        peak = {
          commits: buckets[peakIdx],
          fromCounter: anchorCounters[peakIdx], toCounter: anchorCounters[peakIdx + 1],
          fromTime: times.get(anchorCounters[peakIdx]) ?? null, toTime: times.get(anchorCounters[peakIdx + 1]) ?? null,
        };
      }
      if (qStart >= 0) {
        const qa = anchorCounters[qStart], qb = anchorCounters[qStart + qLen];
        quiet = { fromCounter: qa, toCounter: qb, fromTime: times.get(qa) ?? null, toTime: times.get(qb) ?? null, durationSec: dur(times.get(qa), times.get(qb)) };
      }
    }

    const ratePerMin = span?.durationSec && span.durationSec > 0
      ? Math.round((fileCommits / (span.durationSec / 60)) * 100) / 100
      : null;

    // Timeline: files AND anchors binned by wall-clock time. Domain endpoints
    // are the range's anchor block times (authoritative); each entry falls
    // into a bin by its S3 write time (server clock, approximate). Binning by
    // TIME rather than by anchor index matters: anchor cadence varies (12s
    // hot, 3600s idle), so index-binning would compress idle hours into one
    // bar. The anchor series is the TEE's pulse — it shows when the enclave
    // was anchoring at all, which gives the file series its context.
    let timeline: { startTime: string; endTime: string; fileBins: number[]; anchorBins: number[] } | null = null;
    if (!truncated && span?.fromTime && span?.toTime) {
      const start = new Date(span.fromTime).getTime();
      const end = new Date(span.toTime).getTime();
      if (end > start) {
        const BINS = 96;
        const binOf = (mtime: number) => Math.min(BINS - 1, Math.max(0, Math.floor(((mtime - start) / (end - start)) * BINS)));
        const fileBins = new Array<number>(BINS).fill(0);
        const anchorBins = new Array<number>(BINS).fill(0);
        for (const [c, , mtime] of fileKeys) if (mtime && !systemCounters.has(c)) fileBins[binOf(mtime)]++;
        for (const [, , mtime] of anchorsRes.items) if (mtime) anchorBins[binOf(mtime)]++;
        timeline = { startTime: span.fromTime, endTime: span.toTime, fileBins, anchorBins };
      }
    }

    // Epoch inventory + all-time totals: sealed heads cache forever, so this
    // is a handful of cached lookups after the first request.
    const heads = await Promise.all(epochList.map((e) => getHead(e.epoch, now, e.epoch === currentEpoch)));
    const epochs = epochList.map((e, i) => ({
      epoch: e.epoch,
      born: e.born ? new Date(e.born).toISOString() : null,
      head: heads[i],
      current: e.epoch === currentEpoch,
    }));
    const allTime = { epochs: epochs.length, positions: heads.reduce((a, b) => a + b, 0) };

    // A range whose upper bound sits below the live head is settled ledger
    // history; cache those, but only when the payload is intact (boundary
    // block times resolved — never bake an RPC outage into the CDN) and only
    // moderately, because the body also bundles live inventory fields (head,
    // epochs, allTime) that go stale when the TEE mints a new epoch.
    const settled = (!isCurrent || to < head - 4) && !empty && !!(span?.fromTime && span?.toTime);
    return NextResponse.json({
      epoch, head, isCurrent, epochs, allTime,
      range: { from, to, clamped, empty, coveredTo: truncated ? coveredTo : null },
      span,
      totals: {
        entries: proofsRes.items.length,
        fileCommits,
        anchors: anchorCounters.length,
        uniqueDigests: digestCounts.size,
        recurringDigests: recurring.length,
      },
      ratePerMin,
      recurrences,
      rhythm: { peak, quiet },
      timeline,
      truncated,
      digestsCapped,
    }, {
      headers: { "Cache-Control": settled ? "public, s-maxage=600, stale-while-revalidate=3600" : "public, s-maxage=10, stale-while-revalidate=20" },
    });
  } catch (e) {
    console.error("GET /api/stats error:", e);
    return NextResponse.json({ error: "failed" }, { status: 500 });
  }
}
