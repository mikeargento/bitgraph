// Copyright (c) 2024-2026 Mike Argento. Licensed under the MIT License. See LICENSE.

import { strict as assert } from "node:assert";
import { test } from "node:test";
import { kleeneAll, kleeneAny, kleeneNot } from "../logic.js";
import { normalizeDigest, parseRule, RuleError } from "../rule.js";
import type { ThreeValued } from "../types.js";

const T: ThreeValued = "TRUE";
const F: ThreeValued = "FALSE";
const U: ThreeValued = "UNDETERMINED";
const VALUES: readonly ThreeValued[] = [T, F, U];

// ---------------------------------------------------------------------------
// Kleene tables, exhaustively for the binary projections.
// ---------------------------------------------------------------------------

test("kleeneNot table", () => {
  assert.equal(kleeneNot(T), F);
  assert.equal(kleeneNot(F), T);
  assert.equal(kleeneNot(U), U);
});

test("kleeneAll pairwise table", () => {
  const expect: Record<string, ThreeValued> = {
    "TRUE,TRUE": T,
    "TRUE,FALSE": F,
    "TRUE,UNDETERMINED": U,
    "FALSE,TRUE": F,
    "FALSE,FALSE": F,
    "FALSE,UNDETERMINED": F,
    "UNDETERMINED,TRUE": U,
    "UNDETERMINED,FALSE": F,
    "UNDETERMINED,UNDETERMINED": U,
  };
  for (const a of VALUES) {
    for (const b of VALUES) {
      assert.equal(kleeneAll([a, b]), expect[`${a},${b}`], `all([${a}, ${b}])`);
    }
  }
  assert.equal(kleeneAll([]), T, "empty conjunction is vacuously TRUE");
});

test("kleeneAny pairwise table", () => {
  const expect: Record<string, ThreeValued> = {
    "TRUE,TRUE": T,
    "TRUE,FALSE": T,
    "TRUE,UNDETERMINED": T,
    "FALSE,TRUE": T,
    "FALSE,FALSE": F,
    "FALSE,UNDETERMINED": U,
    "UNDETERMINED,TRUE": T,
    "UNDETERMINED,FALSE": U,
    "UNDETERMINED,UNDETERMINED": U,
  };
  for (const a of VALUES) {
    for (const b of VALUES) {
      assert.equal(kleeneAny([a, b]), expect[`${a},${b}`], `any([${a}, ${b}])`);
    }
  }
  assert.equal(kleeneAny([]), F, "empty disjunction is vacuously FALSE");
});

test("UNDETERMINED never launders into FALSE through not", () => {
  // The single easiest way to make Player dishonest is a boolean evaluator.
  assert.notEqual(kleeneNot(U), T);
  assert.notEqual(kleeneNot(U), F);
});

// ---------------------------------------------------------------------------
// Digest normalization: four spellings, one canonical form.
// ---------------------------------------------------------------------------

test("normalizeDigest accepts hex, sha256:hex, base64, base64url identically", () => {
  const bytes = Buffer.alloc(32, 7);
  const hex = bytes.toString("hex");
  const b64 = bytes.toString("base64");
  const b64url = bytes.toString("base64url");
  assert.equal(normalizeDigest(hex), b64);
  assert.equal(normalizeDigest(`sha256:${hex}`), b64);
  assert.equal(normalizeDigest(b64), b64);
  assert.equal(normalizeDigest(b64url), b64);
});

test("normalizeDigest rejects malformed input", () => {
  assert.equal(normalizeDigest("not-a-digest"), undefined);
  assert.equal(normalizeDigest("sha256:abcd"), undefined);
  assert.equal(normalizeDigest(""), undefined);
});

// ---------------------------------------------------------------------------
// Rule parsing.
// ---------------------------------------------------------------------------

const DIGEST = Buffer.alloc(32, 1).toString("base64");

function baseRule(): Record<string, unknown> {
  return {
    rule: "bitgraph-player/1",
    id: "test-rule",
    cast: { a: { digest: DIGEST } },
    world: "closed",
    requires: { ordering: "hash-linked" },
    claim: { exists: "a" },
  };
}

test("a well-formed rule parses", () => {
  const rule = parseRule(JSON.stringify(baseRule()));
  assert.equal(rule.id, "test-rule");
  assert.equal(rule.requires.ordering, "hash-linked");
});

test("a rule with no requires.ordering does not parse (mandatory trust floor)", () => {
  const raw = baseRule();
  delete raw["requires"];
  assert.throws(() => parseRule(JSON.stringify(raw)), RuleError);

  const raw2 = baseRule();
  raw2["requires"] = {};
  assert.throws(() => parseRule(JSON.stringify(raw2)), RuleError);
});

