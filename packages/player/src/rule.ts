// Copyright (c) 2024-2026 Mike Argento. Licensed under the MIT License. See LICENSE.

/**
 * Rule parsing and validation for bitgraph-player/1.
 *
 * Strict by design: unknown fields are rejected at every level, because a
 * silently ignored field in a rule is a claim the author believes is being
 * enforced and is not. `requires.ordering` is mandatory — a rule that does
 * not declare its trust floor does not parse.
 *
 * One deliberate looseness: a claim may reference a role the cast does not
 * declare. That is NOT a parse error; it evaluates to UNDETERMINED. The
 * rule file stays parseable so the verdict can say exactly which reference
 * was undeclared.
 */

import type { TrustedKey } from "./sig.js";
import type { CastEntry, CastPin, Claim, EvidenceTier, Rule, RuleFormat } from "./types.js";

export class RuleError extends Error {
  readonly issues: readonly string[];
  constructor(issues: readonly string[]) {
    super(`invalid rule: ${issues.join("; ")}`);
    this.name = "RuleError";
    this.issues = issues;
  }
}

const HEX64 = /^[0-9a-fA-F]{64}$/;
const B64_STD = /^[A-Za-z0-9+/]{43}=$/;
const B64_URL = /^[A-Za-z0-9_-]{43}=?$/;

/**
 * Normalize any accepted digest spelling to the standard-base64 form used
 * by bitgraph/1 proofs (artifact.digestB64). Returns undefined when the
 * input is not a CANONICAL spelling of a 32-byte SHA-256: base64 forms
 * must round-trip byte-exactly, so spellings with nonzero trailing
 * padding bits (which Node's lenient decoder silently reinterprets) are
 * rejected rather than collapsed into different bytes than written.
 */
export function normalizeDigest(input: string): string | undefined {
  let s = input.trim();
  if (s.toLowerCase().startsWith("sha256:")) s = s.slice("sha256:".length);
  if (HEX64.test(s)) {
    return Buffer.from(s, "hex").toString("base64");
  }
  if (B64_STD.test(s)) {
    const bytes = Buffer.from(s, "base64");
    if (bytes.length === 32 && bytes.toString("base64") === s) return s;
    return undefined;
  }
  if (B64_URL.test(s)) {
    const bytes = Buffer.from(s, "base64url");
    if (bytes.length === 32 && bytes.toString("base64url") === s.replace(/=+$/, "")) {
      return bytes.toString("base64");
    }
    return undefined;
  }
  return undefined;
}

/**
 * Tolerant decode of a digest string observed in a bundle proof, for
 * byte-level matching only (a hostile file may spell its digest any way
 * it likes; matching by bytes keeps "only broken recordings exist" from
 * masquerading as "no recordings exist").
 */
