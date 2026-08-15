// Copyright (c) 2024-2026 Mike Argento. Licensed under the MIT License. See LICENSE.

/**
 * `check` tests.
 *
 * The real fixture is a genuine export from the production ledger: a
 * 685-byte random text file, its proof (real Ed25519 signature, real AWS
 * Nitro attestation, enclave v5 measurement), both bounding anchors, and
 * both block-header witnesses. Copied verbatim from a BitGraph Folder
 * export; read-only here, no ledger writes, no network.
 *
 * The parity test is the one that matters most: the same bundle ingested
 * from disk (the CLI's path) and from memory (the browser page's path)
 * must produce byte-identical reports, or the two fronts have drifted.
 */

import { describe, it, before, after } from "node:test";
import * as assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { cp, mkdtemp, readFile, rm, writeFile, readdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { ingestBundle, ingestEntries } from "@mikeargento/bitgraph-audit";
import type { AuditResult, BundleEntrySource } from "@mikeargento/bitgraph-audit";
import { buildCheckReport, checkIngest, renderCheckText, serializeCheckReport, KNOWN_ENCLAVE_MEASUREMENTS } from "../check.js";
import type { CheckReport } from "../check.js";
import { PLAYER_VERSION } from "../verdict.js";
import { digestFor, makeAudit } from "./fixtures.js";

const FIXTURE = fileURLToPath(new URL("../../src/__tests__/fixtures/export-random-043", import.meta.url));
const CLI_PATH = fileURLToPath(new URL("../cli.js", import.meta.url));

async function walk(root: string, rel = ""): Promise<string[]> {
  const out: string[] = [];
  const dir = rel === "" ? root : join(root, rel);
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const r = rel === "" ? entry.name : `${rel}/${entry.name}`;
    if (entry.isDirectory()) out.push(...(await walk(root, r)));
    else if (entry.isFile()) out.push(r);
  }
  return out;
}

async function memoryEntriesOf(root: string): Promise<BundleEntrySource[]> {
  const paths = await walk(root);
  return paths.map((p) => ({
    path: p,
    open: () => readFile(join(root, ...p.split("/"))).then((b) => new Uint8Array(b)),
  }));
}

/** Fill the audit sections makeAudit leaves empty so buildCheckReport can run over synthetic input. */
function complete(audit: AuditResult, overrides: Partial<AuditResult> = {}): AuditResult {
  const a = audit as unknown as Record<string, unknown>;
  return {
    ...audit,
    anomalies: { anomalies: [], divergences: [], boundaryEntryPoints: [] },
    authorities: { groups: [], anomalies: [], sharedSignersAcrossEpochs: [] },
    anchors: { anchors: [], metadataOnlyProofHashes: [], findings: [] },
    witnesses: { outcomes: [], findings: [] },
    attestations: {
      records: [],
      findings: [],
      counts: {
        proofsWithDeclaredMeasurement: 0,
        proofsWithDocument: 0,
        documentsValidated: 0,
        documentsFailed: 0,
        pcr0Matches: 0,
        pcr0Mismatches: 0,
        userDataBound: 0,
        userDataUnbound: 0,
      },
    },
    ...(a["temporal"] !== undefined ? {} : {}),
    ...overrides,
  } as AuditResult;
}

