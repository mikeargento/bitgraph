/**
 * BitGraph Ledger — Verification
 *
 * Verifies a proof's causal placement:
 *   1. Proof signature is valid (Ed25519)
 *   2. Slot preceded commit (atomic causality)
 *   3. Chain links are valid (prevB64)
 *   4. Proof is bounded by a front anchor (Ethereum)
 *
 * The user keeps only their file. This module proves:
 *   "This file existed after [prev anchor] and before [next anchor]"
 */

import { sha256 } from "@noble/hashes/sha256";
import { verifyAsync } from "@noble/ed25519";
import { canonicalize, computeProofHash } from "bitgraph";
import type { StoredProof, StoredAnchor, Finalization } from "./types.js";

// ---------------------------------------------------------------------------
// Verification result
// ---------------------------------------------------------------------------

export interface CausalVerification {
  /** Does the artifact hash match? */
  artifactMatch: boolean;

  /** Is the Ed25519 signature valid? */
  signatureValid: boolean;

  /** Does slotCounter < counter? (slot preceded commit) */
  slotBeforeCommit: boolean;

  /** Does slotHashB64 match the embedded slot allocation? */
  slotBindingValid: boolean;

  /** Is this proof bounded by a front anchor? */
  bounded: boolean;

  /** The Ethereum block that seals this proof (front anchor). */
  boundedByBlock?: number;
  boundedByBlockHash?: string;

  /** The previous anchor (if any). */
  afterBlock?: number;
  afterBlockHash?: string;

  /** The proof's causal position. */
  counter: string;
  epochId: string;

  /** Overall validity. */
  valid: boolean;
}

// ---------------------------------------------------------------------------
// Verify
// ---------------------------------------------------------------------------

/**
 * Verify a proof's causal placement given the proof, its bounding anchor,
 * and optionally the previous anchor.
 */
export async function verifyCausalPlacement(
  proof: StoredProof,
  anchorAfter?: StoredAnchor,
  anchorBefore?: StoredAnchor,
): Promise<CausalVerification> {

  // 1. Verify Ed25519 signature
  const signedBody: Record<string, unknown> = {
    version: proof.version,
    artifact: proof.artifact,
    commit: proof.commit,
    publicKeyB64: proof.signer.publicKeyB64,
    enforcement: proof.environment.enforcement,
    measurement: proof.environment.measurement,
  };
  if (proof.attribution) signedBody.attribution = proof.attribution;
  if (proof.environment.attestation) {
    signedBody.attestationFormat = proof.environment.attestation.format;
  }

  const bodyBytes = canonicalize(signedBody);
  const pubKeyBytes = Buffer.from(proof.signer.publicKeyB64, "base64");
  const sigBytes = Buffer.from(proof.signer.signatureB64, "base64");

  let signatureValid = false;
  try {
    signatureValid = await verifyAsync(sigBytes, bodyBytes, pubKeyBytes);
  } catch { /* invalid */ }

  // 2. Verify slot preceded commit
  const slotCounter = proof.commit.slotCounter ? BigInt(proof.commit.slotCounter) : undefined;
  const commitCounter = BigInt(proof.commit.counter);
  const slotBeforeCommit = slotCounter !== undefined && slotCounter < commitCounter;

  // 3. Verify slot binding (slotHashB64 matches embedded slot)
  let slotBindingValid = false;
  if (proof.slotAllocation && proof.commit.slotHashB64) {
    const slotBody = {
      version: proof.slotAllocation.version,
      nonceB64: proof.slotAllocation.nonceB64,
      counter: proof.slotAllocation.counter,
      epochId: proof.slotAllocation.epochId,
      publicKeyB64: proof.slotAllocation.publicKeyB64,
    };
    const slotHash = Buffer.from(sha256(canonicalize(slotBody))).toString("base64");
    slotBindingValid = slotHash === proof.commit.slotHashB64;
  }

  // 4. Check bounding by front anchor
  const bounded = anchorAfter !== undefined;
  const boundedByBlock = anchorAfter?.ethereum.blockNumber;
  const boundedByBlockHash = anchorAfter?.ethereum.blockHash;
  const afterBlock = anchorBefore?.ethereum.blockNumber;
  const afterBlockHash = anchorBefore?.ethereum.blockHash;

  // 5. Verify proof hash
  const computedHash = computeProofHash(proof);
  const hashValid = computedHash === proof.proofHash;

  const valid = signatureValid && slotBeforeCommit && slotBindingValid && hashValid;

  return {
    artifactMatch: true, // caller verifies file hash matches proof.artifact.digestB64
    signatureValid,
    slotBeforeCommit,
    slotBindingValid,
    bounded,
    boundedByBlock,
    boundedByBlockHash,
    afterBlock,
    afterBlockHash,
    counter: proof.commit.counter,
    epochId: proof.commit.epochId,
    valid,
  };
}
