// Copyright (c) 2024-2026 Mike Argento. Licensed under the MIT License. See LICENSE.

import { strict as assert } from "node:assert";
import { test } from "node:test";
import { resolveCast } from "../cast.js";
import { evaluate } from "../evaluate.js";
import { parseRule } from "../rule.js";
import { buildVerdict, serializeVerdict } from "../verdict.js";
import { digestFor, makeAudit } from "./fixtures.js";
import type { Rule } from "../types.js";

const PO = digestFor("purchase-order");
const DEL = digestFor("delivery");
const APPR = digestFor("approval");
const CANCEL = digestFor("cancellation");

/**
 * The flagship shape: po -> delivery -> approval in one chain-linked
 * component; a cancellation digest that was never recorded, declared
 * optional.
 */
function poAudit() {
  return makeAudit({
    proofs: [
      { name: "po", digestB64: PO, epochId: "E1", counter: "10", slotCounter: "9" },
      { name: "del", digestB64: DEL, epochId: "E1", counter: "20", slotCounter: "19", prev: "po" },
      { name: "appr", digestB64: APPR, epochId: "E1", counter: "30", slotCounter: "29", prev: "del" },
    ],
    partitions: [
      { epochId: "E1", members: ["po", "del", "appr"], components: [["po", "del", "appr"]] },
    ],
  });
}

function poRule(overrides?: { ordering?: string; cancellationDigest?: string }): Rule {
  return parseRule(
    JSON.stringify({
      rule: "bitgraph-player/1",
      id: "po-release-payment",
      cast: {
        purchase_order: { digest: PO, means: "PO-4471" },
        delivery: { digest: DEL },
        approval: { digest: APPR, signedBy: { kind: "c2pa", manifest: "m-123" } },
        cancellation: { digest: overrides?.cancellationDigest ?? CANCEL, optional: true },
      },
      world: "closed",
      requires: { ordering: overrides?.ordering ?? "hash-linked" },
      claim: {
        all: [
          { exists: "purchase_order" },
          { after: ["delivery", "purchase_order"] },
          { after: ["approval", "delivery"] },
          { not: { before: ["cancellation", "approval"] } },
        ],
      },
      then: { label: "release_payment" },
    })
  );
}

test("the purchase-order rule holds over a chain-linked fixture", () => {
  const audit = poAudit();
  const rule = poRule();
  const evaluation = evaluate(rule, resolveCast(rule.cast, audit), audit);
  assert.equal(evaluation.result, "TRUE");
  assert.equal(evaluation.weakestEvidence, "hash-linked");
  // Full walk: every sub-claim recorded.
  assert.equal(evaluation.steps.length, 4);
});

test("absent-optional supports the negative: no cancellation precedes approval", () => {
  const audit = poAudit();
  const rule = poRule();
  const evaluation = evaluate(rule, resolveCast(rule.cast, audit), audit);
  const negStep = evaluation.steps.find((s) => s.claim.startsWith("before(cancellation"));
  assert.ok(negStep);
  assert.equal(negStep.result, "FALSE"); // so not(...) is TRUE
});

test("PLAN test: counter-order evidence under a hash-linked floor is UNDETERMINED, not TRUE and not FALSE", () => {
  const audit = makeAudit({
    proofs: [
      { name: "po", digestB64: PO, epochId: "E1", counter: "10" },
      { name: "del", digestB64: DEL, epochId: "E1", counter: "20" },
    ],
    // Separate components: counter-order only.
    partitions: [{ epochId: "E1", members: ["po", "del"], components: [["po"], ["del"]] }],
  });
  const rule = parseRule(
    JSON.stringify({
      rule: "bitgraph-player/1",
      id: "floor-test",
      cast: { po: { digest: PO }, del: { digest: DEL } },
      world: "closed",
      requires: { ordering: "hash-linked" },
      claim: { before: ["po", "del"] },
    })
  );
  const evaluation = evaluate(rule, resolveCast(rule.cast, audit), audit);
  assert.equal(evaluation.result, "UNDETERMINED");
  // And the same evidence under the permissive floor answers TRUE.
  const permissive = parseRule(
    JSON.stringify({
      rule: "bitgraph-player/1",
      id: "floor-test-2",
      cast: { po: { digest: PO }, del: { digest: DEL } },
      world: "closed",
      requires: { ordering: "assumption-dependent" },
      claim: { before: ["po", "del"] },
    })
  );
  const evaluation2 = evaluate(permissive, resolveCast(permissive.cast, audit), audit);
  assert.equal(evaluation2.result, "TRUE");
  assert.equal(evaluation2.weakestEvidence, "assumption-dependent");
});

test("the floor gates FALSE outcomes too: distrusted evidence is silent in both directions", () => {
  const audit = makeAudit({
    proofs: [
      { name: "po", digestB64: PO, epochId: "E1", counter: "10" },
      { name: "del", digestB64: DEL, epochId: "E1", counter: "20" },
    ],
    partitions: [{ epochId: "E1", members: ["po", "del"], components: [["po"], ["del"]] }],
  });
  const rule = parseRule(
    JSON.stringify({
      rule: "bitgraph-player/1",
      id: "floor-false",
      cast: { po: { digest: PO }, del: { digest: DEL } },
      world: "closed",
      requires: { ordering: "hash-linked" },
      claim: { before: ["del", "po"] }, // would be FALSE on counter-order evidence
    })
  );
  const evaluation = evaluate(rule, resolveCast(rule.cast, audit), audit);
  assert.equal(evaluation.result, "UNDETERMINED");
});

