/**
 * ingestEntries() and auditIngest(): the filesystem-free path.
 *
 * A browser cannot call ingestBundle(path); it hands over bytes. This suite
 * pins that the in-memory ingest classifies, hashes, and matches exactly
 * as the directory ingest does over the same files at the same paths, and
 * that auditIngest() over either produces the same audit (less the run
 * stamp and the container label). It also pins AUDIT_VERSION to
 * package.json, since the constant replaced a runtime file read.
 */

import { describe, it, before, after } from "node:test";
import * as assert from "node:assert/strict";
import { readFile, readdir, rm } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import {
  auditIngest,
  auditToolVersion,
  AUDIT_VERSION,
  ingestBundle,
  ingestEntries,
  runAudit,
  streamMatchedArtifacts,
} from "@mikeargento/bitgraph-audit";
import type { AuditResult, BundleEntrySource, IngestResult } from "@mikeargento/bitgraph-audit";
import { makeStandardAuditBundle } from "./audit-fixtures.js";

async function walk(root: string, rel = ""): Promise<string[]> {
  const out: string[] = [];
  const dir = rel === "" ? root : join(root, rel);
  const entries = await readdir(dir, { withFileTypes: true });
  for (const entry of entries) {
    const r = rel === "" ? entry.name : `${rel}/${entry.name}`;
    if (entry.isDirectory()) out.push(...(await walk(root, r)));
    else if (entry.isFile()) out.push(r);
  }
  return out;
}

async function entriesOf(root: string): Promise<BundleEntrySource[]> {
  return (await walk(root)).map((p) => ({
    path: p,
    open: () => readFile(join(root, ...p.split("/"))).then((b) => new Uint8Array(b)),
  }));
}

/** Everything in an IngestResult that must agree between containers. */
function comparableIngest(r: IngestResult): unknown {
  const { bundlePath: _p, container: _c, ...rest } = r;
  return JSON.parse(JSON.stringify(rest));
}

function comparableAudit(a: AuditResult): unknown {
  const { runMetadata: _m, ingest, ...rest } = a;
  return JSON.parse(JSON.stringify({ ingest: comparableIngest(ingest), ...rest }));
}

describe("audit: AUDIT_VERSION is a source constant that tracks package.json", () => {
  it("equals the version in packages/audit/package.json", async () => {
    const pkgPath = fileURLToPath(new URL("../../packages/audit/package.json", import.meta.url));
    const pkg = JSON.parse(await readFile(pkgPath, "utf8")) as { version: string };
    assert.equal(AUDIT_VERSION, pkg.version);
    assert.equal(auditToolVersion(), pkg.version);
  });
});

describe("audit: ingestEntries mirrors ingestBundle over the same files", () => {
  let dir: string;
  let fromDisk: IngestResult;
  let fromMemory: IngestResult;

  before(async () => {
    const bundle = await makeStandardAuditBundle();
    dir = bundle.dir;
    fromDisk = await ingestBundle(dir);
    fromMemory = await ingestEntries(await entriesOf(dir));
  });

  after(async () => {
    if (dir !== undefined) await rm(dir, { recursive: true, force: true });
  });

  it("labels the container and keeps the label the caller gave", async () => {
    assert.equal(fromMemory.container, "memory");
    assert.equal(fromMemory.bundlePath, "");
    const labeled = await ingestEntries([], { label: "dropped files" });
    assert.equal(labeled.bundlePath, "dropped files");
    assert.equal(labeled.entriesScanned, 0);
  });

  it("classifies and matches identically: proofs, artifacts, witnesses, findings, counts, contents hash", () => {
    assert.deepEqual(comparableIngest(fromMemory), comparableIngest(fromDisk));
    assert.ok(fromDisk.proofs.length > 0, "the standard bundle has proofs");
    assert.equal(fromMemory.computedContentsHashB64, fromDisk.computedContentsHashB64);
  });

  it("re-reads matched artifact bytes through the registered sources", async () => {
    const disk: string[] = [];
    for await (const m of streamMatchedArtifacts(fromDisk)) disk.push(`${m.path}:${m.sha256Hex}:${m.bytes.length}`);
    const mem: string[] = [];
    for await (const m of streamMatchedArtifacts(fromMemory)) mem.push(`${m.path}:${m.sha256Hex}:${m.bytes.length}`);
    assert.deepEqual(mem, disk);
    assert.ok(mem.length > 0, "the standard bundle has matched artifacts");
  });

  it("yields no artifact bytes for a structurally cloned result (sources are keyed by identity), never throws", async () => {
    const clone = JSON.parse(JSON.stringify(fromMemory)) as IngestResult;
    const seen: string[] = [];
    for await (const m of streamMatchedArtifacts(clone)) seen.push(m.path);
    assert.deepEqual(seen, []);
  });

  it("skips and reports unsafe paths exactly as archive ingest does", async () => {
    const bad = await ingestEntries([
      { path: "../escape.json", open: () => new Uint8Array([1]) },
      { path: "/abs.json", open: () => new Uint8Array([2]) },
      { path: "ok.bin", open: () => new Uint8Array([3]) },
    ]);
    assert.equal(bad.counts.skippedUnsafePaths, 2);
    assert.equal(bad.entriesScanned, 3);
    assert.deepEqual(
      bad.findings.map((f) => f.code),
      ["unsafe-path", "unsafe-path"]
    );
    assert.equal(bad.artifacts.length, 1);
  });

  it("auditIngest over either ingest matches runAudit over the directory, less the run stamp", async () => {
    const viaRun = await runAudit(dir);
    const viaMemory = await auditIngest(await ingestEntries(await entriesOf(dir)), { startedAt: "" });
    assert.deepEqual(comparableAudit(viaMemory), comparableAudit(viaRun));
    assert.equal(viaMemory.runMetadata.startedAt, "");
    assert.equal(viaMemory.runMetadata.container, "memory");
    assert.equal(viaRun.runMetadata.toolVersion, AUDIT_VERSION);
    // The full-tier pass ran in memory too: matched artifacts verified with bytes.
    assert.equal(viaMemory.verification.verified, viaRun.verification.verified);
    assert.ok(viaMemory.verification.verified > 0);
  });
});

describe("audit: a bitgraph-fuse/1 Frame is a proof carrier", () => {
  it("ingestEntries reads the nested proof out of a Frame and does not index the Frame as an artifact", async () => {
    const fix = fileURLToPath(new URL("../../src/__tests__/fuse-fixtures/", import.meta.url)); // compiled tests run from dist/__tests__/
    const frame = new Uint8Array(await readFile(join(fix, "trailer.bitgraph-fuse.json")));
    const fused = new Uint8Array(await readFile(join(fix, "fused-trailer.bin")));
    const ingest = await ingestEntries([
      { path: "photo.bitgraph-fuse.json", open: () => frame },
      { path: "photo.bin", open: () => fused },
    ]);
    assert.equal(ingest.proofs.length, 1);
    assert.equal((ingest.proofs[0]!.proof.attribution as { name?: string } | undefined)?.name, "bitgraph-fuse/1");
    assert.ok(!ingest.artifacts.some((a) => a.paths.includes("photo.bitgraph-fuse.json")), "the Frame is not an artifact candidate");
    assert.ok(ingest.artifacts.some((a) => a.paths.includes("photo.bin") && a.matchedProofHashes.length === 1), "the fused bytes match the nested proof");
  });
});
