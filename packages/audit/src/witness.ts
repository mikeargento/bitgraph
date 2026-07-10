// Copyright (c) 2024-2026 Mike Argento. Licensed under the MIT License. See LICENSE.

/**
 * bitgraph-audit anchor witness verification
 *
 * Implements the mandatory procedure of docs/BUNDLE-FORMAT.md section
 * 10.3, exactly and fully offline:
 *
 *   1. Hex-decode headerRlpHex and require a single well-formed RLP list.
 *   2. Recompute the block hash locally with Keccak-256 (Ethereum's
 *      original Keccak padding, explicitly NOT FIPS-202 SHA3-256).
 *   3. Compare against the anchor's SIGNED attribution.message
 *      (lowercased, full 0x string).
 *   4. Bind the signed message to the committed artifact: SHA-256 over
 *      the UTF-8 bytes of the exact signed message string must equal the
 *      strictly decoded artifact.digestB64.
 *   5. Cross-check the claimed fields: header RLP index 8 (number)
 *      against the witness's blockNumber and, when the signed
 *      attribution.title parses as an Etherscan block URL, against the
 *      URL; and the witness's claimed blockHash against the recomputed
 *      hash.
 *   6. Only then read the timestamp from RLP index 11 as external
 *      wall-clock evidence.
 *
 * Preconditions per the spec: the candidate anchor is identified by its
 * signed attribution and its own cryptographic verification has
 * succeeded. A witness cannot rescue an invalid proof. Intrinsic
 * validity (validity.ts) is used for the precondition, so a run-order
 * epoch-link artifact never disqualifies a sound anchor, and the run
 * verification record is never modified.
 *
 * Any failure means the witness confers nothing: no timestamp is
 * reported, and the anchor proof's own standing is unchanged in both
 * directions. Failure codes are stable AnomalyCode literals.
 *
 * Zero network access: witnesses are inbound files, trust in them is
 * established purely by local recomputation.
 */

import { sha256 } from "@noble/hashes/sha256";
import { keccak_256 } from "@noble/hashes/sha3";
import { bytesToHex0x, decodeRlpList, hexToBytes, rlpBytesToBigInt } from "./rlp.js";
import { isIntrinsicallyValid } from "./validity.js";
import type {
  AnchorIdentification,
  AnchorWitnessAnalysis,
  AnchorWitnessFile,
  AnchorWitnessOutcome,
  AnomalyCode,
  AuditFinding,
  IngestResult,
  ObservedProof,
} from "./types.js";

const HEADER_NUMBER_INDEX = 8;
const HEADER_TIMESTAMP_INDEX = 11;
const BLOCK_HASH_SHAPE = /^0x[0-9a-fA-F]{64}$/;
const ETHERSCAN_BLOCK_URL = /^https:\/\/etherscan\.io\/block\/([0-9]+)$/;

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Verify every witness file in the bundle against the identified anchors.
 *
 * Matching is by block hash: a witness is a candidate for every anchor
 * whose signed attribution.message equals (case-insensitively) either the
 * locally recomputed header hash or the witness's claimed blockHash. The
 * second route exists so a witness with a tampered header still fails
 * loudly against its intended anchor (witness-hash-mismatch) instead of
 * disappearing as unmatched. A witness matching no anchor is reported
 * witness-unmatched.
 *
 * Deterministic: witnesses in observation order, candidate anchors in
 * identification (observation) order. Run after verifyObservedProofs and
 * identifyAnchors.
 */
export async function verifyAnchorWitnesses(
  ingest: IngestResult,
  identification: AnchorIdentification
): Promise<AnchorWitnessAnalysis> {
  const outcomes: AnchorWitnessOutcome[] = [];
  const findings: AuditFinding[] = [];
  const byHash = new Map<string, ObservedProof>(ingest.proofs.map((p) => [p.proofHash, p]));

  for (const witnessFile of ingest.witnesses) {
    const decoded = decodeWitness(witnessFile);
    if (decoded.failure !== undefined) {
      const outcome: AnchorWitnessOutcome = {
        witnessPath: witnessFile.path,
        verified: false,
        reason: decoded.failure.reason,
        detail: decoded.failure.detail,
      };
      outcomes.push(outcome);
      findings.push(toFinding(outcome));
      continue;
    }

    // Candidate anchors by recomputed hash or claimed hash.
    const computed = decoded.computedHash as string;
    const claimed = (decoded.claimedHash as string).toLowerCase();
    const candidates = identification.anchors.filter((anchor) => {
      const message = anchor.blockHash?.toLowerCase();
      return message !== undefined && (message === computed || message === claimed);
    });

    if (candidates.length === 0) {
      const outcome: AnchorWitnessOutcome = {
        witnessPath: witnessFile.path,
        verified: false,
        reason: "witness-unmatched",
        detail:
          "neither the locally recomputed block hash nor the claimed blockHash matches any " +
          "observed anchor's signed attribution.message",
        computedBlockHash: computed,
      };
      outcomes.push(outcome);
      findings.push(toFinding(outcome));
      continue;
    }

    for (const candidate of candidates) {
      const anchorProof = byHash.get(candidate.proofHash);
      const anchorValid = anchorProof !== undefined && (await isIntrinsicallyValid(anchorProof));
      const outcome = runProcedure(decoded, witnessFile.path, candidate.proofHash, anchorProof, anchorValid);
      outcomes.push(outcome);
      if (!outcome.verified) findings.push(toFinding(outcome));
    }
  }

  return { outcomes, findings };
}