test("world is mandatory and must be closed", () => {
  const raw = baseRule();
  delete raw["world"];
  assert.throws(() => parseRule(JSON.stringify(raw)), RuleError);
  raw["world"] = "open";
  assert.throws(() => parseRule(JSON.stringify(raw)), RuleError);
});

test("unknown fields are rejected at every level", () => {
  const top = baseRule();
  top["webhook"] = "https://example.com";
  assert.throws(() => parseRule(JSON.stringify(top)), RuleError);

  const castLevel = baseRule();
  (castLevel["cast"] as Record<string, unknown>)["a"] = { digest: DIGEST, url: "x" };
  assert.throws(() => parseRule(JSON.stringify(castLevel)), RuleError);
});

test("then accepts a label and nothing capable of causing an action", () => {
  const ok = baseRule();
  ok["then"] = { label: "release_payment" };
  assert.equal(parseRule(JSON.stringify(ok)).then?.label, "release_payment");

  // Constraint 3 enforced by the format: the first request for a webhook
  // field is a request to make Player an enforcer.
  const bad = baseRule();
  bad["then"] = { label: "x", webhook: "https://example.com/pay" };
  assert.throws(() => parseRule(JSON.stringify(bad)), RuleError);
});

test("claims must have exactly one known operator", () => {
  const bad = baseRule();
  bad["claim"] = { exists: "a", before: ["a", "a"] };
  assert.throws(() => parseRule(JSON.stringify(bad)), RuleError);

  const unknown = baseRule();
  unknown["claim"] = { precedes: ["a", "b"] };
  assert.throws(() => parseRule(JSON.stringify(unknown)), RuleError);
});

test("a claim referencing an undeclared role still parses (evaluates to UNDETERMINED, not a parse error)", () => {
  const raw = baseRule();
  raw["claim"] = { not: { before: ["ghost", "a"] } };
  const rule = parseRule(JSON.stringify(raw));
  assert.ok(rule);
});

test("malformed digests are parse errors", () => {
  const raw = baseRule();
  (raw["cast"] as Record<string, unknown>)["a"] = { digest: "zzzz" };
  assert.throws(() => parseRule(JSON.stringify(raw)), RuleError);
});

test("a role named __proto__ is an ordinary own key, never a prototype assignment", () => {
  // Built as JSON text: a JS object literal cannot even express an own
  // "__proto__" key by assignment, which is exactly the trap the parser
  // must not fall into on its side.
  const json =
    `{"rule":"bitgraph-player/1","id":"t",` +
    `"cast":{"a":{"digest":"${DIGEST}"},"__proto__":{"digest":"${DIGEST}"}},` +
    `"world":"closed","requires":{"ordering":"hash-linked"},"claim":{"exists":"__proto__"}}`;
  const rule = parseRule(json);
  assert.ok(Object.keys(rule.cast).includes("__proto__"), "role survives as an own key");
  assert.ok(Object.keys(rule.cast).includes("a"));
  assert.equal(Object.getPrototypeOf(rule.cast), null);
});

test("pure-integer role names are rejected (declaration order would not survive)", () => {
  const raw = baseRule();
  (raw["cast"] as Record<string, unknown>)["2"] = { digest: DIGEST };
  assert.throws(() => parseRule(JSON.stringify(raw)), RuleError);
});

test("non-canonical base64 spellings are rejected, not silently reinterpreted", () => {
  // 43 chars + pad decodes to 32 bytes but carries nonzero trailing
  // padding bits: Node's lenient decoder drops them, so accepting the
  // spelling would collapse it into different bytes than written.
  const nonCanonical = "A".repeat(42) + "B=";
  assert.equal(normalizeDigest(nonCanonical), undefined);
  const canonical = Buffer.alloc(32, 7).toString("base64");
  assert.equal(normalizeDigest(canonical), canonical);
});

test("at pin must be exactly one of the two forms", () => {
  const both = baseRule();
  (both["cast"] as Record<string, unknown>)["a"] = {
    digest: DIGEST,
    at: { proofHash: "p", epochId: "e", counter: "1" },
  };
  assert.throws(() => parseRule(JSON.stringify(both)), RuleError);

  const position = baseRule();
  (position["cast"] as Record<string, unknown>)["a"] = {
    digest: DIGEST,
    at: { epochId: "e", counter: "12" },
  };
  assert.ok(parseRule(JSON.stringify(position)));
});
