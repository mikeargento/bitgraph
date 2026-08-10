#!/usr/bin/env node
/**
 * Materialise a sealed UTC day into display pages, from the ledger.
 *
 * THE LEDGER WINS. Everything under roll/v1/day/ is derived from the
 * Object-Locked proofs/ prefix and nothing else. This does not reconcile or
 * patch, it rebuilds: --force overwrites a day whose pages were written by a
 * bad version. That is the whole reason the archive is allowed to exist.
 *
 *   node website/scripts/build-roll-archive.mjs --day 2026-08-05
 *   node website/scripts/build-roll-archive.mjs --since 2026-08-01
 *   node website/scripts/build-roll-archive.mjs --all [--force] [--dry-run]
 *
 * Only days strictly in the past are built. Today is still gaining entries and
 * is served by the live path, which reads the ledger directly — the archive
 * covers history only, which is what keeps the one place drift is possible
 * free of a second source of truth.
 *
 * Reads proofs/ and anchors-by-time/, writes ONLY under roll/v1/day/. The
 * guard below refuses any other key, and nothing written carries an Object
 * Lock: derived state has to stay deletable or a bug becomes permanent.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
/* website/.env.local is a CONVENIENCE, not a requirement. It is gitignored, so
   it exists on a laptop and nowhere else, and reading it unconditionally made
   this script runnable only by a person sitting in front of one. That is the
   reason nothing archived a day until someone remembered to. Anywhere else
   (the nightly workflow), the same names arrive as real environment
   variables. */
try {
  for (const line of readFileSync(resolve(here, "../.env.local"), "utf8").split("\n")) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "").trim();
  }
} catch (e) {
  if (e.code !== "ENOENT") throw e;
}
const { S3Client, ListObjectsV2Command, GetObjectCommand, PutObjectCommand } = await import(
  resolve(here, "../node_modules/@aws-sdk/client-s3/dist-cjs/index.js")
);

// Kept in step with src/lib/roll-archive.ts by assertion, so the builder and
// the reader can never disagree about names or page size.
const PAGE_ROWS = 100;
const ARCHIVE_PREFIX = "roll/v1/day";
{
  const src = readFileSync(resolve(here, "../src/lib/roll-archive.ts"), "utf8");
  const r = /PAGE_ROWS\s*=\s*(\d+)/.exec(src);
  const p = /ARCHIVE_PREFIX\s*=\s*"([^"]+)"/.exec(src);
  if (!r || Number(r[1]) !== PAGE_ROWS) throw new Error(`page-size drift: roll-archive.ts says ${r?.[1]}`);
  if (!p || p[1] !== ARCHIVE_PREFIX) throw new Error(`prefix drift: roll-archive.ts says ${p?.[1]}`);
}

const BUCKET = (process.env.LEDGER_BUCKET || "occ-ledger-prod").trim();
const s3 = new S3Client({ region: (process.env.LEDGER_REGION || "us-east-2").trim() });
/* Resolve credentials before doing anything, and say so plainly if they are
   absent. Asked of the SDK rather than guessed at from environment variables,
   so a profile, an instance role or a web identity all count. Without this the
   first failure is an S3 error thrown from inside a day build, which reads as
   "the ledger is broken" rather than "this run has no keys". */
try {
  await s3.config.credentials();
} catch {
  console.error("\nNo AWS credentials could be resolved.");
  console.error("Locally: website/.env.local supplies them. In CI: set the");
  console.error("AWS_ACCESS_KEY_ID and AWS_SECRET_ACCESS_KEY repository secrets.\n");
  process.exit(1);
}

const args = process.argv.slice(2);
const has = (f) => args.includes(f);
const arg = (f) => { const i = args.indexOf(f); return i >= 0 ? args[i + 1] : null; };
const DRY = has("--dry-run");
const FORCE = has("--force");
const EARLIEST_DAY = "2026-05-15"; // the ledger's first day (BitGraph cutover)

const pad = (n) => String(n).padStart(12, "0");
const pad4 = (n) => String(n).padStart(4, "0");
const toSafe = (b) => String(b).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const todayUTC = () => new Date().toISOString().slice(0, 10);
const nextDay = (d) => { const [y, m, dd] = d.split("-").map(Number); return new Date(Date.UTC(y, m - 1, dd + 1)).toISOString().slice(0, 10); };

