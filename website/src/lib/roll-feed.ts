import { unstable_cache } from "next/cache";
import { S3Client, ListObjectsV2Command, GetObjectCommand } from "@aws-sdk/client-s3";
import { dayIndexKey, pageKey, type DayIndex, type DayPage, type RollFilter } from "./roll-archive";

/* The Roll feed, shared by the API route and the server-rendered /roll page.

   This lived inside app/api/explorer/route.ts until the roll page needed the
   same first page at request time. A route handler can only be reached over
   HTTP, so server-rendering the first 25 rows through it would have meant the
   page fetching itself. The logic moved here instead and route.ts became a
   thin adapter over it; behaviour, cache headers and the disclosure surface
   are unchanged.

   Read-only, CURRENT epoch. Returns aggregate, safe per-entry fields only
   (counter, type, short hash, link digest, anchor block). Never returns
   attestation, signatures, agency, or any operator/clock detail. See the
   disclosure audit: the per-proof page already carries the rest; this surface
   deliberately exposes only the spine. */

const region = (process.env.LEDGER_REGION || "us-east-2").trim();
const bucket = (process.env.LEDGER_BUCKET || "occ-ledger-prod").trim();
const s3 = new S3Client({ region });

const PAGE = 25;
const pad = (n: number) => String(n).padStart(12, "0");
const toSafe = (b64: string) => b64.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

// ── tiny in-memory caches (warm-instance scoped) ───────────────────────────
let epochCache: { epoch: string; at: number } | null = null;
const EPOCH_TTL = 60_000;

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

/* getHead() lived here. It walked keys-only LIST pages to find the epoch's
   highest counter and, when the walk hit its page cap, fell through to a
   ~20-probe binary search — and on 2026-08-09 the day's epoch outgrew the cap,
   so it did BOTH: 3,261ms to learn one number, the answer from the walk thrown
   away first. Nothing calls it now. The live path takes the head from the same
   cached pass that produces its rows, and the day path takes its bounds from
   the anchors-by-time segments. */

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
/* 40,000, not 4,000. Recordings arrive in bursts and anchors do not, so a quiet
   stretch is anchor-only for thousands of counters at a time. On 2026-08-09 the
   top 4,000 counters held no recordings at all, so this budget expired before
   finding one and the live Roll answered a 5.2s request with ZERO rows and
   hasMore — a page that looks exactly like an empty ledger.

   The budget is cheap to raise because the scan itself is cheap: anchor
   counters come from the anchors/ index, so a skipped counter costs no GET,
   and only rows that will actually be shown are fetched. What it bounds is
   LISTs, at two per 1,000 counters. */
const SCAN_BUDGET = 40_000;
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
    /* Fetch newest-first, in batches, only as far as the page needs.
       fileKeys covers a window of up to 1000 counters, and this used to GET
       every key in it to render 25 rows: on a busy stretch, hundreds of round
       trips thrown away. The sibling listRecent always sliced to `limit`
       before fetching; this path never did, and it was the bulk of a cold
       page's time.

       Batched rather than a flat slice because a key can still turn out to be
       an anchor (see the belt-and-suspenders check below) or fail to load, and
       stopping at exactly `limit` keys would silently short the page. The loop
       keeps drawing from the same window until the page is full or the window
       is spent, so nothing inside a window is ever skipped unexamined. In
       practice that is one batch. */
    let idx = 0;
    while (idx < fileKeys.length && found.length < limit) {
      const batch = fileKeys.slice(idx, idx + (limit - found.length) + 4);
      idx += batch.length;
      const objs = await Promise.all(batch.map(async ({ key, lm }) => {
        try {
          const r = await s3.send(new GetObjectCommand({ Bucket: bucket, Key: key }));
          const body = await r.Body?.transformToString();
          return body ? { json: JSON.parse(body) as Record<string, unknown>, lm } : null;
        } catch { return null; }
      }));
      for (const o of objs) {
        const e = o ? toEntry(o.json, o.lm) : null;
        // Belt and suspenders: the anchors/ index is authoritative for
        // skipping, but if an index write ever went missing the proof itself
        // still says what it is.
        if (e && e.type === "proof") found.push(e);
      }
    }
    scanned += cursor - start;
    cursor = start;
  }
  found.sort((a, b) => b.counter - a.counter);
  const entries = found.slice(0, limit);
  /* Resume just below the last row actually shown, not at the bottom of the
     window we happened to be scanning. A full page nearly always ends partway
     through its window, and reporting the window's floor told the next page to
     start below everything in between, so those recordings were never shown at
     all. Only when the page did not fill is the window floor the right answer:
     there, everything above it really has been accounted for. */
  return {
    entries,
    floor: entries.length >= limit ? entries[entries.length - 1].counter : cursor + 1,
  };
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

