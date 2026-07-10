// Copyright (c) Mike Argento. All rights reserved. See LICENSE.

/**
 * Anchor witness verification tests (bundle spec section 10.3).
 *
 * The synthetic header is a 20-item RLP list with the block number at
 * index 8 and the timestamp at index 11; its Keccak-256 hash is the
 * "block hash", the anchor's signed attribution.message is that hash,
 * and the anchor's artifact digest is SHA-256 over the hash STRING,
 * exactly like bitcoin-anchor.ts. Full verification yields the header
 * timestamp; every single-point corruption fails with its own stable
 * reason and confers nothing.
 */

import { describe, it } from "node:test";
import * as assert from "node:assert/strict";
import { keccak_256 } from "@noble/hashes/sha3";
import { sha256 } from "@noble/hashes/sha256";
import {
  identifyAnchors,
  ingestBundle,
  verifyAnchorWitness,
  verifyAnchorWitnesses,
  verifyObservedProofs,
} from "@mikeargento/bitgraph-audit";
import type { AnchorIdentification, IngestResult } from "@mikeargento/bitgraph-audit";
import {
  b64,
  makeAnchorProof,
  makeEthereumHeader,
  makeTempDir,
  proofJson,
  utf8,
  witnessJson,
  writeBundleDir,
} from "./audit-fixtures.js";

const BLOCK_NUMBER = 24800448;
const TIMESTAMP = 1750000000;

const HEADER = makeEthereumHeader({ blockNumber: BLOCK_NUMBER, timestamp: TIMESTAMP });
const BLOCK_HASH = `0x${Buffer.from(keccak_256(HEADER.headerBytes)).toString("hex")}`;

async function pipeline(
  files: Record<string, string | Uint8Array>
): Promise<{ ingest: IngestResult; anchors: AnchorIdentification }> {
  const dir = await makeTempDir("bg-audit-witness-");
  await writeBundleDir(dir, files);
  const ingest = await ingestBundle(dir);
  await verifyObservedProofs(ingest);
  return { ingest, anchors: identifyAnchors(ingest) };
}

function goodWitness(): string {
  return witnessJson({
    headerRlpHex: HEADER.headerRlpHex,
    blockNumber: BLOCK_NUMBER,
    blockHash: BLOCK_HASH,
    network: "ethereum-mainnet",
  });
}

describe("audit witness: full verification", () => {
  it("passes every step and yields the header timestamp as the only wall-clock evidence", async () => {
    const anchor = await makeAnchorProof({
      blockHash: BLOCK_HASH,
      blockNumber: String(BLOCK_NUMBER),
      epochId: "E-W1",
      counter: "4",
      slotCounter: "3",
    });
    const { ingest, anchors } = await pipeline({
      "proofs/anchor.json": proofJson(anchor.proof),
      "witnesses/w.json": goodWitness(),
    });

    const analysis = await verifyAnchorWitnesses(ingest, anchors);
    assert.equal(analysis.outcomes.length, 1);
    const outcome = analysis.outcomes[0]!;
    assert.equal(outcome.verified, true);
    assert.equal(outcome.anchorProofHash, anchor.proofHash);
    assert.equal(outcome.computedBlockHash, BLOCK_HASH);
    assert.equal(outcome.blockNumber, String(BLOCK_NUMBER));
    assert.equal(outcome.timestamp, TIMESTAMP);
    assert.equal(outcome.reason, undefined);
    assert.equal(analysis.findings.length, 0);
  });

  it("compares the hash case-insensitively but binds the digest to the exact signed string", async () => {
    // The anchor signed an UPPERCASE hash string; the digest covers that
    // exact string. Step 3 lowercases for comparison, step 4 does not.
    const upper = `0x${BLOCK_HASH.slice(2).toUpperCase()}`;
    const anchor = await makeAnchorProof({
      blockHash: upper,
      blockNumber: String(BLOCK_NUMBER),
      epochId: "E-W2",
      counter: "2",
    });
    const { ingest, anchors } = await pipeline({
      "proofs/anchor.json": proofJson(anchor.proof),
      "witnesses/w.json": goodWitness(),
    });
    const analysis = await verifyAnchorWitnesses(ingest, anchors);
    assert.equal(analysis.outcomes.length, 1);
    assert.equal(analysis.outcomes[0]!.verified, true);
    assert.equal(analysis.outcomes[0]!.timestamp, TIMESTAMP);
  });
});

