// Copyright (c) 2024-2026 Mike Argento. Licensed under the MIT License. See LICENSE.

/**
 * Format 2: trustedKeys + signedBy.
 *
 * The invariants under test:
 *   - signedBy is TRUE or UNDETERMINED, never FALSE, so not(signedBy)
 *     is permanently UNDETERMINED: no open-world negative escapes.
 *   - Signature math is derived; the name-to-key binding is declared.
 *   - A /1 rule parses and evaluates exactly as before (verdict/1), and
 *     /2-only syntax in a /1 rule is a parse error.
 *   - Broken signature files are noise, never evidence and never errors.
 *
 * All evidence is synthetic and in-memory. No ledger writes, ever.
 */

import { strict as assert } from "node:assert";
import { createHash, generateKeyPairSync, sign as cryptoSign } from "node:crypto";
import { test } from "node:test";
import { evaluate } from "../evaluate.js";
import { playAudit, claimUsesSignatures } from "../play.js";
import { parseRule, RuleError } from "../rule.js";
import { parseSigFile, sigMessage } from "../sig.js";
import { resolveCast } from "../cast.js";
import { digestFor, makeAudit } from "./fixtures.js";

// ---------------------------------------------------------------------------
// Key + signature helpers (in-memory, per-run keys; verification is the
// deterministic part under test, not key generation)
// ---------------------------------------------------------------------------

function ed25519Pair(): { publicKeyB64: string; privateKey: import("node:crypto").KeyObject } {
  const { publicKey, privateKey } = generateKeyPairSync("ed25519");
  const spki = publicKey.export({ format: "der", type: "spki" }) as Buffer;
  // Raw key = last 32 bytes of the SPKI encoding.
  return { publicKeyB64: spki.subarray(spki.length - 32).toString("base64"), privateKey };
}

function es256Pair(): { publicKeyB64: string; privateKey: import("node:crypto").KeyObject } {
  const { publicKey, privateKey } = generateKeyPairSync("ec", { namedCurve: "P-256" });
  const spki = publicKey.export({ format: "der", type: "spki" }) as Buffer;
  return { publicKeyB64: spki.toString("base64"), privateKey };
}

function hexOfB64(digestB64: string): string {
  return Buffer.from(digestB64, "base64").toString("hex");
}

function makeSigBytes(
  alg: "ed25519" | "es256",
  publicKeyB64: string,
  privateKey: import("node:crypto").KeyObject,
  overHex: string
): Uint8Array {
  const message = sigMessage(overHex);
  const signature =
    alg === "ed25519"
      ? cryptoSign(null, message, privateKey)
      : cryptoSign("sha256", message, privateKey);
  return Buffer.from(
    JSON.stringify({
      sig: "bitgraph-sig/1",
      over: `sha256:${overHex}`,
      alg,
      publicKey: publicKeyB64,
      signature: signature.toString("base64"),
    })
  );
}

function evidenceOf(...items: Uint8Array[]): Map<string, Uint8Array> {
  const map = new Map<string, Uint8Array>();
  for (const bytes of items) {
    map.set(createHash("sha256").update(bytes).digest("hex"), bytes);
  }
  return map;
}

const WORK = digestFor("work");

function v2Rule(publicKeyB64: string, alg: "ed25519" | "es256", claim: unknown): string {
  return JSON.stringify({
    rule: "bitgraph-player/2",
    id: "test-v2",
    cast: { work: { digest: WORK } },
    world: "closed",
    requires: { ordering: "assumption-dependent" },
    trustedKeys: { mike: { alg, publicKey: publicKeyB64 } },
    claim,
  });
}

function auditWithWork() {
  return makeAudit({
    proofs: [{ name: "w", digestB64: WORK, epochId: "e1", counter: "1" }],
    partitions: [{ epochId: "e1", members: ["w"] }],
  });
}

// ---------------------------------------------------------------------------
// Parsing
// ---------------------------------------------------------------------------

test("signedBy in a /1 rule is a parse error", () => {
  const text = JSON.stringify({
    rule: "bitgraph-player/1",
    id: "r",
    cast: { work: { digest: WORK } },
    world: "closed",
    requires: { ordering: "hash-linked" },
    claim: { signedBy: ["work", "mike"] },
  });
  assert.throws(() => parseRule(text), RuleError);
});

test("trustedKeys in a /1 rule is a parse error", () => {
  const text = JSON.stringify({
    rule: "bitgraph-player/1",
    id: "r",
    cast: { work: { digest: WORK } },
    world: "closed",
    requires: { ordering: "hash-linked" },
    trustedKeys: { mike: { alg: "ed25519", publicKey: "A".repeat(43) + "=" } },
    claim: { exists: "work" },
  });
  assert.throws(() => parseRule(text), RuleError);
});

