// Copyright (c) Mike Argento. All rights reserved. See LICENSE.

/**
 * bitgraph-core — BitGraph
 *
 * Portable cryptographic proof at finalization.
 * Hardware TEE enforcement via AWS Nitro Enclaves.
 */

// Types
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

// Host interface
export type { HostCapabilities } from "./host.js";

// Constructor (write path)
export { Constructor } from "./constructor.js";

// Verifier (read path)
export { verify, resetEpochLinkState } from "./verifier.js";
export type { VerifyResult } from "./verifier.js";

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

// Proof hash
export { computeProofHash } from "./proof-hash.js";

// Canonical serialization
export { canonicalize, canonicalizeToString, constantTimeEqual } from "./canonical.js";
