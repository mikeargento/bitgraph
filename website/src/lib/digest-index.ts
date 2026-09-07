/**
 * The ledger's digest index: what makes "is this file on record" cheap.
 *
 * A lookup costs one S3 listing per digest, so a 30,000-file drop is 30,000
 * listings and nearly all of them return nothing. This module holds a Bloom
 * filter over every digest the ledger indexes (1.5 million of them, about
 * 2.6 MB) in the function's memory, so a digest the filter rejects is answered
 * without touching S3 at all. Only the few it cannot rule out cost a read.
 *
 * Three rules, and they are the whole design:
 *
 *   1. A rejection must be TRUE. The filter cannot produce false negatives by
 *      construction, so the only way to be wrong is not to have heard about a
 *      write. Every by-digest write therefore journals its digests FIRST, and
 *      every read folds the journal in before answering. A journal entry with
 *      no keys behind it is harmless (a false positive costs one read); keys
 *      with no journal entry would be a wrong answer, which is why the order
 *      is that way round.
 *   2. Not knowing is not an answer. If the base cannot be loaded, or the
 *      journal cannot be listed, this module reports that it has nothing, and
 *      the caller does exactly what it did before: ask S3 about every digest.
 *      Slow is a fine failure. Wrong is not.
 *   3. It is a cache of ABSENCE only. A digest the filter admits still gets
 *      the same full read it always got, so no answer here is ever assembled
 *      from the filter's opinion.
 *
 * Layout on the ledger:
 *   digest-index/filter.bin        the base filter (see digest-filter.ts)
 *   digest-index/meta.json         { builtAt, n, m, k, cutoff }
 *   digest-journal/{ms}-{rand}.json  { at, digests: [...] } written per write
 *
 * The journal keys start with a zero-padded millisecond stamp, so listing
 * after the last one this instance folded returns only what is new, which is
 * usually nothing. Rebuilding the base folds the journal away: see
 * scripts/build-digest-filter.mjs.
 */
