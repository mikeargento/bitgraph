// Copyright (c) 2024-2026 Mike Argento. Licensed under the MIT License. See LICENSE.

/**
 * The evaluator: walks the claim tree over resolved recordings and the
 * ordering adapter, under strong Kleene semantics.
 *
 * Deliberate properties:
 *
 * - FULL WALK, no short-circuit. Every sub-claim is evaluated and recorded
 *   so the verdict is a complete replayable trace, not just an outcome.
 *
 * - CLOSED WORLD, scoped to the cast. An absent OPTIONAL role is a
 *   definite absence within the declared universe: positive claims about
 *   it are FALSE, so negatives over it hold. An absent REQUIRED role, an
 *   ambiguous role, and a role the cast never declared are UNDETERMINED —
 *   the evidence does not decide, and saying FALSE would be a lie.
 *
 * - THE FLOOR GATES EVIDENCE, NOT POLARITY. When an ordering answer rests
 *   on a tier below requires.ordering, the answer is UNDETERMINED whether
 *   it would have been TRUE or FALSE: the rule author said not to trust
 *   that evidence in either direction.
 */

import type { AuditResult, ObservedProof } from "@mikeargento/bitgraph-audit";
import { kleeneAll, kleeneAny, kleeneNot } from "./logic.js";
import { compare } from "./order.js";
import { basisTier, meetsFloor } from "./types.js";
import type {
  Claim,
  DerivedStep,
  EvidenceTier,
  Resolution,
  Rule,
  ThreeValued,
} from "./types.js";

export interface Evaluation {
  result: ThreeValued;
  steps: DerivedStep[];
  /** Weakest tier among ordering answers that actually decided a step. */
  weakestEvidence?: EvidenceTier;
}

interface Ctx {
  rule: Rule;
  resolutions: Map<string, Resolution>;
  audit: AuditResult;
  steps: DerivedStep[];
  usedTiers: Set<EvidenceTier>;
}

function positionOf(proof: ObservedProof): Record<string, unknown> {
  const out: Record<string, unknown> = { proofHash: proof.proofHash };
  if (proof.epochId !== undefined) out["epochId"] = proof.epochId;
  out["chainId"] = proof.chainId;
  if (proof.counter !== undefined) out["counter"] = proof.counter;
  if (proof.slotCounter !== undefined) out["slotCounter"] = proof.slotCounter;
  return out;
}

/**
 * Classify a role for predicate purposes.
 *   resolved          -> use the recording
 *   definitely-absent -> optional and absent: closed-world FALSE material
 *   undetermined      -> everything else, with the reason
 */
function classify(
  ctx: Ctx,
  role: string
):
  | { kind: "resolved"; proof: ObservedProof }
  | { kind: "definitely-absent" }
  | { kind: "undetermined"; reason: string } {
  const res = ctx.resolutions.get(role);
  if (res === undefined) {
    return { kind: "undetermined", reason: `role "${role}" is not declared in the cast` };
  }
  switch (res.kind) {
    case "resolved":
      return { kind: "resolved", proof: res.proof };
    case "absent":
      return res.optional
        ? { kind: "definitely-absent" }
        : {
            kind: "undetermined",
            reason: `required role "${role}" has no verified recording in the bundle`,
          };
    case "ambiguous":
      return {
        kind: "undetermined",
        reason: `role "${role}" matches ${res.matchCount} recordings and no "at" pin selects one`,
      };
    case "invalid":
      return { kind: "undetermined", reason: `role "${role}": ${res.reason}` };
  }
}

function record(ctx: Ctx, step: DerivedStep): ThreeValued {
  ctx.steps.push(step);
  return step.result;
}

function evalExists(ctx: Ctx, role: string): ThreeValued {
  const c = classify(ctx, role);
  const claim = `exists(${role})`;
  if (c.kind === "resolved") {
    return record(ctx, {
      claim,
      result: "TRUE",
      because: { recording: positionOf(c.proof) },
    });
  }
  if (c.kind === "definitely-absent") {
    return record(ctx, {
      claim,
      result: "FALSE",
      because: {
        reason: `no verified recording of the declared digest is in the bundle; definite absence within the declared closed world`,
      },
    });
  }
  return record(ctx, { claim, result: "UNDETERMINED", because: { reason: c.reason } });
}

