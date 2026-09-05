/**
 * S3-based proof storage — replaces Neon Postgres.
 *
 * Keys:
 *   by-digest/{urlSafeDigest}.json  — lookup by artifact hash
 *   anchors-by-time/{timestamp}.json — chronological anchor listing
 */

import { S3Client, GetObjectCommand, PutObjectCommand, ListObjectsV2Command, HeadObjectCommand } from "@aws-sdk/client-s3";
import { fusedOriginDigestOf } from "@/lib/fuse-core";
import { SET_KEY, bindSet, isSetProof, setIndexEntries, stripSetManifest, type BoundSet } from "@/lib/fuse-set";

/**
 * Raised when the ledger could not be READ. It is not an answer about the
 * ledger's contents, and callers must never degrade it into one: "we could
 * not check" and "these bytes were never recorded" are opposite claims, and
 * only one of them accuses the holder of a file.
 */
export class LedgerUnavailableError extends Error {
  constructor(where: string, cause?: unknown) {
    super(`ledger read failed (${where}): ${(cause as Error)?.message ?? "unknown"}`);
    this.name = "LedgerUnavailableError";
  }
}

/**
 * ONE client for the process, not one per lookup.
 *
 * This used to construct a fresh S3Client on every call, and every read path
 * calls it per digest: a 2000-recording folder dropped on the site fanned out
 * into thousands of clients, each with its own connection pool and none of
 * them reused. Under that burst the reads started failing, and because every
 * layer below turned a failure into an empty answer, the viewer told the
 * owner that hundreds of genuine recordings were not on the ledger (observed
 * 2026-08-06: 448 false verdicts in one drop, all of them present when asked
 * again calmly).
 *
 * `adaptive` retries add client-side rate limiting on top of the standard
 * backoff, which is the mode meant for exactly this: a burst that trips
 * throttling should slow itself down rather than fail.
 */
let client: S3Client | null = null;
function getClient() {
  if (!client) {
    client = new S3Client({
      region: (process.env.LEDGER_REGION || "us-east-2").trim(),
      maxAttempts: 5,
      retryMode: "adaptive",
    });
  }
  return client;
}

function getBucket() {
  return (process.env.LEDGER_BUCKET || "occ-ledger-prod").trim();
}

function toSafe(b64: string): string {
  return b64.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function isPlainObject(x: unknown): x is Record<string, unknown> {
  return typeof x === "object" && x !== null && !Array.isArray(x);
}

/** How many S3 calls one function keeps in flight for a set's member keys and for a lookup's position reads. */
const POOL = 16;

/**
 * Run `fn` over `items` with at most `limit` in flight, results settled in
 * item order. Nothing here throws: a rejection comes back as a settled
 * result so the caller decides what a failure means (the index counts it,
 * a lookup raises it).
 */
export async function runPool<T, R>(items: readonly T[], limit: number, fn: (item: T, index: number) => Promise<R>): Promise<PromiseSettledResult<R>[]> {
  const results: PromiseSettledResult<R>[] = new Array(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.max(1, Math.min(limit, items.length)) }, async () => {
    while (next < items.length) {
      const i = next++;
      try {
        results[i] = { status: "fulfilled", value: await fn(items[i], i) };
      } catch (reason) {
        results[i] = { status: "rejected", reason };
      }
    }
  });
  await Promise.all(workers);
  return results;
}

// Warm-instance cache for the current epoch (a new epoch is born at counter 1
// on every TEE restart, so it changes rarely).
let epochCache: { epoch: string; at: number } | null = null;
const EPOCH_TTL = 60_000;

/** Current epoch, asked of the authority that mints it.
 *
 * The enclave's /key endpoint knows the current epoch in one call, so that is
 * the primary source (cached briefly). The S3 scan is only a fallback for the
 * seconds when the boundary is rotating, and it PAGINATES: with daily epoch
 * rotation the old single-page MaxKeys:200 listing would have silently
 * returned a stale epoch once the 201st epoch prefix existed (~2027-01), with
 * the failure day decided by how the new epoch's base64 happened to sort.
 * The fallback also costs one LIST per epoch ever created, which grows by one
 * per day under rotation; the /key path costs one HTTP call, always. */
