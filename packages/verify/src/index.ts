// Copyright (c) 2024-2026 Mike Argento. Licensed under the MIT License. See LICENSE.

/**
 * @mikeargento/bitgraph-verify
 *
 * Offline, deterministic verification of BitGraph proofs.
 * Permissionless by design: this package is MIT-licensed so that anyone
 * can verify a proof without asking permission.
 */

export type {
  BitGraphProof,
  BitGraphPolicy,
  VerificationPolicy,
  SignedBody,
  EnforcementTier,
  Attribution,
  PolicyBinding,
  SlotAllocation,
  ActorIdentity,
  AuthorizationPayload,
  WebAuthnAuthorization,
  AgencyEnvelope,
} from "./types.js";

export { verify, verifyProofIntegrity, resetEpochLinkState } from "./verifier.js";
export type { VerifyResult, ProofIntegrityResult } from "./verifier.js";

export { computeProofHash, computeChainHash, buildSignedBody, computeSignedBodyHash } from "./proof-hash.js";

export { canonicalize, canonicalizeToString, constantTimeEqual } from "./canonical.js";