export function decodeDigestBytes(input: string): Buffer | undefined {
  const s = input.trim();
  if (HEX64.test(s)) return Buffer.from(s, "hex");
  if (/^[A-Za-z0-9+/]+=*$/.test(s)) {
    const bytes = Buffer.from(s, "base64");
    return bytes.length === 32 ? bytes : undefined;
  }
  if (/^[A-Za-z0-9_-]+=*$/.test(s)) {
    const bytes = Buffer.from(s, "base64url");
    return bytes.length === 32 ? bytes : undefined;
  }
  return undefined;
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function rejectUnknownKeys(
  obj: Record<string, unknown>,
  allowed: readonly string[],
  where: string,
  issues: string[]
): void {
  for (const key of Object.keys(obj)) {
    if (!allowed.includes(key)) issues.push(`${where}: unknown field "${key}"`);
  }
}

function parsePin(v: unknown, where: string, issues: string[]): CastPin | undefined {
  if (!isPlainObject(v)) {
    issues.push(`${where}: "at" must be an object`);
    return undefined;
  }
  const hasProofHash = "proofHash" in v;
  const hasPosition = "epochId" in v || "counter" in v;
  if (hasProofHash && hasPosition) {
    issues.push(`${where}: "at" must be {proofHash} or {epochId, counter}, not both`);
    return undefined;
  }
  if (hasProofHash) {
    rejectUnknownKeys(v, ["proofHash"], where, issues);
    if (typeof v["proofHash"] !== "string" || v["proofHash"].length === 0) {
      issues.push(`${where}: "at.proofHash" must be a non-empty string`);
      return undefined;
    }
    return { proofHash: v["proofHash"] };
  }
  if (hasPosition) {
    rejectUnknownKeys(v, ["epochId", "counter"], where, issues);
    const epochId = v["epochId"];
    const counter = v["counter"];
    if (typeof epochId !== "string" || epochId.length === 0) {
      issues.push(`${where}: "at.epochId" must be a non-empty string`);
      return undefined;
    }
    if (typeof counter !== "string" || !/^\d+$/.test(counter)) {
      issues.push(`${where}: "at.counter" must be a decimal string`);
      return undefined;
    }
    return { epochId, counter };
  }
  issues.push(`${where}: "at" must be {proofHash} or {epochId, counter}`);
  return undefined;
}

function parseCastEntry(role: string, v: unknown, issues: string[]): CastEntry | undefined {
  const where = `cast.${role}`;
  if (!isPlainObject(v)) {
    issues.push(`${where}: must be an object`);
    return undefined;
  }
  rejectUnknownKeys(v, ["digest", "means", "at", "signedBy", "optional"], where, issues);
  const digest = v["digest"];
  if (typeof digest !== "string") {
    issues.push(`${where}: "digest" is required and must be a string`);
    return undefined;
  }
  if (normalizeDigest(digest) === undefined) {
    issues.push(`${where}: "digest" is not a well-formed 32-byte SHA-256 in any accepted spelling`);
    return undefined;
  }
  const entry: CastEntry = { digest };
  if ("means" in v) {
    if (typeof v["means"] !== "string") {
      issues.push(`${where}: "means" must be a string`);
    } else {
      entry.means = v["means"];
    }
  }
  if ("at" in v) {
    const pin = parsePin(v["at"], where, issues);
    if (pin !== undefined) entry.at = pin;
  }
  if ("signedBy" in v) {
    entry.signedBy = v["signedBy"];
  }
  if ("optional" in v) {
    if (typeof v["optional"] !== "boolean") {
      issues.push(`${where}: "optional" must be a boolean`);
    } else {
      entry.optional = v["optional"];
    }
  }
  return entry;
}

function parseClaim(
  v: unknown,
  where: string,
  issues: string[],
  depth: number,
  format: RuleFormat
): Claim | undefined {
  if (depth > 32) {
    issues.push(`${where}: claim nesting exceeds the maximum depth of 32`);
    return undefined;
  }
  if (!isPlainObject(v)) {
    issues.push(`${where}: must be an object`);
    return undefined;
  }
  const keys = Object.keys(v);
  if (keys.length !== 1) {
    issues.push(`${where}: a claim must have exactly one operator, got [${keys.join(", ")}]`);
    return undefined;
  }
  const op = keys[0];
  const body = v[op as keyof typeof v];
  switch (op) {
    case "exists": {
      if (typeof body !== "string" || body.length === 0) {
        issues.push(`${where}.exists: must be a role name`);
        return undefined;
      }
      return { exists: body };
    }
    case "before":
    case "after": {
      if (!Array.isArray(body) || body.length !== 2 || body.some((r) => typeof r !== "string")) {
        issues.push(`${where}.${op}: must be a two-element array of role names`);
        return undefined;
      }
      const pair = body as [string, string];
      return op === "before" ? { before: pair } : { after: pair };
    }
    case "between": {
      if (!Array.isArray(body) || body.length !== 3 || body.some((r) => typeof r !== "string")) {
        issues.push(`${where}.between: must be [subject, lowerRole, upperRole]`);
        return undefined;
      }
      return { between: body as [string, string, string] };
    }
    case "all":
    case "any": {
      if (!Array.isArray(body) || body.length === 0) {
        issues.push(`${where}.${op}: must be a non-empty array of claims`);
        return undefined;
      }
      const parsed: Claim[] = [];
      let ok = true;
      body.forEach((child, i) => {
        const c = parseClaim(child, `${where}.${op}[${i}]`, issues, depth + 1, format);
        if (c === undefined) ok = false;
        else parsed.push(c);
      });
      if (!ok) return undefined;
      return op === "all" ? { all: parsed } : { any: parsed };
    }
    case "not": {
      const inner = parseClaim(body, `${where}.not`, issues, depth + 1, format);
      if (inner === undefined) return undefined;
      return { not: inner };
    }
    case "signedBy": {
      if (format !== "bitgraph-player/2") {
        issues.push(`${where}.signedBy: requires rule format "bitgraph-player/2"`);
        return undefined;
      }
      if (!Array.isArray(body) || body.length !== 2 || body.some((r) => typeof r !== "string")) {
        issues.push(`${where}.signedBy: must be [roleName, trustedKeyName]`);
        return undefined;
      }
      return { signedBy: body as [string, string] };
    }
    default:
      issues.push(`${where}: unknown operator "${op}"`);
      return undefined;
  }
}

/**
 * Parse and validate a rule from raw JSON text. Throws RuleError with every
 * issue found, not just the first.
 */
export function parseRule(jsonText: string): Rule {
  let raw: unknown;
  try {
    raw = JSON.parse(jsonText);
  } catch (err) {
    throw new RuleError([`not valid JSON: ${(err as Error).message}`]);
  }
  const issues: string[] = [];
  if (!isPlainObject(raw)) throw new RuleError(["rule file must be a JSON object"]);

  rejectUnknownKeys(
    raw,
    ["rule", "id", "cast", "world", "requires", "trustedKeys", "claim", "then"],
    "rule",
    issues
  );

  let format: RuleFormat = "bitgraph-player/1";
  if (raw["rule"] === "bitgraph-player/1" || raw["rule"] === "bitgraph-player/2") {
    format = raw["rule"];
  } else {
    issues.push(`"rule" must be "bitgraph-player/1" or "bitgraph-player/2"`);
  }
  if (typeof raw["id"] !== "string" || raw["id"].length === 0) {
    issues.push(`"id" is required and must be a non-empty string`);
  }
  if (raw["world"] !== "closed") {
    issues.push(`"world" is required and must be exactly "closed" (the only defined value)`);
  }

  // The trust floor is mandatory. No default: a rule that does not state
  // what evidence it accepts does not parse.
  let ordering: EvidenceTier | undefined;
  if (!isPlainObject(raw["requires"])) {
    issues.push(`"requires" is required: a rule must declare its trust floor via requires.ordering`);
  } else {
    rejectUnknownKeys(raw["requires"], ["ordering"], "requires", issues);
    const o = raw["requires"]["ordering"];
    if (o === "hash-linked" || o === "assumption-dependent") {
      ordering = o;
    } else {
      issues.push(`requires.ordering must be "hash-linked" or "assumption-dependent"`);
    }
  }

  // Null prototype: a role named "__proto__" must become an ordinary own
  // key, not a prototype assignment that silently drops the role.
  const cast: Record<string, CastEntry> = Object.create(null) as Record<string, CastEntry>;
  if (!isPlainObject(raw["cast"]) || Object.keys(raw["cast"]).length === 0) {
    issues.push(`"cast" is required and must declare at least one role`);
  } else {
    for (const [role, entry] of Object.entries(raw["cast"])) {
      if (!/^[A-Za-z0-9_.-]+$/.test(role)) {
        issues.push(`cast: role name "${role}" must match [A-Za-z0-9_.-]+`);
        continue;
      }
      // Pure-integer names are re-ordered ahead of string keys by JSON
      // object semantics in some languages, breaking the declaration-order
      // guarantee a verdict depends on. Forbidden by the grammar.
      if (/^[0-9]+$/.test(role)) {
        issues.push(`cast: role name "${role}" must contain at least one non-digit character`);
        continue;
      }
      const parsed = parseCastEntry(role, entry, issues);
      if (parsed !== undefined) cast[role] = parsed;
    }
  }

  // trustedKeys: format 2 only. The name-to-key binding is declared, so
  // parsing only enforces well-formedness, never meaning.
  let trustedKeys: Record<string, TrustedKey> | undefined;
  if ("trustedKeys" in raw) {
    if (format !== "bitgraph-player/2") {
      issues.push(`"trustedKeys" requires rule format "bitgraph-player/2"`);
    } else if (!isPlainObject(raw["trustedKeys"]) || Object.keys(raw["trustedKeys"]).length === 0) {
      issues.push(`"trustedKeys" must be an object naming at least one key`);
    } else {
      trustedKeys = Object.create(null) as Record<string, TrustedKey>;
      for (const [name, entry] of Object.entries(raw["trustedKeys"])) {
        const where = `trustedKeys.${name}`;
        if (!/^[A-Za-z0-9_.-]+$/.test(name) || /^[0-9]+$/.test(name)) {
          issues.push(
            `trustedKeys: key name "${name}" must match [A-Za-z0-9_.-]+ with at least one non-digit`
          );
          continue;
        }
        if (!isPlainObject(entry)) {
          issues.push(`${where}: must be an object`);
          continue;
        }
        rejectUnknownKeys(entry, ["alg", "publicKey"], where, issues);
        const alg = entry["alg"];
        const publicKey = entry["publicKey"];
        if (alg !== "ed25519" && alg !== "es256") {
          issues.push(`${where}: "alg" must be "ed25519" or "es256"`);
          continue;
        }
        if (typeof publicKey !== "string" || publicKey.length === 0) {
          issues.push(`${where}: "publicKey" is required and must be a non-empty string`);
          continue;
        }
        trustedKeys[name] = { alg, publicKey };
      }
    }
  }

  let claim: Claim | undefined;
  if (!("claim" in raw)) {
    issues.push(`"claim" is required`);
  } else {
    claim = parseClaim(raw["claim"], "claim", issues, 0, format);
  }

  // Every signedBy claim must reference a declared trusted key: the
  // reference is statically checkable, and an unresolvable key name is a
  // rule the author believes is being enforced and is not.
  if (claim !== undefined) {
    const referenced: string[] = [];
    const walk = (c: Claim): void => {
      if ("signedBy" in c) referenced.push(c.signedBy[1]);
      else if ("all" in c) c.all.forEach(walk);
      else if ("any" in c) c.any.forEach(walk);
      else if ("not" in c) walk(c.not);
    };
    walk(claim);
    for (const name of referenced) {
      if (trustedKeys === undefined || !(name in trustedKeys)) {
        issues.push(`claim: signedBy references trusted key "${name}" which trustedKeys does not declare`);
      }
    }
  }

  let then: { label: string } | undefined;
  if ("then" in raw) {
    if (!isPlainObject(raw["then"])) {
      issues.push(`"then" must be an object`);
    } else {
      // A label and nothing else. The first request for a field here that
      // can cause an action is a request to make Player an enforcer.
      rejectUnknownKeys(raw["then"], ["label"], "then", issues);
      if (typeof raw["then"]["label"] !== "string" || raw["then"]["label"].length === 0) {
        issues.push(`then.label must be a non-empty string`);
      } else {
        then = { label: raw["then"]["label"] };
      }
    }
  }

  if (issues.length > 0) throw new RuleError(issues);

  const rule: Rule = {
    rule: format,
    id: raw["id"] as string,
    cast,
    world: "closed",
    requires: { ordering: ordering as EvidenceTier },
    claim: claim as Claim,
  };
  if (trustedKeys !== undefined) rule.trustedKeys = trustedKeys;
  if (then !== undefined) rule.then = then;
  return rule;
}