export async function getCurrentEpoch(): Promise<string | null> {
  const now = Date.now();
  if (epochCache && now - epochCache.at < EPOCH_TTL) return epochCache.epoch;

  // Primary: the enclave itself.
  try {
    const r = await fetch("https://nitro.occproof.com/key", { signal: AbortSignal.timeout(4000) });
    if (r.ok) {
      const k = (await r.json()) as { epochId?: string };
      if (k.epochId) {
        const epoch = toSafe(k.epochId);
        epochCache = { epoch, at: now };
        return epoch;
      }
    }
  } catch { /* rotating or unreachable: fall through to the ledger scan */ }

  // Fallback: newest epoch by first-object write time, over ALL epoch
  // prefixes (paginated — correctness must not depend on epoch count).
  const s3 = getClient();
  const bucket = getBucket();
  const prefixes: string[] = [];
  let token: string | undefined;
  do {
    const pe = await s3.send(new ListObjectsV2Command({
      Bucket: bucket, Prefix: "proofs/", Delimiter: "/", ContinuationToken: token,
    }));
    for (const p of pe.CommonPrefixes || []) if (p.Prefix) prefixes.push(p.Prefix);
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
  return readLegacyDigest(digestB64, false);
}

/**
 * The legacy single-object index read.
 *
 * `strict` is the difference between the two things a null can mean. A
 * missing key is an ANSWER (these bytes have no legacy entry); any other
 * error is a failure to read, and the strict form raises it so a reader
 * cannot mistake one for the other. The write path (commit pre-reads the
 * prior) stays lenient: there, a failed read costs a merge hint, not a
 * verdict about someone's file.
 */
async function readLegacyDigest(digestB64: string, strict: boolean): Promise<Record<string, unknown> | null> {
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
    if (strict) throw new LedgerUnavailableError("legacy digest key", err);
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
 * A set proof additionally earns one position key per member digest, see
 * indexSetMembers.
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
    // A fused proof (profile bitgraph-fuse/1) that names an origin in its
    // SIGNED attribution is also indexed under the origin digest, per
    // position, so a lookup by the origin's hash lists its descendants. Never
    // the origin's legacy key: that key means "the proof of these bytes" to
    // /api/search and the commit pre-read, and a descendant is not that.
    const originDigest = fusedOriginDigestOf(proof);
    const c = proof.commit as { epochId?: string; counter?: string } | undefined;
    if (originDigest !== null && originDigest !== artifact.digestB64 && c?.epochId && c?.counter) {
      puts.push(s3.send(new PutObjectCommand({
        Bucket: bucket,
        Key: `by-digest/${toSafe(originDigest)}/${toSafe(c.epochId)}-${String(c.counter).padStart(12, "0")}.json`,
        Body: body,
        ContentType: "application/json",
        Metadata: { "bg-kind": "fused-descendant" },
      })));
    }
    await Promise.all(puts);
    if (c?.epochId && c?.counter) await indexSetMembers(s3, bucket, proof, artifact.digestB64, c.epochId, c.counter);
  } catch (err) {
    console.error("[s3] storeProofByDigest failed:", (err as Error).message);
  }
}

