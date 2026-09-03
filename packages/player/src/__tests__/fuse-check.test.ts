// Copyright (c) 2024-2026 Mike Argento. Licensed under the MIT License. See LICENSE.

/**
 * `check` over fused recordings (profile bitgraph-fuse/1, working name).
 * Fixtures are real proofs minted through the local enclave harness
 * (real signatures, fake PCR0), read-only here; no ledger, no network.
 */

import { describe, it } from "node:test";
import * as assert from "node:assert/strict";
import { readFile, mkdtemp, writeFile, rm, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { ingestBundle, ingestEntries } from "@mikeargento/bitgraph-audit";
import type { AnchorRecord, BundleEntrySource, SegmentBound, TemporalSegment } from "@mikeargento/bitgraph-audit";
import { checkIngest, fusedFloor, renderCheckText, serializeCheckReport } from "../check.js";

const FIX = fileURLToPath(new URL("../../../../src/__tests__/fuse-fixtures/", import.meta.url));
const read = (name: string) => readFile(join(FIX, name)).then((b) => new Uint8Array(b));

async function entries(spec: Record<string, string>): Promise<BundleEntrySource[]> {
  const out: BundleEntrySource[] = [];
  for (const [path, fixture] of Object.entries(spec)) {
    const bytes = await read(fixture);
    out.push({ path, open: () => bytes });
  }
  return out;
}

describe("fused recordings in check", () => {
  it("fused bytes beside the proof: fused line TRUE, floor undetermined without anchors, statements carried", async () => {
    const report = await checkIngest(await ingestEntries(await entries({ "proof.json": "trailer.proof.json", "photo.bin": "fused-trailer.bin" })));
    assert.equal(report.recordings.length, 1);
    const rec = report.recordings[0]!;
    const fused = rec.lines.find((l) => l.name === "fused");
    assert.ok(fused, "a fused line exists");
    assert.equal(fused!.result, "TRUE", fused!.detail);
    assert.equal(rec.lines.find((l) => l.name === "file")?.result, "TRUE");
    assert.equal(rec.lines.find((l) => l.name === "signature")?.result, "TRUE");
    assert.ok(rec.fused);
    assert.equal(rec.fused!.category, "FUSED_DIRECT");
    assert.equal(rec.fused!.evidence, "fused-bytes");
    assert.equal(rec.fused!.placement, "trailer/1");
    assert.equal(rec.fused!.floor, null);
    assert.match(rec.fused!.floorDetail, /floor undetermined: no anchor precedes this slot in its epoch/);
    assert.equal(rec.fused!.statements.length, 2);
    assert.match(rec.fused!.statements[1]!, /at position \d+, and were committed no later than position \d+/);
    assert.ok(rec.fused!.span && BigInt(rec.fused!.span.positions) >= 1n);
    // The harness attests with a fake document, so the attestation line is FALSE
    // here; that is the harness, not the fused check, and it is reported on its
    // own line. The fused line above stands regardless.
    assert.notEqual(rec.lines.find((l) => l.name === "attestation")?.result, "TRUE");
    const text = renderCheckText(report);
    assert.match(text, /fused floor floor undetermined/);
    assert.match(text, /fused span  slot \d+ to commit \d+/);
  });

  it("the original beside the proof: rebuilt, fused line TRUE, the original is noted as such and not as unmatched", async () => {
    const report = await checkIngest(await ingestEntries(await entries({ "proof.json": "trailer.proof.json", "original.txt": "original.txt" })));
    const rec = report.recordings[0]!;
    const fused = rec.lines.find((l) => l.name === "fused")!;
    assert.equal(fused.result, "TRUE", fused.detail);
    assert.equal(rec.fused!.category, "FUSED_FROM_ORIGIN");
    assert.equal(rec.fused!.evidence, "original");
    // The committed bytes are not in hand, so the file line stays UNDETERMINED: the
    // original receives the ceiling, the fused bytes the interval.
    assert.equal(rec.lines.find((l) => l.name === "file")?.result, "UNDETERMINED");
    assert.ok(report.notes.some((n) => /original of a fused recording: original\.txt/.test(n)), report.notes.join(" | "));
    assert.ok(!report.notes.some((n) => /matches no recording here: original\.txt/.test(n)), "the original is not called unmatched");
  });

  it("neither bytes present: fused line UNDETERMINED, never FALSE", async () => {
    const report = await checkIngest(await ingestEntries(await entries({ "proof.json": "trailer.proof.json" })));
    const rec = report.recordings[0]!;
    const fused = rec.lines.find((l) => l.name === "fused")!;
    assert.equal(fused.result, "UNDETERMINED");
    assert.match(fused.detail, /neither the fused bytes nor the original/);
    assert.equal(rec.fused!.category, "NO_EVIDENCE");
    assert.equal(rec.fused!.evidence, null);
  });

  it("a file committed under a different slot than its commitment names: fused line FALSE", async () => {
    const report = await checkIngest(await ingestEntries(await entries({ "proof.json": "wrong-slot.proof.json", "photo.bin": "fused-wrong-slot.bin" })));
    const rec = report.recordings[0]!;
    assert.equal(rec.lines.find((l) => l.name === "fused")?.result, "FALSE");
    assert.equal(rec.fused!.category, "INVALID_SLOT_COMMITMENT");
    assert.equal(report.result, "FALSE");
  });

  it("an unregistered placement: UNDETERMINED with the placement named", async () => {
    const report = await checkIngest(await ingestEntries(await entries({ "proof.json": "unregistered.proof.json", "photo.bin": "fused-unregistered.bin" })));
    const rec = report.recordings[0]!;
    const fused = rec.lines.find((l) => l.name === "fused")!;
    assert.equal(fused.result, "UNDETERMINED");
    assert.match(fused.detail, /xmp\/9/);
  });

  it("an ordinary recording has no fused line and no fused block", async () => {
    const report = await checkIngest(await ingestEntries(await entries({ "proof.json": "recorded.proof.json", "original.txt": "original.txt" })));
    const rec = report.recordings[0]!;
    assert.equal(rec.lines.find((l) => l.name === "fused"), undefined);
    assert.equal(rec.fused, undefined);
    assert.equal(rec.lines.find((l) => l.name === "file")?.result, "TRUE");
  });

  it("container/1 from the PNG alone and produced/1 from its own bytes", async () => {
    const a = await checkIngest(await ingestEntries(await entries({ "proof.json": "container.proof.json", "image.png": "image.png" })));
    assert.equal(a.recordings[0]!.fused!.category, "FUSED_FROM_ORIGIN");
    assert.equal(a.recordings[0]!.fused!.placement, "container/1");
    const b = await checkIngest(await ingestEntries(await entries({ "proof.json": "produced-origin.proof.json", "record.json": "produced-origin.json" })));
    assert.equal(b.recordings[0]!.fused!.category, "FUSED_DIRECT");
    assert.equal(b.recordings[0]!.fused!.placement, "produced/1");
  });

  it("disk and memory ingests of the same fused bundle give byte-identical reports", async () => {
    const dir = await mkdtemp(join(tmpdir(), "bitgraph-fuse-check-"));
    try {
      await mkdir(dir, { recursive: true });
      await writeFile(join(dir, "proof.json"), await read("trailer.proof.json"));
      await writeFile(join(dir, "original.txt"), await read("original.txt"));
      const fromDisk = await checkIngest(await ingestBundle(dir));
      const fromMemory = await checkIngest(await ingestEntries(await entries({ "proof.json": "trailer.proof.json", "original.txt": "original.txt" })));
      assert.equal(serializeCheckReport(fromDisk), serializeCheckReport(fromMemory));
      assert.equal(fromDisk.recordings[0]!.fused!.category, "FUSED_FROM_ORIGIN");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});

describe("fusedFloor", () => {
  const bound = (anchorProofHash: string, blockNumber: string, timestamp: number): SegmentBound => ({
    kind: "not-before", anchorProofHash, blockNumber, blockHash: "0x" + "ab".repeat(32), timestamp,
    evidence: "counter-order", weaker: true, basis: "block-hash-unpredictability", boundClass: "evidence", claim: "",
  });
  const anchor = (proofHash: string, counter: string): AnchorRecord => ({ proofHash, chainId: "bitgraph:main", counter, metadataCorroboration: "absent" } as unknown as AnchorRecord);
  const segment = (lower: SegmentBound[]): TemporalSegment => ({ lowerBounds: lower } as unknown as TemporalSegment);

  it("picks the last verified anchor whose counter precedes the SLOT, not the commit", () => {
    const anchors = new Map([["a1", anchor("a1", "10")], ["a2", anchor("a2", "40")], ["a3", anchor("a3", "45")]]);
    const seg = segment([bound("a1", "100", 1000), bound("a2", "200", 2000), bound("a3", "300", 3000)]);
    // slot 42, commit 50: a3 (counter 45) precedes the commit but not the slot.
    const floor = fusedFloor(seg, anchors, "42");
    assert.equal(floor?.anchorProofHash, "a2");
    assert.equal(floor?.blockNumber, "200");
    assert.equal(floor?.evidence, "counter-order");
  });

  it("no anchor before the slot: null (UNDET), never a following anchor", () => {
    const anchors = new Map([["a3", anchor("a3", "45")]]);
    assert.equal(fusedFloor(segment([bound("a3", "300", 3000)]), anchors, "42"), null);
    assert.equal(fusedFloor(undefined, anchors, "42"), null);
    assert.equal(fusedFloor(segment([bound("a3", "300", 3000)]), anchors, undefined), null);
  });

  it("only not-before bounds count; not-after bounds are never a ceiling", () => {
    const anchors = new Map([["a9", anchor("a9", "5")]]);
    const after: SegmentBound = { ...bound("a9", "900", 9000), kind: "not-after" };
    assert.equal(fusedFloor(segment([after]), anchors, "42"), null);
  });
});
