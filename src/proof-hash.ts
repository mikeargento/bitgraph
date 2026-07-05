// Copyright (c) Mike Argento. All rights reserved. See LICENSE.

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
 * This hash is used for:
 *   - prevB64 chain linking
 *   - S3 ledger key generation
 *   - Ethereum anchor binding
 *   - Proof deduplication and verification
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

  // Base64 encode (works in both Node.js and browser)
  if (typeof Buffer !== "undefined") {
    return Buffer.from(hash).toString("base64");
  }
  // Browser fallback
  let binary = "";
  for (let i = 0; i < hash.length; i++) {
    binary += String.fromCharCode(hash[i]!);
  }
  return btoa(binary);
}