test("signedBy referencing an undeclared trusted key is a parse error", () => {
  const { publicKeyB64 } = ed25519Pair();
  const text = v2Rule(publicKeyB64, "ed25519", { signedBy: ["work", "ghost"] });
  assert.throws(() => parseRule(text), /does not declare/);
});

test("trustedKeys entries are strictly validated", () => {
  for (const bad of [
    { alg: "rsa", publicKey: "x" },
    { alg: "ed25519" },
    { publicKey: "x" },
    { alg: "ed25519", publicKey: "x", extra: 1 },
  ]) {
    const text = JSON.stringify({
      rule: "bitgraph-player/2",
      id: "r",
      cast: { work: { digest: WORK } },
      world: "closed",
      requires: { ordering: "hash-linked" },
      trustedKeys: { mike: bad },
      claim: { exists: "work" },
    });
    assert.throws(() => parseRule(text), RuleError, JSON.stringify(bad));
  }
});

test("pure-integer trusted key names are rejected", () => {
  const text = JSON.stringify({
    rule: "bitgraph-player/2",
    id: "r",
    cast: { work: { digest: WORK } },
    world: "closed",
    requires: { ordering: "hash-linked" },
    trustedKeys: { "42": { alg: "ed25519", publicKey: "A".repeat(43) + "=" } },
    claim: { exists: "work" },
  });
  assert.throws(() => parseRule(text), /non-digit/);
});

test("claimUsesSignatures walks the tree", () => {
  assert.equal(claimUsesSignatures({ exists: "x" }), false);
  assert.equal(
    claimUsesSignatures({ all: [{ exists: "x" }, { not: { signedBy: ["x", "k"] } }] }),
    true
  );
});

// ---------------------------------------------------------------------------
// Signature file parsing
// ---------------------------------------------------------------------------

test("parseSigFile accepts a well-formed file and rejects noise", () => {
  const { publicKeyB64, privateKey } = ed25519Pair();
  const good = makeSigBytes("ed25519", publicKeyB64, privateKey, hexOfB64(WORK));
  assert.notEqual(parseSigFile(good), undefined);
  assert.equal(parseSigFile(Buffer.from("not json")), undefined);
  assert.equal(parseSigFile(Buffer.from(JSON.stringify({ sig: "other/1" }))), undefined);
  assert.equal(
    parseSigFile(Buffer.from(JSON.stringify({ sig: "bitgraph-sig/1", over: "x", alg: "rsa" }))),
    undefined
  );
});

// ---------------------------------------------------------------------------
// Evaluation: ed25519 and es256
// ---------------------------------------------------------------------------

for (const alg of ["ed25519", "es256"] as const) {
  test(`signedBy(${alg}): valid signature in evidence evaluates TRUE with derived math`, () => {
    const pair = alg === "ed25519" ? ed25519Pair() : es256Pair();
    const rule = parseRule(v2Rule(pair.publicKeyB64, alg, { signedBy: ["work", "mike"] }));
    const audit = auditWithWork();
    const evidence = evidenceOf(makeSigBytes(alg, pair.publicKeyB64, pair.privateKey, hexOfB64(WORK)));
    const result = playAudit(rule, "0".repeat(64), audit, evidence);
    assert.equal(result.verdict.result, "TRUE");
    assert.equal(result.verdict.verdict, "bitgraph-player-verdict/2");
    const step = result.verdict.derived.find((s) => s.claim.startsWith("signedBy"));
    assert.ok(step !== undefined);
    assert.equal((step as NonNullable<typeof step>).result, "TRUE");
    // The binding is declared, alongside the math being derived.
    const trusted = result.verdict.declared.find((d) => d.assertion === "trusted-key");
    assert.ok(trusted !== undefined);
    assert.equal((trusted as NonNullable<typeof trusted>)["keyName"], "mike");
    assert.equal((trusted as NonNullable<typeof trusted>).verifiedHere, false);
  });

  test(`signedBy(${alg}): tampered signature is noise, evaluates UNDETERMINED`, () => {
    const pair = alg === "ed25519" ? ed25519Pair() : es256Pair();
    const rule = parseRule(v2Rule(pair.publicKeyB64, alg, { signedBy: ["work", "mike"] }));
    const bytes = makeSigBytes(alg, pair.publicKeyB64, pair.privateKey, hexOfB64(WORK));
    const parsed = JSON.parse(Buffer.from(bytes).toString("utf8")) as Record<string, string>;
    const sigBytes = Buffer.from(parsed["signature"] as string, "base64");
    sigBytes[0] = (sigBytes[0] as number) ^ 0xff;
    parsed["signature"] = sigBytes.toString("base64");
    const tampered = Buffer.from(JSON.stringify(parsed));
    const result = playAudit(rule, "0".repeat(64), auditWithWork(), evidenceOf(tampered));
    assert.equal(result.verdict.result, "UNDETERMINED");
  });
}

