// Copyright (c) Mike Argento. All rights reserved. See LICENSE.

/**
 * Export round trip (Phase 5, mandatory per the build brief): a synthetic
 * epoch (real signed chain, an interleaved Ethereum anchor, and a valid
 * offline witness) goes through the archive builder, the resulting .tar.gz
 * goes through the full audit pipeline, and the report must come back
 * completely clean. Also covers the open-epoch snapshot manifest round
 * trip, builder determinism, and conformance of the website's independent
 * export assembly (website/src/lib/export-epoch.ts, imported by a spawned
 * node process under type stripping) against the reference builder,
 * byte for byte.
 *
 * All data is synthetic and local. No network, no live ledger, ever.
 */

import { describe, it, before } from "node:test";
import * as assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { keccak_256 } from "@noble/hashes/sha3";
import type { BitGraphProof } from "@mikeargento/bitgraph-verify";
import {
  buildBundleArchive,
  runAudit,
  computeExitFlags,
  buildJsonReport,
  type AuditResult,
  type BundleArchiveInput,
} from "@mikeargento/bitgraph-audit";
import {
  b64,
  utf8,
  makeCounterChain,
  makeAnchorProof,
  makeEthereumHeader,
  makeTempDir,
  storedProofJson,
  type CounterChainLink,
} from "./audit-fixtures.js";

const execFileAsync = promisify(execFile);

const EPOCH_ID = "epoch-roundtrip-1";
const CHAIN_ID = "bitgraph:main";
const MEASUREMENT = "test-measurement-roundtrip";
const GENERATED_AT = "2026-07-10T00:00:00Z";
const BLOCK_NUMBER = 987654;
const BLOCK_TIMESTAMP = 1_720_000_000;

const pad12 = (counter: string): string => counter.padStart(12, "0");
const toSafe = (value: string): string => value.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

interface SyntheticEpoch {
  /** The four user proofs, chain order. */
  userProofs: CounterChainLink[];
  /** The anchor proof, an ordinary member of the same chain (slot 5 / commit 6). */
  anchor: { proof: BitGraphProof; proofHash: string };
  blockHash: string;
  witness: Record<string, unknown>;
  /** All five members in chain order. */
  members: Array<{ proof: BitGraphProof; proofHash: string }>;
}

/**
 * One epoch, one signer, one chain, enclave-shaped counters:
 * user proofs at slot/commit 1/2 and 3/4, an Ethereum anchor at 5/6, then
 * user proofs at 7/8 and 9/10, all prevB64-linked into one intact chain.
 * The anchor's block hash is the Keccak-256 of a synthetic RLP header, so
 * the witness verifies fully offline.
 */
async function makeSyntheticEpoch(): Promise<SyntheticEpoch> {
  const part1 = await makeCounterChain({
    epochId: EPOCH_ID,
    pairs: [
      { slot: "1", commit: "2" },
      { slot: "3", commit: "4" },
    ],
    chainId: CHAIN_ID,
    measurement: MEASUREMENT,
    payloadPrefix: "rt-part1",
  });

  const { headerBytes, headerRlpHex } = makeEthereumHeader({
    blockNumber: BLOCK_NUMBER,
    timestamp: BLOCK_TIMESTAMP,
  });
  const blockHash = `0x${Buffer.from(keccak_256(headerBytes)).toString("hex")}`;
  const anchor = await makeAnchorProof({
    blockHash,
    blockNumber: BLOCK_NUMBER,
    key: part1.key,
    epochId: EPOCH_ID,
    counter: "6",
    slotCounter: "5",
    prevB64: part1.proofs[1]!.proofHash,
    chainId: CHAIN_ID,
    measurement: MEASUREMENT,
  });

  const part2 = await makeCounterChain({
    epochId: EPOCH_ID,
    pairs: [
      { slot: "7", commit: "8" },
      { slot: "9", commit: "10" },
    ],
    key: part1.key,
    chainId: CHAIN_ID,
    measurement: MEASUREMENT,
    payloadPrefix: "rt-part2",
    prevB64OfFirst: anchor.proofHash,
  });

  const userProofs = [...part1.proofs, ...part2.proofs];
  const witness: Record<string, unknown> = {
    version: "bitgraph-anchor-witness/1",
    headerRlpHex,
    blockNumber: BLOCK_NUMBER,
    blockHash,
  };
  const members: Array<{ proof: BitGraphProof; proofHash: string }> = [
    ...part1.proofs.map((p) => ({ proof: p.proof, proofHash: p.proofHash })),
    { proof: anchor.proof, proofHash: anchor.proofHash },
    ...part2.proofs.map((p) => ({ proof: p.proof, proofHash: p.proofHash })),
  ];
  return { userProofs, anchor, blockHash, witness, members };
}

