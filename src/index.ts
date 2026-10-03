// Copyright (c) Argento Computing Inc. All rights reserved. See LICENSE.

/**
 * bitgraph-core: BitGraph
 *
 * Portable cryptographic proof at finalization.
 * Hardware TEE enforcement via AWS Nitro Enclaves.
 *
 * The verification side (verify, proof schema, canonicalization, proofHash)
 * lives in @mikeargento/bitgraph-verify (MIT) and is re-exported here for
 * compatibility. Verification of BitGraph proofs is permissionless.
 */

// Read side: re-exported from the permissive verifier package
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
export { verify, resetEpochLinkState, createVerificationContext } from "@mikeargento/bitgraph-verify";
export type { VerificationContext } from "@mikeargento/bitgraph-verify";
export type { VerifyResult } from "@mikeargento/bitgraph-verify";
export { computeProofHash } from "@mikeargento/bitgraph-verify";
export { canonicalize, canonicalizeToString, constantTimeEqual } from "@mikeargento/bitgraph-verify";

// Host interface
export type { HostCapabilities } from "./host.js";

// Constructor (write path)
export { Constructor } from "./constructor.js";

// tree/1 (2026-10-03): every new BitGraph is one Merkle tree of 1 to N files
// under one position; a single file is a tree of one. fuseTree makes it, and
// the export builders write bitgraph-export/1 for one member or the owner.
export { fuseTree, MAX_FUSE_BYTES, treePlacementFor } from "./fuse.js";
export type { FuseTreeMember, FuseTreeBytesMember, FuseTreeLoadedMember, FuseTreeHashedMember, FuseTreeAsIsMember, TreeMemberPlacement, FuseTreeOptions, FuseTreeProgress, FuseTreeMemberResult, FuseTreeResult, AnchorMark } from "./fuse.js";
export { buildMemberExport, buildOwnerExport, namesByLeaf, floorFromHeader, fetchFloorHeader, completeExport } from "./export.js";
export type { ExportFloor, TreeExportSource, ExportParts, ExportFetchOptions, CompleteExportOptions, CompletedExport } from "./export.js";
export { committedBytesFor, verifyTreeMember, verifyExport, parseExport, EXPORT_FORMAT } from "@mikeargento/bitgraph-verify";
export type { BitGraphExport, TreeLeaf, TreeMemberEvidence, TreeVerifyResult, ExportClaim, ExportVerifyResult } from "@mikeargento/bitgraph-verify";

// The producer profile over the primitive (working name Fuse): allocate a
// slot, write a commitment to it into the artifact, hash, commit under the
// same slot. The resulting proof is ordinary bitgraph/1. fuse and fuseSet are
// superseded by fuseTree and kept so code that imports them keeps working.
export { fuse, fuseSet, MAX_SET_MEMBERS, trailerBytesFor, builderFor, FuseError, digestFromBase64, placementForBytes, fusedNamesFor } from "./fuse.js";
export { MAX_SET2_MEMBERS, SET2_PLACEMENT_ID, SET_MEMBER_METADATA_KEY } from "@mikeargento/bitgraph-verify";
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

// Recovery from the file (2026-10-03): the sealed entries a tree's files are
// found again by, and the writer the CLI, SDK and MCP use after making a tree.
export { writeRecoveryEntries } from "./recovery-write.js";
export type { RecoveryWriteInput, RecoveryWriteOptions, RecoveryWriteResult } from "./recovery-write.js";
export {
  recoveryAddress, recoveryEntryId, recoveryKeyBytes, recoveryObjectKey, sealRecoveryEnvelope, openRecoveryEnvelope,
  encodeRecoveryPlaintext, parseRecoveryPlaintext, recoveryTreeFrom, sealRecoveryMember, recoverFromDigest, fetchRecoveredProof,
  RECOVERY_FORMAT, RECOVERY_PREFIX,
} from "./recovery.js";
export type { RecoveredEntry, RecoveryPlaintext } from "./recovery.js";