/**
 * The member keys of a set proof: one position entry per distinct member
 * digest, so a lookup by a member's ORIGINAL bytes (bg-kind
 * "fused-descendant": these bytes are the origin of a fused artifact under
 * this proof, the same meaning the solo fused index gives it) or by its
 * FUSED bytes (bg-kind "set-member": these exact bytes were fused under this
 * proof as one of N) lists the set's position. bg-set-member carries the
 * row as "i/N" and bg-set-digest names the set, so a reader can say "one of
 * N" and find the set's own entry without opening the body.
 *
 * Every member entry carries the set proof WITHOUT its manifest and is
 * hydrated on read from the set's own position key (hydrateSetMembers). A
 * 2000-row manifest pretty-printed is ~700 KB, and copying it under up to
 * 4000 member keys, permanently, under Object Lock, is not a cost a per-row
 * convenience may incur.
 *
 * Only a BOUND set is indexed (bindSet: strict parse, hash equal to the
 * signed artifact digest, commitment equal to the proof's own slot record),
 * whatever route stored the proof: a set proof with forged or stripped
 * metadata indexes nothing. Never a legacy key for a member. Failures are
 * counted and logged, never thrown, which is this function's contract.
 */
async function indexSetMembers(s3: S3Client, bucket: string, proof: Record<string, unknown>, artifactDigestB64: string, epochId: string, counter: string): Promise<void> {
  const bound = await bindSet(proof);
  if (bound === null) {
    if (isSetProof(proof)) console.log("[s3] set proof carries no bound manifest; members not indexed");
    return;
  }
  const entries = setIndexEntries(bound, artifactDigestB64);
  const body = JSON.stringify(stripSetManifest(proof), null, 2);
  const position = `${toSafe(epochId)}-${String(counter).padStart(12, "0")}`;
  const setDigest = toSafe(artifactDigestB64);
  const results = await runPool(entries, POOL, (e) => s3.send(new PutObjectCommand({
    Bucket: bucket,
    Key: `by-digest/${toSafe(e.digestB64)}/${position}.json`,
    Body: body,
    ContentType: "application/json",
    Metadata: { "bg-kind": e.kind, "bg-set-digest": setDigest, "bg-set-member": `${e.index}/${e.count}` },
  })));
  const failed = results.filter((r) => r.status === "rejected").length;
  console.log(`[s3] set index wrote=${results.length - failed} failed=${failed}`);
}

export interface DigestProofEntry {
  proof: Record<string, unknown>;
  /** S3 write time of the position-index entry (ms), null for the legacy key. */
  writeTime: number | null;
  /**
   * "recorded": the proof commits exactly the looked-up bytes.
   * "fused": a fused artifact (profile bitgraph-fuse/1) that names the
   * looked-up bytes as its origin, or a set that lists them as a member's
   * origin or fused bytes; the bytes themselves were not committed by this
   * proof. Descendants are listed, never ranked.
   */
  kind: "recorded" | "fused";
  /**
   * Present on a set member's entry: which row of the set these bytes are,
   * as the row's origin ("origin") or its fused bytes ("fused"), read from
   * the headers the index write stamped.
   */
  member?: { index: number; count: number; role: "origin" | "fused" };
  /**
   * Present on a set member's entry: the set's own digest (url-safe), as the
   * index stamped it. When the lookup ran with hydrate false the entry's
   * proof lacks its manifest, and this names the set position that holds it
   * (readSetPosition).
   */
  setDigest?: string;
}

/** One position read: the entry plus the set it belongs to, when the headers name one. */
interface IndexedRead {
  entry: DigestProofEntry;
  /** bg-set-digest (url-safe), or null for anything that is not a set member entry. */
  setDigest: string | null;
}

/** A set member entry's row, from the headers its index write stamped (see indexSetMembers). */
function memberOfHeaders(metadata: Record<string, string> | undefined): { member?: DigestProofEntry["member"] } {
  const kind = metadata?.["bg-kind"];
  const m = /^(\d+)\/(\d+)$/.exec(metadata?.["bg-set-member"] ?? "");
  if (m === null || (kind !== "set-member" && kind !== "fused-descendant")) return {};
  return { member: { index: parseInt(m[1], 10), count: parseInt(m[2], 10), role: kind === "set-member" ? "fused" : "origin" } };
}

/**
 * Member entries carry the set proof stripped of its manifest (see
 * indexSetMembers). Put it back from the set's own position key, read once
 * per distinct set position, and only when that copy BINDS and the entry
 * binds to it in turn (bindSet on both): an unbound source leaves the group
 * exactly as it was, which is never a verdict, only less to show. A source
 * that cannot be READ raises, like any other hole in the answer; a source
 * that does not EXIST leaves the group unhydrated, since a missing key is
 * permanent and a lookup must not fail forever on it.
 */