function builderInput(epoch: SyntheticEpoch, extras?: Partial<BundleArchiveInput>): BundleArchiveInput {
  return {
    proofs: epoch.userProofs.map((p) => ({ proof: p.proof as unknown as Record<string, unknown>, storedProofHash: p.proofHash })),
    anchors: [{ proof: epoch.anchor.proof as unknown as Record<string, unknown>, storedProofHash: epoch.anchor.proofHash }],
    witnesses: [{ path: `witnesses/${BLOCK_NUMBER}.json`, witness: epoch.witness }],
    artifactFiles: [
      ...epoch.userProofs.map((p, i) => ({ name: `payload-${i}.bin`, bytes: p.bytes })),
      { name: "anchor-block-hash.txt", bytes: utf8(epoch.blockHash) },
    ],
    epochIds: [EPOCH_ID],
    chainIds: [CHAIN_ID],
    generatedAt: GENERATED_AT,
    ...extras,
  };
}

/** Every clean-report assertion in one place, shared by the variants. */
function assertCleanAudit(result: AuditResult, expected: { verified: number; artifactUnavailable: number; verifiedWitnesses?: number }): void {
  const expectedWitnesses = expected.verifiedWitnesses ?? 1;
  const flags = computeExitFlags(result);
  assert.equal(flags.code, 0, "exit flags must be 0 (clean)");

  assert.equal(result.ingest.counts.observed, 5);
  assert.equal(result.ingest.counts.unsupportedVersion, 0);
  assert.equal(result.ingest.counts.exactDuplicates, 0);
  assert.equal(result.ingest.counts.semanticDuplicates, 0);
  assert.deepEqual(result.ingest.findings, [], "zero ingest findings");

  assert.equal(result.verification.total, 5);
  assert.equal(result.verification.verified, expected.verified);
  assert.equal(result.verification.failed, 0);
  assert.equal(result.verification.artifactUnavailable, expected.artifactUnavailable);
  assert.equal(result.verification.chainless, 0);

  assert.deepEqual(result.anomalies.anomalies, [], "zero chain anomalies");
  assert.deepEqual(result.anomalies.divergences, [], "zero divergences");
  assert.deepEqual(result.authorities.anomalies, [], "zero authority anomalies");
  assert.deepEqual(result.anchors.findings, [], "zero anchor findings");
  assert.deepEqual(result.witnesses.findings, [], "zero witness findings");
  assert.deepEqual(result.attestations.findings, [], "zero attestation findings");

  // One partition, one intact component.
  assert.equal(result.reconstruction.partitions.length, 1);
  assert.equal(result.reconstruction.partitions[0]!.components.length, 1);
  assert.equal(result.reconstruction.partitions[0]!.components[0]!.memberProofHashes.length, 5);

  // Manifest: recognized, valid, contents hash verifies, counts match.
  const manifest = result.ingest.manifest;
  assert.ok(manifest, "manifest present");
  assert.equal(manifest.parsed, true);
  assert.equal(manifest.recognized, true);
  assert.deepEqual(manifest.problems, []);
  assert.ok(manifest.contentsHash, "manifest declared a contents hash");
  assert.equal(manifest.contentsHash.match, true, "manifest contents hash verifies");
  assert.equal(manifest.manifest!["proofCount"], result.ingest.counts.observed, "manifest proofCount matches observed");
  assert.deepEqual(manifest.manifest!["epochIds"], [EPOCH_ID]);
  assert.deepEqual(manifest.manifest!["chainIds"], [CHAIN_ID]);
  assert.deepEqual(manifest.manifest!["counterRanges"], [
    { epochId: EPOCH_ID, chainId: CHAIN_ID, min: "2", max: "10" },
  ]);

  // The anchor is identified from its signed attribution regardless of
  // witness presence. When the bundle carries a witness (the reference
  // builder variants), it verifies fully offline and yields the header
  // timestamp as evidence; website exports carry no witnesses because the
  // ledger stores neither witnesses nor artifacts.
  assert.equal(result.anchors.anchors.length, 1);
  assert.equal(result.anchors.anchors[0]!.blockNumber, String(BLOCK_NUMBER));
  const outcomes = result.witnesses.outcomes.filter((o) => o.verified);
  assert.equal(outcomes.length, expectedWitnesses, "verified witness outcomes");
  if (expectedWitnesses > 0) {
    assert.equal(outcomes[0]!.timestamp, BLOCK_TIMESTAMP);
    assert.equal(outcomes[0]!.blockNumber, String(BLOCK_NUMBER));
  }

  // Report-level verdicts.
  const report = buildJsonReport(result);
  assert.equal(report.summary.chainIntact, true, "chain intact");
  assert.deepEqual(report.summary.anomalyCountsByCode, {});
  assert.equal(report.summary.temporal.anchorsWithVerifiedWitness, expectedWitnesses);
  assert.equal(report.summary.exit.code, 0);
}

