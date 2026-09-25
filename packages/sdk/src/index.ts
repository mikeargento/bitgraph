// Copyright (c) 2024-2026 Argento Computing Inc. Licensed under the MIT License. See LICENSE.

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
export type { BitGraphOptions, RecordResult, RecordedFile, CheckedInput, VerifyOutcome, Slot } from "./bitgraph.js";

// The engine, piece by piece.
export { configFromEnv, batchCheck, getProofDetail, search, indexSetMembers, ApiError, BATCH_CHECK_LIMIT } from "./api.js";
export type { ApiConfig, SetIndexRequest } from "./api.js";
export { scanFile, fusedDigestFor, expandPaths, sniffC2paBytes } from "./scan.js";
export type { ScannedFile, ScanPlacement, Expansion } from "./scan.js";
export { sniffCarrierTail, readCarrierFile, carrierWindowView, carrierLine } from "./carrier-io.js";
export type { CarrierWindowView, CarrierFileResult } from "./carrier-io.js";
export { fuseFilePipeline, fuseSetPipeline, classifyPath, MAX_LOADED_BYTES } from "./pipelines.js";
export type { FuseFileFn, FuseSetFn, FusedSummary, SetSummary, CarrierRow, ClassifiedPath } from "./pipelines.js";
export { beginTask, sealTask, decodeTaskToken, encodeTaskToken, writeProofBeside, SLOT_TTL_SECONDS } from "./task.js";
export type { Begun, SealedTask, TaskState } from "./task.js";
export { buildBitGraphedFile, completeBitGraphedFile, carrierFileName } from "./carrier-build.js";
export type { BuiltCarrier, CompletedCarrier } from "./carrier-build.js";
export { toUrlSafeB64, fromUrlSafeB64, looksLikeDigest, sha256FileB64, mapConcurrent } from "./encoding.js";
export type { BitGraphProof, ProofDetailResponse, PositionView, AnchorView, SetMemberView, BatchCheckResponse, SearchResponse } from "./types.js";
export { serve } from "./serve.js";
export type { ServeOptions, RunningServer } from "./serve.js";
