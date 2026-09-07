/**
 * Build the ledger's digest index: the Bloom filter the lookup consults
 * before touching S3.
 *
 *   node scripts/build-digest-filter.mjs [--dry-run] [--fp 0.001]
 *
 * Lists every key under by-digest/, adds each distinct digest to a filter, and
 * writes the filter plus its metadata to the ledger. The listing is the whole
 * cost: 1.5 million digests took about five minutes on 2026-09-07.
 *
 * The cutoff it records is taken BEFORE the listing starts, so any write that
 * lands while it runs is still folded in from the journal rather than being
 * assumed present. Erring that way costs a wasted read; erring the other way
 * would tell someone their file is not on record.
 *
 * Run it after a large import, and on a schedule so the journal stays short.
 * Nothing depends on it having run: without the artifact the lookup behaves
 * exactly as it did before, one listing per digest.
 */
import { readFileSync } from "node:fs";
import { S3Client, ListObjectsV2Command, PutObjectCommand } from "@aws-sdk/client-s3";
import { DigestFilter, bloomParamsFor } from "../src/lib/digest-filter.ts";

const args = process.argv.slice(2);
const dryRun = args.includes("--dry-run");
const fp = Number((args[args.indexOf("--fp") + 1] ?? "").trim()) || 0.001;

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

// Taken first, on purpose: see the header.
const cutoff = Date.now();
const t0 = Date.now();
const digests = new Set();
let keys = 0, pages = 0, token;
do {
  const r = await s3.send(new ListObjectsV2Command({ Bucket, Prefix: "by-digest/", ContinuationToken: token, MaxKeys: 1000 }));
  for (const o of r.Contents || []) {
    keys++;
    const rest = o.Key.slice("by-digest/".length);
    const slash = rest.indexOf("/");
    digests.add(slash === -1 ? rest.replace(/\.json$/, "") : rest.slice(0, slash));
  }
  pages++;
  token = r.IsTruncated ? r.NextContinuationToken : undefined;
  if (pages % 200 === 0) console.log(`  ${pages} pages, ${digests.size} digests…`);
} while (token);
console.log(`listed ${keys} keys, ${digests.size} distinct digests in ${((Date.now() - t0) / 1000).toFixed(0)}s`);

// The keys are url-safe; the filter is asked in the same alphabet the route
// uses, which converts to standard base64 before testing. Store both forms so
// either spelling of the same digest is admitted.
const params = bloomParamsFor(Math.max(digests.size, 1), fp);
const filter = new DigestFilter(params);
for (const d of digests) {
  filter.add(d);
  const std = d.replace(/-/g, "+").replace(/_/g, "/") + "=";
  if (std !== d) filter.add(std);
}
const bytes = filter.serialize();
const meta = { builtAt: Date.now(), n: digests.size, m: params.m, k: params.k, cutoff };
console.log(`filter: ${(bytes.length / 1024 / 1024).toFixed(2)} MB, ${params.k} hashes, false-positive ${fp}`);

// A filter that does not answer correctly for a digest it just added is not
// worth uploading, so check before writing.
let checked = 0;
for (const d of digests) { if (!filter.has(d)) { console.error(`FATAL: the filter rejects ${d}, which it was told about`); process.exit(1); } if (++checked >= 50000) break; }
console.log(`self-check: ${checked} digests, none rejected`);

if (dryRun) { console.log("\ndry run: nothing written"); process.exit(0); }
await s3.send(new PutObjectCommand({ Bucket, Key: "digest-index/filter.bin", Body: bytes, ContentType: "application/octet-stream" }));
await s3.send(new PutObjectCommand({ Bucket, Key: "digest-index/meta.json", Body: JSON.stringify(meta, null, 2), ContentType: "application/json" }));
console.log(`\nwrote digest-index/filter.bin and meta.json (cutoff ${new Date(cutoff).toISOString()})`);