describe("audit witness: single-point corruptions fail with distinct stable reasons", () => {
  it("wrong claimed blockHash: witness-claimed-hash-mismatch", async () => {
    const anchor = await makeAnchorProof({
      blockHash: BLOCK_HASH,
      blockNumber: String(BLOCK_NUMBER),
      epochId: "E-W3",
      counter: "2",
    });
    const wrongClaim = `0x${"ab".repeat(32)}`;
    const { ingest, anchors } = await pipeline({
      "proofs/anchor.json": proofJson(anchor.proof),
      "witnesses/w.json": witnessJson({
        headerRlpHex: HEADER.headerRlpHex,
        blockNumber: BLOCK_NUMBER,
        blockHash: wrongClaim,
      }),
    });
    const analysis = await verifyAnchorWitnesses(ingest, anchors);
    const outcome = analysis.outcomes[0]!;
    assert.equal(outcome.verified, false);
    assert.equal(outcome.reason, "witness-claimed-hash-mismatch");
    assert.equal(outcome.timestamp, undefined, "a rejected witness confers nothing");
    assert.ok(analysis.findings.some((f) => f.code === "witness-claimed-hash-mismatch"));
  });

  it("wrong artifact digest: witness-digest-mismatch", async () => {
    // Validly signed anchor whose digest covers a different string, so the
    // proof itself verifies but the message-to-digest binding fails.
    const anchor = await makeAnchorProof({
      blockHash: BLOCK_HASH,
      blockNumber: String(BLOCK_NUMBER),
      epochId: "E-W4",
      counter: "2",
      digestB64: b64(sha256(utf8("some other committed artifact"))),
    });
    const { ingest, anchors } = await pipeline({
      "proofs/anchor.json": proofJson(anchor.proof),
      "witnesses/w.json": goodWitness(),
    });
    const analysis = await verifyAnchorWitnesses(ingest, anchors);
    const outcome = analysis.outcomes[0]!;
    assert.equal(outcome.verified, false);
    assert.equal(outcome.reason, "witness-digest-mismatch");
    assert.equal(outcome.timestamp, undefined);
  });

  it("wrong claimed blockNumber: witness-block-number-mismatch", async () => {
    const anchor = await makeAnchorProof({
      blockHash: BLOCK_HASH,
      blockNumber: String(BLOCK_NUMBER),
      epochId: "E-W5",
      counter: "2",
    });
    const { ingest, anchors } = await pipeline({
      "proofs/anchor.json": proofJson(anchor.proof),
      "witnesses/w.json": witnessJson({
        headerRlpHex: HEADER.headerRlpHex,
        blockNumber: BLOCK_NUMBER + 1,
        blockHash: BLOCK_HASH,
      }),
    });
    const analysis = await verifyAnchorWitnesses(ingest, anchors);
    const outcome = analysis.outcomes[0]!;
    assert.equal(outcome.verified, false);
    assert.equal(outcome.reason, "witness-block-number-mismatch");
    assert.match(outcome.detail as string, /witness claims blockNumber/);
  });

  it("signed Etherscan URL disagreeing with the header: witness-block-number-mismatch", async () => {
    const anchor = await makeAnchorProof({
      blockHash: BLOCK_HASH,
      blockNumber: String(BLOCK_NUMBER + 7),
      epochId: "E-W6",
      counter: "2",
    });
    const { ingest, anchors } = await pipeline({
      "proofs/anchor.json": proofJson(anchor.proof),
      "witnesses/w.json": goodWitness(),
    });
    const analysis = await verifyAnchorWitnesses(ingest, anchors);
    const outcome = analysis.outcomes[0]!;
    assert.equal(outcome.verified, false);
    assert.equal(outcome.reason, "witness-block-number-mismatch");
    assert.match(outcome.detail as string, /Etherscan URL/);
  });

  it("tampered RLP header bytes: witness-hash-mismatch", async () => {
    const anchor = await makeAnchorProof({
      blockHash: BLOCK_HASH,
      blockNumber: String(BLOCK_NUMBER),
      epochId: "E-W7",
      counter: "2",
    });
    // Flip content bytes in the middle: still well-formed RLP, different
    // Keccak hash. The witness still reaches its intended anchor through
    // the claimed hash and fails loudly at step 3.
    const tampered =
      HEADER.headerRlpHex.slice(0, 40) +
      (HEADER.headerRlpHex[40] === "f" ? "e" : "f") +
      HEADER.headerRlpHex.slice(41);
    const { ingest, anchors } = await pipeline({
      "proofs/anchor.json": proofJson(anchor.proof),
      "witnesses/w.json": witnessJson({
        headerRlpHex: tampered,
        blockNumber: BLOCK_NUMBER,
        blockHash: BLOCK_HASH,
      }),
    });
    const analysis = await verifyAnchorWitnesses(ingest, anchors);
    const outcome = analysis.outcomes[0]!;
    assert.equal(outcome.verified, false);
    assert.equal(outcome.reason, "witness-hash-mismatch");
    assert.equal(outcome.timestamp, undefined);
  });
});

