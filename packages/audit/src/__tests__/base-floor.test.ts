// Copyright (c) 2024-2026 Argento Computing Inc.

/**
 * Base floors (enclave v10) in the audit.
 *
 * A proof made by enclave v10 signs its floor as commit.slotFloor, a Base
 * block, instead of an Ethereum anchor. The audit reads it through
 * signedFloorOf and gives the proof a NOT-BEFORE bound labelled Base, never a
 * not-after: a later proof's floor block can predate this proof. Floors count
 * toward an epoch's coverage but never order epochs. Bundles from before the
 * cutover must audit exactly as before, so the mixed case checks that the old
 * epoch's segments are the same with and without the new epoch beside them.
 *
 * The real fixtures are the v10 harness proofs over Base block #52,271,417
 * (src/__tests__/fuse3-fixtures/, the block's header saved beside them). The
 * synthetic proofs are signed here with throwaway keys, exactly as the
 * enclave signs (the canonical signed body), so they verify.
 *
 * Run, after `npm run build` in packages/audit:
 *   node --test packages/audit/src/__tests__/base-floor.test.ts
 */
import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { mkdtemp, mkdir, writeFile, rm, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { getPublicKeyAsync, signAsync } from "@noble/ed25519";
import { sha256 } from "@noble/hashes/sha256";
import { keccak_256 } from "@noble/hashes/sha3";
import {
  BASE_MAINNET_GENESIS_TIME, assembleCarrierV3Payload, buildCarrier, buildSignedBody, canonicalize, computeChainHash,
  computeProofHash, type BitGraphProof,
} from "@mikeargento/bitgraph-verify";
import { buildJsonReport, buildMarkdownReport, computeExitFlags, runAudit, FLOOR_HEADER_VERSION } from "@mikeargento/bitgraph-audit";
import type { AuditResult, TemporalSegment } from "@mikeargento/bitgraph-audit";

const here = dirname(fileURLToPath(import.meta.url));
const FIX = join(here, "../../../../src/__tests__/fuse3-fixtures");
const CLI = join(here, "../../dist/cli.js");
const HEADER = readFileSync(join(FIX, "floor-base-52271417.rlp.hex"), "utf8").trim();
const BLOCK = 52271417;
const BLOCK_HASH = "0x71d926aeae9847fcc15fad2d4de8871923f56862d42db7a7463e95a838f8f9b0";
const BLOCK_TIME = 1791332181;
const realProof = (name: string): string => readFileSync(join(FIX, name), "utf8");
const realHash = (name: string): string => computeProofHash(JSON.parse(realProof(name)));

const b64 = (u: Uint8Array): string => Buffer.from(u).toString("base64");
const hex = (u: Uint8Array): string => `0x${Buffer.from(u).toString("hex")}`;
const utf8 = (s: string): Uint8Array => new TextEncoder().encode(s);
const scheduled = (n: number): number => BASE_MAINNET_GENESIS_TIME + 2 * n;

interface Key { priv: Uint8Array; pub: string }
async function key(seed: string): Promise<Key> {
  const priv = sha256(utf8(`base-floor audit test key ${seed} (TEST ONLY)`));
  return { priv, pub: b64(await getPublicKeyAsync(priv)) };
}

interface Minted { proof: BitGraphProof; proofHash: string; chainHash: string }

async function sign(k: Key, artifactBytes: Uint8Array, commit: Record<string, unknown>, attribution?: Record<string, string>): Promise<Minted> {
  const proof = {
    version: "bitgraph/1",
    artifact: { hashAlg: "sha256", digestB64: b64(sha256(artifactBytes)) },
    commit: { nonceB64: b64(sha256(utf8(`nonce ${JSON.stringify(commit)}`))), ...commit },
    signer: { publicKeyB64: k.pub, signatureB64: "" },
    environment: { enforcement: "stub", measurement: "test-measurement-base-floor" },
    ...(attribution !== undefined ? { attribution } : {}),
  } as unknown as BitGraphProof;
  proof.signer.signatureB64 = b64(await signAsync(canonicalize(buildSignedBody(proof) as never), k.priv));
  return { proof, proofHash: computeProofHash(proof), chainHash: computeChainHash(proof) };
}

function baseFloor(blockNumber: number, opts?: { hash?: string; time?: number }): Record<string, unknown> {
  return {
    chain: "base",
    evmChainId: 8453,
    blockNumber,
    blockHash: opts?.hash ?? hex(sha256(utf8(`base block ${blockNumber}`))),
    blockTimestamp: opts?.time ?? scheduled(blockNumber),
  };
}

/** A user proof whose floor is a Base block (enclave v10). */
async function baseProof(k: Key, epochId: string, slot: string, counter: string, floor: Record<string, unknown>, prevB64?: string, extra?: Record<string, unknown>): Promise<Minted> {
  return sign(k, utf8(`base ${epochId} ${counter}`), {
    counter, slotCounter: slot, ...(prevB64 !== undefined ? { prevB64 } : {}), epochId, slotFloor: floor, chainId: "bitgraph:main", ...(extra ?? {}),
  });
}

// --- the old world: an Ethereum anchor and its witness ---------------------

function rlp(item: Uint8Array | Uint8Array[]): Uint8Array {
  const len = (n: number, off: number): number[] => {
    if (n <= 55) return [off + n];
    const b: number[] = [];
    for (let v = n; v > 0; v = Math.floor(v / 256)) b.unshift(v & 0xff);
    return [off + 55 + b.length, ...b];
  };
  if (item instanceof Uint8Array) return item.length === 1 && item[0]! < 0x80 ? item : new Uint8Array([...len(item.length, 0x80), ...item]);
  const body = item.flatMap((i) => [...rlp(i)]);
  return new Uint8Array([...len(body.length, 0xc0), ...body]);
}
function be(n: number): Uint8Array {
  const b: number[] = [];
  for (let v = n; v > 0; v = Math.floor(v / 256)) b.unshift(v & 0xff);
  return new Uint8Array(b);
}
function ethHeader(blockNumber: number, timestamp: number): { rlpHex: string; hash: string } {
  const items: Uint8Array[] = [];
  for (let i = 0; i < 20; i++) items.push(i === 8 ? be(blockNumber) : i === 11 ? be(timestamp) : new Uint8Array(32).fill(i + 1));
  const bytes = rlp(items);
  return { rlpHex: hex(bytes), hash: hex(keccak_256(bytes)) };
}

async function anchorProof(k: Key, epochId: string, slot: string, counter: string, blockNumber: number, blockHash: string, prevB64?: string): Promise<Minted> {
  return sign(k, utf8(blockHash), { counter, slotCounter: slot, ...(prevB64 !== undefined ? { prevB64 } : {}), epochId, chainId: "bitgraph:main" }, {
    name: "Ethereum Anchor", title: `https://etherscan.io/block/${blockNumber}`, message: blockHash,
  });
}
async function userProof(k: Key, epochId: string, slot: string, counter: string, prevB64?: string): Promise<Minted> {
  return sign(k, utf8(`user ${epochId} ${counter}`), { counter, slotCounter: slot, ...(prevB64 !== undefined ? { prevB64 } : {}), epochId, chainId: "bitgraph:main" });
}

// --- bundles ----------------------------------------------------------------

const dirs: string[] = [];
async function bundle(files: Record<string, string>): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "audit-base-floor-"));
  dirs.push(dir);
  for (const [path, content] of Object.entries(files)) {
    await mkdir(dirname(join(dir, path)), { recursive: true });
    await writeFile(join(dir, path), content);
  }
  return dir;
}
after(async () => {
  for (const d of dirs) await rm(d, { recursive: true, force: true });
});

