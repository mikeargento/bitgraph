#!/usr/bin/env node
/**
 * Rebuild the Roll index from the ledger, from scratch.
 *
 * THE LEDGER WINS. Everything under roll/v1/ is derived from the Object-Locked
 * proofs/ prefix and nothing else. If the index and the ledger ever disagree,
 * this is the answer: it does not reconcile, patch or diff, it rebuilds. That
 * is the whole reason the index is allowed to exist.
 *
 *   node website/scripts/rebuild-roll-index.mjs --epoch current
 *   node website/scripts/rebuild-roll-index.mjs --epoch <id> --force
 *   node website/scripts/rebuild-roll-index.mjs --all          # every epoch
 *   node website/scripts/rebuild-roll-index.mjs --all --dry-run
 *
 * Sealed chunks are skipped when they already exist, because they are immutable
 * and rebuilding one can only produce the same bytes; --force rewrites them
 * anyway, which is what to reach for if a chunk was ever written by a bad
 * version. The tail chunk is never written: it is still live.
 *
 * Reads proofs/ and writes ONLY under roll/v1/. It cannot touch the ledger:
 * the bucket is Object Lock COMPLIANCE, and the write guard below refuses any
 * key outside the index prefix regardless.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
for (const line of readFileSync(resolve(here, "../.env.local"), "utf8").split("\n")) {
  const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)$/);
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "").trim();
}
const { S3Client, ListObjectsV2Command, GetObjectCommand, PutObjectCommand } = await import(
  resolve(here, "../node_modules/@aws-sdk/client-s3/dist-cjs/index.js")
);

// Kept in step with src/lib/roll-chunks.ts by the assertion below, so a width
// change cannot silently produce two incompatible chunk layouts.
const CHUNK_WIDTH = 2048;
const CHUNK_PREFIX = "roll/v1";
{
  const src = readFileSync(resolve(here, "../src/lib/roll-chunks.ts"), "utf8");
  const w = /CHUNK_WIDTH\s*=\s*(\d+)/.exec(src);
  const p = /CHUNK_PREFIX\s*=\s*"([^"]+)"/.exec(src);
  if (!w || Number(w[1]) !== CHUNK_WIDTH) throw new Error(`width drift: roll-chunks.ts says ${w?.[1]}, this script says ${CHUNK_WIDTH}`);
  if (!p || p[1] !== CHUNK_PREFIX) throw new Error(`prefix drift: roll-chunks.ts says ${p?.[1]}, this script says ${CHUNK_PREFIX}`);
}

const BUCKET = (process.env.LEDGER_BUCKET || "occ-ledger-prod").trim();
const s3 = new S3Client({ region: (process.env.LEDGER_REGION || "us-east-2").trim() });
const args = process.argv.slice(2);
const has = (f) => args.includes(f);
const arg = (f) => { const i = args.indexOf(f); return i >= 0 ? args[i + 1] : null; };
const DRY = has("--dry-run");
const FORCE = has("--force");

const pad = (n) => String(n).padStart(12, "0");
const toSafe = (b) => b.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const chunkRange = (i) => ({ from: i * CHUNK_WIDTH + 1, to: (i + 1) * CHUNK_WIDTH });
const chunkKey = (epoch, i) => { const { from, to } = chunkRange(i); return `${CHUNK_PREFIX}/${epoch}/c/${pad(from)}-${pad(to)}.json`; };

async function put(key, value) {
  if (!key.startsWith(`${CHUNK_PREFIX}/`)) throw new Error(`refusing to write outside ${CHUNK_PREFIX}/: ${key}`);
  if (DRY) return;
  await s3.send(new PutObjectCommand({ Bucket: BUCKET, Key: key, Body: JSON.stringify(value), ContentType: "application/json" }));
}
async function exists(key) {
  const r = await s3.send(new ListObjectsV2Command({ Bucket: BUCKET, Prefix: key, MaxKeys: 1 }));
  return (r.Contents || []).some((o) => o.Key === key);
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
  return { c, t, d: toSafe(digestB64), h: toSafe(proofHash).slice(0, 10), ...(b != null ? { b } : {}), ...(lm ? { at: lm } : {}) };
}

/** Every key in the epoch, once. One pass feeds every chunk, so a full rebuild
 *  costs one LIST sweep rather than one per chunk. */