describe("check: real export fixture (disk)", () => {
  let report: CheckReport;
  before(async () => {
    report = await checkIngest(await ingestBundle(FIXTURE));
  });

  it("is TRUE end to end: file, signature, attestation, enclave, both anchors, both witnesses", () => {
    assert.equal(report.check, "bitgraph-check/1");
    assert.equal(report.result, "TRUE");
    assert.equal(report.recordings.length, 1);
    assert.equal(report.anchors.length, 2);
    const rec = report.recordings[0]!;
    assert.equal(rec.result, "TRUE");
    assert.equal(rec.filePath, "random-043.txt");
    assert.deepEqual(
      rec.lines.map((l) => [l.name, l.result]),
      [
        ["file", "TRUE"],
        ["signature", "TRUE"],
        ["attestation", "TRUE"],
        ["enclave", "TRUE"],
      ]
    );
    for (const anchor of report.anchors) {
      assert.equal(anchor.result, "TRUE");
      assert.deepEqual(
        anchor.lines.map((l) => [l.name, l.result]),
        [
          ["signature", "TRUE"],
          ["witness", "TRUE"],
        ]
      );
    }
    assert.equal(report.contradictions.length, 0);
  });

  it("brackets the recording between the two verified block headers", () => {
    const b = report.recordings[0]!.bounds;
    assert.equal(b.status, "bracketed");
    assert.equal(b.notBefore?.blockNumber, "25735831");
    assert.equal(b.notAfter?.blockNumber, "25735832");
    assert.match(b.detail, /after Ethereum block 25735831 and before block 25735832/);
  });

  it("orders anchors by causal position, not file name", () => {
    assert.deepEqual(
      report.anchors.map((a) => a.blockNumber),
      ["25735831", "25735832"]
    );
    assert.equal(report.anchors[0]!.witnessPath, "ethereum-anchors/anchor-before-witness.json");
  });

  it("names the excerpt gaps as notes, never as verdicts", () => {
    assert.ok(report.notes.some((n) => /causal positions? between the earliest and latest recording/.test(n)));
    assert.ok(report.notes.some((n) => /link(s)? to a predecessor that is not in this bundle/.test(n)));
    assert.equal(report.contradictions.length, 0);
  });

  it("states what it cannot check", () => {
    assert.ok(report.notChecked.some((n) => /canonical/.test(n)));
    assert.ok(report.notChecked.some((n) => /ledger/.test(n)));
    assert.equal(report.network, "none");
    assert.equal(report.evaluator.version, PLAYER_VERSION);
  });

  it("recognizes the enclave v5 measurement from PINS.md", () => {
    const enclave = report.recordings[0]!.lines.find((l) => l.name === "enclave")!;
    assert.match(enclave.detail, /enclave v5/);
    assert.equal(KNOWN_ENCLAVE_MEASUREMENTS.length, 4);
  });

  it("serializes deterministically: no timestamps, no machine paths", async () => {
    const again = await checkIngest(await ingestBundle(FIXTURE));
    assert.equal(serializeCheckReport(again), serializeCheckReport(report));
    const bytes = serializeCheckReport(report);
    assert.ok(!bytes.includes(FIXTURE), "report must not contain the machine path");
    assert.ok(!bytes.includes("startedAt"));
    assert.ok(renderCheckText(report).startsWith("TRUE: this file was recorded at position 1576"));
  });
});

describe("check: disk and memory ingest produce byte-identical reports (the no-drift guarantee)", () => {
  it("ingestEntries over the same files equals ingestBundle over the directory", async () => {
    const fromDisk = await checkIngest(await ingestBundle(FIXTURE));
    const fromMemory = await checkIngest(await ingestEntries(await memoryEntriesOf(FIXTURE)));
    assert.equal(serializeCheckReport(fromMemory), serializeCheckReport(fromDisk));
    assert.equal(fromMemory.result, "TRUE");
  });

  it("memory ingest tolerates any supply order (entries are sorted by path)", async () => {
    const entries = await memoryEntriesOf(FIXTURE);
    const reversed = [...entries].reverse();
    const a = await checkIngest(await ingestEntries(entries));
    const b = await checkIngest(await ingestEntries(reversed));
    assert.equal(serializeCheckReport(a), serializeCheckReport(b));
  });

  it("memory ingest accepts whole bytes, promises, and chunk streams alike", async () => {
    const paths = await walk(FIXTURE);
    const entries: BundleEntrySource[] = [];
    for (const [i, p] of paths.entries()) {
      const bytes = new Uint8Array(await readFile(join(FIXTURE, ...p.split("/"))));
      const open =
        i % 3 === 0
          ? () => bytes
          : i % 3 === 1
            ? () => Promise.resolve(bytes)
            : () =>
                (async function* () {
                  const half = Math.floor(bytes.length / 2);
                  yield bytes.subarray(0, half);
                  yield bytes.subarray(half);
                })();
      entries.push({ path: p, open });
    }
    const report = await checkIngest(await ingestEntries(entries));
    assert.equal(report.result, "TRUE");
  });
});