const json = (m: Minted): string => JSON.stringify(m.proof, null, 2);
const floorHeaderFile = (header = HEADER, extra?: Record<string, unknown>): string =>
  JSON.stringify({ version: FLOOR_HEADER_VERSION, chain: "base", evmChainId: 8453, blockNumber: BLOCK, blockHash: BLOCK_HASH, blockTimestamp: BLOCK_TIME, header, ...(extra ?? {}) });

function segmentOf(r: AuditResult, proofHash: string): TemporalSegment {
  const s = r.temporal.segments.find((x) => x.memberProofHashes.includes(proofHash));
  assert.ok(s, `proof ${proofHash} lands in a segment`);
  return s;
}

// ---------------------------------------------------------------------------

describe("a Base floor bounds its proof not-before, labelled Base", () => {
  test("real v10 harness proofs with the floor header: a checked not-before on Base block 52,271,417, no not-after", async () => {
    const dir = await bundle({
      "proofs/trailer3.json": realProof("trailer3.proof.json"),
      "proofs/made3.json": realProof("made3.proof.json"),
      "base-floor/floor-header.json": floorHeaderFile(),
    });
    const r = await runAudit(dir);
    assert.equal(r.temporal.floorProblems, undefined, "no floor problem");
    const floors = r.temporal.signedFloors ?? [];
    assert.equal(floors.length, 2);
    for (const f of floors) {
      assert.equal(f.chain, "base");
      assert.equal(f.blockNumber, BLOCK);
      assert.equal(f.blockHash, BLOCK_HASH);
      assert.equal(f.header, "checked");
      assert.equal(f.headerPath, "base-floor/floor-header.json");
      assert.equal(f.bound, "not-before");
    }
    for (const name of ["trailer3.proof.json", "made3.proof.json"]) {
      const seg = segmentOf(r, realHash(name));
      assert.equal(seg.upperBounds.length, 0, "a floor never gives a not-after");
      const b = seg.lowerBounds[0]!;
      assert.equal(b.kind, "not-before");
      assert.equal(b.source, "signed-floor");
      assert.equal(b.chain, "base");
      assert.equal(b.timeSource, "header");
      assert.equal(b.blockNumber, String(BLOCK));
      assert.equal(b.timestamp, BLOCK_TIME);
      assert.equal(b.basis, "block-hash-unpredictability");
      assert.equal(b.boundClass, "evidence");
      assert.equal(b.weaker, false);
      assert.match(b.claim, /Base block 52271417/);
      assert.doesNotMatch(b.claim, /Ethereum/);
      assert.doesNotMatch(b.claim, /[–—]/, "no dashes in report copy");
    }
    // made3 follows trailer3 in the chain? Either way its own floor is the bound.
    assert.equal(segmentOf(r, realHash("made3.proof.json")).lowerBounds.some((b) => b.evidence === "signed-floor"), true);
    // Epoch coverage counts both as floored.
    const epoch = r.reconstruction.epochRelationships.epochs[0]!;
    const nb = (epoch.anchorBounds ?? []).find((b) => b.kind === "not-before");
    assert.ok(nb, "the epoch has a not-before");
    assert.equal(nb.source, "signed-floor");
    assert.equal(nb.chain, "base");
    assert.equal(nb.coveredProofCount, 2);
    assert.equal((epoch.anchorBounds ?? []).some((b) => b.kind === "not-after"), false);
    assert.equal(computeExitFlags(r).chainAnomaliesOrDivergences && (r.temporal.floorProblems ?? []).length > 0, false);
    const report = buildJsonReport(r);
    assert.deepEqual(report.summary.temporal.baseFloors, { signed: 2, bounding: 2, headersChecked: 2, withheld: 0, problems: 0 });
    const md = buildMarkdownReport(r);
    assert.match(md, /2 proofs sign a Base block as their floor/);
    assert.match(md, /Base block 52,271,417/);
    assert.doesNotMatch(md, /this report makes no wall-clock claims/);
  });

  test("without the header: the time is the signed one, and the bound says it needs a Base lookup", async () => {
    const dir = await bundle({ "proofs/made3.json": realProof("made3.proof.json") });
    const r = await runAudit(dir);
    const f = r.temporal.signedFloors![0]!;
    assert.equal(f.header, "not-carried");
    assert.equal(f.bound, "not-before");
    const b = segmentOf(r, realHash("made3.proof.json")).lowerBounds[0]!;
    assert.equal(b.timeSource, "signed");
    assert.equal(b.timestamp, BLOCK_TIME);
    assert.match(b.claim, /needs a Base lookup/);
  });

  test("no not-after is invented from a later proof's floor, even when that floor is older", async () => {
    const k = await key("chain");
    // B2 follows B1 in the chain but signs an OLDER Base block: its floor
    // says nothing about B1, and B1 gets no upper bound from it.
    const b1 = await baseProof(k, "E-base", "1", "2", baseFloor(52_000_100));
    const b2 = await baseProof(k, "E-base", "3", "4", baseFloor(52_000_000), b1.chainHash);
    const b3 = await baseProof(k, "E-base", "5", "6", baseFloor(52_000_200), b2.chainHash);
    const r = await runAudit(await bundle({ "b1.json": json(b1), "b2.json": json(b2), "b3.json": json(b3) }));
    for (const seg of r.temporal.segments) {
      assert.equal(seg.upperBounds.length, 0, "no segment carries a not-after");
      assert.equal(seg.status, "lower-bounded");
    }
    const s1 = segmentOf(r, b1.proofHash);
    assert.equal(s1.lowerBounds[0]!.timestamp, scheduled(52_000_100));
    assert.equal(s1.lowerBounds[0]!.evidence, "signed-floor");
    // B2's tightest not-before is B1's floor, reached by the hash link (it is later than B2's own).
    const s2 = segmentOf(r, b2.proofHash);
    assert.equal(s2.lowerBounds[0]!.timestamp, scheduled(52_000_100));
    assert.equal(s2.lowerBounds[0]!.evidence, "chain-link");
    assert.equal(s2.lowerBounds[0]!.anchorProofHash, b1.proofHash);
    // B3's own floor is the latest.
    assert.equal(segmentOf(r, b3.proofHash).lowerBounds[0]!.evidence, "signed-floor");
    const epoch = r.reconstruction.epochRelationships.epochs[0]!;
    assert.equal((epoch.anchorBounds ?? []).some((b) => b.kind === "not-after"), false);
    assert.equal(r.temporal.anchorOrderedPairs.length, 0);
  });
});