async function computeDaySegments(day: string): Promise<DaySeg[]> {
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
  if (keys.length === 0) return [];
  const [first, last] = await Promise.all([getAnchorRef(keys[0]), getAnchorRef(keys[keys.length - 1])]);
  if (!first || !last) return [];
  return keys.length === 1 || first.epoch === last.epoch
    ? [{ epoch: first.epoch, min: first.counter, max: last.counter }]
    : await splitSegs(keys, 0, keys.length - 1, first, last);
}

/* A sealed day's segments are a fixed fact, but computeDaySegments rederived
   them from scratch on every cold instance: a dozen keys-only LISTs plus a
   recursive binary partition, and it is the reason a cold day roll cost ~3.8s
   while a warm one cost ~100ms. The in-process Map above only ever helped an
   instance that had already answered for that day.

   So the derived map goes in the Data Cache, which outlives an instance.
   revalidate: false because the input cannot change: the day is sealed, its
   anchors are written, and epoch keys are never reused. Bump the key suffix
   rather than trying to invalidate if the segment shape ever changes.

   Deliberately NOT written to the ledger bucket. That would be durable across
   deploys too, but the bucket is Object Lock COMPLIANCE, so a map derived by a
   buggy version could never be deleted. A cache that can be thrown away is the
   right home for a derived value. */
const cachedDaySegments = unstable_cache(
  async (day: string): Promise<DaySeg[]> => {
    const segs = await computeDaySegments(day);
    // Never let an empty answer become durable. A day that genuinely has no
    // anchors and a day whose index read failed are indistinguishable here, and
    // persisting the second would turn one bad read into a permanent "nothing
    // was recorded that day". Throwing leaves nothing cached, so the next
    // request tries again.
    if (segs.length === 0) throw new Error(EMPTY_DAY);
    return segs;
  },
  ["roll-day-segments-v1"],
  { revalidate: false },
);

const EMPTY_DAY = "roll-feed: day resolved to no segments";

async function daySegments(day: string): Promise<DaySeg[]> {
  const cached = daySegCache.get(day);
  if (cached) return cached;
  let segs: DaySeg[];
  try {
    segs = await cachedDaySegments(day);
  } catch (e) {
    // Empty is the one throw this layer invents, and the answer it stands for
    // is []: no recompute needed. Anything else is a real read failure and has
    // to stay one, so it travels up rather than being flattened into an empty
    // roll.
    if ((e as Error)?.message !== EMPTY_DAY) throw e;
    segs = [];
  }
  if (daySegCache.size > 64) daySegCache.clear();
  daySegCache.set(day, segs);
  return segs;
}

