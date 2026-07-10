#!/usr/bin/env node
// Copyright (c) 2024-2026 Mike Argento. Licensed under the MIT License. See LICENSE.

/**
 * Full-scale audit benchmark: a protocol-correct synthetic corpus of
 * 50,000 proofs (override with argv[1]) audited end-to-end.
 *
 *   node scripts/bench-audit.mjs [proofCount]     (or: npm run bench)
 *
 * Corpus shape mirrors the deployed system: five epochs (fresh Ed25519
 * key per epoch, per G1), one chain ("bitgraph:main"), the G2
 * two-position slot/commit counter pattern (slot 2i+1 / commit 2i+2),
 * real prevB64 hash links via computeProofHash, and a sprinkle of
 * Ethereum anchor proofs interleaved as ordinary chain members (per G5
 * and G6), each with an offline-verifiable RLP header witness. Every
 * proof carries a REAL Ed25519 signature over the canonical SignedBody;
 * nothing bypasses verifier semantics, and verification is never
 * weakened for speed.
 *
 * Measures and prints: generation time, bundle write time (directory and
 * .tar.gz), ingest time, every pipeline stage, full runAudit wall time
 * over both containers, report build time, proofs/sec, and peak RSS
 * (sampled on an interval plus final reads). Deterministic corpus
 * (seeded PRNG, fixed literal seed), zero network access.
 */

import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { createWriteStream } from "node:fs";
import { once } from "node:events";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createGzip } from "node:zlib";
import { getPublicKeyAsync, signAsync } from "@noble/ed25519";
import { sha256 } from "@noble/hashes/sha256";
import { keccak_256 } from "@noble/hashes/sha3";
import { canonicalize, computeProofHash } from "@mikeargento/bitgraph-verify";
import {
  analyzeAuthorities,
  buildJsonReport,
  buildMarkdownReport,
  classifyAnomalies,
  computeExitFlags,
  deriveTemporalBounds,
  identifyAnchors,
  ingestBundle,
  reconstructChains,
  runAudit,
  validateAttestations,
  verifyAnchorWitnesses,
  verifyObservedProofs,
} from "@mikeargento/bitgraph-audit";

// ---------------------------------------------------------------------------
// Parameters
// ---------------------------------------------------------------------------

const PROOF_COUNT = Number(process.argv[2] ?? 50_000);
const EPOCH_COUNT = 5;
const ANCHOR_EVERY = 500; // one anchor proof per 500 chain positions
const CHAIN_ID = "bitgraph:main";
const MEASUREMENT = "bench-measurement-" + "0".repeat(64);
const SEED = 0xb17c0de;
const SIGN_BATCH = 512;

// ---------------------------------------------------------------------------
// Seeded PRNG (mulberry32): the corpus is deterministic, never clock-derived.
// ---------------------------------------------------------------------------

function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const rng = mulberry32(SEED);

function randBytes(n) {
  const out = new Uint8Array(n);
  for (let i = 0; i < n; i++) out[i] = Math.floor(rng() * 256);
  return out;
}

const b64 = (bytes) => Buffer.from(bytes).toString("base64");
const utf8 = (text) => new TextEncoder().encode(text);

// ---------------------------------------------------------------------------
// Minimal RLP encoder + synthetic Ethereum headers (generation side only;
// the audit package carries its own independent decoder).
// ---------------------------------------------------------------------------

function encodeRlp(item) {
  if (item instanceof Uint8Array) {
    if (item.length === 1 && item[0] < 0x80) return item;
    return concatBytes([rlpLength(item.length, 0x80), item]);
  }
  const payload = concatBytes(item.map(encodeRlp));
  return concatBytes([rlpLength(payload.length, 0xc0), payload]);
}

function rlpLength(length, offset) {
  if (length <= 55) return new Uint8Array([offset + length]);
  const bytes = [];
  let v = length;
  while (v > 0) {
    bytes.unshift(v & 0xff);
    v = Math.floor(v / 256);
  }
  return new Uint8Array([offset + 55 + bytes.length, ...bytes]);
}

function beBytes(value) {
  let v = BigInt(value);
  const bytes = [];
  while (v > 0n) {
    bytes.unshift(Number(v & 0xffn));
    v >>= 8n;
  }
  return new Uint8Array(bytes);
}

function makeEthereumHeader(blockNumber, timestamp) {
  const items = [];
  for (let i = 0; i < 20; i++) {
    if (i === 8) items.push(beBytes(blockNumber));
    else if (i === 11) items.push(beBytes(timestamp));
    else items.push(new Uint8Array(32).fill((i + 1) & 0xff));
  }
  const headerBytes = encodeRlp(items);
  return { headerBytes, headerRlpHex: `0x${Buffer.from(headerBytes).toString("hex")}` };
}