describe("a bundle mixing Ethereum-anchored and Base-floored proofs", () => {
  let oldOnly: AuditResult;
  let mixed: AuditResult;
  const h: Record<string, Minted> = {};
  const T_ANCHOR = 1_700_000_000;

  before(async () => {
    const k1 = await key("old epoch");
    const k2 = await key("new epoch");
    const H = ethHeader(100, T_ANCHOR);
    h.p1 = await userProof(k1, "E-old", "1", "2");
    h.a1 = await anchorProof(k1, "E-old", "3", "4", 100, H.hash, h.p1.chainHash);
    h.p2 = await userProof(k1, "E-old", "5", "6", h.a1.chainHash);
    h.b1 = await baseProof(k2, "E-new", "1", "2", baseFloor(52_100_000));
    h.b2 = await baseProof(k2, "E-new", "3", "4", baseFloor(52_100_010), h.b1.chainHash);
    const old = {
      "old/p1.json": json(h.p1), "old/a1.json": json(h.a1), "old/p2.json": json(h.p2),
      "old/a1.witness.json": JSON.stringify({ version: "bitgraph-anchor-witness/1", headerRlpHex: H.rlpHex, blockNumber: 100, blockHash: H.hash }),
    };
    oldOnly = await runAudit(await bundle(old));
    mixed = await runAudit(await bundle({ ...old, "new/b1.json": json(h.b1), "new/b2.json": json(h.b2) }));
  });

  test("the old epoch's bounds are exactly what they are without the new epoch beside it", () => {
    const oldSegs = (r: AuditResult) => r.temporal.segments.filter((s) => s.partition.epochId === "E-old");
    assert.deepEqual(oldSegs(mixed), oldSegs(oldOnly));
    const p2 = segmentOf(mixed, h.p2!.proofHash).lowerBounds[0]!;
    assert.equal(p2.source, undefined, "an anchor bound carries no source");
    assert.equal(p2.chain, undefined, "an anchor bound is Ethereum");
    assert.equal(p2.anchorProofHash, h.a1!.proofHash);
    assert.equal(p2.timestamp, T_ANCHOR);
    assert.equal(segmentOf(mixed, h.p1!.proofHash).upperBounds[0]!.anchorProofHash, h.a1!.proofHash);
    const eOld = (r: AuditResult) => r.reconstruction.epochRelationships.epochs.find((e) => e.epochId === "E-old")!.anchorBounds;
    assert.deepEqual(eOld(mixed), eOld(oldOnly));
  });

  test("the new epoch is floored on Base, and floors order no epoch", () => {
    for (const m of [h.b1!, h.b2!]) {
      const b = segmentOf(mixed, m.proofHash).lowerBounds[0]!;
      assert.equal(b.chain, "base");
      assert.equal(b.source, "signed-floor");
    }
    const eNew = mixed.reconstruction.epochRelationships.epochs.find((e) => e.epochId === "E-new")!;
    const nb = eNew.anchorBounds!.find((b) => b.kind === "not-before")!;
    assert.equal(nb.chain, "base");
    assert.equal(nb.coveredProofCount, 2);
    assert.match(nb.claim!, /orders no epoch/);
    // The old epoch has a not-after (an anchor followed P1) earlier than every
    // Base floor, yet no pair is claimed: the after side reads anchors only.
    assert.equal(mixed.temporal.anchorOrderedPairs.length, 0);
    const report = buildJsonReport(mixed);
    assert.equal(report.summary.temporal.anchorsIdentified, 1);
    assert.equal(report.summary.temporal.baseFloors?.signed, 2);
    const md = buildMarkdownReport(mixed);
    assert.match(md, /1 Ethereum anchor proof was/);
    assert.match(md, /2 proofs sign a Base block as their floor/);
  });
});

