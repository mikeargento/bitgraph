/**
 * The kill switch for the digest index.
 *
 *   node scripts/digest-index-off.mjs
 *
 * Hides digest-index/filter.bin and meta.json, so the site loads no filter and
 * every lookup asks S3 about every digest exactly as it did before the index
 * existed. Slower, never wrong. No deploy involved.
 *
 * The ledger is under a 10-year COMPLIANCE Object Lock, so nothing here is
 * really deleted: this writes a delete marker over the current version, which
 * versioning allows and the lock does not. To bring the index back, publish
 * again: `node scripts/build-digest-filter.mjs --activate`.
 */
import { readFileSync } from "node:fs";
import { S3Client, DeleteObjectCommand, GetObjectCommand } from "@aws-sdk/client-s3";

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

for (const Key of ["digest-index/meta.json", "digest-index/filter.bin"]) {
  const r = await s3.send(new DeleteObjectCommand({ Bucket, Key }));
  console.log(`delete marker on ${Key} (version ${r.VersionId})`);
}
for (const Key of ["digest-index/meta.json", "digest-index/filter.bin"]) {
  try { await s3.send(new GetObjectCommand({ Bucket, Key })); console.log(`⚠️  ${Key} is still readable`); }
  catch (e) { console.log(`${Key} now reads as ${e.name}`); }
}
console.log("\nthe index is off; warm function instances keep the filter they already hold, which is correct, just fast");
