// Copyright (c) 2024-2026 Mike Argento. Licensed under the MIT License. See LICENSE.

/**
 * @mikeargento/bitgraph-player
 *
 * Deterministic evaluation of causal rules over BitGraph proof bundles.
 *
 *   BitGraph records. Player evaluates.
 *
 * Player is a pure function over `runAudit()`'s output: same rule, same
 * bundle, same verdict, on anyone's machine, with no network access at
 * evaluation time. It decides; it does not enforce — no field in the rule
 * format is capable of causing an action.
 */

export type {
  CastEntry,
  CastPin,
  Claim,
  DeclaredEntry,
  DerivedStep,
  EvidenceTier,
  OrderBasis,
  OrderResult,
  Resolution,
  Rule,
  RuleFormat,
  ThreeValued,
  Verdict,
} from "./types.js";
export { basisTier, meetsFloor } from "./types.js";

export { parseRule, normalizeDigest, decodeDigestBytes, RuleError } from "./rule.js";
export { play, playAudit, claimUsesSignatures, SIG_EVIDENCE_MAX_BYTES, PlayError } from "./play.js";
export type { PlayResult, PlayStage } from "./play.js";
export { parseSigFile, verifySigFile, keyObjectFor, sigMessage } from "./sig.js";
export type { SigAlg, SigFile, TrustedKey } from "./sig.js";
export type { SigEvidence } from "./evaluate.js";
export { scaffoldRule, roleNameForFile, ORDERING_PLACEHOLDER } from "./init.js";
export type { ScaffoldEntry } from "./init.js";
export { resolveCast, resolveRole } from "./cast.js";
export { compare } from "./order.js";
export { kleeneAll, kleeneAny, kleeneNot } from "./logic.js";
export { evaluate } from "./evaluate.js";
export type { Evaluation } from "./evaluate.js";
export { buildVerdict, serializeVerdict, playerVersion, PLAYER_VERSION } from "./verdict.js";

export { checkIngest, buildCheckReport, renderCheckText, serializeCheckReport, KNOWN_ENCLAVE_MEASUREMENTS } from "./check.js";
export type { CheckReport, CheckRecording, CheckAnchor, CheckLine, CheckBounds, CheckBound, CheckOptions, CheckDomain } from "./check.js";

export {
  parseDomainFile,
  isDomainName,
  keyFingerprint,
  domainKeyRefs,
  diffDomainFiles,
  checkDomain,
  DomainFileError,
  DOMAIN_FILE_VERSION,
  DOMAIN_WELL_KNOWN_PATH,
  DOMAIN_FILE_MAX_BYTES,
} from "./domain.js";
export type { DomainFile, DomainKeyRef, DomainDiff } from "./domain.js";
export { defaultPinsDir, readPin, writePin, forgetPin, listPins, fetchDomainFile } from "./pin.js";
export type { StoredPin, PinListEntry, FetchLike } from "./pin.js";