describe("export round trip: buildBundleArchive -> runAudit", () => {
  let epoch: SyntheticEpoch;
  before(async () => {
    epoch = await makeSyntheticEpoch();
  });

  it("closed-epoch archive with artifacts audits completely clean", async () => {
    const archive = buildBundleArchive(builderInput(epoch));
    const dir = await makeTempDir("bitgraph-roundtrip-closed-");
    const bundlePath = join(dir, "bundle.tar.gz");
    await writeFile(bundlePath, archive);

    const result = await runAudit(bundlePath);
    assertCleanAudit(result, { verified: 5, artifactUnavailable: 0 });
    assert.equal(result.ingest.container, "tar-gz");
    assert.equal(result.ingest.manifest!.manifest!["artifactsIncluded"], true);
    assert.equal(result.ingest.manifest!.manifest!["openEpochs"], undefined);
  });

  it("open-epoch snapshot: openEpochs round-trips through the manifest and audits clean", async () => {
    const openEpochs = [{ epochId: EPOCH_ID, counterAtSnapshot: "10" }];
    const archive = buildBundleArchive(builderInput(epoch, { openEpochs }));
    const dir = await makeTempDir("bitgraph-roundtrip-open-");
    const bundlePath = join(dir, "bundle.tar.gz");
    await writeFile(bundlePath, archive);

    const result = await runAudit(bundlePath);
    assertCleanAudit(result, { verified: 5, artifactUnavailable: 0 });
    assert.deepEqual(result.ingest.manifest!.manifest!["openEpochs"], openEpochs, "openEpochs round-trips");
  });

  it("is deterministic: the same input produces a byte-identical archive", () => {
    const a = buildBundleArchive(builderInput(epoch));
    const c = buildBundleArchive(builderInput(epoch));
    assert.ok(Buffer.from(a).equals(Buffer.from(c)), "two builds of the same input are byte-identical");
  });

  it("rejects producer-conformance violations deterministically", async () => {
    // Non-bitgraph/1 member.
    assert.throws(
      () =>
        buildBundleArchive({
          proofs: [{ proof: { version: "occ/1" } }],
          epochIds: [],
          chainIds: [],
        }),
      /only bitgraph\/1 proofs/
    );
    // storedProofHash disagreeing with the computed canonical hash.
    assert.throws(
      () =>
        buildBundleArchive({
          proofs: [{ proof: epoch.userProofs[0]!.proof as unknown as Record<string, unknown>, storedProofHash: "bm90LXRoZS1oYXNo" }],
          epochIds: [EPOCH_ID],
          chainIds: [CHAIN_ID],
        }),
      /storedProofHash does not match/
    );
    // Duplicate canonical identity.
    assert.throws(
      () =>
        buildBundleArchive({
          proofs: [
            { proof: epoch.userProofs[0]!.proof as unknown as Record<string, unknown> },
            { proof: epoch.userProofs[0]!.proof as unknown as Record<string, unknown> },
          ],
          epochIds: [EPOCH_ID],
          chainIds: [CHAIN_ID],
        }),
      /duplicate proof/
    );
    // Unsafe witness path.
    assert.throws(
      () =>
        buildBundleArchive({
          proofs: [{ proof: epoch.userProofs[0]!.proof as unknown as Record<string, unknown> }],
          witnesses: [{ path: "../escape.json", witness: {} }],
          epochIds: [EPOCH_ID],
          chainIds: [CHAIN_ID],
        }),
      /unsafe component/
    );
  });
});

