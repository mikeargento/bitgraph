/**
 * S3-based proof storage — replaces Neon Postgres.
 *
 * Keys:
 *   by-digest/{urlSafeDigest}.json  — lookup by artifact hash
 *   anchors-by-time/{timestamp}.json — chronological anchor listing
 */

import { S3Client, GetObjectCommand, PutObjectCommand, ListObjectsV2Command, HeadObjectCommand } from "@aws-sdk/client-s3";

function getClient() {
  return new S3Client({ region: (process.env.LEDGER_REGION || "us-east-2").trim() });
}

function getBucket() {
  return (process.env.LEDGER_BUCKET || "occ-ledger-prod").trim();
}

function toSafe(b64: string): string {
  return b64.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

// Warm-instance cache for the current epoch (a new epoch is born at counter 1
// on every TEE restart, so it changes rarely).
let epochCache: { epoch: string; at: number } | null = null;
const EPOCH_TTL = 60_000;

/** Current epoch = the one whose first object was written most recently. */
export async function getCurrentEpoch(): Promise<string | null> {
  const now = Date.now();
  if (epochCache && now - epochCache.at < EPOCH_TTL) return epochCache.epoch;
  const s3 = getClient();
  const bucket = getBucket();
  const pe = await s3.send(new ListObjectsV2Command({ Bucket: bucket, Prefix: "proofs/", Delimiter: "/", MaxKeys: 200 }));
  const prefixes = (pe.CommonPrefixes || []).map((p) => p.Prefix!).filter(Boolean);
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

/** List every key under a prefix, paginated, lexicographically sorted (read-only). */
export async function listKeysUnderPrefix(prefix: string, maxKeys = 100_000): Promise<string[]> {
  const s3 = getClient();
  const bucket = getBucket();
  const keys: string[] = [];
  let continuationToken: string | undefined;
  do {
    const result = await s3.send(new ListObjectsV2Command({
      Bucket: bucket,
      Prefix: prefix,
      ContinuationToken: continuationToken,
    }));
    for (const obj of result.Contents || []) {
      if (obj.Key) keys.push(obj.Key);
      if (keys.length >= maxKeys) return keys.sort();
    }
    continuationToken = result.NextContinuationToken;
  } while (continuationToken);
  return keys.sort(); // counter-padded keys sort lexicographically = causal order
}

/** Fetch one object's raw UTF-8 text, or null when missing (read-only). */
export async function getObjectText(key: string): Promise<string | null> {
  try {
    const s3 = getClient();
    const result = await s3.send(new GetObjectCommand({ Bucket: getBucket(), Key: key }));
    return (await result.Body?.transformToString()) ?? null;
  } catch (err) {
    const name = (err as { name?: string }).name;
    if (name === "NoSuchKey" || name === "NotFound") return null;
    console.error("[s3] getObjectText failed:", name, (err as Error).message);
    return null;
  }
}

/** Look up a proof by artifact digest (legacy single-object index: latest proof only) */
export async function getProofByDigest(digestB64: string): Promise<Record<string, unknown> | null> {
  try {
    const s3 = getClient();
    const key = `by-digest/${toSafe(digestB64)}.json`;
    const result = await s3.send(new GetObjectCommand({ Bucket: getBucket(), Key: key }));
    const body = await result.Body?.transformToString();
    if (!body) return null;
    return JSON.parse(body);
  } catch (err) {
    const name = (err as { name?: string }).name;
    if (name === "NoSuchKey" || name === "NotFound") return null;
    console.error("[s3] getProofByDigest failed:", name, (err as Error).message);
    return null;
  }
}

/**
 * Store a proof indexed by artifact digest.
 *
 * Two writes per proof:
 *   by-digest/{digest}.json                      — legacy single-object index
 *     (latest proof wins; kept so older readers keep working)
 *   by-digest/{digest}/{epoch}-{counter}.json    — one entry per causal
 *     position, so the same bytes can be BitGraphed more than once and every
 *     position stays findable. Digests are fixed-length so the "/" sub-prefix
 *     can never collide with another digest's legacy key.
 */
/**
 * @param priorLegacy The proof the legacy by-digest key held BEFORE this
 * commit, when the caller pre-read it (null = key absent). MUST be pre-read
 * before the commit that produced `proof`: the EC2 parent also overwrites the
 * legacy key fire-and-forget as soon as the TEE responds, so reading it here
 * races that write and can see the NEW proof — skipping the backfill and
 * orphaning the original recording from digest lookup. When undefined, the
 * key is read here (best effort, race-prone).
 */
export async function storeProofByDigest(proof: Record<string, unknown>, priorLegacy?: Record<string, unknown> | null): Promise<void> {
  try {
    const s3 = getClient();
    const bucket = getBucket();
    const artifact = proof.artifact as { digestB64: string };
    const body = JSON.stringify(proof, null, 2);
    const safeDigest = toSafe(artifact.digestB64);

    const positionKeyFor = (p: Record<string, unknown>): string | null => {
      const c = p.commit as { epochId?: string; counter?: string } | undefined;
      if (!c?.epochId || !c?.counter) return null;
      return `by-digest/${safeDigest}/${toSafe(c.epochId)}-${String(c.counter).padStart(12, "0")}.json`;
    };

    // Backfill: digests BitGraphed before the per-position index existed live
    // ONLY in the legacy key, and the write below replaces it. If the legacy
    // key holds a DIFFERENT position than the proof being stored and that
    // position has no index entry yet, copy it into the index first so no
    // recording is orphaned. The entry is flagged as a backfill (metadata) so
    // the reader orders it before same-second index writes: a proof that was
    // ever legacy-only necessarily predates every indexed one.
    const newPositionKey = positionKeyFor(proof);
    try {
      const existing = priorLegacy !== undefined ? priorLegacy : await getProofByDigest(artifact.digestB64);
      if (existing) {
        const existingPositionKey = positionKeyFor(existing);
        if (existingPositionKey && existingPositionKey !== newPositionKey) {
          const alreadyIndexed = await s3.send(new HeadObjectCommand({ Bucket: bucket, Key: existingPositionKey }))
            .then(() => true, () => false);
          if (!alreadyIndexed) {
            await s3.send(new PutObjectCommand({
              Bucket: bucket,
              Key: existingPositionKey,
              Body: JSON.stringify(existing, null, 2),
              ContentType: "application/json",
              Metadata: { "bg-backfill": "1" },
            }));
          }
        }
      }
    } catch (err) {
      console.error("[s3] by-digest backfill failed:", (err as Error).message);
    }

    const puts = [
      s3.send(new PutObjectCommand({
        Bucket: bucket,
        Key: `by-digest/${safeDigest}.json`,
        Body: body,
        ContentType: "application/json",
      })),
    ];
    if (newPositionKey) {
      puts.push(s3.send(new PutObjectCommand({
        Bucket: bucket,
        Key: newPositionKey,
        Body: body,
        ContentType: "application/json",
      })));
    }
    await Promise.all(puts);
  } catch (err) {
    console.error("[s3] storeProofByDigest failed:", (err as Error).message);
  }
}

/* ── Intervals ─────────────────────────────────────────────────────────────
 *
 * A user interval is the same uniquely generated marker file recorded at two
 * causal positions: the first recording opens it, a possession-verified
 * re-recording closes it. The proofs themselves are ordinary BitGraphs; this
 * registry is product state (which digest is an interval, where it opened,
 * where it verifiably closed), NOT part of any signed proof.
 *
 * Key: intervals/{urlSafeDigest}.json
 */

export interface IntervalPosition {
  epochId: string;   // standard base64
  counter: string;
  at: string;        // ISO write time (server clock, advisory)
}

export interface IntervalReport {
  sameEpoch: boolean;
  /** close.counter - open.counter; null across epochs (counters reset). */
  counterDistance: number | null;
  /** Ledger objects strictly between the two commits (file commits + anchors). */
  entriesBetween: number | null;
  fileCommits: number | null;
  anchors: number | null;
  /** Counter gaps = slot reservations (a slot reserves a counter, no object). */
  slots: number | null;
  uniqueDigests: number | null;
  truncated?: boolean;
}

export interface IntervalRecord {
  kind: "bitgraph-interval/1";
  digestB64: string;
  opened: IntervalPosition;
  closed: IntervalPosition | null;
  report: IntervalReport | null;
}

function intervalKey(digestB64: string): string {
  return `intervals/${toSafe(digestB64)}.json`;
}

export async function getIntervalRecord(digestB64: string): Promise<IntervalRecord | null> {
  const text = await getObjectText(intervalKey(digestB64));
  if (!text) return null;
  try { return JSON.parse(text) as IntervalRecord; } catch { return null; }
}

/**
 * Register a digest as an interval, atomically: IfNoneMatch:"*" makes the
 * first writer win (same claim pattern as anchor dedup), so a digest can never
 * be registered twice. Returns false when the record already existed.
 */
export async function claimIntervalRecord(record: IntervalRecord): Promise<boolean> {
  try {
    const s3 = getClient();
    await s3.send(new PutObjectCommand({
      Bucket: getBucket(),
      Key: intervalKey(record.digestB64),
      Body: JSON.stringify(record, null, 2),
      ContentType: "application/json",
      IfNoneMatch: "*",
    }));
    return true;
  } catch (err) {
    const name = (err as { name?: string }).name;
    if (name === "PreconditionFailed" || (err as { $metadata?: { httpStatusCode?: number } }).$metadata?.httpStatusCode === 412) return false;
    console.error("[s3] claimIntervalRecord failed:", name, (err as Error).message);
    throw err;
  }
}

/** Overwrite the interval record (bucket versioning keeps prior versions). */
export async function putIntervalRecord(record: IntervalRecord): Promise<void> {
  const s3 = getClient();
  await s3.send(new PutObjectCommand({
    Bucket: getBucket(),
    Key: intervalKey(record.digestB64),
    Body: JSON.stringify(record, null, 2),
    ContentType: "application/json",
  }));
}

/**
 * What happened strictly between the open and close commits. Counted from S3
 * key names only (proofs/{epoch}/{counter}-{hash}.json), no object GETs.
 * Anchors are identified via the anchors/{epoch}/ counter index. Counter gaps
 * are slot reservations: every proof spans TWO counters (slot N, commit N+1),
 * so raw counter distance always overstates activity.
 */
export async function computeIntervalReport(opened: IntervalPosition, closed: IntervalPosition): Promise<IntervalReport> {
  const sameEpoch = opened.epochId === closed.epochId;
  if (!sameEpoch) {
    return { sameEpoch, counterDistance: null, entriesBetween: null, fileCommits: null, anchors: null, slots: null, uniqueDigests: null };
  }
  const openC = parseInt(opened.counter, 10);
  const closeC = parseInt(closed.counter, 10);
  const report: IntervalReport = {
    sameEpoch,
    counterDistance: closeC - openC,
    entriesBetween: 0, fileCommits: 0, anchors: 0, slots: 0, uniqueDigests: 0,
  };
  const span = closeC - openC - 1;
  if (span <= 0) return report;

  const s3 = getClient();
  const bucket = getBucket();
  const safeEpoch = toSafe(opened.epochId);
  const MAX_KEYS = 5000;

  // Keys in (openC, closeC) under a prefix; returns [counter, filename] pairs.
  const listBetween = async (prefix: string): Promise<Array<[number, string]>> => {
    const out: Array<[number, string]> = [];
    let token: string | undefined;
    do {
      const res = await s3.send(new ListObjectsV2Command({
        Bucket: bucket,
        Prefix: prefix,
        StartAfter: `${prefix}${String(openC + 1).padStart(12, "0")}`,
        ContinuationToken: token,
        MaxKeys: 1000,
      }));
      for (const obj of res.Contents || []) {
        const filename = (obj.Key || "").split("/").pop() || "";
        const c = parseInt(filename.split("-")[0], 10);
        if (isNaN(c)) continue;
        if (c >= closeC) return out;
        if (c > openC) out.push([c, filename]);
        if (out.length >= MAX_KEYS) { report.truncated = true; return out; }
      }
      token = res.IsTruncated ? res.NextContinuationToken : undefined;
    } while (token);
    return out;
  };

  const [proofEntries, anchorEntries] = await Promise.all([
    listBetween(`proofs/${safeEpoch}/`),
    listBetween(`anchors/${safeEpoch}/`),
  ]);
  const anchorCounters = new Set(anchorEntries.map(([c]) => c));
  const digests = new Set<string>();
  for (const [c, filename] of proofEntries) {
    if (!anchorCounters.has(c)) {
      // filename: {counter}-{hash}.json — the hash part identifies the digest.
      const hash = filename.replace(/\.json$/, "").split("-").slice(1).join("-");
      if (hash) digests.add(hash);
    }
  }
  report.entriesBetween = proofEntries.length;
  report.anchors = anchorCounters.size;
  report.fileCommits = proofEntries.filter(([c]) => !anchorCounters.has(c)).length;
  report.uniqueDigests = digests.size;
  report.slots = report.truncated ? null : Math.max(0, span - proofEntries.length);
  return report;
}

export interface DigestProofEntry {
  proof: Record<string, unknown>;
  /** S3 write time of the position-index entry (ms), null for the legacy key. */
  writeTime: number | null;
}

/**
 * Look up EVERY proof recorded for an artifact digest, earliest causal
 * position first. Merges the per-position index with the legacy single-object
 * key (which is the only record for digests BitGraphed before the
 * per-position index existed) and dedupes by (epoch, counter).
 *
 * Ordering: within an epoch the counter is exact causal order. Across epochs
 * counters reset (TEE restart), and stored proofs carry no clock field, so
 * entries are ordered by the index entry's S3 write time; the legacy entry has
 * no per-position write time and necessarily predates the index, so it sorts
 * first.
 */
export async function getProofsByDigest(digestB64: string): Promise<DigestProofEntry[]> {
  const safeDigest = toSafe(digestB64);
  const entries: DigestProofEntry[] = [];
  try {
    const s3 = getClient();
    const bucket = getBucket();
    const listed = await s3.send(new ListObjectsV2Command({
      Bucket: bucket,
      Prefix: `by-digest/${safeDigest}/`,
      MaxKeys: 1000,
    }));
    const objects = (listed.Contents || []).filter((o) => o.Key);
    const fetched = await Promise.all(objects.map(async (obj): Promise<DigestProofEntry | null> => {
      try {
        const result = await s3.send(new GetObjectCommand({ Bucket: bucket, Key: obj.Key! }));
        const body = await result.Body?.transformToString();
        if (!body) return null;
        // Backfilled entries were legacy-only records copied into the index at
        // some later commit; they predate every genuinely indexed entry, so
        // they order like the legacy key (before any write time).
        const backfilled = result.Metadata?.["bg-backfill"] === "1";
        return { proof: JSON.parse(body) as Record<string, unknown>, writeTime: backfilled ? null : obj.LastModified?.getTime() ?? null };
      } catch { return null; }
    }));
    for (const e of fetched) if (e) entries.push(e);
  } catch (err) {
    console.error("[s3] getProofsByDigest failed:", (err as Error).message);
  }
  const legacy = await getProofByDigest(digestB64);
  if (legacy) entries.push({ proof: legacy, writeTime: null });

  const positionOf = (p: Record<string, unknown>) => {
    const c = p.commit as { epochId?: string; counter?: string } | undefined;
    return { epoch: c?.epochId ?? "", counter: parseInt(c?.counter ?? "0", 10) || 0 };
  };
  const seen = new Set<string>();
  const unique = entries.filter((e) => {
    const pos = positionOf(e.proof);
    const id = `${pos.epoch}:${pos.counter}`;
    if (seen.has(id)) return false;
    seen.add(id);
    return true;
  });

  unique.sort((a, b) => {
    const pa = positionOf(a.proof);
    const pb = positionOf(b.proof);
    if (pa.epoch && pa.epoch === pb.epoch) return pa.counter - pb.counter;
    return (a.writeTime ?? 0) - (b.writeTime ?? 0);
  });
  return unique;
}

/**
 * Get the first ETH anchor proof(s) AFTER a given counter on the same chain.
 *
 * Since anchors and user proofs share the same monotonic counter chain,
 * we find the next anchor by scanning proofs with counter > proofCounter
 * in the same epoch, filtering for Ethereum anchors (attribution.name).
 */
/**
 * Get proofs around a given counter in the same epoch.
 * Returns up to `before` proofs before and `after` proofs after the counter,
 * plus the proof at the counter itself.
 */
export async function getProofsAroundCounter(
  epochId: string,
  counter: number,
  before = 3,
  after = 3,
): Promise<Array<Record<string, unknown>>> {
  try {
    const s3 = getClient();
    const bucket = getBucket();
    const safeEpoch = toSafe(epochId);
    const prefix = `proofs/${safeEpoch}/`;

    // Fetch proofs BEFORE (and including) the current counter
    // We list from the start and collect keys up to our counter
    const targetKey = String(counter).padStart(12, "0");
    const beforeProofs: Array<Record<string, unknown>> = [];

    // To get proofs before, we list with prefix and collect those <= counter
    // Start scanning from a few before our target
    const scanStart = Math.max(1, counter - before - 1);
    const scanStartKey = `${prefix}${String(scanStart).padStart(12, "0")}`;

    const beforeResult = await s3.send(new ListObjectsV2Command({
      Bucket: bucket,
      Prefix: prefix,
      StartAfter: scanStartKey,
      MaxKeys: before + after + 5, // extra buffer
    }));

    const allKeys = (beforeResult.Contents || []).map(o => o.Key!).filter(Boolean);

    // Split into before, current, and after based on counter in key
    const beforeKeys: string[] = [];
    let currentKey: string | null = null;
    const afterKeys: string[] = [];

    for (const key of allKeys) {
      const filename = key.split("/").pop() || "";
      const keyCounter = parseInt(filename.split("-")[0], 10);
      if (isNaN(keyCounter)) continue;
      if (keyCounter < counter) beforeKeys.push(key);
      else if (keyCounter === counter) currentKey = key;
      else if (keyCounter > counter) afterKeys.push(key);
    }

    // Trim to requested sizes
    const selectedKeys = [
      ...beforeKeys.slice(-before),
      ...(currentKey ? [currentKey] : []),
      ...afterKeys.slice(0, after),
    ];

    // Fetch all proofs in parallel
    const proofs = await Promise.all(
      selectedKeys.map(async (key) => {
        try {
          const result = await s3.send(new GetObjectCommand({ Bucket: bucket, Key: key }));
          const body = await result.Body?.transformToString();
          if (!body) return null;
          return JSON.parse(body) as Record<string, unknown>;
        } catch { return null; }
      })
    );

    return proofs.filter((p): p is Record<string, unknown> => p !== null);
  } catch (err) {
    console.error("[s3] getProofsAroundCounter failed:", (err as Error).message);
    return [];
  }
}

/**
 * Get the most recent ETH anchor BEFORE a given counter on the same chain.
 * Scans backwards from the counter to find the latest anchor.
 */
export async function getAnchorBeforeCounter(proofCounter: number, epochId: string): Promise<Record<string, unknown> | null> {
  try {
    const s3 = getClient();
    const bucket = getBucket();
    const safeEpoch = toSafe(epochId);
    // Scan the counter-indexed anchors/ index (anchors only — no user proofs to
    // skip), same source getAnchorsAfterCounter uses.
    const anchorPrefix = `anchors/${safeEpoch}/`;

    // Nearest anchor strictly BEFORE proofCounter (the lower time bound). S3
    // lists ascending only, so we open a window just below proofCounter via
    // StartAfter, page forward keeping the highest anchor counter still
    // < proofCounter, and stop as soon as keys reach proofCounter. The window
    // starts wider than any realistic anchor gap (~600 commits per 12s at peak
    // TEE throughput) and widens only if it somehow caught no anchor, e.g. a
    // long anchoring outage left a large gap. Crucially this is bounded near
    // proofCounter rather than scanning the whole epoch from the start, which
    // was the previous bug (it always returned the first anchor of the epoch).
    for (let window = 4096; ; window *= 8) {
      const start = Math.max(0, proofCounter - window);
      let token: string | undefined;
      let bestKey: string | null = null;
      let bestCounter = -1;
      let reachedProof = false;
      for (let page = 0; page < 128; page++) {
        const res = await s3.send(new ListObjectsV2Command({
          Bucket: bucket,
          Prefix: anchorPrefix,
          StartAfter: `${anchorPrefix}${String(start).padStart(12, "0")}`,
          ContinuationToken: token,
          MaxKeys: 1000,
        }));
        for (const obj of res.Contents || []) {
          const filename = (obj.Key || "").split("/").pop() || "";
          const c = parseInt(filename.split("-")[0], 10);
          if (isNaN(c)) continue;
          if (c < proofCounter) {
            if (c > bestCounter) { bestCounter = c; bestKey = obj.Key!; }
          } else {
            reachedProof = true;
            break;
          }
        }
        if (reachedProof || !res.IsTruncated) break;
        token = res.NextContinuationToken;
      }
      if (bestKey) {
        const gr = await s3.send(new GetObjectCommand({ Bucket: bucket, Key: bestKey }));
        const body = await gr.Body?.transformToString();
        return body ? JSON.parse(body) : null;
      }
      // No anchor found in the window. If we already reached the epoch start,
      // there is genuinely no anchor before this proof (very early proof).
      if (start === 0 || window >= 8_388_608) return null;
    }
  } catch (err) {
    console.error("[s3] getAnchorBeforeCounter failed:", (err as Error).message);
    return null;
  }
}

export async function getAnchorsAfterCounter(proofCounter: number, epochId: string, limit = 2): Promise<Array<Record<string, unknown>>> {
  try {
    const s3 = getClient();
    const bucket = getBucket();

    const safeEpoch = toSafe(epochId);
    const startCounter = String(proofCounter + 1).padStart(12, "0");

    // Scan anchors/{epoch}/ — counter-indexed, only contains anchors.
    // One S3 LIST + one GET per anchor found. No user proofs to skip.
    // Falls back to proofs/ scan if anchors/ index isn't populated yet.
    const anchorPrefix = `anchors/${safeEpoch}/`;
    let result = await s3.send(new ListObjectsV2Command({
      Bucket: bucket,
      Prefix: anchorPrefix,
      StartAfter: `${anchorPrefix}${startCounter}`,
      MaxKeys: limit,
    }));

    let keys = (result.Contents || []).map(o => o.Key!).filter(Boolean);

    // Fallback: if anchors/ index is empty, scan proofs/ (slower but works)
    if (keys.length === 0) {
      const proofPrefix = `proofs/${safeEpoch}/`;
      let continuationToken: string | undefined;
      const foundAnchors: Array<Record<string, unknown>> = [];
      for (let page = 0; page < 5 && foundAnchors.length < limit; page++) {
        const r = await s3.send(new ListObjectsV2Command({
          Bucket: bucket,
          Prefix: proofPrefix,
          StartAfter: page === 0 ? `${proofPrefix}${startCounter}` : undefined,
          ContinuationToken: continuationToken,
          MaxKeys: 100,
        }));
        for (const obj of r.Contents || []) {
          if (!obj.Key || foundAnchors.length >= limit) break;
          try {
            const gr = await s3.send(new GetObjectCommand({ Bucket: bucket, Key: obj.Key }));
            const body = await gr.Body?.transformToString();
            if (!body) continue;
            const p = JSON.parse(body);
            if ((p.attribution as { name?: string })?.name === "Ethereum Anchor") foundAnchors.push(p);
          } catch { /* skip */ }
        }
        if (!r.IsTruncated) break;
        continuationToken = r.NextContinuationToken;
      }
      return foundAnchors;
    }

    // Fetch from anchors/ index
    const anchors: Array<Record<string, unknown>> = [];
    for (const key of keys.slice(0, limit)) {
      try {
        const getResult = await s3.send(new GetObjectCommand({ Bucket: bucket, Key: key }));
        const body = await getResult.Body?.transformToString();
        if (!body) continue;
        anchors.push(JSON.parse(body));
      } catch { /* skip */ }
    }
    return anchors;
  } catch (err) {
    console.error("[s3] getAnchorsAfterCounter failed:", (err as Error).message);
    return [];
  }
}
