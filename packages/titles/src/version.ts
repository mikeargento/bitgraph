// Copyright (c) 2024-2026 Mike Argento. Licensed under the MIT License. See LICENSE.

/**
 * bitgraph-versions/1: a VERSION of a bitgraph.
 *
 * A recording is public and unownable: everyone can verify it, nobody
 * can hold it. A version is the holdable object of the same work: a
 * small salted file that references the recorded work and, once
 * recorded itself, is one of a kind at one position, forever. The
 * record is everyone's; the version is yours.
 *
 * The entropy changes direction here. A recording's uniqueness comes
 * from the enclave's randomness receiving your bytes; a version's comes
 * from YOUR randomness, which the chain then places. Same invariant —
 * uniqueness is entropy plus position — new source.
 *
 * Properties:
 *   - `of` is a one-way edge to the work's digest. The work is
 *     untouched; its recording unchanged; the core never learns
 *     versions exist.
 *   - The salt makes every version distinct bytes (mint twice, get two
 *     versions) and makes a sealed version unconfirmable by guessing.
 *   - The possession hash gates minting to holders of the work's full
 *     bytes: no file, no version. A public digest scraped from a proof
 *     page cannot mint.
 *   - Versions are BEARER objects: no signature, no key. Whoever holds
 *     the salted bytes holds the version; "whose" is possession
 *     evidence, and the Titles conveyance layer exists for the day a
 *     version must provably change hands.
 *   - Causal order numbers versions for free: a version's recording
 *     provably postdates the work's, and the earliest version of a work
 *     is first as a matter of public order.
 *
 * A version proves held and placed. It never proves that any statement
 * in its body is true, who minted it, or who holds it now.
 */

import { createHash, randomBytes } from "node:crypto";
import { PmError, possessionHash } from "./pm.js";

export const VERSION_FORMAT = "bitgraph-versions/1";

const HEX64 = /^[0-9a-f]{64}$/;
const SALT_HEX = /^[0-9a-f]{32}$/;

export interface BitGraphVersion {
  version: "bitgraph-versions/1";
  /** Digest of the work whose bitgraph this is a version of: "sha256:<hex>". */
  of: string;
  /** Free text; the human layer, sealed inside the version. */
  body?: string;
  /** 32 lowercase hex chars: what makes this version one of a kind. */
  salt: string;
  /** The possession hash of the work's full bytes: minting requires holding. */
  possession: string;
}

/** Canonical serialization: fixed order, two-space indent, trailing newline. */
export function serializeVersion(v: BitGraphVersion): string {
  const ordered: Record<string, unknown> = { version: v.version, of: v.of };
  if (v.body !== undefined) ordered["body"] = v.body;
  ordered["salt"] = v.salt;
  ordered["possession"] = v.possession;
  return JSON.stringify(ordered, null, 2) + "\n";
}

function isPlainObject(x: unknown): x is Record<string, unknown> {
  return typeof x === "object" && x !== null && !Array.isArray(x);
}

/**
 * Parse version bytes. CANONICAL BYTES OR NOTHING, for the same reason
 * as possession messages: a version's identity IS its file digest, and
 * accepting a re-spelled variant would fracture one version into many.
 */
export function parseVersion(bytes: Uint8Array): BitGraphVersion {
  const issues: string[] = [];
  let raw: unknown;
  try {
    raw = JSON.parse(Buffer.from(bytes).toString("utf8"));
  } catch (err) {
    throw new PmError([`not valid JSON: ${(err as Error).message}`]);
  }
  if (!isPlainObject(raw)) throw new PmError(["a version must be a JSON object"]);
  for (const key of Object.keys(raw)) {
    if (!["version", "of", "body", "salt", "possession"].includes(key)) {
      issues.push(`unknown field "${key}"`);
    }
  }
  if (raw["version"] !== VERSION_FORMAT) issues.push(`"version" must be exactly "${VERSION_FORMAT}"`);
  const of = raw["of"];
  if (typeof of !== "string" || !/^sha256:[0-9a-f]{64}$/.test(of)) {
    issues.push(`"of" must be "sha256:<64 lowercase hex>"`);
  }
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
    issues.push(`"possession" is mandatory: lowercase hex SHA-256 (the possession hash of the work)`);
  }
  if (issues.length > 0) throw new PmError(issues);

  const v: BitGraphVersion = {
    version: VERSION_FORMAT,
    of: of as string,
    salt: salt as string,
    possession: possession as string,
  };
  if (body !== undefined) v.body = body;

  if (!Buffer.from(bytes).equals(Buffer.from(serializeVersion(v), "utf8"))) {
    throw new PmError([
      "not the canonical serialization: a version file must be byte-identical to its canonical form",
    ]);
  }
  return v;
}

/** Mint a version of the work. Requires the work's full bytes: no file, no version. */
export function mintVersion(
  workBytes: Uint8Array,
  options: { body?: string; salt?: string } = {}
): { version: BitGraphVersion; bytes: Buffer } {
  const digestHex = createHash("sha256").update(workBytes).digest("hex");
  const version: BitGraphVersion = {
    version: VERSION_FORMAT,
    of: `sha256:${digestHex}`,
    salt: options.salt ?? randomBytes(16).toString("hex"),
    possession: possessionHash(workBytes),
  };
  if (options.body !== undefined && options.body.length > 0) version.body = options.body;
  const bytes = Buffer.from(serializeVersion(version), "utf8");
  parseVersion(bytes);
  return { version, bytes };
}

/**
 * Check a version against the work's bytes. Three-valued by nature:
 * verified with the bytes in hand, unverifiable without them, refuted
 * when supplied bytes contradict either the edge or the gate.
 */
export function checkVersion(
  v: BitGraphVersion,
  workBytes?: Uint8Array
): { possession: "verified" | "unverifiable" | "refuted"; issues: string[] } {
  if (workBytes === undefined) return { possession: "unverifiable", issues: [] };
  const issues: string[] = [];
  const digestHex = createHash("sha256").update(workBytes).digest("hex");
  if (`sha256:${digestHex}` !== v.of) {
    issues.push("supplied work bytes do not match `of`");
    return { possession: "refuted", issues };
  }
  if (possessionHash(workBytes) !== v.possession) {
    issues.push("possession hash does not match the work bytes");
    return { possession: "refuted", issues };
  }
  return { possession: "verified", issues };
}
