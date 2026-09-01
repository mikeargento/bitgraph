// Copyright (c) Mike Argento. All rights reserved. See LICENSE.

/**
 * Tests for the bitgraph-audit CLI: spawns the built packages/audit
 * dist/cli.js with node against temp-dir bundles and asserts the written
 * report files, the bit-flag exit codes (0 clean, 1 verification
 * failures including unsupported-version, 2 chain anomalies or
 * divergences, 3 both, 64 usage error), format selection, trust-policy
 * key validation, and the --help exit-code documentation.
 */

import { describe, it, before, after } from "node:test";
import * as assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  healthyPairs,
  makeAnchorProof,
  makeCounterChain,
  makeEthereumHeader,
  makeStandardAuditBundle,
  makeTempDir,
  proofJson,
  signBody,
  utf8,
  witnessJson,
  writeBundleDir,
  b64,
  type StandardAuditBundle,
} from "./audit-fixtures.js";
import { sha256 } from "@noble/hashes/sha256";
import { keccak_256 } from "@noble/hashes/sha3";
import { computeProofHash } from "@mikeargento/bitgraph-verify";
import type { BitGraphProof } from "@mikeargento/bitgraph-verify";

const CLI_PATH = fileURLToPath(
  new URL("../../packages/audit/dist/cli.js", import.meta.url)
);

function runCli(args: string[]): { status: number; stdout: string; stderr: string } {
  const spawned = spawnSync(process.execPath, [CLI_PATH, ...args], { encoding: "utf8" });
  return {
    status: spawned.status ?? -1,
    stdout: spawned.stdout ?? "",
    stderr: spawned.stderr ?? "",
  };
}

