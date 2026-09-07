/**
 * Build the ledger's digest index: the Bloom filter the lookup consults
 * before touching S3.
 *
 *   node scripts/build-digest-filter.mjs [--fp 0.001] [--capacity N] [--stage] [--dry-run]
 *   node scripts/build-digest-filter.mjs --compact [--stage]
 *   node scripts/build-digest-filter.mjs --activate
 *
 * A full build lists every key under by-digest/ and writes a fresh filter.
 * The listing is the whole cost: 1,986,707 keys took 2,225s on 2026-09-07.
 *
 * --compact does the cheap half. It loads the published filter, folds every
 * journal written since its cutoff, and republishes with a later cutoff. No
 * by-digest listing, so it runs in seconds. This is what keeps the journal
 * window short, and the window is what a cold reader pays for: journals are
 * written on every by-digest write (about 12,000 a day at a 12s anchor
 * interval) and are read at load time. Run it often. A Bloom filter cannot
 * shrink, so compaction spends the base's headroom; a full rebuild resizes.
 *
 * --stage writes under digest-index/staging/ instead, which is inert: the
 * site reads only the live keys. --activate copies staging over live.
 *
 * The cutoff is taken BEFORE the listing starts, so a write that lands while
 * the build runs is folded from the journal rather than assumed present.
 * Erring that way costs a wasted read; erring the other way would tell
 * someone their file is not on record.
 *
 * Nothing depends on this having run. With no filter published, the lookup
 * behaves exactly as it did before: one listing per digest.
 */
import { readFileSync } from "node:fs";
import { S3Client, ListObjectsV2Command, PutObjectCommand, GetObjectCommand } from "@aws-sdk/client-s3";
import { canon, DigestFilter, bloomParamsFor } from "../src/lib/digest-filter.ts";

const args = process.argv.slice(2);
const has = (f) => args.includes(f);
const dryRun = has("--dry-run"), stage = has("--stage");
const fp = Number((args[args.indexOf("--fp") + 1] ?? "").trim()) || 0.001;
/**
 * Entries the filter is built to hold, overriding the headroom rule below.
 *
 * The size of this file is what a cold function instance downloads before it
 * can answer anything, and that is most of the lookup wait on a big drop:
 * 3.3s cold against 275ms warm (measured 2026-09-07). Precision past a point
 * buys nothing, because what a false positive costs is one S3 read: at
 * capacity 2.2M and fp 0.003 the filter is 3.17MB and a 48,000 file drop pays
 * 14 extra reads, against 4.33MB and 1 read at the original settings.
 */
const capacityArg = Number((args[args.indexOf("--capacity") + 1] ?? "").trim()) || 0;

/**
 * Room to grow before the filter's false-positive rate drifts off target.
 * Compaction adds to the base without resizing it, so the base is built for
 * more than the ledger currently holds. Sized for about four months at the
 * present write rate; past that, run a full rebuild.
 */
const HEADROOM = 1.7;


