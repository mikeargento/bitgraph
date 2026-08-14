// Copyright (c) 2024-2026 Mike Argento. Licensed under the MIT License. See LICENSE.

/**
 * @mikeargento/bitgraph-titles
 *
 * Possession messages, custody threads, and title abstracts.
 *
 *   BitGraph records. Titles convey. Player evaluates.
 *
 * A possession message proves SAID (signed), HELD (possession hash), and
 * PLACED (its recording) — never that its statement is true, who the
 * person behind a key is, or who holds anything now. A title is the
 * thread, never the bytes: the work stays freely copyable, and the one
 * uncopyable thing — the ability to sign — is what makes standing
 * scarce. Events, never states.
 */

export type { Pm, PmCheck, PmClaim, PmKeyRef, Thread, ThreadLink } from "./types.js";
export {
  PM_VERSION,
  PmError,
  parsePm,
  createPm,
  checkPm,
  serializePm,
  pmSigningBytes,
  possessionHash,
  sha256HexOf,
  digestSpelling,
} from "./pm.js";
export type { CreatePmInput } from "./pm.js";
export { markerBytes, parseMarker } from "./marker.js";
export { buildThread, ThreadError } from "./thread.js";
export { buildTitleRule } from "./titlerule.js";
export type { TitleRuleOptions } from "./titlerule.js";
export { keygen, loadKey, KeyFileError } from "./keysfile.js";
export type { KeyFile } from "./keysfile.js";
export {
  initVault,
  vaultPut,
  vaultGet,
  vaultCount,
  vaultKeyFor,
  lookupIdFor,
  VaultError,
} from "./vault.js";