// ---------------------------------------------------------------------------
// Website conformance: the independent assembly in
// website/src/lib/export-epoch.ts must produce a spec-conformant bundle,
// byte-identical to the reference builder for the same input. The website
// lib is imported by a SPAWNED node process under type stripping (it is
// self-contained: node builtins only), because the website's tsconfig and
// package scope are separate from the root project.
// ---------------------------------------------------------------------------

const WEBSITE_LIB_PATH = fileURLToPath(
  new URL("../../website/src/lib/export-epoch.ts", import.meta.url)
);

const RUNNER_SOURCE = `
const [configPath] = process.argv.slice(2);
const { readFile, writeFile } = await import("node:fs/promises");
const config = JSON.parse(await readFile(configPath, "utf8"));
const mod = await import(config.libUrl);
const source = {
  listProofKeys: async () => config.proofKeys,
  listAnchorKeys: async () => config.anchorKeys,
  getObjectText: async (key) => Object.hasOwn(config.objects, key) ? config.objects[key] : null,
  getCurrentEpochSafeId: async () => config.currentSafeId,
};
const result = await mod.exportEpoch(source, config.safeEpochId, config.generatedAt);
if (result === null) {
  console.error("exportEpoch returned null");
  process.exit(2);
}
await writeFile(config.outPath, result.archive);
await writeFile(config.metaPath, JSON.stringify({
  open: result.open,
  proofCount: result.proofCount,
  epochId: result.epochId,
  maxCounter: result.maxCounter,
  skipped: result.skipped,
}));
`;

interface WebsiteRun {
  archivePath: string;
  meta: { open: boolean; proofCount: number; epochId: string; maxCounter: string | null; skipped: number };
}

