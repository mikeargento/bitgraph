// Copyright (c) 2024-2026 Argento Computing Inc. Licensed under the MIT License. See LICENSE.

/**
 * Base floors (enclave v10) in `check` and `compare`.
 *
 * From enclave v10 a recording signs its floor as a Base block
 * (commit.slotFloor) instead of an Ethereum anchor. An audit that reads it
 * reports a not-before segment bound with source "signed-floor" and chain
 * "base", a TemporalAnalysis.signedFloors record per floor, and
 * floorProblems. The Player reads those fields structurally (it still builds
 * against an older audit), so these tests hand it AuditResult shapes with
 * them, exactly as the fixtures elsewhere do. No ledger writes, no network.
 */

import { describe, it } from "node:test";
import * as assert from "node:assert/strict";
import type { AuditResult, ObservedProof, SegmentBound, TemporalSegment } from "@mikeargento/bitgraph-audit";
import { buildCheckReport, renderCheckText } from "../check.js";
import type { SignedFloorRecord } from "../check.js";
import { compare } from "../order.js";
import { digestFor, makeAudit, makeBound, proofHashOf } from "./fixtures.js";

const BASE_BLOCK = 52271417;
const BASE_TIME = 1791332181;
const BASE_HASH = "0x71d926aeae9847fcc15fad2d4de8871923f56862d42db7a7463e95a838f8f9b0";

function complete(audit: AuditResult, temporal: Record<string, unknown>): AuditResult {
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
        proofsWithDeclaredMeasurement: 0, proofsWithDocument: 0, documentsValidated: 0, documentsFailed: 0,
        pcr0Matches: 0, pcr0Mismatches: 0, userDataBound: 0, userDataUnbound: 0,
      },
    },
    temporal: { ...audit.temporal, ...temporal },
  } as unknown as AuditResult;
}

function baseBound(proofName: string, opts?: Partial<{ timeSource: "header" | "signed"; evidence: SegmentBound["evidence"] | "signed-floor"; blockNumber: number; timestamp: number }>): SegmentBound {
  return {
    ...makeBound({
      kind: "not-before",
      anchorProofHash: proofHashOf(proofName),
      blockHash: BASE_HASH,
      blockNumber: String(opts?.blockNumber ?? BASE_BLOCK),
      timestamp: opts?.timestamp ?? BASE_TIME,
      evidence: (opts?.evidence ?? "signed-floor") as SegmentBound["evidence"],
      claim: "fixture Base floor bound",
    }),
    source: "signed-floor",
    chain: "base",
    timeSource: opts?.timeSource ?? "header",
  } as SegmentBound;
}

function floorRecord(proofName: string, opts?: Partial<SignedFloorRecord>): SignedFloorRecord {
  return {
    proofHash: proofHashOf(proofName),
    chain: "base",
    blockNumber: BASE_BLOCK,
    blockHash: BASE_HASH,
    blockTimestamp: BASE_TIME,
    header: "checked",
    headerPath: "base-floor/floor-header.json",
    bound: "not-before",
    ...(opts ?? {}),
  };
}

function segment(names: string[], lower: SegmentBound[], upper: SegmentBound[] = [], epochId = "E10"): TemporalSegment {
  return {
    partition: { publicKeyB64: "key-A", chainId: "bitgraph:main", epochId },
    memberProofHashes: names.map(proofHashOf),
    status: lower.length > 0 && upper.length > 0 ? "lower-bounded-with-following-anchor" : lower.length > 0 ? "lower-bounded" : upper.length > 0 ? "upper-bounded" : "ordered-but-unanchored",
    lowerBounds: lower,
    upperBounds: upper,
  } as TemporalSegment;
}

function oneRecording(temporal: Record<string, unknown>, attribution?: Record<string, string>): AuditResult {
  const audit = makeAudit({ proofs: [{ name: "r", digestB64: digestFor("r"), epochId: "E10", counter: "4", slotCounter: "3" }] });
  if (attribution !== undefined) {
    (audit.ingest.proofs[0]!.proof as unknown as Record<string, unknown>)["attribution"] = attribution;
  }
  return complete(audit, temporal);
}