async function put(key, value) {
  if (!key.startsWith(`${ARCHIVE_PREFIX}/`)) throw new Error(`refusing to write outside ${ARCHIVE_PREFIX}/: ${key}`);
  if (DRY) return;
  await s3.send(new PutObjectCommand({ Bucket: BUCKET, Key: key, Body: JSON.stringify(value), ContentType: "application/json" }));
}
async function exists(key) {
  const r = await s3.send(new ListObjectsV2Command({ Bucket: BUCKET, Prefix: key, MaxKeys: 1 }));
  return (r.Contents || []).some((o) => o.Key === key);
}
async function getJson(key) {
  try {
    const r = await s3.send(new GetObjectCommand({ Bucket: BUCKET, Key: key }));
    return JSON.parse(await r.Body.transformToString());
  } catch { return null; }
}

function rowFromProof(p, lm) {
  const c = parseInt(String(p?.commit?.counter ?? "0"), 10);
  if (!c) return null;
  const name = p?.attribution?.name;
  const t = name === "Ethereum Anchor" ? "a" : name === "Interval" ? "i" : "p";
  const digestB64 = String(p?.artifact?.digestB64 || "");
  const proofHash = String(p?.proofHash || p?.commit?.prevB64 || digestB64 || "");
  let b;
  if (t !== "p") {
    const m = String(p?.attribution?.title || "").match(/\/block\/(\d+)/);
    b = m ? parseInt(m[1], 10) : p?.metadata?.interval?.originalBlockNumber;
  }
  const ep = toSafe(p?.commit?.epochId || "");
  return { c, t, d: toSafe(digestB64), h: toSafe(proofHash).slice(0, 10), ...(b != null ? { b } : {}), ...(lm ? { at: lm } : {}), ...(ep ? { ep } : {}) };
}

/**
 * The day's (epoch, counter-range) segments, from the anchors-by-time index.
 * Same boundary the live feed uses: anchors are the protocol's clock, so "the
 * recordings between the day's first and last anchor" is the honest day. This
 * is the expensive derivation the archive exists to do exactly once.
 */
