#!/usr/bin/env node
/**
 * Roll baseline probe. READ-ONLY: LIST and GET, never a write.
 *
 * Exists so "the Roll got faster" is a comparison rather than a memory. Run it
 * before and after any change to the Roll's load path and paste both outputs
 * into the commit.
 *
 *   node website/scripts/roll-bench.mjs            # against the live ledger
 *   node website/scripts/roll-bench.mjs --http     # also time production HTTP
 *
 * Credentials come from website/.env.local (the same file `vercel env pull`
 * writes), so this runs wherever that file does and needs nothing else.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const envPath = resolve(here, "../.env.local");
for (const line of readFileSync(envPath, "utf8").split("\n")) {
  const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)$/);
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "").trim();
}
const { S3Client, ListObjectsV2Command, GetObjectCommand } = await import(
  resolve(here, "../node_modules/@aws-sdk/client-s3/dist-cjs/index.js")
);

const REGION = (process.env.LEDGER_REGION || "us-east-2").trim();
const BUCKET = (process.env.LEDGER_BUCKET || "occ-ledger-prod").trim();
const TEE = "https://nitro.occproof.com";
const SITE = process.env.BENCH_ORIGIN || "https://bitgraph.ing";
const s3 = new S3Client({ region: REGION });

let calls = 0;
const send = (cmd) => { calls++; return s3.send(cmd); };
const pad = (n) => String(n).padStart(12, "0");
const ms = (t) => `${(performance.now() - t).toFixed(0)}ms`;
const row = (label, value) => console.log(`  ${label.padEnd(26)} ${value}`);

console.log(`\nRoll bench · ${BUCKET} (${REGION}) · ${new Date().toISOString()}`);

// ── epoch ──────────────────────────────────────────────────────────────────
let t = performance.now();
const key = await fetch(`${TEE}/key`, { signal: AbortSignal.timeout(8000) }).then((r) => r.json()).catch(() => null);
const keyMs = ms(t);
const epoch = key?.epochId ? key.epochId.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "") : null;
console.log("\nEPOCH");
row("TEE /key", `${keyMs}  ${epoch ? epoch.slice(0, 12) + "…" : "UNREACHABLE"}`);
if (!epoch) process.exit(1);

// ── ledger size ────────────────────────────────────────────────────────────
const countAll = async (prefix, cap = 60) => {
  let n = 0, token, pages = 0;
  do {
    const r = await send(new ListObjectsV2Command({ Bucket: BUCKET, Prefix: prefix, MaxKeys: 1000, ...(token ? { ContinuationToken: token } : {}) }));
    n += (r.Contents || []).length;
    token = r.NextContinuationToken;
  } while (token && ++pages < cap);
  return n;
};
console.log("\nLEDGER SIZE");
calls = 0;
t = performance.now();
const proofs = await countAll(`proofs/${epoch}/`);
const anchors = await countAll(`anchors/${epoch}/`);
row("proofs objects (today)", `${proofs}`);
row("anchors index", `${anchors}`);
row("files (non-anchor)", `~${proofs - anchors}`);
row("full count cost", `${ms(t)}, ${calls} LIST`);

// ── head ───────────────────────────────────────────────────────────────────
// Both algorithms, because which one runs depends on whether the 12-page walk
// exhausts the epoch, and that flipped mid-2026-08-09.
console.log("\nHEAD");
const prefix = `proofs/${epoch}/`;
calls = 0; t = performance.now();
let token, lastKey, walkExhausted = false;
for (let p = 0; p < 12; p++) {
  const r = await send(new ListObjectsV2Command({ Bucket: BUCKET, Prefix: prefix, MaxKeys: 1000, ...(token ? { ContinuationToken: token } : {}) }));
  if (r.Contents?.length) lastKey = r.Contents[r.Contents.length - 1].Key;
  token = r.NextContinuationToken;
  if (!token) { walkExhausted = true; break; }
}
row("12-page walk", `${ms(t)}, ${calls} LIST, exhausted=${walkExhausted}`);
let head = parseInt((lastKey.split("/").pop() || "").split("-")[0], 10);
if (!walkExhausted) {
  calls = 0; t = performance.now();
  const has = async (n) => (await send(new ListObjectsV2Command({ Bucket: BUCKET, Prefix: prefix, StartAfter: `${prefix}${pad(n)}`, MaxKeys: 1 }))).Contents?.length > 0;
  let lo = 0, cur = 1024, hi = 1e9;
  while (cur < hi && (await has(cur))) { lo = cur; cur *= 4; }
  hi = Math.min(hi, cur);
  while (hi - lo > 1) { const mid = (lo + hi) >> 1; if (await has(mid)) lo = mid; else hi = mid; }
  head = Math.max(lo, 1);
  row("→ search fallback", `${ms(t)}, ${calls} SEQUENTIAL LIST probes`);
}
row("head", `${head}  (${(head / proofs).toFixed(2)} counters/object)`);

// ── one page of rows ───────────────────────────────────────────────────────
console.log("\nONE PAGE (25 file rows)");
calls = 0; t = performance.now();
{
  const anchorsPrefix = `anchors/${epoch}/`;
  let cursor = head, scanned = 0, found = 0, windows = 0, gets = 0;
  while (cursor >= 1 && scanned < 4000 && found < 25) {
    const start = Math.max(0, cursor - Math.min(1000, cursor));
    const inWindow = (n) => !isNaN(n) && n > start && n <= cursor;
    const [pr, ar] = await Promise.all([
      send(new ListObjectsV2Command({ Bucket: BUCKET, Prefix: prefix, StartAfter: `${prefix}${pad(start)}`, MaxKeys: 1000 })),
      send(new ListObjectsV2Command({ Bucket: BUCKET, Prefix: anchorsPrefix, StartAfter: `${anchorsPrefix}${pad(start)}`, MaxKeys: 1000 })),
    ]);
    windows++;
    const anchorSet = new Set((ar.Contents || []).map((o) => parseInt((o.Key.split("/").pop() || "").replace(".json", ""), 10)).filter(inWindow));
    const fileKeys = (pr.Contents || [])
      .map((o) => ({ key: o.Key, counter: parseInt((o.Key.split("/").pop() || "").split("-")[0], 10) }))
      .filter((x) => inWindow(x.counter) && !anchorSet.has(x.counter))
      .sort((a, b) => b.counter - a.counter);
    let idx = 0;
    while (idx < fileKeys.length && found < 25) {
      const batch = fileKeys.slice(idx, idx + (25 - found) + 4);
      idx += batch.length; gets += batch.length;
      const bodies = await Promise.all(batch.map(({ key }) =>
        send(new GetObjectCommand({ Bucket: BUCKET, Key: key })).then((r) => r.Body.transformToString()).catch(() => null)));
      for (const b of bodies) {
        if (!b) continue;
        const n = JSON.parse(b).attribution?.name;
        if (n !== "Ethereum Anchor" && n !== "Interval") found++;
      }
    }
    scanned += cursor - start;
    cursor = start;
  }
  row("windows scanned", `${windows} (${scanned} counters)`);
  row("per-row proof GETs", `${gets}`);
  row("rows returned", `${found} of 25`);
  row("TOTAL", `${ms(t)}, ${calls} S3 requests`);
}

// ── production HTTP ────────────────────────────────────────────────────────
if (process.argv.includes("--http")) {
  console.log(`\nPRODUCTION HTTP (${SITE})`);
  const time = async (url, label) => {
    const t0 = performance.now();
    const r = await fetch(url, { cache: "no-store" });
    const body = await r.text();
    row(label, `${ms(t0)}  ${r.status}  ${body.length}B`);
    return body;
  };
  const bust = () => Math.random().toString(36).slice(2);
  const html = await time(`${SITE}/roll?cb=${bust()}`, "GET /roll (cold)");
  row("seeded rows in HTML", `${(html.match(/hashShort/g) || []).length}`);
  await time(`${SITE}/roll`, "GET /roll (warm)");
  const feed = await time(`${SITE}/api/explorer?files=1&cb=${bust()}`, "GET feed (cold)");
  try { row("cold feed rows", `${(JSON.parse(feed).entries || []).length}`); } catch { /* not json */ }
  await time(`${SITE}/api/explorer?files=1`, "GET feed (warm)");
}
console.log("");