describe("floor problems are reported, never silently bounded (exit bit 2)", () => {
  test("a proof that signs both an Ethereum anchor and a Base floor", async () => {
    const k = await key("both");
    const both = await baseProof(k, "E-both", "1", "2", baseFloor(52_200_000), undefined, {
      slotAnchor: { counter: "0", blockNumber: 25_000_000, blockHash: hex(sha256(utf8("eth block"))) },
    });
    const r = await runAudit(await bundle({ "both.json": json(both) }));
    const problems = r.temporal.floorProblems ?? [];
    assert.equal(problems.length, 1);
    assert.equal(problems[0]!.code, "floor-ambiguous");
    assert.equal(problems[0]!.proofHash, both.proofHash);
    assert.equal(r.temporal.signedFloors, undefined, "nothing is read from it as a floor");
    assert.equal(segmentOf(r, both.proofHash).lowerBounds.length, 0);
    assert.equal(computeExitFlags(r).code & 2, 2);
    assert.match(buildMarkdownReport(r), /floor-ambiguous/);
  });

  test("a Base floor off Base mainnet's schedule", async () => {
    const k = await key("schedule");
    const off = await baseProof(k, "E-off", "1", "2", baseFloor(52_200_000, { time: scheduled(52_200_000) + 1 }));
    const r = await runAudit(await bundle({ "off.json": json(off) }));
    assert.equal(r.temporal.floorProblems?.[0]?.code, "floor-off-schedule");
    assert.equal(r.temporal.signedFloors?.[0]?.bound, "withheld");
    assert.equal(segmentOf(r, off.proofHash).lowerBounds.length, 0);
    assert.equal(computeExitFlags(r).code & 2, 2);
  });

  test("a slotFloor that does not name Base mainnet", async () => {
    const k = await key("chain id");
    const wrong = await baseProof(k, "E-wrong", "1", "2", { ...baseFloor(52_200_000), evmChainId: 84532 });
    const r = await runAudit(await bundle({ "wrong.json": json(wrong) }));
    assert.equal(r.temporal.floorProblems?.[0]?.code, "floor-malformed");
    assert.equal(segmentOf(r, wrong.proofHash).lowerBounds.length, 0);
  });

  test("a floor header for the signed hash that carries another number contradicts the proof", async () => {
    const k = await key("header");
    // Signs the real block's hash at the wrong height (on schedule for that height).
    const liar = await baseProof(k, "E-liar", "1", "2", baseFloor(BLOCK + 1, { hash: BLOCK_HASH }));
    const r = await runAudit(await bundle({ "liar.json": json(liar), "floor.json": floorHeaderFile() }));
    const p = (r.temporal.floorProblems ?? []).find((x) => x.code === "floor-header-mismatch");
    assert.ok(p, "the mismatch is a problem");
    assert.equal(p.proofHash, liar.proofHash);
    assert.equal(r.temporal.signedFloors?.[0]?.bound, "withheld");
    assert.equal(segmentOf(r, liar.proofHash).lowerBounds.length, 0);
    assert.equal(computeExitFlags(r).code & 2, 2);
  });

  test("a floor header that hashes to another block than it names, and one no proof signs", async () => {
    const tampered = HEADER.slice(0, -2) + (HEADER.endsWith("0") ? "1" : "0");
    const r1 = await runAudit(await bundle({ "proofs/made3.json": realProof("made3.proof.json"), "h.json": floorHeaderFile(tampered) }));
    assert.ok((r1.temporal.floorProblems ?? []).some((p) => p.code === "floor-header-mismatch" || p.code === "floor-header-malformed"));
    assert.equal(r1.temporal.signedFloors?.[0]?.header, "not-carried", "a tampered header never checks the floor");
    const r2 = await runAudit(await bundle({ "h.json": floorHeaderFile() }));
    assert.equal(r2.temporal.floorProblems?.[0]?.code, "floor-header-unmatched");
    assert.equal(computeExitFlags(r2).code & 2, 2);
  });
});

