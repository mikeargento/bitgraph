// Copyright (c) 2024-2026 Argento Computing Inc. Licensed under the MIT License. See LICENSE.

/**
 * @mikeargento/bitgraph-verify
 *
 * Offline, deterministic verification of BitGraph proofs.
 * Permissionless by design: this package is MIT-licensed so that anyone
 * can verify a proof without asking permission.
 */

export {
  ANCHOR_ATTRIBUTION_NAME,
  anchorKindOf,
  anchorMarkOf,
  isAnchorProof,
  type AnchorKind,
  type AnchorMark,
} from "./anchor.js";

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

export { verify, verifyProofIntegrity, resetEpochLinkState, createVerificationContext } from "./verifier.js";
export type { VerifyResult, ProofIntegrityResult, VerificationContext } from "./verifier.js";

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
  FUSE2_PROFILE,
  FUSE2_DOMAIN,
  FUSE2_ATTRIBUTION_NAME,
  fuseVersionOfName,
  isFuseMarkerName,
  slotCommitment2Preimage,
  computeSlotCommitment2,
  commitmentForProof,
  producerCommitment,
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
export { MAX_CONTAINER_ENTRY_BYTES } from "./fuse.js";
export { verifyFuse, assembledAfterCommit } from "./fuse-verify.js";
export type { FuseCategory, FuseSpan, FuseVerifyResult, FuseVerifyOptions } from "./fuse-verify.js";
export { verifyFuseMember } from "./fuse-member.js";
export type { FuseMemberCategory, FuseSetEvidence, FuseMemberOptions, FuseMemberResult } from "./fuse-member.js";
export { SET2_PLACEMENT_ID, SET_MEMBER_METADATA_KEY, MAX_SET2_MEMBERS, canonicalSetRow, setLeaf, sortSetMembers, buildSetTree, setMemberPath, buildSetRoot, parseSetRoot, buildSetMemberProof, parseSetMemberProof, setRootFromMember } from "./fuse.js";
export type { SetRoot, SetMemberProof } from "./fuse.js";
export { merkleLeafHash, merkleNodeHash, merkleRoot, merklePath, merkleRootFromPath, MerkleTree } from "./fuse-merkle.js";

// One marker, two vocabularies for how the commitment is carried: a placement
// (a recipe exists, rebuild from the original) or an encoding (the artifact was
// MADE with the commitment inside it, so look for it). verifyFuse handles both;
// these were briefly two profiles, which was one idea wearing two names.
export { ENCODING_BASE64URL, isCarryEncoding, findCommitment, inlineAttribution } from "./fuse.js";

/* bitgraph-carrier/1: the file that carries its own proof (2026-09-24). */
export {
  CARRIER_MAGIC, CARRIER_OVERHEAD, MAX_CARRIER_PAYLOAD, CARRIER_VERSION,
  encodeCarrierBlock, buildCarrier, parseCarrier, completeCarrier,
  anchorIdentity, checkFloorBinding, checkCeilingBinding, anchorMessageBytes,
  decodeRlpTop, verifyWitnessHeader, carrierBounds, innerDigestMatches,
  sameDigest, b64ToBytes, bytesToB64,
} from "./carrier.js";
export type {
  CarrierWitness, CarrierProof, CarrierFloor, CarrierCeiling, CarrierPayload,
  CarrierParse, WitnessCheck, CarrierBounds,
} from "./carrier.js";
export { verifyCarrier, verifyCarrierPayload, BITGRAPH_CEILING_WRITER, BASE_MAINNET_CHAIN_ID } from "./carrier-verify.js";
export type { CarrierVerifyResult, CarrierClaim, ClaimResult, CarrierLookups, CarrierVerifyOptions } from "./carrier-verify.js";

/* bitgraph-carrier/2 (2026-09-30): the ceiling in time, its settlement, the attestation witness and the declared pins, in the same block. */
export {
  CARRIER_VERSION_2, CEILING_SIDECAR_VERSION, SETTLEMENT_POINTER_VERSION, ATTESTATION_WITNESS_VERSION,
  carrierVersionOf, completeCarrierInTime, completeCarrierSettlement, settlementFromSidecar,
} from "./carrier.js";
export type { CarrierVersion, CarrierCeilingInTime, CarrierSettlement, CarrierPins } from "./carrier.js";
export { assembleCarrierV2Payload, carrierBlockSize, CARRIER_BLOCK_ZIP_LIMIT } from "./carrier-assemble.js";
export type { CarrierV2Parts } from "./carrier-assemble.js";

