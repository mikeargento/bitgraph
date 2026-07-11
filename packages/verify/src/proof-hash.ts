// Copyright (c) 2024-2026 Mike Argento. Licensed under the MIT License. See LICENSE.

/**
 * bitgraph-core proof hash
 *
 * Canonical, deterministic proof hash computation.
 *
 * The proof hash covers the SIGNED BODY — the fields that are
 * cryptographically signed by the enclave. This matches what the
 * Ed25519 signature covers, making the hash verifiable.
 *
 * Signed body fields:
 *   - version, artifact, commit
 *   - publicKeyB64 (from signer)
 *   - enforcement, measurement (from environment)
 *   - attribution (if present)
 *   - attestationFormat (if attestation present)
 *
 * This hash (the signed-body hash) is used for:
 *   - S3 ledger key generation
 *   - Ethereum anchor binding
 *   - Proof deduplication and canonical identity
 *
 * It is NOT the value referenced by commit.prevB64 or by
 * epochLink.prevProofHashB64. Those reference the CHAIN hash: SHA-256 over
 * the canonicalized WHOLE proof (every field, minus the ledger-added
 * proofHash), computed by computeChainHash below. Matching prevB64 against
 * computeProofHash instead of computeChainHash silently fails to link real
 * chains.
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
 * Compute the canonical hash of a BitGraph proof's signed body.
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
 * Compute the CHAIN hash of a BitGraph proof: SHA-256 over the canonicalized
 * whole proof object, with the ledger-added `proofHash` field removed.
 *
 * This is the value the enclave writes into the NEXT proof's
 * `commit.prevB64` (and into `epochLink.prevProofHashB64` at an epoch
 * boundary): the enclave hashes the entire assembled proof, before the ledger
 * appends its convenience `proofHash` field. To link a chain, match a proof's
 * `commit.prevB64` against `computeChainHash(predecessor)`.
 *
 * This differs from computeProofHash, which hashes only the signed-body
 * subset. The chain hash covers every field (signer signature, attestation
 * report, slot allocation, attribution, and so on), so any change anywhere in
 * a proof breaks the link from its successor.
 *
 * @param proof - The full BitGraphProof object (or equivalent Record). A
 *   top-level `proofHash` field, if present, is excluded before hashing.
 * @returns Base64-standard encoded SHA-256 hash
 */
export function computeChainHash(proof: BitGraphProof | Record<string, unknown>): string {
  const p = proof as Record<string, unknown>;
  let hashable: Record<string, unknown> = p;
  if (Object.prototype.hasOwnProperty.call(p, "proofHash")) {
    // Shallow copy without the ledger-added field; the enclave hashed the
    // proof before this field existed.
    hashable = {};
    for (const key of Object.keys(p)) {
      if (key !== "proofHash") hashable[key] = p[key];
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
