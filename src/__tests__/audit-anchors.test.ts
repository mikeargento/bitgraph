// Copyright (c) Mike Argento. All rights reserved. See LICENSE.

/**
 * Anchor identification tests (G5): the SIGNED attribution.name is the
 * discriminator; unsigned metadata.type is corroboration only, recorded
 * but never trusted; the block number comes only from the signed
 * Etherscan URL; no wall-clock time is ever derived from anything here.
 */

import { describe, it } from "node:test";
import * as assert from "node:assert/strict";
import {
  identifyAnchors,
  ingestBundle,
  verifyObservedProofs,
} from "@mikeargento/bitgraph-audit";
import type { IngestResult } from "@mikeargento/bitgraph-audit";
import {
  makeAnchorProof,
  makeChainIdProof,
  makeTempDir,
  proofJson,
  writeBundleDir,
} from "./audit-fixtures.js";

const BLOCK_HASH = "0x28ed3639cd705fb8cb2b915c1991e9f808b40e775bc8eb540702942729fec2c0";

async function ingestAndVerify(files: Record<string, string | Uint8Array>): Promise<IngestResult> {
  const dir = await makeTempDir("bg-audit-anchors-");
  await writeBundleDir(dir, files);
  const ingest = await ingestBundle(dir);
  await verifyObservedProofs(ingest);
  return ingest;
}

describe("audit anchors: identification by signed attribution", () => {
  it("identifies an anchor by attribution.name and extracts the signed facts", async () => {
    const anchor = await makeAnchorProof({
      blockHash: BLOCK_HASH,
      blockNumber: "24800448",
      epochId: "EPOCH-A",
      counter: "4",
      slotCounter: "3",
      chainId: "bitgraph:main",
      metadata: {
        type: "ethereum-anchor",
        anchor: { blockNumber: 24800448, blockHash: BLOCK_HASH, blockTime: 1750000000 },
      },
    });
    const user = await makeChainIdProof({ chainId: "bitgraph:main", counter: "6", epochId: "EPOCH-A" });

    const ingest = await ingestAndVerify({
      "proofs/anchor.json": proofJson(anchor.proof),
      "proofs/user.json": proofJson(user.proof),
    });
    const result = identifyAnchors(ingest);

    assert.equal(result.anchors.length, 1);
    const record = result.anchors[0]!;
    assert.equal(record.proofHash, anchor.proofHash);
    assert.equal(record.epochId, "EPOCH-A");
    assert.equal(record.chainId, "bitgraph:main");
    assert.equal(record.counter, "4");
    assert.equal(record.slotCounter, "3");
    assert.equal(record.blockHash, BLOCK_HASH);
    assert.equal(record.blockNumber, "24800448");
    assert.equal(record.metadataCorroboration, "agrees");
    // The unsigned metadata carries a blockTime; no time field of any kind
    // may appear on the record.
    assert.ok(!("timestamp" in record));
    assert.ok(!("blockTime" in record));
    assert.equal(result.findings.length, 0);
  });

  it("copies the run verification status onto the record", async () => {
    const good = await makeAnchorProof({ blockHash: BLOCK_HASH, blockNumber: "1", epochId: "E", counter: "2" });
    const bad = await makeAnchorProof({ blockHash: BLOCK_HASH.replace("28", "29"), blockNumber: "2", epochId: "E", counter: "4" });
    // Tamper the signature after signing: identification still works (it
    // reads the signed body fields), and the failed status is copied.
    bad.proof.signer.signatureB64 = `AA${bad.proof.signer.signatureB64.slice(2)}`;

    const ingest = await ingestAndVerify({
      "proofs/good.json": proofJson(good.proof),
      "proofs/bad.json": proofJson(bad.proof),
    });
    const result = identifyAnchors(ingest);

    assert.equal(result.anchors.length, 2);
    const goodRecord = result.anchors.find((a) => a.proofHash === good.proofHash)!;
    assert.equal(goodRecord.verificationTier, "integrity");
    assert.equal(goodRecord.verificationStatus, "artifact-unavailable");
    const badRecord = result.anchors.find((a) => a.proofHash !== good.proofHash)!;
    assert.equal(badRecord.verificationStatus, "failed");
    assert.ok(badRecord.verificationReason !== undefined);
  });

  it("never identifies an anchor from unsigned metadata alone", async () => {
    const user = await makeChainIdProof({ counter: "2", epochId: "E-META" });
    (user.proof as unknown as Record<string, unknown>)["metadata"] = { type: "ethereum-anchor" };

    const ingest = await ingestAndVerify({ "proofs/claimant.json": proofJson(user.proof) });
    const result = identifyAnchors(ingest);

    assert.equal(result.anchors.length, 0);
    assert.equal(result.metadataOnlyProofHashes.length, 1);
    const finding = result.findings.find((f) => f.code === "anchor-metadata-only-claim");
    assert.ok(finding !== undefined);
    assert.match(finding.message, /not treated as an anchor/);
  });

  it("records disagreement between the signed attribution and unsigned metadata", async () => {
    const anchor = await makeAnchorProof({
      blockHash: BLOCK_HASH,
      blockNumber: "7",
      epochId: "E-DIS",
      counter: "2",
      metadata: { type: "something-else" },
    });
    const ingest = await ingestAndVerify({ "proofs/anchor.json": proofJson(anchor.proof) });
    const result = identifyAnchors(ingest);

    assert.equal(result.anchors.length, 1, "the signed field governs: still an anchor");
    assert.equal(result.anchors[0]!.metadataCorroboration, "disagrees");
    assert.ok(result.findings.some((f) => f.code === "anchor-metadata-disagreement"));
  });

  it("treats absent metadata as absent corroboration, not disagreement", async () => {
    const anchor = await makeAnchorProof({ blockHash: BLOCK_HASH, blockNumber: "9", epochId: "E-ABS", counter: "2" });
    const ingest = await ingestAndVerify({ "proofs/anchor.json": proofJson(anchor.proof) });
    const result = identifyAnchors(ingest);
    assert.equal(result.anchors[0]!.metadataCorroboration, "absent");
    assert.equal(result.findings.filter((f) => f.code === "anchor-metadata-disagreement").length, 0);
  });
});