const setPositionKey = (setDigestSafe: string, epochId: string, counter: string) =>
  `by-digest/${setDigestSafe}/${toSafe(epochId)}-${String(counter).padStart(12, "0")}.json`;

/**
 * The set proof at its own position key, WITH its manifest, when that copy
 * binds (bindSet). Null when the key does not exist or the copy does not
 * bind; raises LedgerUnavailableError when it cannot be read.
 */
async function readBoundSetPosition(s3: S3Client, bucket: string, key: string): Promise<{ proof: Record<string, unknown>; bound: BoundSet } | null> {
  let body: string | undefined;
  try {
    const result = await s3.send(new GetObjectCommand({ Bucket: bucket, Key: key }));
    body = await result.Body?.transformToString();
  } catch (err) {
    const name = (err as { name?: string }).name;
    if (name === "NoSuchKey" || name === "NotFound") return null;
    throw new LedgerUnavailableError(`set position ${key}`, err);
  }
  if (!body) return null;
  const proof = JSON.parse(body) as Record<string, unknown>;
  const bound = await bindSet(proof);
  return bound === null ? null : { proof, bound };
}

/**
 * A set's own position entry, bound, for a caller that looked members up
 * with hydrate false and wants each distinct set ONCE (the batch route's
 * side table) instead of a manifest copy per member row. setDigest is
 * url-safe, as the entry's setDigest carries it. Null when absent or
 * unbound; raises LedgerUnavailableError when unreadable.
 */
export async function readSetPosition(setDigest: string, epochId: string, counter: string): Promise<Record<string, unknown> | null> {
  const r = await readBoundSetPosition(getClient(), getBucket(), setPositionKey(setDigest, epochId, counter));
  return r?.proof ?? null;
}