// ── The sealed-day archive ──────────────────────────────────────────────────
/* A sealed day is written history: it cannot gain, lose or reorder an entry, so
   it is materialised once into display pages by scripts/build-roll-archive.mjs
   and read back by name. Everything below replaces, for archived days only, the
   derivation this file does otherwise — a dozen LISTs over anchors-by-time, a
   recursive binary partition to find epoch boundaries, then window scans with a
   GET per row, repeated on every cold instance for a day frozen a week ago.
   Measured on three days: 1.10s → 250ms, 3.64s → 145ms, 2.98s → 119ms.

   The live epoch is deliberately NOT archived. It is the one range that can
   still change, and leaving it on the ledger read keeps the only place drift is
   possible free of a second source of truth.

   PAGING. Archived days are paged by page NUMBER, not by counter: the pages are
   the pagination. That cursor gets its OWN field, `page`/`nextPage`, rather than
   riding on `before`.

   It rode on `before` first, and the two meanings could not be told apart at the
   one place it mattered. The archive declines mid-run whenever a page read
   fails, and the derivation then received a page number and read it as a
   counter: `before=3` meant "page 3" to the reader that wrote it and "everything
   below counter 3" to the one that answered, which is the end of the day. With
   the fields split, a declined page leaves `before` unset, so the derivation
   falls back to the day's top and walks down by counter, re-deriving rows the
   client already holds and deduping them away. Slower, and correct.

   An out-of-range page still declines rather than clamping: clamping would
   answer with an empty page, and an empty page is the one answer this feed must
   never invent. */

async function getArchiveJson<T>(key: string): Promise<T | null> {
  try {
    const r = await s3.send(new GetObjectCommand({ Bucket: bucket, Key: key }));
    const body = await r.Body?.transformToString();
    return body ? (JSON.parse(body) as T) : null;
  } catch {
    return null;
  }
}

function entryFromRow(r: DayPage["rows"][number]): Entry {
  const type = r.t === "a" ? "anchor" : r.t === "i" ? "interval" : "proof";
  return {
    counter: r.c,
    type,
    digest: r.d,
    hashShort: r.h,
    blockNumber: r.b ?? null,
    etherscanUrl: r.b != null ? `https://etherscan.io/block/${r.b}` : null,
    ...(r.at ? { at: r.at } : {}),
    ...(r.ep ? { ep: r.ep } : {}),
  };
}

/**
 * One page of an archived day, or null to say "not archived, derive it".
 *
 * NULL IS THE ONLY FAILURE ANSWER. A missing manifest, an unreadable page, a
 * schema this build does not understand and an out-of-range cursor all return
 * null, and the caller then does exactly what it did before this existed. What
 * none of them do is return an empty page: a Roll that under-reports is
 * indistinguishable from a ledger that never recorded the thing you came to
 * look for, and every shortcut here has to fail towards the slow answer rather
 * than towards the empty one.
 */
async function archivedDayPage(
  day: string, pageParam: string | null, filesOnly: boolean,
): Promise<{ entries: Entry[]; nextPage: number | null; hasMore: boolean; total: number } | null> {
  const index = await getArchiveJson<DayIndex>(dayIndexKey(day));
  if (!index || index.v !== 1) return null;
  const filter: RollFilter = filesOnly ? "f" : "a";
  const pageCount = index.pages?.[filter];
  const rowTotal = index.rows?.[filter];
  if (typeof pageCount !== "number" || typeof rowTotal !== "number") return null;

  const n = pageParam ? parseInt(pageParam, 10) : 0;
  if (isNaN(n) || n < 0) return null;
  // Past the end. Only reachable from a hand-made or stale request, since the
  // last page reports no next page at all. Declining sends it to the derivation,
  // which answers from the ledger; clamping would answer with an empty page.
  if (n >= pageCount) return null;

  const page = await getArchiveJson<DayPage>(pageKey(day, filter, n));
  if (!page || !Array.isArray(page.rows) || page.n !== n) return null;

  const hasMore = n + 1 < pageCount;
  return {
    entries: page.rows.map(entryFromRow),
    nextPage: hasMore ? n + 1 : null,
    hasMore,
    total: rowTotal,
  };
}