function concatBytes(parts) {
  const total = parts.reduce((sum, part) => sum + part.length, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }
  return out;
}

// ---------------------------------------------------------------------------
// Timing and memory instrumentation
// ---------------------------------------------------------------------------

const mib = (bytes) => `${(bytes / (1024 * 1024)).toFixed(1)} MiB`;
const secs = (ms) => `${(ms / 1000).toFixed(2)} s`;

let peakRss = process.memoryUsage().rss;
let stagePeakRss = peakRss;
const sampler = setInterval(() => {
  const rss = process.memoryUsage().rss;
  if (rss > peakRss) peakRss = rss;
  if (rss > stagePeakRss) stagePeakRss = rss;
}, 25);
sampler.unref();

const stageRows = [];

async function stage(name, fn) {
  stagePeakRss = process.memoryUsage().rss;
  if (stagePeakRss > peakRss) peakRss = stagePeakRss;
  const start = process.hrtime.bigint();
  const value = await fn();
  const ms = Number(process.hrtime.bigint() - start) / 1e6;
  const rss = process.memoryUsage().rss;
  if (rss > stagePeakRss) stagePeakRss = rss;
  if (stagePeakRss > peakRss) peakRss = stagePeakRss;
  stageRows.push({ name, ms, stagePeak: stagePeakRss });
  console.log(`  ${name.padEnd(34)} ${secs(ms).padStart(10)}   stage peak RSS ${mib(stagePeakRss)}`);
  return value;
}

// ---------------------------------------------------------------------------
// Corpus generation (real signing path, batched)
// ---------------------------------------------------------------------------

async function generateCorpus() {
  const perEpoch = Math.floor(PROOF_COUNT / EPOCH_COUNT);
  const remainder = PROOF_COUNT - perEpoch * EPOCH_COUNT;
  const files = []; // { path, content: string | Uint8Array }
  let anchorCount = 0;
  let witnessCount = 0;
  let globalAnchorIndex = 0;

  for (let e = 0; e < EPOCH_COUNT; e++) {
    const epochId = `bench-epoch-${e}`;
    const epochSize = perEpoch + (e === EPOCH_COUNT - 1 ? remainder : 0);
    const privateKey = randBytes(32);
    const publicKeyB64 = b64(await getPublicKeyAsync(privateKey));

    // Pass 1: build signed bodies and the prevB64 hash chain. The
    // canonical proof hash covers the signed body (not the signature), so
    // chaining never has to wait for signing.
    const entries = [];
    let prevHash;
    for (let i = 0; i < epochSize; i++) {
      const isAnchor = i % ANCHOR_EVERY === ANCHOR_EVERY - 250 && i > 0;
      const commit = {
        nonceB64: b64(randBytes(16)),
        counter: String(2 * i + 2),
        slotCounter: String(2 * i + 1),
        ...(prevHash !== undefined ? { prevB64: prevHash } : {}),
        epochId,
        chainId: CHAIN_ID,
      };

      let artifact;
      let attribution;
      if (isAnchor) {
        const blockNumber = 24_000_000 + globalAnchorIndex;
        const timestamp = 1_700_000_000 + globalAnchorIndex * 3600;
        const { headerRlpHex, headerBytes } = makeEthereumHeader(blockNumber, timestamp);
        const blockHash = `0x${Buffer.from(keccak_256(headerBytes)).toString("hex")}`;
        artifact = { hashAlg: "sha256", digestB64: b64(sha256(utf8(blockHash))) };
        attribution = {
          name: "Ethereum Anchor",
          title: `https://etherscan.io/block/${blockNumber}`,
          message: blockHash,
        };
        files.push({
          path: `witnesses/witness-${String(globalAnchorIndex).padStart(4, "0")}.json`,
          content: JSON.stringify({
            version: "bitgraph-anchor-witness/1",
            headerRlpHex,
            blockNumber, // spec 10.2: a JSON number (non-negative integer)
            blockHash,
          }),
        });
        witnessCount++;
        anchorCount++;
        globalAnchorIndex++;
      } else {
        artifact = {
          hashAlg: "sha256",
          digestB64: b64(sha256(utf8(`bench-${epochId}-payload-${i}`))),
        };
      }

      const signedBody = {
        version: "bitgraph/1",
        artifact,
        commit,
        publicKeyB64,
        enforcement: "stub",
        measurement: MEASUREMENT,
        ...(attribution !== undefined ? { attribution } : {}),
      };
      const proof = {
        version: "bitgraph/1",
        artifact,
        commit,
        signer: { publicKeyB64, signatureB64: "" },
        environment: { enforcement: "stub", measurement: MEASUREMENT },
        ...(attribution !== undefined ? { attribution } : {}),
      };
      prevHash = computeProofHash(proof); // signature not part of the canonical hash
      entries.push({ proof, canonicalBytes: canonicalize(signedBody), index: i });
    }

    // Pass 2: real Ed25519 signatures, batched.
    for (let start = 0; start < entries.length; start += SIGN_BATCH) {
      const batch = entries.slice(start, start + SIGN_BATCH);
      const signatures = await Promise.all(
        batch.map((entry) => signAsync(entry.canonicalBytes, privateKey))
      );
      for (let j = 0; j < batch.length; j++) {
        batch[j].proof.signer.signatureB64 = b64(signatures[j]);
      }
    }

    for (const entry of entries) {
      files.push({
        path: `proofs/${epochId}/proof-${String(entry.index).padStart(6, "0")}.json`,
        content: JSON.stringify(entry.proof),
      });
    }
  }

  return { files, anchorCount, witnessCount };
}