describe("audit anchors: block number from the signed title URL", () => {
  it("parses the number only from a strict Etherscan block URL", async () => {
    const good = await makeAnchorProof({ blockHash: BLOCK_HASH, blockNumber: "24800448", epochId: "E-URL", counter: "2" });
    const foreign = await makeAnchorProof({
      blockHash: BLOCK_HASH.replace("28", "30"),
      title: "https://example.com/block/99",
      epochId: "E-URL",
      counter: "4",
    });
    const missing = await makeAnchorProof({
      blockHash: BLOCK_HASH.replace("28", "31"),
      noTitle: true,
      epochId: "E-URL",
      counter: "6",
    });

    const ingest = await ingestAndVerify({
      "proofs/good.json": proofJson(good.proof),
      "proofs/foreign.json": proofJson(foreign.proof),
      "proofs/missing.json": proofJson(missing.proof),
    });
    const result = identifyAnchors(ingest);

    const byHash = new Map(result.anchors.map((a) => [a.proofHash, a]));
    assert.equal(byHash.get(good.proofHash)!.blockNumber, "24800448");
    assert.equal(byHash.get(foreign.proofHash)!.blockNumber, undefined);
    assert.equal(byHash.get(missing.proofHash)!.blockNumber, undefined);
    assert.equal(result.findings.filter((f) => f.code === "anchor-title-unparseable").length, 2);
  });
});

describe("audit anchors: non-anchor proofs are untouched", () => {
  it("produces no records or findings for ordinary proofs and mutates nothing", async () => {
    const a = await makeChainIdProof({ counter: "2", epochId: "E-PLAIN" });
    const b = await makeChainIdProof({ counter: "4", epochId: "E-PLAIN" });
    const ingest = await ingestAndVerify({
      "proofs/a.json": proofJson(a.proof),
      "proofs/b.json": proofJson(b.proof),
    });
    const statusesBefore = ingest.proofs.map((p) => p.verification?.status);

    const result = identifyAnchors(ingest);

    assert.equal(result.anchors.length, 0);
    assert.equal(result.metadataOnlyProofHashes.length, 0);
    assert.equal(result.findings.length, 0);
    assert.deepEqual(
      ingest.proofs.map((p) => p.verification?.status),
      statusesBefore,
      "identification is read-only"
    );
  });
});
