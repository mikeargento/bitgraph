// Copyright (c) Mike Argento. All rights reserved. See LICENSE.

/**
 * BitGraph Recorder, core.
 *
 * Everything the app does, with no user interface attached: hashing files once
 * without holding them, making a BitGraph, writing it beside the file,
 * collecting the anchors later, and checking a folder offline.
 *
 * ⚠️ THE PIPELINE IS NOT REIMPLEMENTED HERE. `fuse()`, `fuseSet()`, the
 * placements, the canonical set manifest and the verifier are
 * @mikeargento/bitgraph and @mikeargento/bitgraph-verify, used as published. A
 * second implementation of that pipeline is how the old page generator drifted
 * until it had to be deleted.
 */

export { scanFile, scanAll } from "./hash.js";
export type { ScannedFile } from "./hash.js";

export { makeFiles, makeScanned, MAX_SOLO_BYTES, SET1_LIMIT } from "./make.js";
export type { MakeOptions, MakeResult, MadeFile, SkippedFile, MakeProgress, MakePhase } from "./make.js";

export { checkFolder, checkFile, walk, VERIFIER_BYTES } from "./check.js";
export type { CheckOptions, CheckedFile, CheckedBound, FolderReport, CheckStatus } from "./check.js";

export { completeFolder, completePosition, ANCHOR_STATUS_VERSION } from "./anchors.js";
export type { AnchorPass, AnchorStatusFile, AnchorTransport, BoundState, SideStatus } from "./anchors.js";

export { watchFolder, QUIET_MS, STABLE_MS, MAX_BATCH } from "./watch.js";
export type { FolderWatcher, WatchEvent, WatchOptions, TroubleSeverity } from "./watch.js";

export { Daemon } from "./daemon.js";
export type { DaemonEvent, DaemonOptions } from "./daemon.js";

export { FolderIndex, INDEX_ROW_VERSION } from "./index-store.js";
export type { IndexRow } from "./index-store.js";

export { writeEvidence, readEvidence, parseEvidence, writeJsonAtomic, writeBytesAtomic, EvidenceWriteError, EVIDENCE_VERSION } from "./evidence.js";
export type { Evidence, EvidenceMember, EvidencePosition, EvidenceProof } from "./evidence.js";

export { pathsFor, relativeEvidencePath, evidenceNameFor, positionSegments, BITGRAPHS_DIR, POSITIONS_DIR, ANCHOR_DIR, INDEX_FILE } from "./paths.js";
export type { FolderPaths } from "./paths.js";

export { loadSettings, saveSettings, defaultSettings, SETTINGS_VERSION, DEFAULT_BASE_URL } from "./settings.js";
export type { Settings, WatchedFolder } from "./settings.js";

export { supportDir, settingsPath, rescueDir, logPath, APP_NAME } from "./app-paths.js";
export { BLOCKED_PREFIX, BLOCKED_HOW, isBlocked, blockedMessage, explain } from "./blocked.js";
export { rescue, RESCUE_VERSION } from "./rescue.js";
export type { RescueFile } from "./rescue.js";

export { ROWS_SHOWN, look, lookAt, scanDrop, describe, expand, commonRoot } from "./inspect.js";
export { exportBitGraph } from "./export.js";
export { ledger, listDay } from "./library.js";
export type { Recording, DayCount } from "./library.js";
export type { ExportResult } from "./export.js";
export type { Looked, LookResult, Described, DescribeTarget } from "./inspect.js";
export { readMembers, evidenceFromMember } from "./members.js";
export type { MemberRow } from "./members.js";

export { verifyWitness } from "./eth-anchor.js";
export type { WitnessVerdict, AnchorWitness } from "./eth-anchor.js";