// ---------------------------------------------------------------------------
// Bundle writers
// ---------------------------------------------------------------------------

async function writeDirectoryBundle(root, files) {
  const dirs = new Set();
  for (const file of files) {
    const dir = join(root, ...file.path.split("/").slice(0, -1));
    if (!dirs.has(dir)) {
      await mkdir(dir, { recursive: true });
      dirs.add(dir);
    }
  }
  const WRITE_BATCH = 200;
  for (let start = 0; start < files.length; start += WRITE_BATCH) {
    await Promise.all(
      files.slice(start, start + WRITE_BATCH).map((file) =>
        writeFile(
          join(root, ...file.path.split("/")),
          typeof file.content === "string" ? utf8(file.content) : file.content
        )
      )
    );
  }
}

function tarHeaderBlock(name, size) {
  const block = new Uint8Array(512);
  const ascii = (text, offset) => {
    const bytes = utf8(text);
    block.set(bytes, offset);
  };
  ascii(name, 0); // benchmark paths are all < 100 bytes
  ascii("0000644\0", 100);
  ascii("0000000\0", 108);
  ascii("0000000\0", 116);
  ascii(`${size.toString(8).padStart(11, "0")}\0`, 124);
  ascii("00000000000\0", 136);
  for (let i = 148; i < 156; i++) block[i] = 0x20;
  block[156] = "0".charCodeAt(0);
  ascii("ustar", 257);
  ascii("00", 263);
  let sum = 0;
  for (let i = 0; i < 512; i++) sum += block[i];
  ascii(sum.toString(8).padStart(6, "0"), 148);
  block[154] = 0;
  block[155] = 0x20;
  return block;
}

async function writeTarGzBundle(tarGzPath, files) {
  const gzip = createGzip();
  const out = createWriteStream(tarGzPath);
  gzip.pipe(out);
  const push = async (bytes) => {
    if (!gzip.write(bytes)) await once(gzip, "drain");
  };
  for (const file of files) {
    const content = typeof file.content === "string" ? utf8(file.content) : file.content;
    await push(tarHeaderBlock(file.path, content.length));
    await push(content);
    const pad = (512 - (content.length % 512)) % 512;
    if (pad > 0) await push(new Uint8Array(pad));
  }
  await push(new Uint8Array(1024));
  gzip.end();
  await once(out, "close");
}

// ---------------------------------------------------------------------------
// Benchmark
// ---------------------------------------------------------------------------