async function daySegments(day) {
  const prefix = "anchors-by-time/";
  const endExcl = `${prefix}${nextDay(day)}T`;
  const keys = [];
  let token;
  for (let page = 0; page < 24; page++) {
    const r = await s3.send(new ListObjectsV2Command({
      Bucket: BUCKET, Prefix: prefix, MaxKeys: 1000,
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
  if (!keys.length) return [];
  const refOf = async (k) => {
    const p = await getJson(k);
    const epoch = toSafe(p?.commit?.epochId || "");
    const counter = parseInt(String(p?.commit?.counter ?? "0"), 10);
    return epoch && counter ? { epoch, counter } : null;
  };
  // Every anchor's epoch, so a day containing a restart splits correctly. One
  // GET per anchor is affordable here because it happens once per day, ever.
  const segs = [];
  const BATCH = 64;
  for (let i = 0; i < keys.length; i += BATCH) {
    const refs = await Promise.all(keys.slice(i, i + BATCH).map(refOf));
    for (const ref of refs) {
      if (!ref) continue;
      const last = segs[segs.length - 1];
      if (last && last.epoch === ref.epoch) {
        last.min = Math.min(last.min, ref.counter);
        last.max = Math.max(last.max, ref.counter);
      } else segs.push({ epoch: ref.epoch, min: ref.counter, max: ref.counter });
    }
  }
  return segs;
}

async function rowsForSegment(seg) {
  const prefix = `proofs/${seg.epoch}/`;
  const keys = [];
  let token, startAfter = `${prefix}${pad(seg.min - 1)}`;
  for (let page = 0; page < 40; page++) {
    const r = await s3.send(new ListObjectsV2Command({
      Bucket: BUCKET, Prefix: prefix, MaxKeys: 1000,
      ...(token ? { ContinuationToken: token } : { StartAfter: startAfter }),
    }));
    let past = false;
    for (const o of r.Contents || []) {
      const n = parseInt(((o.Key || "").split("/").pop() || "").split("-")[0], 10);
      if (isNaN(n)) continue;
      if (n > seg.max) { past = true; break; }
      if (n >= seg.min) keys.push({ key: o.Key, lm: o.LastModified?.getTime() });
    }
    token = r.NextContinuationToken;
    startAfter = undefined;
    if (past || !token) break;
  }
  const rows = [];
  const BATCH = 64;
  for (let i = 0; i < keys.length; i += BATCH) {
    const got = await Promise.all(keys.slice(i, i + BATCH).map(async ({ key, lm }) => {
      const p = await getJson(key);
      return p ? rowFromProof(p, lm) : null;
    }));
    for (const r of got) if (r) rows.push(r);
  }
  return rows;
}

async function buildDay(day) {
  const label = `  ${day}`;
  if (!FORCE && await exists(`${ARCHIVE_PREFIX}/${day}/index.json`)) {
    console.log(`${label}  already archived, skipped`);
    return;
  }
  const t = performance.now();
  const segs = await daySegments(day);
  if (!segs.length) {
    // A day with no anchors is a real answer (the ledger was quiet or down),
    // and it must be recorded as such: an absent manifest and an empty one mean
    // different things, and only the manifest can say "nothing, definitively".
    await put(`${ARCHIVE_PREFIX}/${day}/f/${pad4(0)}.json`, { day, filter: "f", n: 0, rows: [] });
    await put(`${ARCHIVE_PREFIX}/${day}/a/${pad4(0)}.json`, { day, filter: "a", n: 0, rows: [] });
    await put(`${ARCHIVE_PREFIX}/${day}/index.json`, { day, pages: { f: 1, a: 1 }, rows: { f: 0, a: 0 }, epochs: [], v: 1 });
    console.log(`${label}  no anchors — archived as definitively empty  ${((performance.now() - t) / 1000).toFixed(1)}s`);
    return;
  }
  let all = [];
  for (const seg of segs) all.push(...await rowsForSegment(seg));
  all.sort((a, b) => b.c - a.c);
  const files = all.filter((r) => r.t === "p");

  let written = 0;
  for (const [filter, rows] of [["f", files], ["a", all]]) {
    const pages = [];
    for (let i = 0; i < rows.length; i += PAGE_ROWS) pages.push(rows.slice(i, i + PAGE_ROWS));
    if (!pages.length) pages.push([]);
    for (let n = 0; n < pages.length; n++) {
      await put(`${ARCHIVE_PREFIX}/${day}/${filter}/${pad4(n)}.json`, { day, filter, n, rows: pages[n] });
      written++;
    }
  }
  const index = {
    day,
    pages: { f: Math.max(1, Math.ceil(files.length / PAGE_ROWS)), a: Math.max(1, Math.ceil(all.length / PAGE_ROWS)) },
    rows: { f: files.length, a: all.length },
    epochs: [...new Set(segs.map((s) => s.epoch))],
    v: 1,
  };
  // The manifest LAST, always. It is what declares the day complete, so a run
  // killed halfway leaves an unarchived day rather than a day that claims more
  // pages than exist.
  await put(`${ARCHIVE_PREFIX}/${day}/index.json`, index);
  console.log(`${label}  ${all.length} rows (${files.length} files), ${written} pages, ${segs.length} segment(s)  ${((performance.now() - t) / 1000).toFixed(1)}s${DRY ? "  [DRY RUN]" : ""}`);
}

const today = todayUTC();
let days = [];
if (arg("--day")) days = [arg("--day")];
else {
  const from = arg("--since") || EARLIEST_DAY;
  for (let d = from; d < today; d = nextDay(d)) days.push(d);
}
days = days.filter((d) => {
  if (d >= today) { console.log(`  ${d}  is not sealed yet, skipped`); return false; }
  if (d < EARLIEST_DAY) { console.log(`  ${d}  predates the ledger, skipped`); return false; }
  return true;
});

console.log(`\nBuild roll archive · ${BUCKET}${DRY ? " · DRY RUN" : ""}${FORCE ? " · FORCE" : ""}`);
console.log(`${days.length} sealed day(s)\n`);
const t0 = performance.now();
for (const d of days) await buildDay(d);
console.log(`\ndone in ${((performance.now() - t0) / 1000).toFixed(1)}s\n`);
