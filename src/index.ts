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

// The producer profile over the primitive (working name Fuse): allocate a
// slot, write a commitment to it into the artifact, hash, commit under the
// same slot. The resulting proof is ordinary bitgraph/1.
export { fuse, fuseSet, MAX_SET_MEMBERS, trailerBytesFor, builderFor, FuseError, digestFromBase64, placementForBytes, fusedNamesFor } from "./fuse.js";
export type { FuseBuilder, BuilderInput, FuseOptions, FuseResult, FuseTransport, FuseErrorCode } from "./fuse.js";
export type { FuseSetMember, FuseSetBytesMember, FuseSetLoadedMember, FuseSetHashedMember, FusedDigestInput, SetMemberPlacement, FuseSetOptions, FuseSetProgress, FuseSetMemberResult, FuseSetResult } from "./fuse.js";
// The verify-package types those results are made of, so the core entry names everything it returns.
export type { FuseFrame, PlacementId, SetManifest, FuseMemberResult, FuseVerifyResult } from "@mikeargento/bitgraph-verify";

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
