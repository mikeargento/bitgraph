// Copyright (c) 2024-2026 Mike Argento. Licensed under the MIT License. See LICENSE.

/**
 * @mikeargento/bitgraph-player
 *
 * Shared vocabulary. The normative semantics live in SPEC.md; the comments
 * here restate them only where a reader of the types needs the contract.
 *
 * Player is a pure function over an AuditResult:
 *
 *   evaluate(rule, runAudit(bundle)) -> verdict
 *
 * Three-valued by design. TRUE and FALSE are claims BitGraph evidence
 * supports; UNDETERMINED is the honest answer everywhere the evidence does
 * not decide. A boolean evaluator would launder undecidable into FALSE.
 */

import type { ObservedProof } from "@mikeargento/bitgraph-audit";

// ---------------------------------------------------------------------------
// Three-valued logic
// ---------------------------------------------------------------------------

export type ThreeValued = "TRUE" | "FALSE" | "UNDETERMINED";

// ---------------------------------------------------------------------------
// Ordering evidence
// ---------------------------------------------------------------------------

/**
 * Every ordering answer names what it rests on:
 *
 *   "chain-link"     same partition, both proofs in one verified prevB64
 *                    component; commit-counter order within a hash-linked
 *                    structure.
 *   "counter-order"  same partition, different components; commit-counter
 *                    values only, which relies on the authority's counter
 *                    discipline.
 *   "epoch-lineage"  different epochs related by hard epochLink succession
 *                    (cryptographic hand-off; transitive pairs from audit).
 *   "anchor-bounds"  different epochs related through Ethereum anchor
 *                    bounds. The not-after side always rests on the
 *                    anchor-freshness assumption.
 */
export type OrderBasis = "chain-link" | "counter-order" | "epoch-lineage" | "anchor-bounds";

/**
 * The two honest tiers. "hash-linked" rests on hash links alone;
 * "assumption-dependent" additionally rests on counter discipline or
 * anchor freshness. A rule declares the floor it will accept.
 */
export type EvidenceTier = "hash-linked" | "assumption-dependent";

export function basisTier(basis: OrderBasis): EvidenceTier {
  switch (basis) {
    case "chain-link":
    case "epoch-lineage":
      return "hash-linked";
    case "counter-order":
    case "anchor-bounds":
      return "assumption-dependent";
  }
}

/** True when `tier` satisfies a declared floor. */
export function meetsFloor(tier: EvidenceTier, floor: EvidenceTier): boolean {
  return floor === "assumption-dependent" || tier === "hash-linked";
}

/** Result of comparing two resolved recordings. */
export interface OrderResult {
  /** "same" when both roles resolved to the identical recording. */
  relation: "before" | "after" | "same" | "unordered";
  /** Present exactly when relation is "before" or "after". */
  basis?: OrderBasis;
  /**
   * Present exactly when relation is "before" or "after": the tier this
   * specific answer rests on. Usually basisTier(basis), but epoch-lineage
   * answers whose predecessor-side coverage rests on counter discipline
   * carry "assumption-dependent" despite the hash-linked basis family.
   * The evidence floor gates THIS field.
   */
  tier?: EvidenceTier;
  /** True when the answer rests on an assumption (counter discipline or anchor freshness). */
  assumptionDependent: boolean;
  /** True when the evidence additionally rests on counter-order rather than a chain-link path. */
  weaker: boolean;
  /** Plain-language statement of exactly what was compared and why it answered this way. */
  detail: string;
}

// ---------------------------------------------------------------------------
// Rule file (bitgraph-player/1)
// ---------------------------------------------------------------------------

/**
 * Pin selecting one occurrence when the same bits hold several causal
 * positions. Exactly one of the two forms.
 */
export type CastPin =
  | { proofHash: string }
  | { epochId: string; counter: string };

/**
 * One cast role. Everything here is DECLARED: taken on the rule author's
 * word, surfaced in the verdict's `declared` block, never derived.
 */
export interface CastEntry {
  /**
   * Artifact digest identifying the bits. Accepted forms: "sha256:<64 hex>",
   * bare 64-char hex, standard base64, or base64url of the 32-byte digest.
   * Normalized internally to the proof's base64 form.
   */
  digest: string;
  /** What the digest means as a business object. Declared, echoed, never interpreted. */
  means?: string;
  /** Selects one recording when the digest holds several causal positions. */
  at?: CastPin;
  /**
   * External identity evidence (e.g. a C2PA manifest reference). Player
   * echoes it into `declared` verbatim with verifiedHere: false. SIGNED_BY
   * is not a BitGraph primitive and is never derived here.
   */
  signedBy?: unknown;
  /** When true, absence from the bundle is a definite fact under the closed world, not an error. */
  optional?: boolean;
}

export type Claim =
  | { exists: string }
  | { before: [string, string] }
  | { after: [string, string] }
  | { between: [string, string, string] }
  | { all: Claim[] }
  | { any: Claim[] }
  | { not: Claim };

export interface Rule {
  rule: "bitgraph-player/1";
  id: string;
  cast: Record<string, CastEntry>;
  /** The only defined value. Absence is only ever asserted within the declared cast. */
  world: "closed";
  /**
   * Mandatory. A rule that does not state its trust floor does not parse:
   * the rule carries its own security policy.
   */
  requires: { ordering: EvidenceTier };
  claim: Claim;
  /**
   * A label and nothing else. No field in this format is capable of
   * causing an action; Player decides, it does not enforce.
   */
  then?: { label: string };
}

// ---------------------------------------------------------------------------
// Cast resolution
// ---------------------------------------------------------------------------

/**
 * A digest identifies bits; a recording identifies an occurrence of those
 * bits at a causal position. A cast role resolves to a RECORDING. Two or
 * more matches with no pin is UNDETERMINED, never a silent pick.
 */
export type Resolution =
  | {
      kind: "resolved";
      role: string;
      proof: ObservedProof;
      /** Verification tier the resolution rests on ("full" | "integrity"). */
      verificationTier: string;
      /** How many verified recordings of this digest the bundle holds. */
      matchCount: number;
    }
  | { kind: "absent"; role: string; optional: boolean }
  | { kind: "ambiguous"; role: string; matchCount: number; candidates: string[] }
  | { kind: "invalid"; role: string; reason: string };

// ---------------------------------------------------------------------------
// Verdict (bitgraph-player-verdict/1)
// ---------------------------------------------------------------------------

/** One evaluated sub-claim, in evaluation order. Everything BitGraph established. */
export interface DerivedStep {
  claim: string;
  result: ThreeValued;
  basis?: OrderBasis;
  evidenceTier?: EvidenceTier;
  because: Record<string, unknown>;
}

/** One assertion Player took on somebody's word. */
export interface DeclaredEntry {
  assertion: "signedBy" | "means" | "closed-world" | "pinned-occurrence";
  role?: string;
  verifiedHere: false;
  [k: string]: unknown;
}

export interface Verdict {
  verdict: "bitgraph-player-verdict/1";
  result: ThreeValued;
  rule: { id: string; sha256: string };
  then?: { label: string };
  /** Weakest evidence tier any contributing ordering answer rested on. Absent when no ordering was used. */
  weakestEvidence?: EvidenceTier;
  cast: Record<
    string,
    {
      digestB64: string;
      resolution: string;
      proofHash?: string;
      epochId?: string;
      chainId?: string;
      counter?: string;
      slotCounter?: string;
    }
  >;
  derived: DerivedStep[];
  declared: DeclaredEntry[];
  evaluator: { name: string; version: string };
  network: "none";
}
