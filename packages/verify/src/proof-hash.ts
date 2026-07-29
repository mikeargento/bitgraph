// Copyright (c) 2024-2026 Mike Argento. Licensed under the MIT License. See LICENSE.

/**
 * bitgraph-core proof hash
 *
 * Canonical, deterministic proof hash computation.
 *
 * This is the LEDGER IDENTITY of a proof. It hashes a fixed SUBSET of the
 * signed body:
 *   - version, artifact, commit
 *   - publicKeyB64 (from signer)
 *   - enforcement, measurement (from environment)
 *   - attribution (if present)
 *   - attestationFormat (if attestation present)
 *
 * Used for:
 *   - S3 ledger key generation — proofs/{epoch}/{counter}-{proofHash}.json
 *   - Ethereum anchor binding
 *   - Proof deduplication and canonical identity
 *
 * ── THE FIELD LIST ABOVE IS FROZEN. DO NOT ADD TO IT. ──
 *
 * It is tempting to "fix" this function by adding `actor` and `policy`, which
 * ARE in the signed body the enclave signs. Doing so is a silent, permanent
 * break: this value is baked into every S3 object key already written, and
 * ledger verify() compares a recomputed value against the stored `proofHash`
 * field (packages/ledger/src/verify.ts). Widening the subset changes the hash
 * of every existing agency-bearing or policy-bearing proof, orphaning its key
 * and failing its hash check forever. The subset is a compatibility contract,
 * not an approximation of the signature.
 *
 * BitGraph has THREE distinct proof hashes. Confusing them is the single
 * easiest way to break the system, so they are spelled out here:
 *
 *   1. computeProofHash (this function) — signed-body SUBSET.
 *      Ledger identity and S3 key. Frozen. Not a signature-equivalent value.
 *
 *   2. SHA-256 of the FULL canonical signed body — what the Ed25519 signature
 *      actually covers, and what the enclave puts in the Nitro attestation's
 *      user_data. Reconstructed by verifier.ts (step 3) and, in the browser,
 *      by buildSignedBody()/proofHashB64() in website/src/lib/bitgraph.ts.
 *      For a proof with no `actor` and no `policy` this coincides with (1);
 *      for agency or policy proofs it does NOT. Use this for signature and
 *      attestation checks. Never use (1).
 *
 *   3. computeChainHash (below) — the WHOLE proof, minus ledger-added fields.
 *      This is what the enclave writes into the next proof's commit.prevB64
 *      and into epochLink.prevProofHashB64. Matching prevB64 against (1)
 *      silently fails to link real chains.
 *
 * packages/hosted/src/bitcoin-anchor.ts carries a deliberate inline copy of
 * (1) because Railway cannot resolve the monorepo package. It mirrors this
 * field list exactly and must continue to; if this list ever does change,
 * that copy changes with it in the same commit.
 *
 * Algorithm:
 *   1. Extract signed body fields
 *   2. canonicalize(signedBody) — recursive key sort, compact JSON, UTF-8
 *   3. SHA-256 of canonical bytes
 *   4. Base64-standard encode (RFC 4648 §4)
 *
 * IMPORTANT: All call sites MUST use this function. Do NOT compute
 * proof hashes ad-hoc with JSON.stringify or Object.keys().sort().
 * Non-recursive key sorting diverges on nested objects.
 */

import { canonicalize } from "./canonical.js";
import { sha256 } from "@noble/hashes/sha256";
import type { BitGraphProof } from "./types.js";

/**
 * Compute the ledger identity hash of a BitGraph proof.
 *
 * Hashes the frozen signed-body subset described at the top of this file.
 * This is NOT the value the Ed25519 signature covers and NOT the attestation
 * user_data; for that, reconstruct the full signed body (verifier.ts step 3).
 *
 * @param proof - The full BitGraphProof object (or equivalent Record)
 * @returns Base64-standard encoded SHA-256 hash
 */