/**
 * Verify one witness file against one specific anchor proof, running the
 * full spec 10.3 procedure. Exposed for targeted use; the pipeline
 * (verifyAnchorWitnesses) applies the same procedure with hash-based
 * matching.
 */
export async function verifyAnchorWitness(
  witnessFile: AnchorWitnessFile,
  anchorProof: ObservedProof
): Promise<AnchorWitnessOutcome> {
  const decoded = decodeWitness(witnessFile);
  if (decoded.failure !== undefined) {
    return {
      witnessPath: witnessFile.path,
      anchorProofHash: anchorProof.proofHash,
      verified: false,
      reason: decoded.failure.reason,
      detail: decoded.failure.detail,
    };
  }
  const anchorValid = await isIntrinsicallyValid(anchorProof);
  return runProcedure(decoded, witnessFile.path, anchorProof.proofHash, anchorProof, anchorValid);
}

// ---------------------------------------------------------------------------
// Witness decoding (spec 10.3 steps 1 and 2, anchor-independent)
// ---------------------------------------------------------------------------

interface DecodedWitness {
  /** Present when decoding failed at or before step 2. */
  failure?: { reason: AnomalyCode; detail: string };
  /** 0x + 64 lowercase hex, locally recomputed. */
  computedHash?: string;
  /** RLP items of the header list. */
  items?: ReturnType<typeof decodeRlpList>;
  claimedHash?: string;
  claimedNumber?: bigint;
}

function decodeWitness(witnessFile: AnchorWitnessFile): DecodedWitness {
  const w = witnessFile.witness;

  // Field rules of spec 10.2.
  const headerRlpHex = w["headerRlpHex"];
  if (typeof headerRlpHex !== "string") {
    return malformed("headerRlpHex is missing or not a string");
  }
  const blockNumber = w["blockNumber"];
  if (typeof blockNumber !== "number" || !Number.isInteger(blockNumber) || blockNumber < 0) {
    return malformed("blockNumber is missing or not a non-negative integer");
  }
  const blockHash = w["blockHash"];
  if (typeof blockHash !== "string" || !BLOCK_HASH_SHAPE.test(blockHash)) {
    return malformed("blockHash is missing or not 0x followed by 64 hex characters");
  }

  // Step 1: hex-decode, then require a single well-formed RLP list.
  const headerBytes = hexToBytes(headerRlpHex);
  if (headerBytes === null) {
    return malformed("headerRlpHex is not 0x-prefixed even-length hex");
  }
  let items: ReturnType<typeof decodeRlpList>;
  try {
    items = decodeRlpList(headerBytes);
  } catch (error) {
    return {
      failure: {
        reason: "witness-rlp-invalid",
        detail: error instanceof Error ? error.message : String(error),
      },
    };
  }

  // Step 2: Keccak-256 over the exact decoded header bytes.
  const computedHash = bytesToHex0x(keccak_256(headerBytes));

  return {
    computedHash,
    items,
    claimedHash: blockHash,
    claimedNumber: BigInt(blockNumber),
  };
}

function malformed(detail: string): DecodedWitness {
  return { failure: { reason: "witness-malformed", detail } };
}

// ---------------------------------------------------------------------------
// Steps 3 through 6 against one candidate anchor
// ---------------------------------------------------------------------------