async function runWebsiteExport(epoch: SyntheticEpoch, opts: { open: boolean }): Promise<WebsiteRun> {
  const dir = await makeTempDir("bitgraph-roundtrip-website-");
  const safeEpoch = toSafe(EPOCH_ID);

  // The in-memory ledger view: stored-form proofs under proofs/{epoch}/,
  // plus the anchors/ index copy of the anchor (extra unsigned "ethereum"
  // field, no hash suffix in the key) that the exporter must dedup, never
  // mirror.
  const objects: Record<string, string> = {};
  const proofKeys: string[] = [];
  for (const member of epoch.members) {
    const counter = (member.proof.commit as { counter?: string }).counter ?? "0";
    const key = `proofs/${safeEpoch}/${pad12(counter)}-${toSafe(member.proofHash)}.json`;
    objects[key] = storedProofJson(member.proof, member.proofHash);
    proofKeys.push(key);
  }
  proofKeys.sort();
  const anchorIndexKey = `anchors/${safeEpoch}/${pad12("6")}.json`;
  objects[anchorIndexKey] = JSON.stringify({
    ...(JSON.parse(storedProofJson(epoch.anchor.proof, epoch.anchor.proofHash)) as Record<string, unknown>),
    ethereum: { blockNumber: BLOCK_NUMBER, blockHash: epoch.blockHash },
  });

  const runnerPath = join(dir, "runner.mjs");
  const configPath = join(dir, "config.json");
  const outPath = join(dir, "website-export.tar.gz");
  const metaPath = join(dir, "meta.json");
  await writeFile(runnerPath, RUNNER_SOURCE);
  await writeFile(
    configPath,
    JSON.stringify({
      libUrl: pathToFileURL(WEBSITE_LIB_PATH).href,
      safeEpochId: safeEpoch,
      currentSafeId: opts.open ? safeEpoch : "some-other-epoch",
      generatedAt: GENERATED_AT,
      proofKeys,
      anchorKeys: [anchorIndexKey],
      objects,
      outPath,
      metaPath,
    })
  );

  await execFileAsync(process.execPath, [runnerPath, configPath]);
  const meta = JSON.parse(await readFile(metaPath, "utf8")) as WebsiteRun["meta"];
  return { archivePath: outPath, meta };
}

describe("export round trip: website export-epoch conformance", () => {
  let epoch: SyntheticEpoch;
  before(async () => {
    epoch = await makeSyntheticEpoch();
  });

  it("closed-epoch website export is byte-identical to the reference builder and audits clean", async () => {
    const { archivePath, meta } = await runWebsiteExport(epoch, { open: false });
    assert.equal(meta.open, false);
    assert.equal(meta.proofCount, 5);
    assert.equal(meta.epochId, EPOCH_ID);
    assert.equal(meta.maxCounter, "10");
    // Exactly one skip: the anchors/ index copy, deduped by stored proofHash.
    assert.equal(meta.skipped, 1);

    const websiteArchive = await readFile(archivePath);

    // Reference builder, same input: all five members under proofs/ (the
    // website exports the proofs/ listing, where anchors already live), no
    // witnesses or artifacts (the ledger stores neither).
    const reference = buildBundleArchive({
      proofs: epoch.members.map((m) => ({ proof: m.proof as unknown as Record<string, unknown>, storedProofHash: m.proofHash })),
      epochIds: [EPOCH_ID],
      chainIds: [CHAIN_ID],
      generatedAt: GENERATED_AT,
    });
    assert.ok(
      websiteArchive.equals(Buffer.from(reference)),
      "website assembly is byte-identical to the reference builder for the same input"
    );

    const result = await runAudit(archivePath);
    // No artifact bytes in a ledger export: every member is
    // artifact-unavailable at the integrity tier, and that is not a failure.
    assertCleanAudit(result, { verified: 0, artifactUnavailable: 5, verifiedWitnesses: 0 });
    assert.equal(result.ingest.manifest!.manifest!["artifactsIncluded"], false);
    assert.equal(result.ingest.manifest!.manifest!["openEpochs"], undefined);
  });

  it("open-epoch website export carries the openEpochs snapshot and audits clean", async () => {
    const { archivePath, meta } = await runWebsiteExport(epoch, { open: true });
    assert.equal(meta.open, true);

    const result = await runAudit(archivePath);
    assertCleanAudit(result, { verified: 0, artifactUnavailable: 5, verifiedWitnesses: 0 });
    assert.deepEqual(result.ingest.manifest!.manifest!["openEpochs"], [
      { epochId: EPOCH_ID, counterAtSnapshot: "10" },
    ]);
  });
});
