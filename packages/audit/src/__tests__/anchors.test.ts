// Copyright (c) 2024-2026 Mike Argento.

/**
 * What counts as an anchor, and where its block is read from.
 *
 * This package's job is rigour about anchors, and until now it had no test at
 * all for the discriminator it documents. The discriminator also just changed:
 * `attribution.name === "Ethereum Anchor"` was the only test, and it is now the
 * fallback behind the signed `commit.anchor` that enclave v7 introduced.
 *
 * The case that matters is the last one. An anchor fused like every other
 * artifact needs its attribution for the `bitgraph-fuse/1` marker, so the name
 * is gone and the block has to come from `commit.anchor`. If that stops
 * working, fused anchors become invisible to an audit.
 *
 * Run: node --test packages/audit/src/__tests__/anchors.test.ts
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { identifyAnchors } from "../anchors.ts";
import type { IngestResult, ObservedProof } from "../types.ts";

const BLOCK = 25928913;
const HASH = "0x0ce4f044093cdd272ce4d7f47903a2f77e9195c4a5267a3eb7200e3a7d9ba7fa";

function observed(proof: Record<string, unknown>, proofHash: string): ObservedProof {
  return {
    proofHash,
    chainHash: `chain-${proofHash}`,
    proof: proof as never,
    sources: [],
    version: "bitgraph/1",
    chainId: "bitgraph:main",
  } as unknown as ObservedProof;
}

function ingest(proofs: ObservedProof[]): IngestResult {
  return { bundlePath: "test", container: "directory", proofs } as unknown as IngestResult;
}

/** Pre-v7: the signed name is the only thing saying anchor. Most of the ledger. */
const legacy = observed({
  commit: { counter: "10956" },
  attribution: {
    name: "Ethereum Anchor",
    title: `https://etherscan.io/block/${BLOCK}`,
    message: HASH,
  },
  metadata: { type: "ethereum-anchor" },
}, "legacy");

/** v7 onward: both the signed mark and the name. */
const authenticated = observed({
  commit: { counter: "10957", anchor: { blockNumber: BLOCK, blockHash: HASH } },
  attribution: {
    name: "Ethereum Anchor",
    title: `https://etherscan.io/block/${BLOCK}`,
    message: HASH,
  },
  metadata: { type: "ethereum-anchor" },
}, "authenticated");

/** Fused: attribution spent on the fuse marker, block only in commit.anchor. */
const fused = observed({
  commit: { counter: "10958", anchor: { blockNumber: BLOCK, blockHash: HASH } },
  attribution: { name: "bitgraph-fuse/1", title: "container/2" },
  metadata: { type: "ethereum-anchor" },
}, "fused");

/** An unsigned claim with nothing behind it. Never an anchor. */
const metadataOnly = observed({
  commit: { counter: "10959" },
  attribution: { name: "Someone" },
  metadata: { type: "ethereum-anchor" },
}, "metadata-only");

const notAnAnchor = observed({
  commit: { counter: "10960" },
  attribution: { name: "Someone" },
}, "ordinary");

test("a legacy anchor is still an anchor, and its block still comes from attribution", () => {
  const { anchors, findings } = identifyAnchors(ingest([legacy]));
  assert.equal(anchors.length, 1, "the attribution name must keep identifying pre-v7 anchors");
  assert.equal(anchors[0].blockHash, HASH);
  assert.equal(anchors[0].blockNumber, String(BLOCK));
  assert.equal(findings.length, 0);
});

test("an authenticated anchor reads its block from the signed commit.anchor", () => {
  const { anchors, findings } = identifyAnchors(ingest([authenticated]));
  assert.equal(anchors.length, 1);
  assert.equal(anchors[0].blockHash, HASH);
  assert.equal(anchors[0].blockNumber, String(BLOCK));
  assert.equal(findings.length, 0);
});

test("a fused anchor is identified with no attribution name at all", () => {
  // The whole point of the migration: attribution is spent on the fuse marker.
  const { anchors, findings } = identifyAnchors(ingest([fused]));
  assert.equal(anchors.length, 1, "commit.anchor must identify an anchor on its own");
  assert.equal(anchors[0].blockHash, HASH, "the block must be readable without attribution");
  assert.equal(anchors[0].blockNumber, String(BLOCK));
  assert.equal(
    findings.filter((f) => f.code === "anchor-title-unparseable").length,
    0,
    "an authenticated anchor does not need a parseable title, so absence is not a finding",
  );
});

test("an unsigned metadata claim is recorded and refused", () => {
  const { anchors, metadataOnlyProofHashes, findings } = identifyAnchors(ingest([metadataOnly]));
  assert.equal(anchors.length, 0);
  assert.deepEqual(metadataOnlyProofHashes, ["metadata-only"]);
  assert.equal(findings.filter((f) => f.code === "anchor-metadata-only-claim").length, 1);
});

test("an ordinary proof is not an anchor and raises nothing", () => {
  const { anchors, metadataOnlyProofHashes, findings } = identifyAnchors(ingest([notAnAnchor]));
  assert.equal(anchors.length, 0);
  assert.equal(metadataOnlyProofHashes.length, 0);
  assert.equal(findings.length, 0);
});

test("a legacy anchor without a parseable title still reports that", () => {
  const noTitle = observed({
    commit: { counter: "1" },
    attribution: { name: "Ethereum Anchor", message: HASH },
  }, "legacy-no-title");
  const { anchors, findings } = identifyAnchors(ingest([noTitle]));
  assert.equal(anchors.length, 1);
  assert.equal(anchors[0].blockNumber, undefined);
  assert.equal(findings.filter((f) => f.code === "anchor-title-unparseable").length, 1);
});

test("all forms are found together, in observation order", () => {
  const { anchors } = identifyAnchors(ingest([legacy, notAnAnchor, authenticated, metadataOnly, fused]));
  assert.deepEqual(anchors.map((a) => a.proofHash), ["legacy", "authenticated", "fused"]);
});