export function computeProofHash(proof: BitGraphProof | Record<string, unknown>): string {
  const p = proof as Record<string, unknown>;
  const signer = p.signer as { publicKeyB64: string } | undefined;
  const env = p.environment as { enforcement: string; measurement: string; attestation?: { format: string } } | undefined;

  const signedBody: Record<string, unknown> = {
    version: p.version,
    artifact: p.artifact,
    commit: p.commit,
    publicKeyB64: signer?.publicKeyB64,
    enforcement: env?.enforcement,
    measurement: env?.measurement,
  };

  // Include attribution if present
  if (p.attribution) {
    signedBody.attribution = p.attribution;
  }

  // Include attestation format if present
  if (env?.attestation) {
    signedBody.attestationFormat = env.attestation.format;
  }

  const bytes = canonicalize(signedBody as unknown as BitGraphProof);
  const hash = sha256(bytes);
  return base64(hash);
}

/**
 * Fields that are NOT produced by the enclave. They are appended to a proof
 * AFTER it is signed, by the ledger or the anchor service, purely as read-time
 * convenience. The enclave computed its chain hash before any of these
 * existed, so they MUST be excluded from computeChainHash — otherwise a
 * successor's `commit.prevB64` (computed by the enclave over the clean proof)
 * can never match.
 *
 *   proofHash — SHA-256 of the signed-body subset; added by the ledger at
 *               write time (see computeProofHash above).
 *   ethereum  — { blockNumber, blockHash }; added by the anchor service to
 *               anchor records after the transaction is mined. Purely
 *               redundant: the block hash is already in the signed
 *               `attribution.message` and the block number in
 *               `attribution.title`. Present only on Ethereum-anchor proofs.
 *
 * Any future ledger/service-added field must be added here as well.
 */
const LEDGER_ADDED_FIELDS: readonly string[] = ["proofHash", "ethereum"];

/**
 * Compute the CHAIN hash of a BitGraph proof: SHA-256 over the canonicalized
 * whole proof object, with the ledger/service-added fields removed.
 *
 * This is the value the enclave writes into the NEXT proof's
 * `commit.prevB64` (and into `epochLink.prevProofHashB64` at an epoch
 * boundary): the enclave hashes the entire assembled proof, before the ledger
 * or anchor service appends its convenience fields. To link a chain, match a
 * proof's `commit.prevB64` against `computeChainHash(predecessor)`.
 *
 * This differs from computeProofHash, which hashes only the signed-body
 * subset. The chain hash covers every enclave-produced field (signer
 * signature, attestation report, slot allocation, attribution, and so on), so
 * any change anywhere in a proof breaks the link from its successor.
 *
 * @param proof - The full BitGraphProof object (or equivalent Record). Any
 *   ledger/service-added field (see LEDGER_ADDED_FIELDS) is excluded before
 *   hashing.
 * @returns Base64-standard encoded SHA-256 hash
 */
export function computeChainHash(proof: BitGraphProof | Record<string, unknown>): string {
  const p = proof as Record<string, unknown>;
  let hashable: Record<string, unknown> = p;
  if (LEDGER_ADDED_FIELDS.some((k) => Object.prototype.hasOwnProperty.call(p, k))) {
    // Shallow copy without the ledger/service-added fields; the enclave hashed
    // the proof before these existed.
    hashable = {};
    for (const key of Object.keys(p)) {
      if (!LEDGER_ADDED_FIELDS.includes(key)) hashable[key] = p[key];
    }
  }
  const bytes = canonicalize(hashable as unknown as BitGraphProof);
  return base64(sha256(bytes));
}

// Base64-standard encode (works in both Node.js and browser).
function base64(hash: Uint8Array): string {
  if (typeof Buffer !== "undefined") {
    return Buffer.from(hash).toString("base64");
  }
  let binary = "";
  for (let i = 0; i < hash.length; i++) {
    binary += String.fromCharCode(hash[i]!);
  }
  return btoa(binary);
}