function runProcedure(
  decoded: DecodedWitness,
  witnessPath: string,
  anchorProofHash: string,
  anchorProof: ObservedProof | undefined,
  anchorValid: boolean
): AnchorWitnessOutcome {
  const computedHash = decoded.computedHash as string;
  const base = {
    witnessPath,
    anchorProofHash,
    computedBlockHash: computedHash,
  };
  const fail = (reason: AnomalyCode, detail: string, extra?: { blockNumber?: string }): AnchorWitnessOutcome => ({
    ...base,
    verified: false,
    reason,
    detail,
    ...(extra?.blockNumber !== undefined ? { blockNumber: extra.blockNumber } : {}),
  });

  // Preconditions: the anchor proof's own cryptographic verification must
  // have succeeded. A witness cannot rescue an invalid proof.
  if (anchorProof === undefined || !anchorValid) {
    return fail(
      "witness-anchor-invalid",
      "the candidate anchor proof is not cryptographically valid; the witness confers nothing"
    );
  }

  // Step 3: recomputed hash against the SIGNED attribution.message.
  const message = readSignedMessage(anchorProof);
  if (message === undefined || message.toLowerCase() !== computedHash) {
    return fail(
      "witness-hash-mismatch",
      message === undefined
        ? "the anchor carries no signed attribution.message to compare against"
        : "the locally recomputed block hash does not equal the anchor's signed attribution.message"
    );
  }

  // Step 4: bind the signed message string to the committed artifact.
  // SHA-256 over the exact signed string, no case normalization: the
  // digest covers the string as signed (bitcoin-anchor.ts hashes the
  // block-hash STRING).
  const digest = strictBase64Decode32(readDigestB64(anchorProof));
  if (digest === null) {
    return fail(
      "witness-digest-mismatch",
      "the anchor's artifact.digestB64 does not strictly decode as base64 of 32 bytes"
    );
  }
  const messageHash = sha256(new TextEncoder().encode(message));
  if (!bytesEqual(messageHash, digest)) {
    return fail(
      "witness-digest-mismatch",
      "SHA-256 of the exact signed attribution.message string does not equal the anchor's artifact digest"
    );
  }

  // Step 5: cross-check the claimed fields.
  const items = decoded.items as ReturnType<typeof decodeRlpList>;
  const numberItem = items[HEADER_NUMBER_INDEX];
  if (numberItem === undefined || !(numberItem instanceof Uint8Array)) {
    return fail(
      "witness-header-shape",
      `header RLP item ${HEADER_NUMBER_INDEX} (block number) is missing or not a byte string`
    );
  }
  const headerNumber = rlpBytesToBigInt(numberItem);
  if (headerNumber !== decoded.claimedNumber) {
    return fail(
      "witness-block-number-mismatch",
      `the witness claims blockNumber ${decoded.claimedNumber}, but the header's number field is ${headerNumber}`,
      { blockNumber: String(headerNumber) }
    );
  }
  const title = readSignedTitle(anchorProof);
  if (title !== undefined) {
    const urlNumber = ETHERSCAN_BLOCK_URL.exec(title)?.[1];
    if (urlNumber !== undefined && BigInt(urlNumber) !== headerNumber) {
      return fail(
        "witness-block-number-mismatch",
        `the anchor's signed Etherscan URL names block ${urlNumber}, but the header's number field is ${headerNumber}`,
        { blockNumber: String(headerNumber) }
      );
    }
  }
  if ((decoded.claimedHash as string).toLowerCase() !== computedHash) {
    return fail(
      "witness-claimed-hash-mismatch",
      "the witness's claimed blockHash does not equal the locally recomputed block hash",
      { blockNumber: String(headerNumber) }
    );
  }

  // Step 6: only now, read the timestamp.
  const timestampItem = items[HEADER_TIMESTAMP_INDEX];
  if (timestampItem === undefined || !(timestampItem instanceof Uint8Array)) {
    return fail(
      "witness-header-shape",
      `header RLP item ${HEADER_TIMESTAMP_INDEX} (timestamp) is missing or not a byte string`,
      { blockNumber: String(headerNumber) }
    );
  }
  const timestamp = rlpBytesToBigInt(timestampItem);
  if (timestamp > BigInt(Number.MAX_SAFE_INTEGER)) {
    return fail(
      "witness-header-shape",
      "header timestamp does not fit a safe integer",
      { blockNumber: String(headerNumber) }
    );
  }

  return {
    ...base,
    verified: true,
    blockNumber: String(headerNumber),
    timestamp: Number(timestamp),
  };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function readSignedMessage(proof: ObservedProof): string | undefined {
  return readAttribution(proof, "message");
}

function readSignedTitle(proof: ObservedProof): string | undefined {
  return readAttribution(proof, "title");
}

function readAttribution(proof: ObservedProof, field: string): string | undefined {
  const attribution = (proof.proof as unknown as Record<string, unknown>)["attribution"];
  if (attribution === null || typeof attribution !== "object" || Array.isArray(attribution)) {
    return undefined;
  }
  const value = (attribution as Record<string, unknown>)[field];
  return typeof value === "string" ? value : undefined;
}

function readDigestB64(proof: ObservedProof): string | undefined {
  const artifact = (proof.proof as unknown as Record<string, unknown>)["artifact"];
  if (artifact === null || typeof artifact !== "object" || Array.isArray(artifact)) {
    return undefined;
  }
  const value = (artifact as Record<string, unknown>)["digestB64"];
  return typeof value === "string" ? value : undefined;
}

/** Strict standard base64 of exactly 32 bytes (spec 6.3 rules), or null. */
function strictBase64Decode32(value: string | undefined): Uint8Array | null {
  if (value === undefined || value.length === 0) return null;
  const decoded = Buffer.from(value, "base64");
  if (decoded.length !== 32 || decoded.toString("base64") !== value) return null;
  return new Uint8Array(decoded);
}

function bytesEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= (a[i] as number) ^ (b[i] as number);
  return diff === 0;
}

function toFinding(outcome: AnchorWitnessOutcome): AuditFinding {
  return {
    code: outcome.reason as AnomalyCode,
    path: outcome.witnessPath,
    message: `anchor witness rejected: ${outcome.detail ?? "verification failed"}. The witness confers nothing; the anchor proof's own standing is unchanged.`,
    details: {
      ...(outcome.anchorProofHash !== undefined ? { anchorProofHash: outcome.anchorProofHash } : {}),
      ...(outcome.computedBlockHash !== undefined
        ? { computedBlockHash: outcome.computedBlockHash }
        : {}),
    },
  };
}