function env(k) {
  if (process.env[k]) return process.env[k];
  try {
    const f = readFileSync(new URL("../.env.local", import.meta.url), "utf8");
    return (f.match(new RegExp(`^${k}=(.*)$`, "m")) || [])[1]?.trim().replace(/^["']|["']$/g, "");
  } catch { return undefined; }
}

const Bucket = env("LEDGER_BUCKET");
if (!Bucket) { console.error("LEDGER_BUCKET is not set"); process.exit(1); }
const s3 = new S3Client({
  region: env("LEDGER_REGION") || "us-east-2",
  ...(env("AWS_ACCESS_KEY_ID") ? { credentials: { accessKeyId: env("AWS_ACCESS_KEY_ID"), secretAccessKey: env("AWS_SECRET_ACCESS_KEY") } } : {}),
});

const LIVE = { filter: "digest-index/filter.bin", meta: "digest-index/meta.json" };
const STAGING = { filter: "digest-index/staging/filter.bin", meta: "digest-index/staging/meta.json" };
const out = stage ? STAGING : LIVE;

async function getBytes(Key) {
  try { return Buffer.from(await (await s3.send(new GetObjectCommand({ Bucket, Key }))).Body.transformToByteArray()); }
  catch { return null; }
}
async function put(Key, Body, ContentType) {
  await s3.send(new PutObjectCommand({ Bucket, Key, Body, ContentType }));
}
async function publish(filter, meta) {
  const bytes = filter.serialize();
  console.log(`filter: ${(bytes.length / 1048576).toFixed(2)} MB, k=${meta.k}, holds ${meta.n} of ${meta.capacity}`);
  if (dryRun) { console.log("dry run: nothing written"); return; }
  await put(out.filter, bytes, "application/octet-stream");
  await put(out.meta, JSON.stringify(meta, null, 2), "application/json");
  console.log(`wrote ${out.filter} and ${out.meta} (cutoff ${new Date(meta.cutoff).toISOString()})`);
}

/** Every journal key after `after`, oldest first. Keys are time-ordered by construction. */
async function listJournal(after) {
  const keys = [];
  let token;
  do {
    const r = await s3.send(new ListObjectsV2Command({ Bucket, Prefix: "digest-journal/", StartAfter: after, ContinuationToken: token, MaxKeys: 1000 }));
    for (const o of r.Contents || []) keys.push(o.Key);
    token = r.IsTruncated ? r.NextContinuationToken : undefined;
  } while (token);
  return keys;
}

/** Fold journals into `filter`, in parallel. Throws rather than leaving a hole. */
async function foldAll(filter, keys) {
  let next = 0, added = 0;
  await Promise.all(Array.from({ length: Math.min(24, keys.length) }, async () => {
    while (next < keys.length) {
      const k = keys[next++];
      const bytes = await getBytes(k);
      if (!bytes) throw new Error(`journal ${k} could not be read; refusing to publish a filter with a hole in it`);
      const entry = JSON.parse(bytes.toString("utf8"));
      if (!Array.isArray(entry.digests)) throw new Error(`journal ${k} has no digests array`);
      for (const d of entry.digests) if (typeof d === "string") { filter.add(canon(d)); added++; }
    }
  }));
  return added;
}

if (has("--activate")) {
  const bin = await getBytes(STAGING.filter), meta = await getBytes(STAGING.meta);
  if (!bin || !meta) { console.error("nothing staged"); process.exit(1); }
  await put(LIVE.filter, bin, "application/octet-stream");
  await put(LIVE.meta, meta, "application/json");
  console.log(`activated: ${(bin.length / 1048576).toFixed(2)} MB, ${meta.toString("utf8")}`);
  process.exit(0);
}

if (has("--compact")) {
  const from = stage ? STAGING : LIVE;
  const bin = await getBytes(from.filter), metaBytes = await getBytes(from.meta);
  if (!bin || !metaBytes) { console.error(`no published filter at ${from.filter}; run a full build first`); process.exit(1); }
  const meta = JSON.parse(metaBytes.toString("utf8"));
  const filter = DigestFilter.parse(bin);
  if (!filter) { console.error("published filter did not parse"); process.exit(1); }
  const keys = await listJournal(`digest-journal/${String(meta.cutoff).padStart(13, "0")}`);
  console.log(`${keys.length} journals since ${new Date(meta.cutoff).toISOString()}`);
  if (keys.length === 0) { console.log("nothing to compact"); process.exit(0); }
  const added = await foldAll(filter, keys);
  const cutoff = Number(keys[keys.length - 1].slice("digest-journal/".length).split("-")[0]);
  await publish(filter, { ...meta, builtAt: Date.now(), n: meta.n + added, cutoff, compactedAt: Date.now() });
  process.exit(0);
}

// ── Full build ──
const cutoff = Date.now();   // taken first, on purpose: see the header
const t0 = Date.now();
const digests = new Set();
let keys = 0, pages = 0, token;
do {
  const r = await s3.send(new ListObjectsV2Command({ Bucket, Prefix: "by-digest/", ContinuationToken: token, MaxKeys: 1000 }));
  for (const o of r.Contents || []) {
    keys++;
    const rest = o.Key.slice("by-digest/".length);
    const slash = rest.indexOf("/");
    digests.add(canon(slash === -1 ? rest.replace(/\.json$/, "") : rest.slice(0, slash)));
  }
  pages++;
  token = r.IsTruncated ? r.NextContinuationToken : undefined;
  if (pages % 200 === 0) console.log(`  ${pages} pages, ${digests.size} digests…`);
} while (token);
console.log(`listed ${keys} keys, ${digests.size} distinct digests in ${((Date.now() - t0) / 1000).toFixed(0)}s`);

const capacity = capacityArg > 0 ? Math.max(capacityArg, digests.size) : Math.max(Math.ceil(digests.size * HEADROOM), digests.size + 500_000);
const params = bloomParamsFor(capacity, fp);
const filter = new DigestFilter(params);
for (const d of digests) filter.add(d);

// A filter that rejects a digest it was just told about is not worth
// publishing, so check before writing.
let checked = 0;
for (const d of digests) {
  if (!filter.has(d)) { console.error(`FATAL: the filter rejects ${d}, which it was told about`); process.exit(1); }
  if (++checked >= 50000) break;
}
console.log(`self-check: ${checked} digests, none rejected`);

await publish(filter, { builtAt: Date.now(), n: digests.size, capacity, m: params.m, k: params.k, cutoff });
