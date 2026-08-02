#!/usr/bin/env node
// Copyright (c) 2024-2026 Mike Argento. Licensed under the MIT License. See LICENSE.

// BitGraph Folder exporter.
//
// Wraps one recorded drop into the same export layout the website produces, so
// a folder built here and a zip downloaded from a proof page are the same
// thing:
//
//   bitgraph-proof-1858/
//       proof.json
//       random-494.txt                          the original bytes, moved in
//       ethereum-anchors/
//           anchor-before.json                  lower bound
//           anchor-before-witness.json          its block header
//           anchor-after.json                   upper bound, the seal
//           anchor-after-witness.json           its block header
//
// No archive is written: bitgraph-audit ingests a directory directly and
// discovers entries by schema shape rather than by filename, so the folder
// audits as-is with `npx @mikeargento/bitgraph-audit <folder>`.
//
// Read-only against the ledger. It assembles proof material that already
// exists, never commits, and the file bytes never leave the machine. No
// dependencies beyond node builtins.
//
// Usage:
//   export.mjs <file> <digestB64> <counter> <epochUrlSafe>   build one export
//   export.mjs --complete [folder]                           finish pending ones
//   export.mjs --json batch|commit                           parse stdin (see below)
//
// The --json modes exist so the shell script needs exactly one runtime instead
// of also reaching for python3 to read a response body.

import { mkdir, writeFile, rename, readdir, readFile, rm, access } from "node:fs/promises";
import { join, basename, dirname } from "node:path";

const API = process.env.BITGRAPH_API_URL || process.env.BITGRAPH_API || "https://bitgraph.ing";
// Anchors land within roughly 12-24s at the normal cadence, so the ceiling is
// about 2x that and the poll is fine-grained enough not to add much on top.
// This is a ceiling, not a delay: the wait returns the moment the anchor
// appears. Past it the export is written pending and a later run completes it,
// which is the path that carries a slow anchor cadence and the rotation window.
// Keeping the ceiling short matters because the caller holds a lock while it
// waits, so a batch of drops would otherwise queue behind each other.
const SEAL_WAIT_MS = Number(process.env.BITGRAPH_SEAL_WAIT_MS || 45_000);
const POLL_MS = 3_000;
const PENDING = ".bitgraph-pending.json";
const ANCHOR_DIR = "ethereum-anchors";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const toUrlSafe = (b64) => b64.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const exists = (p) => access(p).then(() => true, () => false);
const json = (v) => JSON.stringify(v, null, 2);