/* AWS Nitro attestation: decode, verify (chain to the AWS root, validity at the document's instant), and the openssl-checkable witness. */
export {
  AWS_NITRO_ROOT_CA_PEM, awsNitroRootDer, awsNitroRootSha256, decodeNitroAttestation, verifyNitroAttestation,
  attestationWitness, witnessMatchesAttestation, encodeSigStructure, rawEcdsaSigToDer, derToPem, pemToDer, ATTESTATION_WITNESS_FORMAT,
} from "./nitro.js";
export type { NitroDocument, NitroDecoded, NitroCheck, NitroVerifyOptions, NitroVerifyResult, AttestationWitness } from "./nitro.js";

/* Settlement of a Base ceiling on Ethereum: L1 data inclusion (bitgraph-settlement/1). The pointer layer is here; the blob layer is bitgraph-audit's. */
export * from "./settlement.js";

// Ceiling in time on Base (bitgraph-ceiling/1): a sidecar beside the proof, never inside it.
export {
  CEILING_VERSION, CEILING_MAGIC, CEILING_PAYLOAD_BYTES,
  encodeCeilingPayload, decodeCeilingPayload, ceilingPayloadHash, ceilingLeaf, ceilingLabel,
  verifyCeiling, checkCeilingOnline,
} from "./ceiling.js";
export type { CeilingSidecar, CeilingStatus, CeilingPayload, CeilingCheck, CeilingVerifyResult, CeilingVerifyOptions } from "./ceiling.js";
export { rlpEncode, rlpDecode, decodeHeader, decodeEip1559, mptVerify, txTrieKey, keccak256,
  hexToBytes as evmHexToBytes, bytesToHex as evmBytesToHex } from "./ceiling-evm.js";
export { txTrieProof } from "./ceiling-trie.js";
export type { RlpItem, DecodedHeader, DecodedTx } from "./ceiling-evm.js";

/* tree/1 (2026-10-03): every BitGraph is a Merkle tree under one position; a single file is a tree of one. */
export {
  TREE_PLACEMENT_ID, TREE_PROFILE, TREE_DOMAIN, TREE_LEAF_BYTES, TREE_ROOT_DOCUMENT_BYTES, MAX_TREE_LEAVES, TREE_METADATA_KEY,
  KNOWN_TREE_SPEC_HASHES, LEAF_AS_IS, LEAF_PLACEMENTS, TREE_MEMBER_CATEGORIES,
  leafCodeOf, encodeTreeLeaf, decodeTreeLeaf, treeLeafHash, sortTreeLeaves, buildTree,
  buildTreeRootDocument, parseTreeRootDocument, readTreeMetadata, treeAttribution, currentTreeSpecHash, isTreeProof,
  buildTreeMemberEvidence, parseTreeMemberEvidence, treeRootFromMember, encodeTreeLeaves, decodeTreeLeaves, verifyTreeLeaves,
  committedBytesFor, leafFor, verifyTreeMember,
} from "./tree.js";
export type { TreeLeaf, BuiltTree, TreeMemberEvidence, TreeLeavesCheck, TreeCategory, TreeVerifyOptions, TreeVerifyResult } from "./tree.js";

/* bitgraph-output-root/1: a Base ceiling settled on Ethereum through Base's output root, without blobs. */
export {
  OUTPUT_ROOT_VERSION, HISTORY_STORAGE_ADDRESS, HISTORY_SERVE_WINDOW, BASE_DISPUTE_GAME_FACTORY,
  computeOutputRoot, historySlot, verifyOutputRootSettlement,
} from "./output-root.js";
export type { OutputRootSettlement, OutputRootCheck, OutputRootVerifyResult, OutputRootVerifyOptions } from "./output-root.js";

/* bitgraph-export/1: one JSON file that, with the file, checks a tree/1 BitGraph with nothing of BitGraph's required. */
export { EXPORT_FORMAT, parseExport, verifyExport, buildExport } from "./export.js";
export { baseTimeIsBound, BASE_STAMP_TOLERANCE_SECONDS } from "./ceiling.js";
/* The enclave images BitGraph has published: the default measurement policy (SPEC section 16). */
export { PUBLISHED_ENCLAVE_MEASUREMENTS, PUBLISHED_PCR0S, publishedMeasurement } from "./measurements.js";
export type { PublishedMeasurement } from "./measurements.js";
export type { BitGraphExport, ExportClaim, ExportClaimResult, ExportLookups, ExportVerifyOptions, ExportVerifyResult } from "./export.js";