import { GetObjectCommand, ListObjectsV2Command, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { DigestFilter } from "./digest-filter";

const BASE_KEY = "digest-index/filter.bin";
const META_KEY = "digest-index/meta.json";
export const JOURNAL_PREFIX = "digest-journal/";
/** Journals are listed at most this often per instance; writes are seen within it. */
const LIST_EVERY_MS = 2_000;
/** A journal this far past the base's cutoff is still folded; older ones are already in the base. */
const STAMP_WIDTH = 13;

export const journalKeyFor = (at = Date.now()): string =>
  `${JOURNAL_PREFIX}${String(at).padStart(STAMP_WIDTH, "0")}-${Math.random().toString(16).slice(2, 8)}.json`;

interface Meta { builtAt: number; n: number; m: number; k: number; cutoff: number }

interface Loaded {
  filter: DigestFilter;
  meta: Meta;
  /** The last journal key folded in, for StartAfter on the next listing. */
  lastKey: string;
  listedAt: number;
}

// Module scope: one per warm function instance, which is the point.
let loaded: Loaded | null = null;
let loading: Promise<Loaded | null> | null = null;

function client(): S3Client {
  return new S3Client({ region: process.env.LEDGER_REGION || "us-east-2" });
}
const bucket = (): string | null => process.env.LEDGER_BUCKET ?? null;

async function readAll(s3: S3Client, Bucket: string, Key: string): Promise<Uint8Array | null> {
  try {
    const r = await s3.send(new GetObjectCommand({ Bucket, Key }));
    const bytes = await r.Body?.transformToByteArray();
    return bytes ? new Uint8Array(bytes) : null;
  } catch {
    return null;
  }
}

/** Fold every journal after `lastKey` into the filter. Returns the new last key, or null if the listing failed. */
async function foldJournal(s3: S3Client, Bucket: string, filter: DigestFilter, lastKey: string): Promise<string | null> {
  let key = lastKey;
  let token: string | undefined;
  try {
    do {
      const listed = await s3.send(new ListObjectsV2Command({
        Bucket,
        Prefix: JOURNAL_PREFIX,
        StartAfter: key,
        ContinuationToken: token,
        MaxKeys: 1000,
      }));
      for (const o of listed.Contents ?? []) {
        if (!o.Key) continue;
        const bytes = await readAll(s3, Bucket, o.Key);
        // A journal that cannot be read is a hole in what the filter knows,
        // and a hole means a rejection might be wrong. Refuse the whole load.
        if (!bytes) return null;
        try {
          const entry = JSON.parse(new TextDecoder().decode(bytes)) as { digests?: unknown };
          if (!Array.isArray(entry.digests)) return null;
          for (const d of entry.digests) if (typeof d === "string") filter.add(d);
        } catch {
          return null;
        }
        key = o.Key;
      }
      token = listed.IsTruncated ? listed.NextContinuationToken : undefined;
    } while (token);
    return key;
  } catch {
    return null;
  }
}

async function load(): Promise<Loaded | null> {
  const Bucket = bucket();
  if (!Bucket) return null;
  const s3 = client();
  const metaBytes = await readAll(s3, Bucket, META_KEY);
  const baseBytes = await readAll(s3, Bucket, BASE_KEY);
  if (!metaBytes || !baseBytes) return null;
  let meta: Meta;
  try {
    meta = JSON.parse(new TextDecoder().decode(metaBytes)) as Meta;
  } catch {
    return null;
  }
  const filter = DigestFilter.parse(baseBytes);
  if (!filter || typeof meta.cutoff !== "number") return null;
  const lastKey = `${JOURNAL_PREFIX}${String(meta.cutoff).padStart(STAMP_WIDTH, "0")}`;
  const folded = await foldJournal(s3, Bucket, filter, lastKey);
  if (folded === null) return null;
  return { filter, meta, lastKey: folded, listedAt: Date.now() };
}

/**
 * The filter, fresh enough to answer with. Null means "no opinion": the caller
 * must fall back to asking S3 about every digest.
 */
export async function digestIndex(): Promise<{ absent: (digest: string) => boolean; builtAt: number } | null> {
  if (process.env.DIGEST_INDEX === "off") return null;
  if (loaded === null) {
    loading ??= load().finally(() => { loading = null; });
    loaded = await loading;
    if (loaded === null) return null;
  } else if (Date.now() - loaded.listedAt > LIST_EVERY_MS) {
    const Bucket = bucket();
    if (!Bucket) return null;
    const folded = await foldJournal(client(), Bucket, loaded.filter, loaded.lastKey);
    // A failed refresh means the filter may not know about a recent write, so
    // it stops answering rather than answering out of date.
    if (folded === null) { loaded = null; return null; }
    loaded.lastKey = folded;
    loaded.listedAt = Date.now();
  }
  const l = loaded;
  return { absent: (d: string) => !l.filter.has(d), builtAt: l.meta.builtAt };
}

/**
 * Record digests that are about to be indexed. Called BEFORE the by-digest
 * writes, so the filter never rejects something the ledger holds. Best effort
 * by design: a failed journal write is logged and the write proceeds, because
 * refusing to record a proof over a cache would be the worse failure. It is
 * also why the base is rebuilt on a schedule rather than never.
 */
export async function journalDigests(digests: readonly string[]): Promise<void> {
  const Bucket = bucket();
  if (!Bucket || digests.length === 0 || process.env.DIGEST_INDEX === "off") return;
  const at = Date.now();
  try {
    await client().send(new PutObjectCommand({
      Bucket,
      Key: journalKeyFor(at),
      Body: JSON.stringify({ at, digests: [...new Set(digests)] }),
      ContentType: "application/json",
    }));
  } catch (e) {
    console.error("[digest-index] journal write failed; the filter may not know about these digests until the next rebuild:", (e as Error).message);
  }
}

/** Tests only: forget what this instance loaded. */
export function resetDigestIndex(): void { loaded = null; loading = null; }