describe("bitgraph-audit CLI", () => {
  const tempDirs: string[] = [];
  let mixed: StandardAuditBundle;
  let cleanDir: string;
  let rejectOnlyDir: string;
  let forkOnlyDir: string;

  before(async () => {
    // Mixed bundle: gap + fork (bit 2) and an occ/1 reject (bit 1).
    mixed = await makeStandardAuditBundle();
    tempDirs.push(mixed.dir);

    // Clean bundle: healthy chain with every artifact present.
    cleanDir = await makeTempDir("bitgraph-audit-cli-clean-");
    tempDirs.push(cleanDir);
    const clean = await makeCounterChain({
      epochId: "epoch-cli-clean",
      pairs: healthyPairs(2),
      chainId: "bitgraph:main",
      payloadPrefix: "cli-clean",
    });
    await writeBundleDir(cleanDir, {
      "proofs/a.json": proofJson(clean.proofs[0]!.proof),
      "proofs/b.json": proofJson(clean.proofs[1]!.proof),
      "artifacts/a.bin": clean.proofs[0]!.bytes,
      "artifacts/b.bin": clean.proofs[1]!.bytes,
    });

    // Reject-only bundle: a single occ/1 proof-shaped file.
    rejectOnlyDir = await makeTempDir("bitgraph-audit-cli-reject-");
    tempDirs.push(rejectOnlyDir);
    await writeBundleDir(rejectOnlyDir, {
      "old.json": JSON.stringify({
        version: "occ/1",
        artifact: { hashAlg: "sha256", digestB64: "b2NjLWxlZ2FjeQ==" },
        commit: { nonceB64: "b2NjLW5vbmNl" },
        signer: { publicKeyB64: "b2NjLWtleQ==", signatureB64: "b2NjLXNpZw==" },
      }),
    });

    // Fork-only bundle: valid proofs, one predecessor consumed twice.
    forkOnlyDir = await makeTempDir("bitgraph-audit-cli-fork-");
    tempDirs.push(forkOnlyDir);
    const base = await makeCounterChain({
      epochId: "epoch-cli-fork",
      pairs: healthyPairs(2),
      chainId: "bitgraph:main",
      payloadPrefix: "cli-fork",
    });
    const tail = base.proofs[1]!;
    const forkChild = async (slot: string, commit: string, payload: string) => {
      const bytes = utf8(payload);
      const commitBody: BitGraphProof["commit"] = {
        nonceB64: b64(crypto.getRandomValues(new Uint8Array(16))),
        counter: commit,
        slotCounter: slot,
        prevB64: tail.chainHash,
        epochId: "epoch-cli-fork",
      };
      (commitBody as unknown as Record<string, unknown>)["chainId"] = "bitgraph:main";
      const proof = await signBody(
        base.key,
        { hashAlg: "sha256", digestB64: b64(sha256(bytes)) },
        commitBody,
        "test-measurement-chain"
      );
      return { proof, proofHash: computeProofHash(proof) };
    };
    const childA = await forkChild("5", "6", "cli-fork-a");
    const childB = await forkChild("7", "8", "cli-fork-b");
    await writeBundleDir(forkOnlyDir, {
      "proofs/base-0.json": proofJson(base.proofs[0]!.proof),
      "proofs/base-1.json": proofJson(tail.proof),
      "proofs/fork-a.json": proofJson(childA.proof),
      "proofs/fork-b.json": proofJson(childB.proof),
    });
  });

  after(async () => {
    for (const dir of tempDirs) await rm(dir, { recursive: true, force: true });
  });

  it("exits 3 on the mixed bundle and writes both report files", async () => {
    const outDir = await makeTempDir("bitgraph-audit-cli-out-mixed-");
    tempDirs.push(outDir);
    const run = runCli([mixed.dir, "--out", outDir]);
    assert.equal(run.status, 3, run.stderr);

    const jsonPath = join(outDir, "audit-report.json");
    const mdPath = join(outDir, "audit-report.md");
    assert.ok(existsSync(jsonPath), "audit-report.json written");
    assert.ok(existsSync(mdPath), "audit-report.md written");

    // stdout: the short completion line names the files and the exit meaning.
    assert.ok(run.stdout.includes("audit-report.json"));
    assert.ok(run.stdout.includes("audit-report.md"));
    assert.ok(run.stdout.includes("exit 3"));
    assert.ok(run.stdout.includes("verification failures"));
    assert.ok(run.stdout.includes("chain anomalies"));

    // The written JSON is the real report.
    const written = JSON.parse(readFileSync(jsonPath, "utf8")) as {
      reportSchemaVersion: string;
      summary: { exit: { code: number } };
    };
    assert.equal(written.reportSchemaVersion, "bitgraph-audit-report/2");
    assert.equal(written.summary.exit.code, 3);
    // No em dashes in either written file.
    assert.ok(!readFileSync(jsonPath, "utf8").includes("—"));
    assert.ok(!readFileSync(mdPath, "utf8").includes("—"));
  });

  it("exits 0 on a clean chain-only bundle", async () => {
    const outDir = await makeTempDir("bitgraph-audit-cli-out-clean-");
    tempDirs.push(outDir);
    const run = runCli([cleanDir, "--out", outDir]);
    assert.equal(run.status, 0, run.stderr);
    assert.ok(run.stdout.includes("exit 0"));
    assert.ok(run.stdout.includes("clean"));
    assert.ok(existsSync(join(outDir, "audit-report.json")));
    assert.ok(existsSync(join(outDir, "audit-report.md")));
  });

  it("exits 1 on a reject-only bundle (unsupported-version counts as verification failure)", async () => {
    const outDir = await makeTempDir("bitgraph-audit-cli-out-reject-");
    tempDirs.push(outDir);
    const run = runCli([rejectOnlyDir, "--out", outDir]);
    assert.equal(run.status, 1, run.stderr);
    assert.ok(run.stdout.includes("exit 1"));
  });

  it("exits 2 on a fork-only bundle (divergence between valid proofs)", async () => {
    const outDir = await makeTempDir("bitgraph-audit-cli-out-fork-");
    tempDirs.push(outDir);
    const run = runCli([forkOnlyDir, "--out", outDir]);
    assert.equal(run.status, 2, run.stderr);
    assert.ok(run.stdout.includes("exit 2"));
  });

  it("exits 2 on a bundle whose anchor witness fails offline verification", async () => {
    const witnessDir = await makeTempDir("bitgraph-audit-cli-witness-");
    tempDirs.push(witnessDir);
    const blockNumber = 555000;
    // The anchor commits the hash of the correct header; the witness carries
    // a tampered header (different timestamp, so a different keccak hash)
    // while claiming the correct block hash, so it still matches the anchor
    // and fails loudly at the hash step instead of disappearing as unmatched.
    const correct = makeEthereumHeader({ blockNumber, timestamp: 1_700_000_000 });
    const correctHash = `0x${Buffer.from(keccak_256(correct.headerBytes)).toString("hex")}`;
    const tampered = makeEthereumHeader({ blockNumber, timestamp: 1_699_999_999 });
    const anchor = await makeAnchorProof({
      blockHash: correctHash,
      blockNumber,
      epochId: "epoch-cli-witness",
      counter: "2",
      slotCounter: "1",
    });
    await writeBundleDir(witnessDir, {
      "proofs/anchor.json": proofJson(anchor.proof),
      "witnesses/block.json": witnessJson({
        headerRlpHex: tampered.headerRlpHex,
        blockNumber,
        blockHash: correctHash,
      }),
    });

    const outDir = await makeTempDir("bitgraph-audit-cli-out-witness-");
    tempDirs.push(outDir);
    const run = runCli([witnessDir, "--out", outDir]);
    // The anchor itself verifies (no bytes: artifact-unavailable, not a
    // failure), so bit 1 stays clear; the witness verification failure sets
    // bit 2. Before the fix this bundle exited 0 "clean".
    assert.equal(run.status, 2, run.stderr);
    assert.ok(run.stdout.includes("exit 2"));
    assert.ok(run.stdout.includes("anchor witness verification failures"));
    const report = JSON.parse(readFileSync(join(outDir, "audit-report.json"), "utf8")) as {
      summary: { exit: { code: number }; anomalyCountsByCode: Record<string, number> };
    };
    assert.equal(report.summary.exit.code, 2);
    assert.ok((report.summary.anomalyCountsByCode["witness-hash-mismatch"] ?? 0) >= 1);
  });

  it("exits 1 when a supplied policy makes bytes-free proofs fail (requireSlot)", async () => {
    const outDir = await makeTempDir("bitgraph-audit-cli-out-policy-");
    tempDirs.push(outDir);
    const policyPath = join(outDir, "policy.json");
    await writeFile(policyPath, JSON.stringify({ requireSlot: true }), "utf8");
    // Fork-only proofs carry no slotAllocation record, so requireSlot
    // fails them; the divergence keeps bit 2 set as well.
    const run = runCli([forkOnlyDir, "--out", outDir, "--trust-policy", policyPath]);
    assert.equal(run.status, 3, run.stderr);
  });

  it("writes only JSON with --format json", async () => {
    const outDir = await makeTempDir("bitgraph-audit-cli-out-json-");
    tempDirs.push(outDir);
    const run = runCli([cleanDir, "--out", outDir, "--format", "json"]);
    assert.equal(run.status, 0, run.stderr);
    assert.ok(existsSync(join(outDir, "audit-report.json")));
    assert.ok(!existsSync(join(outDir, "audit-report.md")));
    assert.ok(!run.stdout.includes("audit-report.md"));
  });

  it("rejects an unknown trust-policy key with usage and the valid field list", async () => {
    const outDir = await makeTempDir("bitgraph-audit-cli-out-badpolicy-");
    tempDirs.push(outDir);
    const policyPath = join(outDir, "bad-policy.json");
    await writeFile(policyPath, JSON.stringify({ requireBytes: true }), "utf8");
    const run = runCli([cleanDir, "--out", outDir, "--trust-policy", policyPath]);
    assert.equal(run.status, 64);
    assert.ok(run.stderr.includes("requireBytes"), "names the unknown key");
    assert.ok(run.stderr.includes("allowedMeasurements"), "lists the valid keys");
    assert.ok(run.stderr.includes("requireSlot"), "lists the valid keys");
    assert.ok(run.stderr.includes("Usage:"), "prints usage");
    assert.ok(!existsSync(join(outDir, "audit-report.json")), "no report on usage error");
  });

  it("documents the exit-code semantics in --help", () => {
    const run = runCli(["--help"]);
    assert.equal(run.status, 0);
    assert.ok(run.stdout.includes("Exit codes (bit flags):"));
    for (const marker of ["0 ", "1 ", "2 ", "3 ", "64"]) {
      assert.ok(run.stdout.includes(`  ${marker}`), `documents exit code ${marker.trim()}`);
    }
    assert.ok(run.stdout.includes("unsupported version"));
    assert.ok(run.stdout.includes("NOT a failure"));
    assert.ok(run.stdout.includes("Attestation validation results"));
    assert.ok(!run.stdout.includes("—"), "help text contains no em dashes");
  });

  it("errors with usage when no bundle path is given", () => {
    const run = runCli([]);
    assert.equal(run.status, 64);
    assert.ok(run.stderr.includes("missing bundle path"));
    assert.ok(run.stderr.includes("Usage:"));
  });
});