// ── The live epoch, in one pass ─────────────────────────────────────────────
/* The sealed days are archived; today is the one range that can still change,
   so it is still read from the ledger. What it is NOT any more is scanned.

   The scan walked down from the head in 1000-counter windows, two LISTs each,
   stopping when it had 25 recordings. That is fine when recordings are spread
   evenly and catastrophic when they are not: recordings arrive in bursts and
   anchors arrive every 12 seconds, so by mid-afternoon the top of the epoch is
   tens of thousands of anchor-only counters and filling one page meant ~60
   LISTs. Measured at 7-10s, after the budget was raised far enough to return
   any rows at all.

   Two LISTs of the whole epoch cost less than sixty LISTs of part of it. The
   proofs prefix gives every counter and the anchors prefix gives the ones to
   skip; the difference is the file list, in order, and the last key is the
   head. One pass answers both questions the feed used to ask separately, and
   the answer is cached, so the paging that follows costs nothing but the GETs
   for the rows actually shown.

   revalidate 15 matches the s-maxage this same function hands the CDN for the
   live head, so this changes how often the work is done and never how fresh
   the Roll is allowed to be. */

type EpochIndex = { head: number; files: Array<{ key: string; counter: number; lm?: number }> };

async function listAllCounters(prefix: string): Promise<Array<{ key: string; counter: number; lm?: number }>> {
  const out: Array<{ key: string; counter: number; lm?: number }> = [];
  let token: string | undefined;
  // 60 pages is 60,000 objects: far past a day at the current rate, and a rail
  // rather than a budget. Running short yields FEWER rows, never wrong ones,
  // and the head it implies is a floor, so the client reads as behind.
  for (let page = 0; page < 60; page++) {
    const r = await s3.send(new ListObjectsV2Command({
      Bucket: bucket, Prefix: prefix, MaxKeys: 1000, ...(token ? { ContinuationToken: token } : {}),
    }));
    for (const o of r.Contents || []) {
      const n = parseInt(((o.Key || "").split("/").pop() || "").split("-")[0], 10);
      if (!isNaN(n)) out.push({ key: o.Key!, counter: n, lm: o.LastModified?.getTime() });
    }
    token = r.NextContinuationToken;
    if (!token) break;
  }
  return out;
}

async function computeEpochIndex(epoch: string): Promise<EpochIndex> {
  const [proofs, anchors] = await Promise.all([
    listAllCounters(`proofs/${epoch}/`),
    listAllCounters(`anchors/${epoch}/`),
  ]);
  const anchorCounters = new Set(anchors.map((a) => a.counter));
  const head = proofs.reduce((m, p) => (p.counter > m ? p.counter : m), 0);
  const files = proofs
    .filter((p) => !anchorCounters.has(p.counter))
    .sort((a, b) => b.counter - a.counter);
  return { head, files };
}

const cachedEpochIndex = unstable_cache(
  (epoch: string) => computeEpochIndex(epoch),
  ["roll-live-epoch-index-v1"],
  { revalidate: 15 },
);

/** The `limit` highest-counter recordings at or below `top`, from the cached
 *  index. No scan, no window, no budget: a slice and the GETs for the rows that
 *  will actually be shown. */
async function liveFiles(epoch: string, top: number, limit: number): Promise<{ entries: Entry[]; floor: number }> {
  const { files } = await cachedEpochIndex(epoch);
  const slice = files.filter((f) => f.counter <= top).slice(0, limit);
  const objs = await Promise.all(slice.map(async ({ key, lm }) => {
    try {
      const r = await s3.send(new GetObjectCommand({ Bucket: bucket, Key: key }));
      const body = await r.Body?.transformToString();
      return body ? { json: JSON.parse(body) as Record<string, unknown>, lm } : null;
    } catch { return null; }
  }));
  const entries = objs
    .map((o) => (o ? toEntry(o.json, o.lm) : null))
    .filter((e): e is Entry => e !== null && e.type === "proof")
    .sort((a, b) => b.counter - a.counter);
  // The cursor is the next unshown recording, so an anchor-only stretch is
  // skipped in one step instead of being paged through.
  const lowest = slice.length ? slice[slice.length - 1].counter : 1;
  const more = files.some((f) => f.counter < lowest);
  return { entries, floor: more ? lowest : 1 };
}