async function getJson(url, timeoutMs = 25_000) {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), timeoutMs);
  try {
    const res = await fetch(url, { signal: ctl.signal, redirect: "error" });
    return res.ok ? await res.json() : null;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

async function readStdin() {
  const chunks = [];
  for await (const chunk of process.stdin) chunks.push(chunk);
  return Buffer.concat(chunks).toString("utf8");
}

// ---------------------------------------------------------------------------
// Ledger reads
// ---------------------------------------------------------------------------

/** The proof at this exact causal position, or null. */
async function fetchProof(digestB64, counter) {
  const data = await getJson(`${API}/api/proofs/digest/${toUrlSafe(digestB64)}`);
  const entries = data?.proofs;
  if (!Array.isArray(entries)) return null;
  const proofs = entries.map((e) => e?.proof ?? e).filter((p) => p && typeof p === "object");
  // The same bytes can sit at several positions (BitGraph Again), so match on
  // the counter rather than taking the first.
  return proofs.find((p) => String(p?.commit?.counter) === String(counter)) ?? null;
}

/** { before, after } anchor proofs bracketing a position. Either may be null. */
async function fetchAnchors(counter, epochUrlSafe) {
  const q = `counter=${encodeURIComponent(counter)}&epoch=${encodeURIComponent(epochUrlSafe)}`;
  const [after, before] = await Promise.all([
    getJson(`${API}/api/proofs/anchors?${q}&limit=1`),
    getJson(`${API}/api/proofs/anchors?${q}&before=1`),
  ]);
  return { before: before?.anchors?.[0] ?? null, after: after?.anchors?.[0] ?? null };
}

/**
 * The offline block-header witness for an anchor's block, or null.
 * The server self-checks it (returns it only when keccak256(header) equals the
 * signed block hash), so a miss just omits the file and the export stays valid.
 */
async function fetchWitness(anchor) {
  const eth = anchor?.ethereum;
  if (typeof eth?.blockNumber !== "number" || typeof eth?.blockHash !== "string") return null;
  const w = await getJson(
    `${API}/api/proofs/witness?block=${eth.blockNumber}&hash=${encodeURIComponent(eth.blockHash)}`
  );
  return w && !w.error ? w : null;
}

/** Wait for the sealing anchor, returning as soon as it appears or at the deadline. */
async function awaitSeal(counter, epochUrlSafe, deadlineMs) {
  const until = Date.now() + deadlineMs;
  let anchors = await fetchAnchors(counter, epochUrlSafe);
  while (!anchors.after && Date.now() < until) {
    await sleep(POLL_MS);
    anchors = await fetchAnchors(counter, epochUrlSafe);
  }
  return anchors;
}

// ---------------------------------------------------------------------------
// Export assembly
// ---------------------------------------------------------------------------

/**
 * Write the proof material into an export directory.
 * Returns true once the sealing anchor is present.
 */
async function writeExportContents(dir, { counter, epochUrlSafe, proof }, waitMs) {
  const anchors = await awaitSeal(counter, epochUrlSafe, waitMs);

  await writeFile(join(dir, "proof.json"), json(proof));

  // Rebuilt wholesale each pass so a completion run cannot leave a stale
  // half-set behind.
  await rm(join(dir, ANCHOR_DIR), { recursive: true, force: true });
  const present = ["before", "after"].filter((side) => anchors[side]);
  if (present.length > 0) {
    await mkdir(join(dir, ANCHOR_DIR), { recursive: true });
    for (const side of present) {
      const anchor = anchors[side];
      await writeFile(join(dir, ANCHOR_DIR, `anchor-${side}.json`), json(anchor));
      const witness = await fetchWitness(anchor);
      if (witness) {
        await writeFile(join(dir, ANCHOR_DIR, `anchor-${side}-witness.json`), json(witness));
      }
    }
  }
  return Boolean(anchors.after);
}

/** Record the pending state, or clear it once sealed. */
async function markPending(dir, meta, sealed) {
  if (sealed) await rm(join(dir, PENDING), { force: true });
  else await writeFile(join(dir, PENDING), json(meta));
}

/**
 * Pick the export directory name, matching the website's bitgraph-proof-<counter>.
 * Counters are unique within an epoch but repeat across epochs, so on a real
 * collision with different bytes the epoch is appended rather than overwriting.
 */
async function resolveDir(folder, counter, epochUrlSafe, digestB64) {
  const plain = join(folder, `bitgraph-proof-${counter}`);
  const existing = await readFile(join(plain, "proof.json"), "utf8").catch(() => null);
  if (existing === null) return { dir: plain, alreadyBuilt: false };
  try {
    if (JSON.parse(existing)?.artifact?.digestB64 === digestB64) {
      return { dir: plain, alreadyBuilt: true };
    }
  } catch {
    /* unreadable, treat as a collision */
  }
  const dir = `${plain}-${epochUrlSafe.slice(0, 8)}`;
  return { dir, alreadyBuilt: await exists(join(dir, "proof.json")) };
}

/** Build a fresh export folder for one recorded file. */
async function buildExport(filePath, digestB64, counter, epochUrlSafe) {
  const fileName = basename(filePath);
  const folder = dirname(filePath);

  const proof = await fetchProof(digestB64, counter);
  if (!proof) {
    console.error(`export: no proof at #${counter} for ${fileName}, leaving the file in place`);
    return 1;
  }

  const { dir, alreadyBuilt } = await resolveDir(folder, counter, epochUrlSafe, digestB64);
  if (alreadyBuilt) {
    // A re-fired watch must not redo the work. Still finish the move: the
    // caller marks the digest handled before calling in, so a run that died
    // between writing the contents and moving the file would otherwise strand
    // it at the top level forever.
    if (await exists(filePath)) await rename(filePath, join(dir, fileName));
    return 0;
  }
  await mkdir(dir, { recursive: true });

  const meta = { fileName, digestB64, counter, epochUrlSafe };
  const sealed = await writeExportContents(dir, { ...meta, proof }, SEAL_WAIT_MS);
  await markPending(dir, meta, sealed);

  // Moved in last, so a failure above never strands the file.
  if (await exists(filePath)) await rename(filePath, join(dir, fileName));

  console.log(`export: ${basename(dir)}${sealed ? "" : " (pending seal)"}`);
  return 0;
}

/** Finish any export still waiting on the anchor that seals it. */
async function completePending(folder) {
  const entries = await readdir(folder, { withFileTypes: true }).catch(() => []);
  for (const e of entries) {
    if (!e.isDirectory()) continue;
    const dir = join(folder, e.name);
    const raw = await readFile(join(dir, PENDING), "utf8").catch(() => null);
    if (raw === null) continue;

    let meta;
    try {
      meta = JSON.parse(raw);
    } catch {
      continue;
    }
    const proof = await fetchProof(meta.digestB64, meta.counter);
    if (!proof) continue;
    try {
      // No waiting on a completion pass: take whatever has landed by now, so a
      // backlog of pending folders cannot stall the run.
      const sealed = await writeExportContents(dir, { ...meta, proof }, 0);
      await markPending(dir, meta, sealed);
      if (sealed) console.log(`export: sealed ${e.name}`);
    } catch (err) {
      console.error(`export: could not complete ${e.name}: ${err.message}`);
    }
  }
  return 0;
}

// ---------------------------------------------------------------------------
// Response parsing for the shell script
// ---------------------------------------------------------------------------

const epochToUrlSafe = (e) => String(e || "").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

/**
 * Batch-check response to `yes\t<counter>\t<epoch>` / `no` / `error`.
 * Reports the EARLIEST position so an already-on-record drop is exported from
 * its originating proof rather than a later BitGraph Again position.
 */
function parseBatch(body) {
  try {
    const results = JSON.parse(body).results;
    const entry = Object.values(results ?? {})[0];
    const proofs = entry?.proofs ?? [];
    if (proofs.length === 0) return "no";
    const commits = proofs.map((p) => (p.proof ?? p).commit ?? {});
    const earliest = commits.reduce((a, b) =>
      BigInt(a.counter || 0) <= BigInt(b.counter || 0) ? a : b
    );
    return `yes\t${earliest.counter ?? ""}\t${epochToUrlSafe(earliest.epochId)}`;
  } catch {
    return "error";
  }
}

/** Commit response to `ok\t<counter>\t<epoch>` / `retry` / `fail`. */
function parseCommit(body) {
  try {
    const parsed = JSON.parse(body);
    const p = Array.isArray(parsed) ? parsed[0] : parsed;
    const commit = p?.commit ?? {};
    if (commit.counter !== undefined && commit.counter !== null) {
      return `ok\t${commit.counter}\t${epochToUrlSafe(commit.epochId)}`;
    }
    // The service holds drops rather than failing them during epoch rotation.
    return p?.code === "tee-restarting" ? "retry" : "fail";
  } catch {
    return "fail";
  }
}

// ---------------------------------------------------------------------------

const argv = process.argv.slice(2);
try {
  if (argv[0] === "--json") {
    const body = await readStdin();
    if (argv[1] === "batch") console.log(parseBatch(body));
    else if (argv[1] === "commit") console.log(parseCommit(body));
    else {
      console.error("usage: export.mjs --json batch|commit");
      process.exit(64);
    }
    process.exit(0);
  }
  if (argv[0] === "--complete") {
    process.exit(await completePending(argv[1] || join(process.env.HOME, "BitGraph")));
  }
  if (argv.length < 4) {
    console.error("usage: export.mjs <file> <digestB64> <counter> <epochUrlSafe> | --complete [folder] | --json batch|commit");
    process.exit(64);
  }
  process.exit(await buildExport(argv[0], argv[1], argv[2], argv[3]));
} catch (err) {
  console.error(`export: ${err.stack || err.message}`);
  process.exit(1);
}