async function hydrateSetMembers(s3: S3Client, bucket: string, reads: IndexedRead[]): Promise<void> {
  const groups = new Map<string, { key: string; entries: DigestProofEntry[] }>();
  for (const r of reads) {
    if (r.setDigest === null) continue;
    const c = r.entry.proof.commit as { epochId?: string; counter?: string } | undefined;
    if (!c?.epochId || !c?.counter) continue;
    const key = setPositionKey(r.setDigest, c.epochId, c.counter);
    const g = groups.get(key) ?? { key, entries: [] };
    g.entries.push(r.entry);
    groups.set(key, g);
  }
  if (groups.size === 0) return;
  const results = await runPool([...groups.values()], POOL, async (g) => {
    const source = await readBoundSetPosition(s3, bucket, g.key);
    if (source === null) return;
    const bound = source.bound;
    for (const e of g.entries) {
      const prior = e.proof.metadata;
      e.proof.metadata = { ...(isPlainObject(prior) ? prior : {}), [SET_KEY]: bound.manifest };
      // The entry itself must bind to what was attached (its own signed
      // digest, its own slot), or the attachment is undone.
      if ((await bindSet(e.proof)) === null) e.proof.metadata = prior;
    }
  });
  for (const r of results) if (r.status === "rejected") throw r.reason;
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
export interface LookupOptions {
  /**
   * Put each set member entry's manifest back from the set's own position
   * key (default true: a page or a single lookup wants the whole proof).
   * A BATCH of member lookups passes false and reads each distinct set once
   * itself (readSetPosition): hydrating per entry copied one N-row manifest
   * onto every member row, so a batch answer over a set grew with N squared
   * (a 50-digest batch over 400 members passed 4.5 MB) and the same set key
   * was fetched once per digest. Unhydrated member entries carry setDigest.
   */
  hydrate?: boolean;
}

export async function getProofsByDigest(digestB64: string, options: LookupOptions = {}): Promise<DigestProofEntry[]> {
  const safeDigest = toSafe(digestB64);
  const entries: DigestProofEntry[] = [];
  // ⚠️ NOTHING in this function may turn a read failure into an empty or
  // partial answer. It used to do both — the outer catch logged and carried
  // on with whatever it had, and a per-object catch dropped individual
  // positions — so a throttled read came back looking exactly like "never
  // recorded". Every failure below raises LedgerUnavailableError, and the
  // routes turn that into a 503 the caller can tell apart from a verdict.
  try {
    const s3 = getClient();
    const bucket = getBucket();
    // Every page of the listing. A digest with more positions than one page
    // holds must not lose the rest to a missing continuation loop.
    const objects: { key: string; lastModified?: Date }[] = [];
    let token: string | undefined;
    do {
      const listed = await s3.send(new ListObjectsV2Command({
        Bucket: bucket,
        Prefix: `by-digest/${safeDigest}/`,
        ContinuationToken: token,
        MaxKeys: 1000,
      }));
      for (const o of listed.Contents || []) if (o.Key) objects.push({ key: o.Key, lastModified: o.LastModified });
      token = listed.IsTruncated ? listed.NextContinuationToken : undefined;
    } while (token);
    const fetched = await runPool(objects, POOL, async (obj): Promise<IndexedRead | null> => {
      try {
        const result = await s3.send(new GetObjectCommand({ Bucket: bucket, Key: obj.key }));
        const body = await result.Body?.transformToString();
        if (!body) return null;
        // Backfilled entries were records copied into the index after the
        // fact, so their OWN LastModified is the copy's moment, not the
        // recording's. When the true write time was recoverable at backfill
        // time it rides in bg-writetime (ms) and is the honest answer; a
        // backfill without one predates every indexed entry and orders like
        // the legacy key (no write time at all).
        const backfilled = result.Metadata?.["bg-backfill"] === "1";
        const stamped = parseInt(result.Metadata?.["bg-writetime"] ?? "", 10);
        const writeTime = Number.isFinite(stamped) ? stamped : backfilled ? null : obj.lastModified?.getTime() ?? null;
        const parsed = JSON.parse(body) as Record<string, unknown>;
        const artifactDigest = (parsed.artifact as { digestB64?: string } | undefined)?.digestB64;
        const member = memberOfHeaders(result.Metadata);
        const setDigest = member.member ? result.Metadata?.["bg-set-digest"] ?? null : null;
        return {
          entry: { proof: parsed, writeTime, kind: artifactDigest === digestB64 ? "recorded" : "fused", ...member, ...(setDigest ? { setDigest } : {}) },
          setDigest,
        };
      } catch (err) {
        // A position that was LISTED but could not be read is a hole in the
        // answer, not a position that does not exist.
        throw new LedgerUnavailableError(`position ${obj.key}`, err);
      }
    });
    const reads: IndexedRead[] = [];
    for (const r of fetched) {
      if (r.status === "rejected") throw r.reason;
      if (r.value) reads.push(r.value);
    }
    if (options.hydrate !== false) await hydrateSetMembers(s3, bucket, reads);
    for (const r of reads) entries.push(r.entry);
  } catch (err) {
    if (err instanceof LedgerUnavailableError) throw err;
    console.error("[s3] getProofsByDigest failed:", (err as Error).message);
    throw new LedgerUnavailableError("by-digest listing", err);
  }
  const legacy = await readLegacyDigest(digestB64, true);
  if (legacy) {
    const legacyDigest = (legacy.artifact as { digestB64?: string } | undefined)?.digestB64;
    entries.push({ proof: legacy, writeTime: null, kind: legacyDigest === digestB64 ? "recorded" : "fused" });
  }

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

  // Recordings of the bytes first, earliest causal position first. Fused
  // descendants follow in a stable order that makes no lineage or version
  // claim: BitGraph knows they name these bytes, nothing more.
  unique.sort((a, b) => {
    if (a.kind !== b.kind) return a.kind === "recorded" ? -1 : 1;
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