describe("check: a recording that signs a Base floor", () => {
  it("is bounded after its Base block, with the header checked, and no upper bound", () => {
    const report = buildCheckReport(oneRecording({ segments: [segment(["r"], [baseBound("r")])], signedFloors: [floorRecord("r")] }));
    const rec = report.recordings[0]!;
    assert.equal(rec.bounds.status, "lower-bounded");
    assert.equal(rec.bounds.notBefore?.chain, "base");
    assert.equal(rec.bounds.notBefore?.evidence, "signed-floor");
    assert.equal(rec.bounds.notBefore?.blockNumber, String(BASE_BLOCK));
    assert.equal(rec.bounds.notAfter, undefined);
    assert.match(rec.bounds.detail, /after Base block 52271417 \(its floor, header checked in this bundle\)/);
    assert.doesNotMatch(rec.bounds.detail, /Ethereum/);
    assert.ok(report.notChecked.some((n) => /Base floor blocks are Base's own/.test(n)));
    assert.doesNotMatch(renderCheckText(report), /[–—]/);
  });

  it("without the header, says the block needs a Base lookup", () => {
    const report = buildCheckReport(
      oneRecording({ segments: [segment(["r"], [baseBound("r", { timeSource: "signed" })])], signedFloors: [floorRecord("r", { header: "not-carried" })] })
    );
    assert.match(report.recordings[0]!.bounds.detail, /confirming the block needs a Base lookup/);
  });

  it("compares bounds across chains by time, never by block number", () => {
    // Ethereum block 25,000,000 is later in time than this Base block,
    // whose NUMBER is larger: the tightest not-before is the Ethereum one.
    const eth = makeBound({ kind: "not-before", anchorProofHash: "anchor-eth", blockNumber: "25000000", timestamp: BASE_TIME + 600 });
    const report = buildCheckReport(oneRecording({ segments: [segment(["r"], [baseBound("r"), eth])], signedFloors: [floorRecord("r")] }));
    const nb = report.recordings[0]!.bounds.notBefore!;
    assert.equal(nb.chain, undefined);
    assert.equal(nb.blockNumber, "25000000");
  });

  it("a fuse/3 recording's fused floor is the Base block it signs", () => {
    const report = buildCheckReport(
      oneRecording({ segments: [segment(["r"], [baseBound("r")])], signedFloors: [floorRecord("r")] }, { name: "bitgraph-fuse/3", title: "trailer/1" })
    );
    const fused = report.recordings[0]!.fused!;
    assert.equal(fused.floor?.chain, "base");
    assert.equal(fused.floor?.evidence, "signed-floor");
    assert.equal(fused.floor?.blockNumber, String(BASE_BLOCK));
    assert.match(fused.floorDetail, /Base block #52271417 .*the Base block this recording signs as its floor/);
  });

  it("a withheld floor bounds nothing and says why", () => {
    const why = "the floor block is stamped after the attestation document was made";
    const report = buildCheckReport(
      oneRecording({ segments: [segment(["r"], [])], signedFloors: [floorRecord("r", { bound: "withheld", withheldReason: why })] }, { name: "bitgraph-fuse/3", title: "trailer/1" })
    );
    const rec = report.recordings[0]!;
    assert.equal(rec.bounds.notBefore, undefined);
    assert.match(rec.bounds.detail, /not used as a bound/);
    assert.equal(rec.fused!.floor, null);
    assert.match(rec.fused!.floorDetail, /not used as a bound/);
  });

  it("a floor problem (a recording that signs two floors) is a contradiction: FALSE", () => {
    const report = buildCheckReport(
      oneRecording({
        segments: [segment(["r"], [])],
        floorProblems: [{ code: "floor-ambiguous", proofHash: proofHashOf("r"), message: "the proof signs two floors" }],
      })
    );
    assert.equal(report.result, "FALSE");
    assert.ok(report.contradictions.some((c) => c.detail.startsWith("floor-ambiguous")));
  });
});

describe("compare: a Base floor orders no epoch", () => {
  it("an anchor's not-after in one epoch and a later Base floor in another answer unordered", () => {
    const base = makeAudit({
      proofs: [
        { name: "old", digestB64: digestFor("old"), epochId: "E9", counter: "2" },
        { name: "new", digestB64: digestFor("new"), epochId: "E10", counter: "2", publicKeyB64: "key-B" },
      ],
      partitions: [
        { epochId: "E9", members: ["old"] },
        { epochId: "E10", members: ["new"], publicKeyB64: "key-B" },
      ],
    });
    const anchorUpper = makeBound({ kind: "not-after", anchorProofHash: "anchor-9", blockNumber: "25000000", timestamp: 1_700_000_000 });
    const audit = complete(base, {
      segments: [segment(["old"], [], [anchorUpper], "E9"), segment(["new"], [baseBound("new")], [], "E10")],
      signedFloors: [floorRecord("new")],
    });
    const byName = (n: string): ObservedProof => audit.ingest.proofs.find((p) => p.proofHash === proofHashOf(n))!;
    assert.equal(compare(byName("old"), byName("new"), audit).relation, "unordered");
    assert.equal(compare(byName("new"), byName("old"), audit).relation, "unordered");
    // The same shape with an anchor not-before on the new side does order them (old behaviour kept).
    const anchorLower = makeBound({ kind: "not-before", anchorProofHash: "anchor-10", blockNumber: "25000100", timestamp: 1_700_001_200 });
    const anchored = complete(base, { segments: [segment(["old"], [], [anchorUpper], "E9"), segment(["new"], [anchorLower], [], "E10")] });
    assert.equal(compare(byName("old"), byName("new"), anchored).relation, "before");
  });
});