test("a non-P-256 key declared as es256 is undecodable key material: UNDETERMINED, never a verify", () => {
  const { publicKey, privateKey } = generateKeyPairSync("ec", { namedCurve: "secp384r1" });
  const spki = (publicKey.export({ format: "der", type: "spki" }) as Buffer).toString("base64");
  const rule = parseRule(v2Rule(spki, "es256", { signedBy: ["work", "mike"] }));
  const evidence = evidenceOf(makeSigBytes("es256", spki, privateKey, hexOfB64(WORK)));
  const result = playAudit(rule, "0".repeat(64), auditWithWork(), evidence);
  assert.equal(result.verdict.result, "UNDETERMINED");
  const step = result.verdict.derived.find((s) => s.claim.startsWith("signedBy"));
  assert.ok(step !== undefined);
  assert.match(String((step as NonNullable<typeof step>).because["reason"]), /not decodable/);
});

test("signedBy with empty evidence is UNDETERMINED, and not(signedBy) stays UNDETERMINED", () => {
  const { publicKeyB64 } = ed25519Pair();
  const rule = parseRule(v2Rule(publicKeyB64, "ed25519", { not: { signedBy: ["work", "mike"] } }));
  const result = playAudit(rule, "0".repeat(64), auditWithWork());
  // Never FALSE and never TRUE: the open world stays open.
  assert.equal(result.verdict.result, "UNDETERMINED");
});

test("signedBy by the wrong key is UNDETERMINED, never FALSE", () => {
  const right = ed25519Pair();
  const wrong = ed25519Pair();
  const rule = parseRule(v2Rule(right.publicKeyB64, "ed25519", { signedBy: ["work", "mike"] }));
  const evidence = evidenceOf(
    makeSigBytes("ed25519", wrong.publicKeyB64, wrong.privateKey, hexOfB64(WORK))
  );
  const result = playAudit(rule, "0".repeat(64), auditWithWork(), evidence);
  assert.equal(result.verdict.result, "UNDETERMINED");
});

test("signedBy over a different digest does not satisfy the role's claim", () => {
  const pair = ed25519Pair();
  const rule = parseRule(v2Rule(pair.publicKeyB64, "ed25519", { signedBy: ["work", "mike"] }));
  const other = digestFor("other");
  const evidence = evidenceOf(
    makeSigBytes("ed25519", pair.publicKeyB64, pair.privateKey, hexOfB64(other))
  );
  const result = playAudit(rule, "0".repeat(64), auditWithWork(), evidence);
  assert.equal(result.verdict.result, "UNDETERMINED");
});

test("signedBy evaluates against the declared digest even when the role has no recording", () => {
  const pair = ed25519Pair();
  const text = JSON.stringify({
    rule: "bitgraph-player/2",
    id: "r",
    cast: { work: { digest: WORK, optional: true } },
    world: "closed",
    requires: { ordering: "hash-linked" },
    trustedKeys: { mike: { alg: "ed25519", publicKey: pair.publicKeyB64 } },
    claim: { signedBy: ["work", "mike"] },
  });
  const rule = parseRule(text);
  const audit = makeAudit({ proofs: [], partitions: [] });
  const evidence = evidenceOf(
    makeSigBytes("ed25519", pair.publicKeyB64, pair.privateKey, hexOfB64(WORK))
  );
  const resolutions = resolveCast(rule.cast, audit);
  const evaluation = evaluate(rule, resolutions, audit, evidence);
  assert.equal(evaluation.result, "TRUE");
});

test("a /1 rule still yields a /1 verdict and ignores supplied evidence", () => {
  const text = JSON.stringify({
    rule: "bitgraph-player/1",
    id: "r",
    cast: { work: { digest: WORK } },
    world: "closed",
    requires: { ordering: "assumption-dependent" },
    claim: { exists: "work" },
  });
  const rule = parseRule(text);
  const result = playAudit(rule, "0".repeat(64), auditWithWork(), evidenceOf(Buffer.from("junk")));
  assert.equal(result.verdict.verdict, "bitgraph-player-verdict/1");
  assert.equal(result.verdict.result, "TRUE");
});

test("multiple candidates: the winner is deterministic and reported by content hash", () => {
  const pair = ed25519Pair();
  const rule = parseRule(v2Rule(pair.publicKeyB64, "ed25519", { signedBy: ["work", "mike"] }));
  const sig = makeSigBytes("ed25519", pair.publicKeyB64, pair.privateKey, hexOfB64(WORK));
  const junk = Buffer.from("{}");
  const a = playAudit(rule, "0".repeat(64), auditWithWork(), evidenceOf(sig, junk));
  const b = playAudit(rule, "0".repeat(64), auditWithWork(), evidenceOf(junk, sig));
  assert.equal(a.bytes, b.bytes);
});