export type RollFeedBody = {
  epoch?: string;
  day?: string;
  head?: number;
  entries: Entry[];
  /** Counter cursor. Always a counter, on every path that sets it. */
  nextBefore: number | null;
  nextEpoch?: string | null;
  /* Page cursor, archived days only. Its own field rather than a second meaning
     for `before`, so that when the archive declines mid-run the derivation is
     handed no cursor at all instead of a page number it would read as a
     counter. Exactly one of the two is ever set. */
  nextPage?: number | null;
  hasMore: boolean;
  /* Rows the archive DECLARES this day holds, for the active filter. Present
     only for archived days, where it is what makes a short list detectably
     short: a client that has loaded three pages can compare what it holds
     against what the day says it has, instead of inferring completeness from a
     response that happened to be short. Absent on the live feed and on derived
     days, where no such declaration exists and the client must not pretend one
     does. */
  total?: number;
};

export type RollFeedResult =
  | { status: 200; body: RollFeedBody; cacheControl: string }
  | { status: 400 | 404; body: { error: string }; cacheControl?: undefined };

/** One page of the Roll. `day` selects a sealed UTC day; omit it for the live
 *  feed. Paging takes one of two cursors and never both: `page` for an archived
 *  day, `before`/`bepoch` for everything else (counters repeat across epochs, so
 *  a counter cursor is scoped by epoch). */
