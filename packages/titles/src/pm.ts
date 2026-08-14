// Copyright (c) 2024-2026 Mike Argento. Licensed under the MIT License. See LICENSE.

/**
 * bitgraph-pm/1: parse, create, canonical serialization, and single-file
 * checks for possession messages.
 *
 * Canonical bytes: UTF-8 JSON, fixed field order (SPEC-PM.md section 3),
 * two-space indent, one trailing newline — the same discipline as Player
 * verdicts. The signature covers the canonical bytes of the object with
 * the `signature` field absent; the object's own discriminator inside the
 * signed content is the domain separation.
 *
 * Everything here is pure and offline. Recording a message (giving it a
 * causal position) happens through the ordinary BitGraph surfaces — the
 * drop, the Folder, the MCP — never through this package: authoring a
 * message and placing it are separate acts by design, and this package
 * never touches the network.
 */

import { createHash, randomBytes, sign as cryptoSign } from "node:crypto";
import type { KeyObject } from "node:crypto";
import { keyObjectFor } from "@mikeargento/bitgraph-player";
import type { SigAlg } from "@mikeargento/bitgraph-player";
import { verify as cryptoVerify } from "node:crypto";
import type { Pm, PmCheck, PmClaim, PmKeyRef } from "./types.js";

export const PM_VERSION = "bitgraph-pm/1";
const POSSESSION_DOMAIN = "bitgraph-pm-possession/1\n";

const HEX64 = /^[0-9a-f]{64}$/;
const SALT_HEX = /^[0-9a-f]{32}$/;
const CLAIMS: readonly PmClaim[] = ["held", "give", "take", "controls-key", "supersedes"];