describe("check: what evidence in hand contradicts, and what it merely leaves open", () => {
  let dir: string;
  before(async () => {
    dir = await mkdtemp(join(tmpdir(), "bitgraph-check-"));
  });
  after(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  async function copyFixture(name: string): Promise<string> {
    const dest = join(dir, name);
    await cp(FIXTURE, dest, { recursive: true });
    return dest;
  }

  it("an edited file is UNDETERMINED (not FALSE) with a note naming it: absence is not a verdict", async () => {
    const d = await copyFixture("edited");
    const p = join(d, "random-043.txt");
    await writeFile(p, Buffer.concat([await readFile(p), Buffer.from("x")]));
    const report = await checkIngest(await ingestBundle(d));
    assert.equal(report.result, "UNDETERMINED");
    const file = report.recordings[0]!.lines.find((l) => l.name === "file")!;
    assert.equal(file.result, "UNDETERMINED");
    assert.ok(report.notes.some((n) => /random-043\.txt/.test(n) && /bytes differ/.test(n)));
    // Everything else about the recording still holds.
    assert.equal(report.recordings[0]!.lines.find((l) => l.name === "signature")!.result, "TRUE");
    assert.equal(report.recordings[0]!.lines.find((l) => l.name === "attestation")!.result, "TRUE");
  });

  it("a tampered signature is FALSE", async () => {
    const d = await copyFixture("badsig");
    const p = join(d, "proof.json");
    const proof = JSON.parse(await readFile(p, "utf8")) as { signer: { signatureB64: string } };
    const sig = Buffer.from(proof.signer.signatureB64, "base64");
    sig[0] = sig[0]! ^ 1;
    proof.signer.signatureB64 = sig.toString("base64");
    await writeFile(p, JSON.stringify(proof));
    const report = await checkIngest(await ingestBundle(d));
    assert.equal(report.result, "FALSE");
    assert.equal(report.recordings[0]!.lines.find((l) => l.name === "signature")!.result, "FALSE");
    assert.match(report.summary, /^FALSE/);
  });

  it("a tampered block header is FALSE on that anchor, and the bound it gave is withdrawn", async () => {
    const d = await copyFixture("badwitness");
    const p = join(d, "ethereum-anchors", "anchor-after-witness.json");
    const w = JSON.parse(await readFile(p, "utf8")) as { headerRlpHex: string };
    const h = w.headerRlpHex;
    w.headerRlpHex = h.slice(0, -2) + (h.slice(-2) === "00" ? "11" : "00");
    await writeFile(p, JSON.stringify(w));
    const report = await checkIngest(await ingestBundle(d));
    assert.equal(report.result, "FALSE");
    const after = report.anchors.find((a) => a.blockNumber === "25735832")!;
    assert.equal(after.lines.find((l) => l.name === "witness")!.result, "FALSE");
    assert.equal(report.recordings[0]!.result, "TRUE", "the recording itself is still sound");
    assert.equal(report.recordings[0]!.bounds.status, "lower-bounded");
  });

  it("proof plus file with no anchors is TRUE and unanchored", async () => {
    const entries: BundleEntrySource[] = ["proof.json", "random-043.txt"].map((name) => ({
      path: name,
      open: () => readFile(join(FIXTURE, name)).then((b) => new Uint8Array(b)),
    }));
    const report = await checkIngest(await ingestEntries(entries));
    assert.equal(report.result, "TRUE");
    assert.equal(report.recordings[0]!.bounds.status, "unanchored");
    assert.equal(report.anchors.length, 0);
    assert.match(report.summary, /with no Ethereum bound in this bundle/);
  });

  it("proof alone (no file) is UNDETERMINED: signature and attestation hold, binding to bytes does not", async () => {
    const entries: BundleEntrySource[] = [
      { path: "proof.json", open: () => readFile(join(FIXTURE, "proof.json")).then((b) => new Uint8Array(b)) },
    ];
    const report = await checkIngest(await ingestEntries(entries));
    assert.equal(report.result, "UNDETERMINED");
    const rec = report.recordings[0]!;
    assert.equal(rec.lines.find((l) => l.name === "file")!.result, "UNDETERMINED");
    assert.equal(rec.lines.find((l) => l.name === "signature")!.result, "TRUE");
    assert.equal(rec.filePath, undefined);
  });

  it("without WebCrypto the attestation is UNDETERMINED with the reason, never FALSE", async () => {
    const report = await checkIngest(await ingestBundle(FIXTURE), { webCryptoAvailable: false });
    const rec = report.recordings[0]!;
    assert.equal(rec.lines.find((l) => l.name === "attestation")!.result, "UNDETERMINED");
    assert.match(rec.lines.find((l) => l.name === "attestation")!.detail, /WebCrypto/);
    assert.equal(rec.lines.find((l) => l.name === "enclave")!.result, "UNDETERMINED");
    assert.equal(report.result, "UNDETERMINED");
  });

  it("an empty bundle is UNDETERMINED and says so", async () => {
    const report = await checkIngest(await ingestEntries([]));
    assert.equal(report.result, "UNDETERMINED");
    assert.match(report.summary, /no BitGraph proofs were found/);
  });
});

describe("check: synthetic audit shapes", () => {
  it("an unknown PCR0 is UNDETERMINED (outside this verifier's knowledge), never FALSE", () => {
    const audit = complete(
      makeAudit({
        proofs: [{ name: "a", digestB64: digestFor("a"), epochId: "E", counter: "5", slotCounter: "4" }],
        partitions: [{ epochId: "E", members: ["a"] }],
      })
    );
    audit.attestations.records.push({
      proofHash: "proofhash-a",
      declaredMeasurementPresent: true,
      declaredMeasurement: "ff".repeat(48),
      documentPresent: true,
      attestationFormat: "aws-nitro",
      documentValidated: true,
      checks: [],
      attestedPcr0: "ff".repeat(48),
      pcr0MatchesDeclared: true,
      userDataBoundToProof: true,
    });
    const report = buildCheckReport(audit);
    const rec = report.recordings[0]!;
    assert.equal(rec.lines.find((l) => l.name === "attestation")!.result, "TRUE");
    const enclave = rec.lines.find((l) => l.name === "enclave")!;
    assert.equal(enclave.result, "UNDETERMINED");
    assert.match(enclave.detail, /not among the BitGraph enclave measurements this verifier knows/);
    assert.equal(report.result, "UNDETERMINED");
  });

  it("an attestation bound to some other proof is FALSE", () => {
    const audit = complete(
      makeAudit({
        proofs: [{ name: "a", digestB64: digestFor("a"), epochId: "E", counter: "5" }],
        partitions: [{ epochId: "E", members: ["a"] }],
      })
    );
    audit.attestations.records.push({
      proofHash: "proofhash-a",
      declaredMeasurementPresent: true,
      documentPresent: true,
      documentValidated: true,
      checks: [],
      attestedPcr0: KNOWN_ENCLAVE_MEASUREMENTS[3]!.pcr0,
      pcr0MatchesDeclared: true,
      userDataBoundToProof: false,
    });
    const report = buildCheckReport(audit);
    assert.equal(report.recordings[0]!.lines.find((l) => l.name === "attestation")!.result, "FALSE");
    assert.equal(report.result, "FALSE");
  });

  it("structural contradictions surface as FALSE while excerpt gaps stay notes", () => {
    const audit = complete(
      makeAudit({
        proofs: [
          { name: "a", digestB64: digestFor("a"), epochId: "E", counter: "5" },
          { name: "b", digestB64: digestFor("b"), epochId: "E", counter: "5" },
        ],
        partitions: [{ epochId: "E", members: ["a", "b"] }],
      })
    );
    audit.anomalies.anomalies.push(
      { code: "unexplained-counter-positions", proofHashes: [], message: "gap", details: { count: "3", ranges: [], positions: [], truncated: false } },
      { code: "chain-break-missing", proofHashes: ["proofhash-a"], message: "missing pred", details: {} },
      { code: "counter-collision", proofHashes: ["proofhash-a", "proofhash-b"], message: "two commits at position 5" }
    );
    const report = buildCheckReport(audit);
    assert.equal(report.contradictions.length, 1);
    assert.match(report.contradictions[0]!.detail, /^counter-collision/);
    assert.ok(report.notes.some((n) => /3 causal positions/.test(n)));
    assert.equal(report.result, "FALSE");
  });
});

describe("check: CLI", () => {
  it("prints the human report and exits 0 on the real fixture", () => {
    const r = spawnSync(process.execPath, [CLI_PATH, "check", FIXTURE], { encoding: "utf8" });
    assert.equal(r.status, 0, r.stderr);
    assert.match(r.stdout, /^TRUE: this file was recorded at position 1576/);
    assert.match(r.stdout, /Result: TRUE/);
  });

  it("--json prints the bitgraph-check/1 report", () => {
    const r = spawnSync(process.execPath, [CLI_PATH, "check", FIXTURE, "--json"], { encoding: "utf8" });
    assert.equal(r.status, 0, r.stderr);
    const parsed = JSON.parse(r.stdout) as CheckReport;
    assert.equal(parsed.check, "bitgraph-check/1");
    assert.equal(parsed.result, "TRUE");
  });

  it("accepts a list of files and ingests them in memory", () => {
    const r = spawnSync(
      process.execPath,
      [CLI_PATH, "check", join(FIXTURE, "proof.json"), join(FIXTURE, "random-043.txt")],
      { encoding: "utf8" }
    );
    assert.equal(r.status, 0, r.stderr);
    assert.match(r.stdout, /no Ethereum bound in this bundle/);
  });

  it("exits 2 for UNDETERMINED (proof alone) and 3 for a missing path", () => {
    const u = spawnSync(process.execPath, [CLI_PATH, "check", join(FIXTURE, "proof.json")], { encoding: "utf8" });
    assert.equal(u.status, 2, u.stderr);
    const e = spawnSync(process.execPath, [CLI_PATH, "check", join(FIXTURE, "does-not-exist")], { encoding: "utf8" });
    assert.equal(e.status, 3);
    assert.match(e.stderr, /cannot read bundle/);
  });

  it("evaluate and init reject --json (it belongs to check only)", () => {
    const r = spawnSync(process.execPath, [CLI_PATH, "init", join(FIXTURE, "random-043.txt"), "--json"], { encoding: "utf8" });
    assert.equal(r.status, 3);
    assert.match(r.stderr, /usage:/);
  });

  it("the relative path helper is unused by the report (paths are bundle-relative only)", () => {
    // Guard against a future report field leaking absolute paths.
    assert.equal(relative(FIXTURE, join(FIXTURE, "proof.json")), "proof.json");
  });
});