async function main() {
  console.log(
    `bitgraph-audit benchmark: ${PROOF_COUNT} proofs, ${EPOCH_COUNT} epochs, ` +
      `1 anchor per ${ANCHOR_EVERY} positions, seed 0x${SEED.toString(16)}`
  );
  console.log(`node ${process.version}, ${process.arch} ${process.platform}\n`);

  const root = await mkdtemp(join(tmpdir(), "bitgraph-audit-bench-"));
  const dirBundle = join(root, "bundle");
  const tarGzBundle = join(root, "bundle.tar.gz");

  try {
    console.log("generation:");
    const corpus = await stage("generate corpus (real signatures)", generateCorpus);
    console.log(
      `  corpus: ${PROOF_COUNT} proofs (${corpus.anchorCount} anchors), ` +
        `${corpus.witnessCount} witnesses, ${corpus.files.length} files`
    );
    await stage("write directory bundle", () => writeDirectoryBundle(dirBundle, corpus.files));
    await stage("write .tar.gz bundle", () => writeTarGzBundle(tarGzBundle, corpus.files));

    console.log("\nstaged pipeline (directory bundle):");
    const stagedStart = process.hrtime.bigint();
    const ingest = await stage("ingest", () => ingestBundle(dirBundle));
    const verification = await stage(`verify tiers (Ed25519 x ${PROOF_COUNT})`, () =>
      verifyObservedProofs(ingest)
    );
    const reconstruction = await stage("reconstruct chains", () => reconstructChains(ingest));
    const anomalies = await stage("classify anomalies", () =>
      classifyAnomalies(ingest, reconstruction)
    );
    const authorities = await stage("analyze authorities", async () => analyzeAuthorities(ingest));
    const anchors = await stage("identify anchors", async () => identifyAnchors(ingest));
    const witnesses = await stage("verify anchor witnesses", () =>
      verifyAnchorWitnesses(ingest, anchors)
    );
    const temporal = await stage("derive temporal bounds", async () =>
      deriveTemporalBounds(ingest, reconstruction, anchors, witnesses)
    );
    const attestations = await stage("validate attestations", () =>
      validateAttestations(ingest, authorities)
    );
    const stagedPipelineMs = Number(process.hrtime.bigint() - stagedStart) / 1e6;

    const stagedResult = {
      runMetadata: {
        toolVersion: "bench",
        startedAt: new Date().toISOString(),
        bundlePath: dirBundle,
        container: ingest.container,
      },
      ingest,
      verification,
      reconstruction,
      anomalies,
      authorities,
      anchors,
      witnesses,
      temporal,
      attestations,
    };
    const report = await stage("build JSON report", async () => buildJsonReport(stagedResult));
    const reportJson = await stage("serialize JSON report", async () =>
      JSON.stringify(report, null, 2)
    );
    const markdown = await stage("build markdown report", async () =>
      buildMarkdownReport(stagedResult)
    );
    console.log(
      `  report sizes: JSON ${mib(Buffer.byteLength(reportJson))}, markdown ${mib(
        Buffer.byteLength(markdown)
      )}`
    );

    console.log("\nfull runAudit wall time (.tar.gz container):");
    const tgzStart = process.hrtime.bigint();
    const tgzResult = await stage("runAudit (.tar.gz)", () => runAudit(tarGzBundle));
    const tgzMs = Number(process.hrtime.bigint() - tgzStart) / 1e6;

    // -------------------------------------------------------------------
    // Sanity: the corpus is protocol-correct and must audit clean.
    // -------------------------------------------------------------------
    const problems = [];
    for (const [label, result] of [
      ["directory (staged)", stagedResult],
      ["tar.gz", tgzResult],
    ]) {
      if (result.ingest.counts.observed !== PROOF_COUNT)
        problems.push(`${label}: observed ${result.ingest.counts.observed} != ${PROOF_COUNT}`);
      if (result.verification.failed !== 0)
        problems.push(`${label}: ${result.verification.failed} verification failures`);
      if (result.verification.artifactUnavailable !== PROOF_COUNT)
        problems.push(`${label}: artifactUnavailable != ${PROOF_COUNT}`);
      if (result.anomalies.anomalies.length !== 0)
        problems.push(
          `${label}: ${result.anomalies.anomalies.length} chain anomalies (` +
            result.anomalies.anomalies.map((a) => a.code).join(", ") +
            ")"
        );
      if (result.authorities.anomalies.length !== 0)
        problems.push(`${label}: authority anomalies`);
      if (result.anchors.anchors.length !== corpus.anchorCount)
        problems.push(
          `${label}: anchors ${result.anchors.anchors.length} != ${corpus.anchorCount}`
        );
      if (result.temporal.verifiedAnchorProofHashes.length !== corpus.anchorCount)
        problems.push(`${label}: not every anchor witness verified`);
      const exit = computeExitFlags(result);
      if (exit.code !== 0) problems.push(`${label}: exit code ${exit.code} != 0`);
    }

    const finalRss = process.memoryUsage().rss;
    if (finalRss > peakRss) peakRss = finalRss;

    console.log("\nsummary:");
    console.log(`  proofs                         ${PROOF_COUNT}`);
    console.log(`  staged pipeline (directory)    ${secs(stagedPipelineMs)}  (${Math.round(PROOF_COUNT / (stagedPipelineMs / 1000))} proofs/sec)`);
    console.log(`  full runAudit (.tar.gz)        ${secs(tgzMs)}  (${Math.round(PROOF_COUNT / (tgzMs / 1000))} proofs/sec)`);
    console.log(`  peak RSS (whole process)       ${mib(peakRss)}`);
    console.log(`  final RSS                      ${mib(finalRss)}`);
    if (problems.length > 0) {
      console.error("\nSANITY FAILURES:");
      for (const problem of problems) console.error(`  - ${problem}`);
      process.exitCode = 1;
    } else {
      console.log("  sanity                         clean (exit 0 on both containers)");
    }
  } finally {
    clearInterval(sampler);
    await rm(root, { recursive: true, force: true });
  }
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