test("PLAN test: a negative predicate naming an undeclared role is UNDETERMINED, not FALSE", () => {
  const audit = poAudit();
  const rule = parseRule(
    JSON.stringify({
      rule: "bitgraph-player/1",
      id: "open-world-negative",
      cast: { approval: { digest: APPR } },
      world: "closed",
      requires: { ordering: "hash-linked" },
      claim: { not: { before: ["ghost", "approval"] } },
    })
  );
  const evaluation = evaluate(rule, resolveCast(rule.cast, audit), audit);
  assert.equal(evaluation.result, "UNDETERMINED");
});

test("PLAN test: two recordings of the same bits and no pin is UNDETERMINED", () => {
  const audit = makeAudit({
    proofs: [
      { name: "x1", digestB64: PO, epochId: "E1", counter: "100" },
      { name: "other", digestB64: DEL, epochId: "E1", counter: "200", prev: "x1" },
      { name: "x2", digestB64: PO, epochId: "E1", counter: "300", prev: "other" },
    ],
    partitions: [
      { epochId: "E1", members: ["x1", "x2", "other"], components: [["x1", "x2", "other"]] },
    ],
  });
  const rule = parseRule(
    JSON.stringify({
      rule: "bitgraph-player/1",
      id: "multiplicity",
      cast: { x: { digest: PO }, other: { digest: DEL } },
      world: "closed",
      requires: { ordering: "hash-linked" },
      claim: { after: ["x", "other"] }, // TRUE and FALSE at once without an occurrence pin
    })
  );
  const evaluation = evaluate(rule, resolveCast(rule.cast, audit), audit);
  assert.equal(evaluation.result, "UNDETERMINED");

  // A pin resolves the ambiguity and the claim becomes decidable.
  const pinned = parseRule(
    JSON.stringify({
      rule: "bitgraph-player/1",
      id: "multiplicity-pinned",
      cast: {
        x: { digest: PO, at: { epochId: "E1", counter: "300" } },
        other: { digest: DEL },
      },
      world: "closed",
      requires: { ordering: "hash-linked" },
      claim: { after: ["x", "other"] },
    })
  );
  const evaluation2 = evaluate(pinned, resolveCast(pinned.cast, audit), audit);
  assert.equal(evaluation2.result, "TRUE");
});

test("required-absent is UNDETERMINED; between works over a chain", () => {
  const audit = poAudit();
  const missingRequired = parseRule(
    JSON.stringify({
      rule: "bitgraph-player/1",
      id: "missing-required",
      cast: { ghost: { digest: digestFor("never-recorded") } },
      world: "closed",
      requires: { ordering: "hash-linked" },
      claim: { exists: "ghost" },
    })
  );
  assert.equal(
    evaluate(missingRequired, resolveCast(missingRequired.cast, audit), audit).result,
    "UNDETERMINED"
  );

  const between = parseRule(
    JSON.stringify({
      rule: "bitgraph-player/1",
      id: "between",
      cast: { po: { digest: PO }, del: { digest: DEL }, appr: { digest: APPR } },
      world: "closed",
      requires: { ordering: "hash-linked" },
      claim: { between: ["del", "po", "appr"] },
    })
  );
  const evaluation = evaluate(between, resolveCast(between.cast, audit), audit);
  assert.equal(evaluation.result, "TRUE");
  assert.equal(evaluation.steps.length, 2); // between records both halves
});

// ---------------------------------------------------------------------------
// Verdict shape and determinism.
// ---------------------------------------------------------------------------

test("verdict carries the trust boundary: declared holds means, signedBy, and the closed world", () => {
  const audit = poAudit();
  const rule = poRule();
  const resolutions = resolveCast(rule.cast, audit);
  const evaluation = evaluate(rule, resolutions, audit);
  const verdict = buildVerdict(rule, "ab".repeat(32), resolutions, evaluation, audit);

  const assertions = verdict.declared.map((d) => d.assertion);
  assert.ok(assertions.includes("means"));
  assert.ok(assertions.includes("signedBy"));
  assert.equal(assertions[assertions.length - 1], "closed-world");

  const closedWorld = verdict.declared[verdict.declared.length - 1] as Record<string, unknown>;
  assert.equal(closedWorld["castSize"], 4);
  assert.equal(closedWorld["recordingsInBundle"], 3);
  for (const d of verdict.declared) assert.equal(d.verifiedHere, false);
  assert.equal(verdict.network, "none");
});

test("verdict bytes are deterministic and carry no timestamp", () => {
  const audit = poAudit();
  const rule = poRule();
  const run = () => {
    const resolutions = resolveCast(rule.cast, audit);
    const evaluation = evaluate(rule, resolutions, audit);
    return serializeVerdict(buildVerdict(rule, "ab".repeat(32), resolutions, evaluation, audit));
  };
  const first = run();
  const second = run();
  assert.equal(first, second);
  assert.ok(!/generatedAt|startedAt|timestamp":/.test(first), "no run timestamp in verdict bytes");
  assert.ok(!first.includes("fixture-path"), "no machine paths in verdict bytes");
  assert.ok(first.endsWith("\n"));
});