describe("bitgraph-carrier/3 through the CLI", () => {
  test("the Base floor header is unpacked, checked and reported; no closing anchor is asked for", async () => {
    const k = await key("carrier");
    const inner = utf8("a BitGraphed file's committed bytes\n");
    const floor = JSON.parse(realProof("trailer3.proof.json")).commit.slotFloor as Record<string, unknown>;
    const minted = await sign(k, inner, { counter: "2", slotCounter: "1", epochId: "E-carrier", slotFloor: floor, chainId: "bitgraph:main" });
    const payload = assembleCarrierV3Payload({
      proof: minted.proof as never,
      floor: { status: "present", basis: "base-header", header: HEADER },
      ceilingInTime: { status: "unfetched" },
    });
    const dir = await bundle({});
    const file = join(dir, "note.bitgraph.txt");
    await writeFile(file, buildCarrier(inner, payload));
    const out = join(dir, "out");
    const run = spawnSync(process.execPath, [CLI, file, "--out", out, "--format", "json"], { encoding: "utf8" });
    assert.ok(run.status === 0 || run.status === 1 || run.status === 2 || run.status === 3, `ran (${run.status}): ${run.stderr}`);
    assert.match(run.stdout, /no earlier than: Base block 52271417/);
    assert.match(run.stdout, /no ceiling in position/);
    assert.doesNotMatch(run.stdout, /closing anchor/);
    assert.doesNotMatch(run.stdout, /floor PROBLEM/);
    const report = JSON.parse(await readFile(join(out, "audit-report.json"), "utf8"));
    const f = report.temporal.signedFloors[0];
    assert.equal(f.header, "checked");
    assert.equal(f.headerPath, "base-floor/floor-header.json");
    assert.equal(f.bound, "not-before");
    assert.equal(report.anchors.records.length, 0, "no anchor proof stands under a /3 floor");
    assert.equal(report.temporal.segments[0].lowerBounds[0].chain, "base");
  });

  test("--help names the /3 layout", () => {
    const run = spawnSync(process.execPath, [CLI, "--help"], { encoding: "utf8" });
    assert.equal(run.status, 0);
    assert.match(run.stdout, /base-floor\/floor-header\.json/);
    assert.match(run.stdout, /bitgraph-floor-header\/1/);
    assert.doesNotMatch(run.stdout, /[–—]/);
  });
});
