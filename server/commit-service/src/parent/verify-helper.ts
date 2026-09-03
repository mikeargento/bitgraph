// Copyright (c) Mike Argento. All rights reserved. See LICENSE.

import { verifyAsync as ed25519VerifyAsync } from "@noble/ed25519";
import { canonicalize } from "bitgraph";
import type { BitGraphProof, SignedBody, VerificationPolicy } from "bitgraph";

export interface VerifyResult {
  valid: boolean;
  reason?: string;
  checks?: string[];
}

export async function verifySignatureOnly(
  proof: BitGraphProof,
  policy?: VerificationPolicy
): Promise<VerifyResult> {
  const checks: string[] = [];

  if (proof.version !== "bitgraph/1") {
    return { valid: false, reason: `unsupported version: ${proof.version}`, checks };
  }
  checks.push("structure: ok");

  const signedBody: SignedBody = {
    version: proof.version as "bitgraph/1",
    artifact: proof.artifact,
    commit: proof.commit,
    publicKeyB64: proof.signer.publicKeyB64,
    enforcement: proof.environment.enforcement,
    measurement: proof.environment.measurement,
  };

  if (proof.environment.attestation !== undefined) {
    signedBody.attestationFormat = proof.environment.attestation.format;
  }

  if (proof.agency !== undefined) {
    signedBody.actor = proof.agency.actor;
  }

  // Attribution and policy are INSIDE the enclave-signed bytes (app.ts seals
  // both before signing). Rebuilding without them reported "signature
  // verification failed" for every anchor proof and for every fused proof
  // (which carries its placement and origin in attribution). Mirrors the
  // rebuild in packages/verify/src/verifier.ts.
  if (proof.policy !== undefined) {
    signedBody.policy = proof.policy;
  }
  if (proof.attribution !== undefined) {
    signedBody.attribution = proof.attribution;
  }

  const canonicalBytes = canonicalize(signedBody);
  checks.push("canonicalize: ok");

  const publicKeyBytes = Buffer.from(proof.signer.publicKeyB64, "base64");
  const signatureBytes = Buffer.from(proof.signer.signatureB64, "base64");

  if (publicKeyBytes.length !== 32) {
    return { valid: false, reason: `invalid public key length: ${publicKeyBytes.length}`, checks };
  }
  if (signatureBytes.length !== 64) {
    return { valid: false, reason: `invalid signature length: ${signatureBytes.length}`, checks };
  }

  let sigValid: boolean;
  try {
    sigValid = await ed25519VerifyAsync(
      new Uint8Array(signatureBytes),
      canonicalBytes,
      new Uint8Array(publicKeyBytes)
    );
  } catch (err) {
    return {
      valid: false,
      reason: `signature error: ${err instanceof Error ? err.message : String(err)}`,
      checks,
    };
  }

  if (!sigValid) {
    return { valid: false, reason: "signature verification failed", checks };
  }
  checks.push("signature: ok");

  if (policy) {
    if (policy.requireEnforcement !== undefined) {
      if (proof.environment.enforcement !== policy.requireEnforcement) {
        return {
          valid: false,
          reason: `enforcement "${proof.environment.enforcement}" does not meet required "${policy.requireEnforcement}"`,
          checks,
        };
      }
      checks.push("policy.enforcement: ok");
    }

    if (policy.allowedMeasurements?.length) {
      if (!policy.allowedMeasurements.includes(proof.environment.measurement)) {
        return { valid: false, reason: "measurement not in allowed set", checks };
      }
      checks.push("policy.measurement: ok");
    }

    if (policy.allowedPublicKeys?.length) {
      if (!policy.allowedPublicKeys.includes(proof.signer.publicKeyB64)) {
        return { valid: false, reason: "public key not in allowed set", checks };
      }
      checks.push("policy.publicKey: ok");
    }

    if (policy.requireAttestation && !proof.environment.attestation) {
      return { valid: false, reason: "attestation required but not present", checks };
    }

    if (policy.minCounter !== undefined || policy.maxCounter !== undefined) {
      if (proof.commit.counter === undefined) {
        return { valid: false, reason: "counter required by policy but not present", checks };
      }
      const c = BigInt(proof.commit.counter);
      if (policy.minCounter !== undefined && c < BigInt(policy.minCounter)) {
        return {
          valid: false,
          reason: `counter ${proof.commit.counter} below minimum ${policy.minCounter}`,
          checks,
        };
      }
      if (policy.maxCounter !== undefined && c > BigInt(policy.maxCounter)) {
        return {
          valid: false,
          reason: `counter ${proof.commit.counter} above maximum ${policy.maxCounter}`,
          checks,
        };
      }
      checks.push("policy.counter: ok");
    }
  }

  return { valid: true, checks };
}
