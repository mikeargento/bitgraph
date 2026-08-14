// Copyright (c) 2024-2026 Mike Argento. Licensed under the MIT License. See LICENSE.

/**
 * Verdict construction and serialization.
 *
 * Determinism is the product claim, so this module is where it is
 * enforced: no wall-clock reads, no random values, no filesystem paths,
 * and a fixed field order. Two machines evaluating the same rule bytes
 * over the same bundle contents must produce byte-identical verdicts.
 *
 * The verdict labels its own trust boundary. `derived` is what BitGraph
 * established; `declared` is what a named party asserted and Player took
 * on faith — including the closed world itself, which nothing in BitGraph
 * establishes: "there is no cancellation before approval" and "among the
 * recordings you told me to consider, none precedes approval" are
 * different claims, and the closed-world entry is what keeps the verdict
 * from passing the first off as the second.
 */

import type { AuditResult } from "@mikeargento/bitgraph-audit";
import type { Evaluation } from "./evaluate.js";
import { normalizeDigest } from "./rule.js";
import type { DeclaredEntry, Resolution, Rule, Verdict } from "./types.js";

/**
 * The player package's own version, as a source constant rather than a
 * runtime package.json read. The read had two failure modes in bundled
 * embedders (esbuild/webpack output): a foreign package.json one level
 * up supplies the WRONG version, changing verdict bytes against the
 * reference CLI, or no package.json at all throws ENOENT mid-evaluation.
 * A unit test asserts this equals package.json's version, so the
 * constant cannot drift silently across releases.
 */
export const PLAYER_VERSION = "0.3.0";

/** The player package's own version. */
export function playerVersion(): string {
  return PLAYER_VERSION;
}

function resolutionLabel(res: Resolution): string {
  switch (res.kind) {
    case "resolved":
      return "resolved";
    case "absent":
      return res.optional ? "absent-optional" : "absent-required";
    case "ambiguous":
      return "ambiguous";
    case "invalid":
      return "invalid";
  }
}

export function buildVerdict(
  rule: Rule,
  ruleSha256Hex: string,
  resolutions: Map<string, Resolution>,
  evaluation: Evaluation,
  audit: AuditResult
): Verdict {
  // Cast summary, in declaration order. Null prototype so a role named
  // "__proto__" serializes as an ordinary key.
  const cast: Verdict["cast"] = Object.create(null) as Verdict["cast"];
  for (const [role, entry] of Object.entries(rule.cast)) {
    const res = resolutions.get(role) as Resolution;
    const summary: Verdict["cast"][string] = {
      digestB64: normalizeDigest(entry.digest) as string,
      resolution: resolutionLabel(res),
    };
    if (res.kind === "resolved") {
      summary.proofHash = res.proof.proofHash;
      if (res.proof.epochId !== undefined) summary.epochId = res.proof.epochId;
      summary.chainId = res.proof.chainId;
      if (res.proof.counter !== undefined) summary.counter = res.proof.counter;
      if (res.proof.slotCounter !== undefined) summary.slotCounter = res.proof.slotCounter;
    }
    cast[role] = summary;
  }

  // Declared assertions, in cast declaration order, closed world last.
  const declared: DeclaredEntry[] = [];
  for (const [role, entry] of Object.entries(rule.cast)) {
    if (entry.means !== undefined) {
      declared.push({
        assertion: "means",
        role,
        verifiedHere: false,
        means: entry.means,
        digestB64: normalizeDigest(entry.digest) as string,
      });
    }
  }
  for (const [role, entry] of Object.entries(rule.cast)) {
    if (entry.at !== undefined) {
      declared.push({
        assertion: "pinned-occurrence",
        role,
        verifiedHere: false,
        at: entry.at,
      });
    }
  }
  for (const [role, entry] of Object.entries(rule.cast)) {
    if (entry.signedBy !== undefined) {
      declared.push({
        assertion: "signedBy",
        role,
        verifiedHere: false,
        evidence: entry.signedBy,
      });
    }
  }
  // Format 2: the name-to-key bindings are declared trust. The signature
  // MATH is derived (it appears in `derived` steps); that key K IS the
  // named party is taken on the rule author's word, exactly like a cast
  // digest's meaning.
  if (rule.trustedKeys !== undefined) {
    for (const [keyName, key] of Object.entries(rule.trustedKeys)) {
      declared.push({
        assertion: "trusted-key",
        verifiedHere: false,
        keyName,
        alg: key.alg,
        publicKey: key.publicKey,
      });
    }
  }
  declared.push({
    assertion: "closed-world",
    verifiedHere: false,
    castSize: Object.keys(rule.cast).length,
    recordingsInBundle: audit.ingest.counts.observed,
    claim:
      "Absence is asserted only among the declared cast. Nothing in BitGraph establishes that the declared cast is complete; that completeness is the rule author's assertion.",
  });

  const verdict: Verdict = {
    verdict:
      rule.rule === "bitgraph-player/2" ? "bitgraph-player-verdict/2" : "bitgraph-player-verdict/1",
    result: evaluation.result,
    rule: { id: rule.id, sha256: ruleSha256Hex },
    cast,
    derived: evaluation.steps,
    declared,
    evaluator: { name: "@mikeargento/bitgraph-player", version: playerVersion() },
    network: "none",
  };
  if (rule.then !== undefined) verdict.then = rule.then;
  if (evaluation.weakestEvidence !== undefined) {
    verdict.weakestEvidence = evaluation.weakestEvidence;
  }
  return verdict;
}

/**
 * Deterministic bytes. Fixed key order (construction order), two-space
 * indent, trailing newline. No timestamp: a `generatedAt` field would
 * break byte-identical reproduction, which is the entire product claim.
 * If a run timestamp is wanted it belongs in a sidecar, never here.
 */
export function serializeVerdict(verdict: Verdict): string {
  // Emit top-level fields in the canonical order regardless of
  // construction history, so optional fields land in a fixed place.
  const ordered: Record<string, unknown> = {
    verdict: verdict.verdict,
    result: verdict.result,
    rule: verdict.rule,
  };
  if (verdict.then !== undefined) ordered["then"] = verdict.then;
  if (verdict.weakestEvidence !== undefined) {
    ordered["weakestEvidence"] = verdict.weakestEvidence;
  }
  ordered["cast"] = verdict.cast;
  ordered["derived"] = verdict.derived;
  ordered["declared"] = verdict.declared;
  ordered["evaluator"] = verdict.evaluator;
  ordered["network"] = verdict.network;
  return JSON.stringify(ordered, null, 2) + "\n";
}
