// Copyright (c) Mike Argento. All rights reserved. See LICENSE.

/**
 * bitgraph-core — BitGraph
 *
 * Portable cryptographic proof at finalization.
 * Hardware TEE enforcement via AWS Nitro Enclaves.
 *
 * The verification side (verify, proof schema, canonicalization, proofHash)
 * lives in @mikeargento/bitgraph-verify (MIT) and is re-exported here for
 * compatibility. Verification of BitGraph proofs is permissionless.
 */

// Read side — re-exported from the permissive verifier package
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
} from "@mikeargento/bitgraph-verify";
export { verify, resetEpochLinkState } from "@mikeargento/bitgraph-verify";
export type { VerifyResult } from "@mikeargento/bitgraph-verify";
export { computeProofHash } from "@mikeargento/bitgraph-verify";
export { canonicalize, canonicalizeToString, constantTimeEqual } from "@mikeargento/bitgraph-verify";

// Host interface
export type { HostCapabilities } from "./host.js";

// Constructor (write path)
export { Constructor } from "./constructor.js";

// Policy parsing, hashing, and validation
export {
  parsePolicy,
  hashPolicy,
  createPolicyBinding,
  validateAction,
} from "./policy.js";
export type {
  PolicyDocument,
  PolicyRules,
  ActionValidationResult,
} from "./policy.js";
