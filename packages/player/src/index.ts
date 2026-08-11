// Copyright (c) 2024-2026 Mike Argento. Licensed under the MIT License. See LICENSE.

/**
 * @mikeargento/bitgraph-player
 *
 * Deterministic evaluation of causal rules over BitGraph proof bundles.
 *
 *   BitGraph records. Player executes.
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
  ThreeValued,
  Verdict,
} from "./types.js";
export { basisTier, meetsFloor } from "./types.js";

export { parseRule, normalizeDigest, RuleError } from "./rule.js";
export { resolveCast, resolveRole } from "./cast.js";
export { compare } from "./order.js";
export { kleeneAll, kleeneAny, kleeneNot } from "./logic.js";
export { evaluate } from "./evaluate.js";
export type { Evaluation } from "./evaluate.js";
export { buildVerdict, serializeVerdict, playerVersion } from "./verdict.js";