/** Shared body of before/after: asks whether `x` precedes `y`. */
function evalPrecedes(ctx: Ctx, claim: string, x: string, y: string): ThreeValued {
  const cx = classify(ctx, x);
  const cy = classify(ctx, y);

  for (const [role, c] of [
    [x, cx],
    [y, cy],
  ] as const) {
    if (c.kind === "undetermined") {
      return record(ctx, {
        claim,
        result: "UNDETERMINED",
        because: { reason: c.reason, role },
      });
    }
  }
  if (cx.kind === "definitely-absent" || cy.kind === "definitely-absent") {
    const absent = cx.kind === "definitely-absent" ? x : y;
    return record(ctx, {
      claim,
      result: "FALSE",
      because: {
        reason: `role "${absent}" is definitely absent within the declared closed world; no ordering claim about it can hold`,
      },
    });
  }

  const a = (cx as { kind: "resolved"; proof: ObservedProof }).proof;
  const b = (cy as { kind: "resolved"; proof: ObservedProof }).proof;
  const order = compare(a, b, ctx.audit);
  const because: Record<string, unknown> = {
    a: positionOf(a),
    b: positionOf(b),
    relation: order.relation,
    detail: order.detail,
  };

  if (order.relation === "same") {
    return record(ctx, { claim, result: "FALSE", because });
  }
  if (order.relation === "unordered") {
    return record(ctx, { claim, result: "UNDETERMINED", because });
  }

  const basis = order.basis as NonNullable<typeof order.basis>;
  // The tier the specific answer rests on — carried by the adapter, not
  // recomputed from the basis family (lineage coverage can downgrade it).
  const tier = order.tier ?? basisTier(basis);
  because["weaker"] = order.weaker;
  because["assumptionDependent"] = order.assumptionDependent;

  if (!meetsFloor(tier, ctx.rule.requires.ordering)) {
    because["floor"] = ctx.rule.requires.ordering;
    return record(ctx, {
      claim,
      result: "UNDETERMINED",
      basis,
      evidenceTier: tier,
      because: {
        ...because,
        reason: `ordering evidence ("${basis}", tier "${tier}") is below the rule's declared floor ("${ctx.rule.requires.ordering}")`,
      },
    });
  }

  ctx.usedTiers.add(tier);
  return record(ctx, {
    claim,
    result: order.relation === "before" ? "TRUE" : "FALSE",
    basis,
    evidenceTier: tier,
    because,
  });
}

function evalClaim(ctx: Ctx, claim: Claim): ThreeValued {
  if ("exists" in claim) return evalExists(ctx, claim.exists);
  if ("before" in claim) {
    const [x, y] = claim.before;
    return evalPrecedes(ctx, `before(${x}, ${y})`, x, y);
  }
  if ("after" in claim) {
    const [x, y] = claim.after;
    // after(x, y) holds exactly when y precedes x.
    return evalPrecedes(ctx, `after(${x}, ${y})`, y, x);
  }
  if ("between" in claim) {
    const [subject, lower, upper] = claim.between;
    // between(x, a, b) := after(x, a) AND before(x, b), recorded as two steps.
    const afterPart = evalPrecedes(ctx, `between(${subject}, ${lower}, ${upper}): after(${subject}, ${lower})`, lower, subject);
    const beforePart = evalPrecedes(ctx, `between(${subject}, ${lower}, ${upper}): before(${subject}, ${upper})`, subject, upper);
    return kleeneAll([afterPart, beforePart]);
  }
  if ("all" in claim) return kleeneAll(claim.all.map((c) => evalClaim(ctx, c)));
  if ("any" in claim) return kleeneAny(claim.any.map((c) => evalClaim(ctx, c)));
  return kleeneNot(evalClaim(ctx, claim.not));
}

export function evaluate(
  rule: Rule,
  resolutions: Map<string, Resolution>,
  audit: AuditResult
): Evaluation {
  const ctx: Ctx = { rule, resolutions, audit, steps: [], usedTiers: new Set() };
  const result = evalClaim(ctx, rule.claim);
  const evaluation: Evaluation = { result, steps: ctx.steps };
  if (ctx.usedTiers.has("assumption-dependent")) {
    evaluation.weakestEvidence = "assumption-dependent";
  } else if (ctx.usedTiers.has("hash-linked")) {
    evaluation.weakestEvidence = "hash-linked";
  }
  return evaluation;
}