async function listEpoch(epoch) {
  const prefix = `proofs/${epoch}/`;
  const out = [];
  let token;
  do {
    const r = await s3.send(new ListObjectsV2Command({ Bucket: BUCKET, Prefix: prefix, MaxKeys: 1000, ...(token ? { ContinuationToken: token } : {}) }));
    for (const o of r.Contents || []) {
      const n = parseInt(((o.Key || "").split("/").pop() || "").split("-")[0], 10);
      if (!isNaN(n)) out.push({ key: o.Key, counter: n, lm: o.LastModified?.getTime() });
    }
    token = r.NextContinuationToken;
  } while (token);
  out.sort((a, b) => a.counter - b.counter);
  return out;
}

async function rebuildEpoch(epoch) {
  const keys = await listEpoch(epoch);
  if (keys.length === 0) { console.log(`  ${epoch.slice(0, 12)}…  empty, skipped`); return; }
  const head = keys[keys.length - 1].counter;
  const tailIdx = Math.floor((head - 1) / CHUNK_WIDTH);
  const byChunk = new Map();
  for (const k of keys) {
    const i = Math.floor((k.counter - 1) / CHUNK_WIDTH);
    if (i >= tailIdx) continue; // the tail is live; never sealed by a rebuild
    if (!byChunk.has(i)) byChunk.set(i, []);
    byChunk.get(i).push(k);
  }
  console.log(`  ${epoch.slice(0, 12)}…  ${keys.length} objects, head ${head}, ${byChunk.size} sealed chunks (tail ${tailIdx} left live)`);

  let built = 0, skipped = 0, gets = 0;
  for (const i of [...byChunk.keys()].sort((a, b) => a - b)) {
    const key = chunkKey(epoch, i);
    if (!FORCE && await exists(key)) { skipped++; continue; }
    const group = byChunk.get(i);
    const rows = [];
    const BATCH = 64;
    for (let j = 0; j < group.length; j += BATCH) {
      const got = await Promise.all(group.slice(j, j + BATCH).map(async ({ key: k, lm }) => {
        gets++;
        try {
          const r = await s3.send(new GetObjectCommand({ Bucket: BUCKET, Key: k }));
          return rowFromProof(JSON.parse(await r.Body.transformToString()), lm);
        } catch { return null; }
      }));
      for (const row of got) if (row) rows.push(row);
    }
    rows.sort((a, b) => b.c - a.c);
    const { from, to } = chunkRange(i);
    await put(key, { epoch, from, to, rows });
    built++;
    process.stdout.write(`\r    built ${built}/${byChunk.size - skipped} chunks, ${gets} GETs`);
  }
  if (built) process.stdout.write("\n");

  // sealedThrough is the ceiling of the last chunk BELOW the tail, so the head
  // walk always starts inside a range that can still grow.
  const sealedThrough = tailIdx > 0 ? chunkRange(tailIdx - 1).to : 0;
  await put(`${CHUNK_PREFIX}/${epoch}/state.json`, { sealedThrough });
  console.log(`    built ${built}, skipped ${skipped} (already sealed), sealedThrough ${sealedThrough}${DRY ? "  [DRY RUN, nothing written]" : ""}`);
}

async function currentEpoch() {
  const r = await fetch("https://nitro.occproof.com/key", { signal: AbortSignal.timeout(8000) });
  return toSafe((await r.json()).epochId);
}

async function allEpochs() {
  const out = [];
  let token;
  do {
    const r = await s3.send(new ListObjectsV2Command({ Bucket: BUCKET, Prefix: "proofs/", Delimiter: "/", ContinuationToken: token }));
    for (const cp of r.CommonPrefixes || []) if (cp.Prefix) out.push(cp.Prefix.replace("proofs/", "").replace(/\/$/, ""));
    token = r.NextContinuationToken;
  } while (token);
  return out;
}

const t0 = performance.now();
console.log(`\nRebuild roll index · ${BUCKET}${DRY ? " · DRY RUN" : ""}${FORCE ? " · FORCE" : ""}`);
const epochs = has("--all") ? await allEpochs() : [arg("--epoch") === "current" || !arg("--epoch") ? await currentEpoch() : arg("--epoch")];
console.log(`${epochs.length} epoch(s)\n`);
for (const e of epochs) await rebuildEpoch(e);
console.log(`\ndone in ${((performance.now() - t0) / 1000).toFixed(1)}s\n`);
