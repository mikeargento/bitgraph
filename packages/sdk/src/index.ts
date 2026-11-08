// Copyright (c) 2025-2026 Argento Computing Inc. Licensed under the MIT License. See LICENSE.

/**
 * @mikeargento/bitgraph-sdk: one engine, three sockets.
 *
 *   TypeScript   import { BitGraph } from "@mikeargento/bitgraph-sdk"
 *   any language npx bitgraph <verb> --json   (spawn a process)
 *   any runtime  npx bitgraph serve           (localhost API, 127.0.0.1 only)
 *
 * The class is the front door; the module exports beneath it are the same
 * engine the MCP server runs, for anyone composing their own surface.
 */

export { BitGraph } from "./bitgraph.js";
export type { BitGraphOptions, CheckedInput, VerifyOutcome, VerifyOptions } from "./bitgraph.js";

// Making BitGraphs: one new file is one BitGraph, several are one tree and one BitGraph.
export {
  recordFiles, proofPathFor, isProofFile, proofPageUrl,
  leafOfDigest, sortedLeaves, treeFromLeaves, memberPath, withMember, leafNames,
} from "./record.js";
export type { RecordResult, RecordedFile, MadeBitGraph, RecordOptions, DigestTree, TreeLeafRow, TreeMemberBlock } from "./record.js";

// The engine, piece by piece.
export { configFromEnv, bindDigest, postTreeMembers, batchCheck, getProofDetail, search, ApiError, BATCH_CHECK_LIMIT } from "./api.js";
export type { ApiConfig, TreeRoot, TreeMemberRow } from "./api.js";
export { scanFile, expandPaths, sniffC2paBytes, fileSource } from "./scan.js";
export type { ScannedFile, Expansion } from "./scan.js";
export { sniffCarrierTail, readCarrierFile, carrierWindowView, carrierLine, classifyPath, MAX_LOADED_BYTES } from "./carrier-io.js";
export type { CarrierWindowView, CarrierFileResult, CarrierRow, ClassifiedPath } from "./carrier-io.js";
export { lookupRecovered, recoveryTrustFromEnv } from "./recovery.js";
export type { RecoveredRow, RecoveryLookup } from "./recovery.js";
export { toUrlSafeB64, fromUrlSafeB64, looksLikeDigest, sha256FileB64, mapConcurrent } from "./encoding.js";
export type { BitGraphProof, ProofCommit, ProofDetailResponse, PositionView, SetMemberView, BatchCheckResponse, SearchResponse } from "./types.js";
export { serve } from "./serve.js";
export type { ServeOptions, RunningServer } from "./serve.js";
