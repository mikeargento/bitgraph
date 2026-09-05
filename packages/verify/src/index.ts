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

// BitGraph Fuse (profile bitgraph-fuse/1): construction, parsing, verification.
export {
  FUSE_PROFILE,
  FUSE_DOMAIN,
  FUSE_ATTRIBUTION_NAME,
  TRAILER_MAGIC,
  TRAILER_LENGTH,
  CONTAINER_MANIFEST_PATH,
  CONTAINER_ORIGINAL_PATH,
  PLACEMENTS,
  getPlacement,
  SET_PLACEMENT_ID,
  SET_METADATA_KEY,
  buildSetManifest,
  parseSetManifest,
  readSetMetadata,
  canonicalSlotBody,
  computeSlotRecordHash,
  slotCommitmentPreimage,
  computeSlotCommitment,
  buildFusePayload,
  parseFusePayload,
  fuseAttribution,
  readFuseAttribution,
  mergeMarkers,
  buildFrame,
  parseFrame,
  readFrameMarker,
  bytesToBase64,
  base64ToBytes,
  bytesToHex,
  hexToBytes,
  bytesEqual,
} from "./fuse.js";
export type { PlacementId, Placement, Located, FusePayload, FuseFrame, FuseMarker, MarkerSource, SetMember, SetManifest, FusedFrame } from "./fuse.js";
export { verifyFuse, assembledAfterCommit } from "./fuse-verify.js";
export type { FuseCategory, FuseSpan, FuseVerifyResult, FuseVerifyOptions } from "./fuse-verify.js";
export { verifyFuseMember } from "./fuse-member.js";
export type { FuseMemberCategory, FuseSetEvidence, FuseMemberOptions, FuseMemberResult } from "./fuse-member.js";