/** Canonical digest spelling used throughout the format. */
export function sha256HexOf(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

export function digestSpelling(bytes: Uint8Array): string {
  return `sha256:${sha256HexOf(bytes)}`;
}

/**
 * The possession hash: only a holder of every subject byte can compute
 * it. Deliberately NOT the plain digest — plain digests of recorded
 * works are public on the ledger, and deriving anything gate-shaped from
 * one would let a digest-scraper pose as a holder.
 */
export function possessionHash(subjectBytes: Uint8Array): string {
  return createHash("sha256")
    .update(Buffer.from(POSSESSION_DOMAIN, "utf8"))
    .update(subjectBytes)
    .digest("hex");
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function normalizeDigestField(v: unknown): string | undefined {
  if (typeof v !== "string") return undefined;
  let s = v.trim().toLowerCase();
  if (s.startsWith("sha256:")) s = s.slice("sha256:".length);
  if (!HEX64.test(s)) return undefined;
  return `sha256:${s}`;
}

function parseKeyRef(v: unknown, where: string, issues: string[]): PmKeyRef | undefined {
  if (!isPlainObject(v)) {
    issues.push(`${where}: must be an object { alg, publicKey }`);
    return undefined;
  }
  for (const key of Object.keys(v)) {
    if (key !== "alg" && key !== "publicKey") issues.push(`${where}: unknown field "${key}"`);
  }
  const alg = v["alg"];
  const publicKey = v["publicKey"];
  if (alg !== "ed25519" && alg !== "es256") {
    issues.push(`${where}: "alg" must be "ed25519" or "es256"`);
    return undefined;
  }
  if (typeof publicKey !== "string" || publicKey.length === 0) {
    issues.push(`${where}: "publicKey" is required`);
    return undefined;
  }
  return { alg, publicKey };
}

/**
 * Canonical serialization: fixed field order, absent optionals omitted
 * entirely, two-space indent, trailing newline.
 */
export function serializePm(pm: Pm): string {
  const ordered: Record<string, unknown> = { pm: pm.pm, about: pm.about, claim: pm.claim };
  if (pm.re !== undefined) ordered["re"] = pm.re;
  if (pm.to !== undefined) ordered["to"] = { alg: pm.to.alg, publicKey: pm.to.publicKey };
  if (pm.body !== undefined) ordered["body"] = pm.body;
  ordered["salt"] = pm.salt;
  ordered["possession"] = pm.possession;
  ordered["alg"] = pm.alg;
  ordered["publicKey"] = pm.publicKey;
  ordered["signature"] = pm.signature;
  return JSON.stringify(ordered, null, 2) + "\n";
}

/** The bytes the signature covers: the canonical object with `signature` absent. */
export function pmSigningBytes(pm: Omit<Pm, "signature">): Buffer {
  const ordered: Record<string, unknown> = { pm: pm.pm, about: pm.about, claim: pm.claim };
  if (pm.re !== undefined) ordered["re"] = pm.re;
  if (pm.to !== undefined) ordered["to"] = { alg: pm.to.alg, publicKey: pm.to.publicKey };
  if (pm.body !== undefined) ordered["body"] = pm.body;
  ordered["salt"] = pm.salt;
  ordered["possession"] = pm.possession;
  ordered["alg"] = pm.alg;
  ordered["publicKey"] = pm.publicKey;
  return Buffer.from(JSON.stringify(ordered, null, 2) + "\n", "utf8");
}

export class PmError extends Error {
  readonly issues: readonly string[];
  constructor(issues: readonly string[]) {
    super(`invalid possession message: ${issues.join("; ")}`);
    this.name = "PmError";
    this.issues = issues;
  }
}

/**
 * Parse message bytes. Structural rules only; signature and possession
 * are checked by checkPm, because "well-formed" and "verified" are
 * different facts and a verdict should be able to say which one failed.
 */
export function parsePm(bytes: Uint8Array): Pm {
  const issues: string[] = [];
  let raw: unknown;
  try {
    raw = JSON.parse(Buffer.from(bytes).toString("utf8"));
  } catch (err) {
    throw new PmError([`not valid JSON: ${(err as Error).message}`]);
  }
  if (!isPlainObject(raw)) throw new PmError(["a possession message must be a JSON object"]);

  const allowed = ["pm", "about", "claim", "re", "to", "body", "salt", "possession", "alg", "publicKey", "signature"];
  for (const key of Object.keys(raw)) {
    if (!allowed.includes(key)) issues.push(`unknown field "${key}"`);
  }
  if (raw["pm"] !== PM_VERSION) issues.push(`"pm" must be exactly "${PM_VERSION}"`);

  const about = normalizeDigestField(raw["about"]);
  if (about === undefined) issues.push(`"about" must be a sha256 digest ("sha256:<64 hex>")`);

  const claim = raw["claim"];
  if (typeof claim !== "string" || !CLAIMS.includes(claim as PmClaim)) {
    issues.push(`"claim" must be one of: ${CLAIMS.join(", ")}`);
  }

  let re: string | undefined;
  if ("re" in raw) {
    re = normalizeDigestField(raw["re"]);
    if (re === undefined) issues.push(`"re" must be a sha256 digest of the predecessor message file`);
  }

  let to: PmKeyRef | undefined;
  if ("to" in raw) to = parseKeyRef(raw["to"], `"to"`, issues);

  let body: string | undefined;
  if ("body" in raw) {
    if (typeof raw["body"] !== "string") issues.push(`"body" must be a string`);
    else body = raw["body"];
  }

  const salt = raw["salt"];
  if (typeof salt !== "string" || !SALT_HEX.test(salt)) {
    issues.push(`"salt" is mandatory: 32 lowercase hex characters (128 bits)`);
  }
  const possession = raw["possession"];
  if (typeof possession !== "string" || !HEX64.test(possession)) {
    issues.push(`"possession" is mandatory: lowercase hex SHA-256 (the possession hash)`);
  }
  const alg = raw["alg"];
  if (alg !== "ed25519" && alg !== "es256") issues.push(`"alg" must be "ed25519" or "es256"`);
  const publicKey = raw["publicKey"];
  if (typeof publicKey !== "string" || publicKey.length === 0) issues.push(`"publicKey" is required`);
  const signature = raw["signature"];
  if (typeof signature !== "string" || signature.length === 0) issues.push(`"signature" is required`);

  // Claim-shape rules: a give names its recipient; nothing else does.
  // A take replies to a give, so `re` is required there; "supersedes"
  // names what it replaces the same way.
  if (claim === "give" && to === undefined) issues.push(`a "give" must name its recipient in "to"`);
  if (claim !== "give" && to !== undefined) issues.push(`"to" is only meaningful on a "give"`);
  if ((claim === "take" || claim === "supersedes") && re === undefined) {
    issues.push(`a "${String(claim)}" must name its predecessor in "re"`);
  }
  if (claim === "held" && re !== undefined) {
    issues.push(`a "held" is an origin statement and must not carry "re"`);
  }

  if (issues.length > 0) throw new PmError(issues);

  const pm: Pm = {
    pm: PM_VERSION,
    about: about as string,
    claim: claim as PmClaim,
    salt: salt as string,
    possession: possession as string,
    alg: alg as SigAlg,
    publicKey: publicKey as string,
    signature: signature as string,
  };
  if (re !== undefined) pm.re = re;
  if (to !== undefined) pm.to = to;
  if (body !== undefined) pm.body = body;

  // CANONICAL BYTES OR NOTHING. The signature covers the canonical
  // serialization, but the file's DIGEST is its identity — `re` links,
  // markers, and the title rule all name file digests. Accepting a
  // re-spelled or re-indented variant would let anyone mint unlimited
  // distinct validly-signed files from one signature, each with its own
  // digest and its own non-colliding marker, defeating the one-signed-
  // message-one-identity assumption the whole thread model rests on.
  if (!Buffer.from(bytes).equals(Buffer.from(serializePm(pm), "utf8"))) {
    throw new PmError([
      "not the canonical serialization (SPEC-PM.md section 3): a message file must be byte-identical to its canonical form",
    ]);
  }
  return pm;
}

export interface CreatePmInput {
  subjectBytes: Uint8Array;
  claim: PmClaim;
  signer: { alg: SigAlg; publicKey: string; privateKey: KeyObject };
  re?: string;
  to?: PmKeyRef;
  body?: string;
  /** Test seam only: production callers omit it and get fresh random salt. */
  salt?: string;
}

/** Author a message: possession hash from the bytes, fresh salt, signed. */
export function createPm(input: CreatePmInput): { pm: Pm; bytes: Buffer } {
  const salt = input.salt ?? randomBytes(16).toString("hex");
  const unsigned: Omit<Pm, "signature"> = {
    pm: PM_VERSION,
    about: digestSpelling(input.subjectBytes),
    claim: input.claim,
    salt,
    possession: possessionHash(input.subjectBytes),
    alg: input.signer.alg,
    publicKey: input.signer.publicKey,
  };
  if (input.re !== undefined) unsigned.re = input.re;
  if (input.to !== undefined) unsigned.to = input.to;
  if (input.body !== undefined) unsigned.body = input.body;

  const message = pmSigningBytes(unsigned);
  const signature =
    input.signer.alg === "ed25519"
      ? cryptoSign(null, message, input.signer.privateKey)
      : cryptoSign("sha256", message, input.signer.privateKey);
  const pm: Pm = { ...unsigned, signature: signature.toString("base64") };
  const bytes = Buffer.from(serializePm(pm), "utf8");
  // The claim-shape rules must hold for what we just built.
  parsePm(bytes);
  return { pm, bytes };
}

/**
 * Check one message in isolation: signature always, possession when the
 * subject bytes are supplied.
 */
export function checkPm(pm: Pm, subjectBytes?: Uint8Array): PmCheck {
  const issues: string[] = [];
  const keyObject = keyObjectFor({ alg: pm.alg, publicKey: pm.publicKey });
  let signatureOk = false;
  if (keyObject === undefined) {
    issues.push(`publicKey is not decodable as ${pm.alg} key material`);
  } else {
    const message = pmSigningBytes(pm);
    const sig = Buffer.from(pm.signature, "base64");
    try {
      signatureOk =
        pm.alg === "ed25519"
          ? cryptoVerify(null, message, keyObject, sig)
          : cryptoVerify("sha256", message, keyObject, sig);
    } catch {
      signatureOk = false;
    }
    if (!signatureOk) issues.push("signature does not verify over the canonical message bytes");
  }

  let possession: PmCheck["possession"] = "unverifiable";
  if (subjectBytes !== undefined) {
    const aboutOk = digestSpelling(subjectBytes) === pm.about;
    if (!aboutOk) {
      possession = "refuted";
      issues.push("supplied subject bytes do not match `about`");
    } else if (possessionHash(subjectBytes) === pm.possession) {
      possession = "verified";
    } else {
      possession = "refuted";
      issues.push("possession hash does not match the subject bytes");
    }
  }

  return { structure: true, signature: signatureOk, possession, issues };
}
