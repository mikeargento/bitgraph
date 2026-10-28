// Copyright (c) Argento Computing Inc. All rights reserved. See LICENSE.
/**
 * The million-file benchmark, on the current Make flow: one tree, one BitGraph.
 *
 *   node --experimental-strip-types scripts/bench-million.mjs [count] [--bind]
 *
 * Does what the Make page does, in Node, and times each step:
 *   1. hash     each file's SHA-256 (the files are made in memory from a seed, as the 2026-10-12 corpus was:
 *               file i = "BitGraph one-million test <seed>\nfile <i+1> of <count>\n<sha256 hex of "<seed>:<i>">\n")
 *   2. tree     leaf = SHA-256(0x00 || SHA-256(file)), node = SHA-256(0x01 || left || right), odd last node rises;
 *               leaves sorted by name, the latest Base block as the first leaf (lib/tree-member.ts, lib/plugins.ts)
 *   3. bind     only with --bind: POST /api/commit with merkle-root.txt's SHA-256 and floorLeaf, as Make does.
 *               BitGraphs are permanent; without --bind nothing is sent.
 *   4. check    one member's path of siblings walks to the root (checkMember); with --bind, the proof is written for
 *               the SDK's offline verify.
 *
 * Results go to bench-out/<date>/: timings.json, seed.txt, merkle-root.txt, and with --bind the proof.
 */
import { createHash } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { cpus, totalmem } from "node:os";
import { digestRootText, baseBlockFileText, checkMember, leafOfDigest } from "../src/lib/tree-member.ts";

const count = Number(process.argv[2] ?? 1_000_000);
const bind = process.argv.includes("--bind");
const site = process.env.BITGRAPH_SITE ?? "https://bitgraph.ing";
const sha = (...parts) => { const h = createHash("sha256"); for (const p of parts) h.update(p); return h.digest(); };
const hex = (b) => Buffer.from(b).toString("hex");
const b64 = (b) => Buffer.from(b).toString("base64");
const now = () => performance.now();
const seed = hex(sha(Buffer.from(String(Date.now())), Buffer.from(String(Math.random())))).slice(0, 32);
const t = {};

// 1. hash: the files, made and hashed one by one as a drop's files are read
let t0 = now();
const digests = new Array(count);
const names = new Array(count);
for (let i = 0; i < count; i++) {
  const file = `BitGraph one-million test ${seed}\nfile ${i + 1} of ${count}\n${hex(sha(Buffer.from(`${seed}:${i}`)))}\n`;
  digests[i] = sha(Buffer.from(file));
  names[i] = `file-${String(i + 1).padStart(7, "0")}.txt`;
}
t.hashS = (now() - t0) / 1000;

// 2. tree: the floor leaf, then the files sorted by name (names here are already in order)
t0 = now();
const block = await fetch(`${site}/api/base/latest`, { cache: "no-store" }).then((r) => r.json());
const floorFile = baseBlockFileText(block);
const floorDigest = sha(Buffer.from(floorFile));
t.baseReadS = (now() - t0) / 1000;
t0 = now();
const leaves = [["base-block.json", hex(leafOfDigest(floorDigest)), b64(floorDigest)]];
for (let i = 0; i < count; i++) leaves.push([names[i], hex(sha(Buffer.from([0]), digests[i])), b64(digests[i])]);
const levels = [];
let row = leaves.map((l) => Buffer.from(l[1], "hex"));
while (row.length > 1) {
  const next = new Array(Math.ceil(row.length / 2));
  for (let k = 0; k < next.length; k++) { const i = 2 * k; next[k] = i + 1 < row.length ? sha(Buffer.from([1]), row[i], row[i + 1]) : row[i]; }
  levels.push(next.map(hex));
  row = next;
}
const root = hex(row[0]);
const rootText = digestRootText(leaves.length, root);
const rootDigest = sha(Buffer.from(rootText));
t.treeS = (now() - t0) / 1000;
t.hashAndTreeS = t.hashS + t.baseReadS + t.treeS;

// 3. bind
let proof = null;
if (bind) {
  t0 = now();
  const res = await fetch(`${site}/api/commit`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ digests: [{ digestB64: b64(rootDigest), hashAlg: "sha256" }], chainId: "bitgraph:main", ceiling: true, floorLeaf: true }) });
  if (!res.ok) throw new Error(`bind failed: ${res.status} ${await res.text()}`);
  const raw = await res.json();
  proof = (Array.isArray(raw) ? raw : raw.proofs ?? [raw]).find((p) => p.artifact?.digestB64 === b64(rootDigest)) ?? raw;
  t.bindS = (now() - t0) / 1000;
  t.dropToProofS = t.hashAndTreeS + t.bindS;
}

// 4. check: one member in the middle of the tree, its path of siblings walked to the root (lib/tree-member.ts)
t0 = now();
const mid = Math.floor(leaves.length / 2);
const sibs = [];
let i = mid, rowHashes = leaves.map((l) => l[1]);
for (let lv = 0; rowHashes.length > 1; lv++) { const s = i ^ 1; if (s < rowHashes.length) sibs.push(Buffer.from(rowHashes[s], "hex")); i >>= 1; rowHashes = levels[lv]; }
const member = { format: "bitgraph-tree-member/1", files: leaves.length, index: mid, path: b64(Buffer.concat(sibs)), rootText };
const memberOk = checkMember({ artifact: { digestB64: b64(rootDigest) }, commit: { counter: proof?.commit?.counter ?? "0" } }, leaves[mid][2], member);
t.memberCheckS = (now() - t0) / 1000;

const out = `bench-out/${new Date().toISOString().slice(0, 10)}`;
mkdirSync(out, { recursive: true });
const timings = { real: bind, count, files: leaves.length, cpu: `${cpus()[0].model}, ${cpus().length} cores, ${Math.round(totalmem() / 2 ** 30)} GB`, node: process.version, flow: "make/tree-member-1 (digest leaves, Base floor leaf, one atomic bind)", floor: { chain: block.chain, blockNumber: block.number, blockHash: block.hash, blockTimestamp: block.timestamp }, ...t, memberOk, counter: proof?.commit?.counter ?? null, epochId: proof?.commit?.epochId ?? null, rootDigestB64: b64(rootDigest), wallClock: new Date().toISOString() };
writeFileSync(`${out}/timings.json`, JSON.stringify(timings, null, 2) + "\n");
writeFileSync(`${out}/seed.txt`, `${seed}\nfile i (0-based) = "BitGraph one-million test <seed>\\nfile <i+1> of ${count}\\n<sha256 hex of \\"<seed>:<i>\\">\\n"\n`);
writeFileSync(`${out}/merkle-root.txt`, rootText);
writeFileSync(`${out}/base-block.json`, floorFile);
if (proof) writeFileSync(`${out}/merkle-root.txt.bitgraph.json`, JSON.stringify(proof, null, 2) + "\n");
console.log(JSON.stringify(timings, null, 2));