async function computeRollFeed(opts: {
  day?: string | null;
  before?: string | null;
  bepoch?: string | null;
  page?: string | null;
  filesOnly?: boolean;
}): Promise<RollFeedResult> {
  const now = Date.now();
  const beforeParam = opts.before ?? null;
  const filesOnly = !!opts.filesOnly;
  const dayParam = opts.day ?? null;

  if (dayParam) {
    // Sealed UTC days only; the live Roll is the plain (no-day) feed.
    const todayUTC = new Date(now).toISOString().slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(dayParam) || dayParam >= todayUTC) {
      return { status: 400, body: { error: "bad day" } };
    }
    /* A sealed day cannot change, but the ANSWER for one can: the moment its
       pages are built, the derivation stops being the best source. So a derived
       day is only cached briefly, while an archived page keeps the immutable
       header it sets for itself further down.

       This was s-maxage=86400, reasoning from the day rather than the answer,
       and it made the backfill invisible: a day anyone had already opened kept
       serving the slow derived answer for a full day after its pages landed.
       The long stale-while-revalidate stays, so the edge still paints instantly
       and corrects itself behind the request. */
    const derivedCache = "public, s-maxage=60, stale-while-revalidate=86400";

    // The archive first, always. It answers by name in two reads, and declines
    // (null) for anything it cannot answer with certainty, so the derivation
    // below stays the fallback rather than the fast path.
    const archived = await archivedDayPage(dayParam, opts.page ?? null, filesOnly);
    if (archived) {
      return {
        status: 200,
        body: {
          day: dayParam,
          entries: archived.entries,
          nextBefore: null,
          nextPage: archived.nextPage,
          hasMore: archived.hasMore,
          total: archived.total,
        },
        // A materialised page of a sealed day cannot change, so it caches hard.
        // The day is history and the page is named for its exact position in it.
        cacheControl: "public, max-age=31536000, s-maxage=31536000, immutable",
      };
    }

    // Newest segment first: the roll reads newest-first within the day too.
    const ordered = [...await daySegments(dayParam)].reverse();
    if (ordered.length === 0) {
      return {
        status: 200,
        body: { day: dayParam, entries: [], nextBefore: null, hasMore: false },
        cacheControl: derivedCache,
      };
    }
    // Cursor: before=<counter> scoped by bepoch=<epoch>, since counters repeat
    // across epochs. No cursor → start at the newest segment's top.
    let segIdx = 0;
    let top: number;
    if (beforeParam) {
      const b = parseInt(beforeParam, 10);
      const bepoch = opts.bepoch || "";
      segIdx = ordered.findIndex((s) => s.epoch === bepoch);
      if (isNaN(b) || segIdx < 0) return { status: 400, body: { error: "bad cursor" } };
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
    return {
      status: 200,
      body: { day: dayParam, entries, nextBefore, nextEpoch, hasMore: nextBefore != null },
      cacheControl: derivedCache,
    };
  }

  const epoch = await getCurrentEpoch(now);
  if (!epoch) return { status: 404, body: { error: "no epoch" } };

  /* The head comes from the same cached pass as the rows. It used to be its own
     LIST walk that, once the epoch outgrew 12,000 objects, discarded its answer
     and paid for a binary search on top: 3,261ms to learn one number. The walk
     is gone; the head is a by-product of listing the epoch once. */
  const { head } = await cachedEpochIndex(epoch);
  let top = head;
  if (beforeParam) {
    const b = parseInt(beforeParam, 10);
    if (isNaN(b)) return { status: 400, body: { error: "bad cursor" } };
    top = Math.min(b - 1, head);
  }

  let entries: Entry[];
  let nextBefore: number | null;
  if (filesOnly) {
    // The cursor is the scan floor, not the last entry: an anchor-only stretch
    // legitimately yields an empty page that still advances.
    const r = top < 1 ? { entries: [], floor: 1 } : await liveFiles(epoch, top, PAGE);
    entries = r.entries;
    nextBefore = r.floor > 1 ? r.floor : null;
  } else {
    entries = top < 1 ? [] : await listRecent(epoch, top, PAGE);
    nextBefore = entries.length ? entries[entries.length - 1].counter : null;
  }

  return {
    status: 200,
    body: { epoch, head, entries, nextBefore, hasMore: nextBefore != null && nextBefore > 1 },
    // The long stale-while-revalidate is the point, not s-maxage. Traffic here
    // is sparse, so a 10s SWR window meant the edge copy had almost always
    // expired by the next visitor and nearly every Roll open paid a cold
    // function invocation plus S3 LISTs. With an hour of SWR the edge always
    // has something to hand back instantly and refreshes behind the request, so
    // the page paints immediately and is corrected in place.
    //
    // Serving a slightly stale head page is safe: a recording the visitor just
    // made is prepended locally from the bitgraph:recorded event, not read back
    // from this feed, and the 12s live poll reconciles the rest. s-maxage stays
    // short so that poll still sees new rows promptly.
    //
    // Cursor pages are effectively immutable (older counters never change), so
    // they cache hard.
    cacheControl: beforeParam
      ? "public, s-maxage=3600, stale-while-revalidate=86400"
      : "public, s-maxage=15, stale-while-revalidate=3600",
  };
}

/* ── The assembled page, cached ─────────────────────────────────────────────
   Caching the parts (the epoch, the head, a day's segments) only ever helped
   the instance that computed them, and the expensive work is the assembly
   itself: the LISTs and the 25 GETs behind every page. So the finished body is
   cached too, in the Data Cache, which outlives the instance.

   The revalidate windows deliberately MIRROR the Cache-Control this same
   function hands the CDN. That is the safety argument: an answer served from
   here can never be staler than one the edge was already allowed to serve for
   the same URL, so this changes how often the work is done, never how fresh
   the roll is allowed to be.

     sealed day    a day/counter range that cannot change. Matches s-maxage=86400.
     live cursor   older counters never change. Matches s-maxage=3600.
     live head     the only one that must stay current. Matches s-maxage=15.

   Why it matters more than the CDN already caching: the edge cache is per-URL
   per-region and this site's traffic is sparse, so cold edges are the common
   case, not the rare one. This layer sits behind all of them. */

// Non-200s ride out as a thrown message so nothing is cached and the caller
// still gets the real answer without recomputing it.
const STATUS_PREFIX = "roll-feed-status:";