describe("audit witness: malformed and unusable witnesses", () => {
  it("field violations fail with witness-malformed", async () => {
    const anchor = await makeAnchorProof({
      blockHash: BLOCK_HASH,
      blockNumber: String(BLOCK_NUMBER),
      epochId: "E-W8",
      counter: "2",
    });
    const { ingest, anchors } = await pipeline({
      "proofs/anchor.json": proofJson(anchor.proof),
      "witnesses/no-header.json": witnessJson({
        blockNumber: BLOCK_NUMBER,
        blockHash: BLOCK_HASH,
        omit: ["headerRlpHex"],
      }),
      "witnesses/string-number.json": witnessJson({
        headerRlpHex: HEADER.headerRlpHex,
        blockNumber: String(BLOCK_NUMBER),
        blockHash: BLOCK_HASH,
      }),
      "witnesses/bad-hash-shape.json": witnessJson({
        headerRlpHex: HEADER.headerRlpHex,
        blockNumber: BLOCK_NUMBER,
        blockHash: "28ed3639",
      }),
    });
    const analysis = await verifyAnchorWitnesses(ingest, anchors);
    assert.equal(analysis.outcomes.length, 3);
    for (const outcome of analysis.outcomes) {
      assert.equal(outcome.verified, false);
      assert.equal(outcome.reason, "witness-malformed");
      assert.equal(outcome.timestamp, undefined);
    }
  });

  it("structurally invalid RLP fails with witness-rlp-invalid", async () => {
    const anchor = await makeAnchorProof({
      blockHash: BLOCK_HASH,
      blockNumber: String(BLOCK_NUMBER),
      epochId: "E-W9",
      counter: "2",
    });
    const { ingest, anchors } = await pipeline({
      "proofs/anchor.json": proofJson(anchor.proof),
      // 0xf9 declares a long list with a 2-byte length that never arrives.
      "witnesses/w.json": witnessJson({
        headerRlpHex: "0xf901",
        blockNumber: BLOCK_NUMBER,
        blockHash: BLOCK_HASH,
      }),
    });
    const analysis = await verifyAnchorWitnesses(ingest, anchors);
    assert.equal(analysis.outcomes[0]!.reason, "witness-rlp-invalid");
  });

  it("a witness matching no anchor is reported witness-unmatched", async () => {
    const otherHeader = makeEthereumHeader({ blockNumber: 5, timestamp: 6 });
    const otherHash = `0x${Buffer.from(keccak_256(otherHeader.headerBytes)).toString("hex")}`;
    const anchor = await makeAnchorProof({
      blockHash: BLOCK_HASH,
      blockNumber: String(BLOCK_NUMBER),
      epochId: "E-W10",
      counter: "2",
    });
    const { ingest, anchors } = await pipeline({
      "proofs/anchor.json": proofJson(anchor.proof),
      "witnesses/w.json": witnessJson({
        headerRlpHex: otherHeader.headerRlpHex,
        blockNumber: 5,
        blockHash: otherHash,
      }),
    });
    const analysis = await verifyAnchorWitnesses(ingest, anchors);
    const outcome = analysis.outcomes[0]!;
    assert.equal(outcome.verified, false);
    assert.equal(outcome.reason, "witness-unmatched");
    assert.equal(outcome.anchorProofHash, undefined);
  });

  it("a witness cannot rescue an invalid anchor: witness-anchor-invalid", async () => {
    const anchor = await makeAnchorProof({
      blockHash: BLOCK_HASH,
      blockNumber: String(BLOCK_NUMBER),
      epochId: "E-W11",
      counter: "2",
    });
    // Tamper the Ed25519 signature: the canonical identity is unchanged
    // (the signature is outside the signed body) but the proof is invalid.
    anchor.proof.signer.signatureB64 = `AA${anchor.proof.signer.signatureB64.slice(2)}`;
    const { ingest, anchors } = await pipeline({
      "proofs/anchor.json": proofJson(anchor.proof),
      "witnesses/w.json": goodWitness(),
    });
    const analysis = await verifyAnchorWitnesses(ingest, anchors);
    const outcome = analysis.outcomes[0]!;
    assert.equal(outcome.verified, false);
    assert.equal(outcome.reason, "witness-anchor-invalid");
    assert.equal(outcome.timestamp, undefined);
  });
});

describe("audit witness: direct single-pair API", () => {
  it("verifyAnchorWitness runs the full procedure against one anchor", async () => {
    const anchor = await makeAnchorProof({
      blockHash: BLOCK_HASH,
      blockNumber: String(BLOCK_NUMBER),
      epochId: "E-W12",
      counter: "2",
    });
    const { ingest } = await pipeline({
      "proofs/anchor.json": proofJson(anchor.proof),
      "witnesses/w.json": goodWitness(),
    });
    const observed = ingest.proofs.find((p) => p.proofHash === anchor.proofHash)!;
    const witnessFile = ingest.witnesses[0]!;
    const outcome = await verifyAnchorWitness(witnessFile, observed);
    assert.equal(outcome.verified, true);
    assert.equal(outcome.timestamp, TIMESTAMP);
  });
});
