/**
 * Build a set's member list from the per-digest keys already on the ledger.
 *
 * Sets made before member lists existed have their members only as one
 * `by-digest/<member>/<epoch>-<counter>.json` key each. This reads those
 * once and writes the list, after which checking that set costs ~20 reads
 * instead of one listing plus a read per member. Going forward the list is
 * written when the set is indexed; this is only for what came before.
 *
 * It never invents anything: every entry comes from a key that exists, with
 * the kind, index and count the index write stamped in its own headers, and
 * the member's own evidence row supplies the digest of its other side.
 *
 *   node scripts/build-set-member-list.mjs --digests <file.json> [--dry]
 *
 * --digests is a JSON array of url-safe digests to start from (a folder
 * scan). Every set those digests land in is listed.
 */
import { S3Client, ListObjectsV2Command, GetObjectCommand, PutObjectCommand } from "@aws-sdk/client-s3";
import { readFileSync } from "node:fs";

const args = process.argv.slice(2);
const arg = (n) => { const i = args.indexOf(n); return i === -1 ? null : args[i + 1]; };
const DRY = args.includes("--dry");
const digestsFile = arg("--digests");
if (!digestsFile) { console.error("--digests <file.json> is required"); process.exit(1); }

const s3 = new S3Client({ region: process.env.AWS_REGION || "us-east-2", maxAttempts: 4 });
const BUCKET = process.env.LEDGER_BUCKET || "occ-ledger-prod";
const CHUNK = 5_000, VERSION = 1, POOL = 64;
const safe = (d) => d.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
/** Evidence stores digests as hex; keys and lists use url-safe base64. */
const hexToSafe = (hex) => /^[0-9a-f]{64}$/.test(hex) ? Buffer.from(hex, "hex").toString("base64url") : null;

async function pool(items, n, fn) {
  let i = 0; const out = new Array(items.length);
  await Promise.all(Array.from({ length: Math.min(n, items.length) }, async () => {
    while (i < items.length) { const k = i++; try { out[k] = await fn(items[k]); } catch (e) { out[k] = { error: e }; } }
  }));
  return out;
}

const digests = JSON.parse(readFileSync(digestsFile, "utf8")).map(safe);
console.log(`starting from ${digests.length} digests`);

/** position key -> { setDigest, writeTime, count, entries: Map<digest,{kind,index}> } */
const bySet = new Map();
let read = 0, failed = 0;

await pool(digests, POOL, async (d) => {
  const listed = await s3.send(new ListObjectsV2Command({ Bucket: BUCKET, Prefix: `by-digest/${d}/`, MaxKeys: 1000 }));
  for (const o of listed.Contents || []) {
    const m = /^(.+)-(\d{12})\.json$/.exec(o.Key.slice(o.Key.lastIndexOf("/") + 1));
    if (!m) continue;
    const epochId = m[1], counter = String(parseInt(m[2], 10));
    const at = `${epochId}/${counter}`;
    let g;
    try { g = await s3.send(new GetObjectCommand({ Bucket: BUCKET, Key: o.Key })); }
    catch { failed++; continue; }
    const meta = g.Metadata || {};
    const kind = meta["bg-kind"];
    const setDigest = meta["bg-set-digest"];
    const mm = /^(\d+)\/(\d+)$/.exec(meta["bg-set-member"] ?? "");
    if ((kind !== "set-member" && kind !== "fused-descendant") || !setDigest || !mm) continue;
    const body = JSON.parse(await g.Body.transformToString());
    const row = body?.metadata?.["bitgraph-fuse/1/member"];
    if (!bySet.has(at)) bySet.set(at, { epochId, counter, setDigest, writeTime: null, count: parseInt(mm[2], 10), entries: new Map() });
    const set = bySet.get(at);
    set.writeTime ??= o.LastModified?.getTime() ?? null;
    const index = parseInt(mm[1], 10);
    set.entries.set(d, { kind, index });
    // The evidence names BOTH sides of this member, so the other key is
    // known without reading it. ⚠️ The stored row is the member EVIDENCE
    // shape, not SetMemberRow: hex digests under member.artifact (the fused
    // bytes) and member.origin (the bytes it was made from).
    const fusedHex = row?.member?.artifact?.digest;
    const originHex = row?.member?.origin?.digest;
    const setArtifact = safe(body?.artifact?.digestB64 ?? "");
    if (typeof fusedHex === "string") {
      const f1 = hexToSafe(fusedHex);
      if (f1 && f1 !== setArtifact && !set.entries.has(f1)) set.entries.set(f1, { kind: "set-member", index });
    }
    if (typeof originHex === "string") {
      const o1 = hexToSafe(originHex);
      if (o1 && o1 !== setArtifact && !set.entries.has(o1)) set.entries.set(o1, { kind: "fused-descendant", index });
    }
    read++;
  }
});

console.log(`read ${read} member keys (${failed} failed) across ${bySet.size} set positions`);
for (const [at, set] of bySet) {
  const entries = [...set.entries].map(([digestB64, e]) => [digestB64, e.kind === "set-member" ? "m" : "f", e.index]);
  entries.sort((a, b) => a[2] - b[2]);
  const chunks = [];
  for (let i = 0; i < entries.length; i += CHUNK) {
    chunks.push({
      key: `set-members/${set.epochId}/${set.counter}/${String(chunks.length).padStart(6, "0")}.json`,
      body: JSON.stringify({ v: VERSION, setDigest: set.setDigest, epochId: set.epochId, counter: set.counter,
        count: set.count, writeTime: set.writeTime, from: i, entries: entries.slice(i, i + CHUNK) }),
    });
  }
  console.log(`  ${at}: ${entries.length} entries (count ${set.count}) -> ${chunks.length} chunks${DRY ? " [dry]" : ""}`);
  if (DRY) continue;
  const w = await pool(chunks, 8, (c) => s3.send(new PutObjectCommand({ Bucket: BUCKET, Key: c.key, Body: c.body, ContentType: "application/json" })));
  const bad = w.filter((x) => x?.error).length;
  if (bad) console.error(`  ${at}: ${bad} chunks FAILED to write`);
}