async function computeOrThrow(opts: Parameters<typeof computeRollFeed>[0]): Promise<RollFeedResult> {
  const result = await computeRollFeed(opts);
  if (result.status !== 200) throw new Error(`${STATUS_PREFIX}${result.status}:${result.body.error}`);
  return result;
}

/* Is this day archived? Asked OUTSIDE the feed cache, and it has to be.
   The feed cache held a day for 24 hours on the reasoning that a sealed day
   cannot change. The day cannot, but which source answers for it can, and the
   builder flips that at an arbitrary moment. The result was a backfill that ran
   correctly and changed nothing anyone could see: every day that had already
   been opened kept serving its derived answer for a day after its pages landed,
   and the days people open are exactly the ones that had been.

   One small GET, cached 60s, which is now the longest a freshly archived day
   stays slow. */
const cachedIsArchived = unstable_cache(
  async (day: string): Promise<boolean> => {
    const index = await getArchiveJson<DayIndex>(dayIndexKey(day));
    return !!index && index.v === 1;
  },
  ["roll-day-archived-v1"],
  { revalidate: 60 },
);

/* Two wrappers, because the two answers have different lifetimes and
   unstable_cache fixes revalidate per wrapper rather than per result.

     archived   materialised pages, addressed by name. Cannot change, so it is
                held for a day exactly as before.
     derived    the ledger walk, correct but supersedable. Held only until the
                archive check would notice a manifest.

   Keyed apart as well as timed apart, so a day crossing from one to the other
   never reads a body the other wrote. */
const cachedArchivedDayFeed = unstable_cache(
  (day: string, before: string | null, bepoch: string | null, page: string | null, filesOnly: boolean) =>
    computeOrThrow({ day, before, bepoch, page, filesOnly }),
  ["roll-feed-day-archived-v1"],
  { revalidate: 86400 },
);

const cachedDerivedDayFeed = unstable_cache(
  (day: string, before: string | null, bepoch: string | null, page: string | null, filesOnly: boolean) =>
    computeOrThrow({ day, before, bepoch, page, filesOnly }),
  ["roll-feed-day-derived-v1"],
  { revalidate: 60 },
);

const cachedLiveCursor = unstable_cache(
  (before: string, filesOnly: boolean) => computeOrThrow({ before, filesOnly }),
  ["roll-feed-live-cursor-v1"],
  { revalidate: 3600 },
);

const cachedLiveHead = unstable_cache(
  (filesOnly: boolean) => computeOrThrow({ filesOnly }),
  ["roll-feed-live-head-v1"],
  { revalidate: 15 },
);

/** One page of the Roll. `day` selects a sealed UTC day; omit it for the live
 *  feed. Paging takes one of two cursors and never both: `page` for an archived
 *  day, `before`/`bepoch` for everything else (counters repeat across epochs, so
 *  a counter cursor is scoped by epoch). */
export async function rollFeed(opts: {
  day?: string | null;
  before?: string | null;
  bepoch?: string | null;
  page?: string | null;
  filesOnly?: boolean;
}): Promise<RollFeedResult> {
  const filesOnly = !!opts.filesOnly;
  try {
    if (opts.day) {
      // Which cache, decided before either is consulted.
      const run = (await cachedIsArchived(opts.day)) ? cachedArchivedDayFeed : cachedDerivedDayFeed;
      return await run(opts.day, opts.before ?? null, opts.bepoch ?? null, opts.page ?? null, filesOnly);
    }
    if (opts.before) return await cachedLiveCursor(opts.before, filesOnly);
    return await cachedLiveHead(filesOnly);
  } catch (e) {
    const message = (e as Error)?.message ?? "";
    if (message.startsWith(STATUS_PREFIX)) {
      const rest = message.slice(STATUS_PREFIX.length);
      const split = rest.indexOf(":");
      const status = parseInt(rest.slice(0, split), 10);
      return { status: status as 400 | 404, body: { error: rest.slice(split + 1) } };
    }
    // A real read failure. It stays a failure: the caller turns it into a 500
    // and the Roll says so, rather than showing an empty ledger.
    throw e;
  }
}
