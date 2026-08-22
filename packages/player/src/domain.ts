// Copyright (c) 2024-2026 Mike Argento. Licensed under the MIT License. See LICENSE.

/**
 * BitGraph Domain: a party's own domain publishing the keys that record
 * for it. The file (`bitgraph-domain/1`) is served at
 * `https://<domain>/.well-known/bitgraph` and is the party speaking for
 * itself, never BitGraph speaking about the party: parsing enforces
 * well-formedness only, and adopting the statement is the reader's act
 * (see pin.ts). The format is DOMAIN.md; evaluation semantics (SPEC.md
 * sections 1 through 9) are untouched by everything in this module.
 *
 * The file shares SPEC section 9.1's trusted-key grammar, so an entry
 * pastes into a format 2 rule's `trustedKeys` unchanged, and a key's
 * fingerprint is the lowercase hex SHA-256 of the decoded key bytes,
 * which for es256 is exactly the `keyId` actor proofs carry. Fingerprints
 * are always derived here and never read from the file, so a domain
 * cannot claim a key it does not show.
 */

import { createHash } from "node:crypto";
import type { CheckDomain } from "./check.js";
import { decodeDigestBytes } from "./rule.js";
import type { TrustedKey } from "./sig.js";
import { decodeB64Strict, keyObjectFor, parseSigFile, verifySigFile } from "./sig.js";

export const DOMAIN_FILE_VERSION = "bitgraph-domain/1";
export const DOMAIN_WELL_KNOWN_PATH = "/.well-known/bitgraph";
export const DOMAIN_FILE_MAX_BYTES = 65_536;

export interface DomainFile {
  version: "bitgraph-domain/1";
  /** Lowercase hostname; the binding. Must equal the domain the reader asked for. */
  domain: string;
  /** The name the domain gives itself. Display only. */
  party: string;
  /** SPEC §9.1 trusted-key bodies, named. */
  keys: Record<string, TrustedKey>;
}

export class DomainFileError extends Error {
  readonly issues: readonly string[];
  constructor(issues: string[]) {
    super(issues[0] ?? "invalid domain file");
    this.name = "DomainFileError";
    this.issues = issues;
  }
}

/**
 * Lowercase registrable hostname: dot-separated LDH labels, at least two,
 * no scheme, no port, no path. Also the safety property the pin store
 * rests on: a name this grammar accepts contains no path separators.
 */
const LABEL = "[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?";
const DOMAIN_RE = new RegExp(`^${LABEL}(?:\\.${LABEL})+$`);

export function isDomainName(s: string): boolean {
  return s.length > 0 && s.length <= 253 && DOMAIN_RE.test(s);
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/**
 * Parse and validate a bitgraph-domain/1 file. Strict: unknown fields are
 * errors (additions are a new format version), and key material that does
 * not decode is refused here rather than stored, so a pin can never hold
 * keys that silently match nothing. Throws DomainFileError with every
 * issue found.
 */
export function parseDomainFile(input: Uint8Array | string, expectedDomain?: string): DomainFile {
  const issues: string[] = [];
  const text = typeof input === "string" ? input : Buffer.from(input).toString("utf8");
  if (typeof input !== "string" && input.length > DOMAIN_FILE_MAX_BYTES) {
    throw new DomainFileError([`file is ${input.length} bytes; the cap is ${DOMAIN_FILE_MAX_BYTES}`]);
  }

  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch (err) {
    throw new DomainFileError([`not JSON: ${(err as Error).message}`]);
  }
  if (!isPlainObject(raw)) throw new DomainFileError(["not a JSON object"]);

  for (const k of Object.keys(raw)) {
    if (!["version", "domain", "party", "keys"].includes(k)) {
      issues.push(`unknown field "${k}" (additions are a new format version)`);
    }
  }

  if (raw["version"] !== DOMAIN_FILE_VERSION) {
    issues.push(`"version" must be exactly "${DOMAIN_FILE_VERSION}"`);
  }

  const domain = raw["domain"];
  if (typeof domain !== "string" || !isDomainName(domain)) {
    issues.push(`"domain" must be a lowercase hostname (no scheme, no port, no path)`);
  } else if (expectedDomain !== undefined && domain !== expectedDomain) {
    issues.push(
      `the file names domain "${domain}" but was requested for "${expectedDomain}"; refusing to store one party's file under another party's name`
    );
  }

  const party = raw["party"];
  if (typeof party !== "string" || party.trim().length === 0) {
    issues.push(`"party" is required: the name the domain gives itself`);
  }

  const keys = Object.create(null) as Record<string, TrustedKey>;
  const rawKeys = raw["keys"];
  if (!isPlainObject(rawKeys) || Object.keys(rawKeys).length === 0) {
    issues.push(`"keys" must be an object naming at least one key`);
  } else {
    for (const [name, entry] of Object.entries(rawKeys)) {
      const where = `keys.${name}`;
      if (!/^[A-Za-z0-9_.-]+$/.test(name) || /^[0-9]+$/.test(name)) {
        issues.push(`${where}: key name must match [A-Za-z0-9_.-]+ with at least one non-digit`);
        continue;
      }
      if (!isPlainObject(entry)) {
        issues.push(`${where}: must be an object`);
        continue;
      }
      for (const k of Object.keys(entry)) {
        if (k !== "alg" && k !== "publicKey") issues.push(`${where}: unknown field "${k}"`);
      }
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
      const key: TrustedKey = { alg, publicKey };
      if (keyObjectFor(key) === undefined) {
        issues.push(
          `${where}: key material does not decode as ${alg} (${alg === "es256" ? "SPKI DER for P-256" : "raw 32-byte key"}, standard base64)`
        );
        continue;
      }
      keys[name] = key;
    }
  }

  if (issues.length > 0) throw new DomainFileError(issues);
  return { version: DOMAIN_FILE_VERSION, domain: domain as string, party: (party as string).trim(), keys };
}

/**
 * Lowercase hex SHA-256 of the decoded publicKey bytes. For es256 this is
 * exactly the actor keyId (hex SHA-256 of the SPKI DER). Undefined when
 * the material does not decode, which parseDomainFile refuses anyway.
 */
export function keyFingerprint(key: TrustedKey): string | undefined {
  const material = decodeB64Strict(key.publicKey);
  if (material === undefined) return undefined;
  return createHash("sha256").update(material).digest("hex");
}

export interface DomainKeyRef {
  name: string;
  key: TrustedKey;
  fingerprint: string;
}

/** Every key with its derived fingerprint, name order. */
export function domainKeyRefs(file: DomainFile): DomainKeyRef[] {
  const refs: DomainKeyRef[] = [];
  for (const name of Object.keys(file.keys).sort()) {
    const key = file.keys[name] as TrustedKey;
    const fingerprint = keyFingerprint(key);
    if (fingerprint !== undefined) refs.push({ name, key, fingerprint });
  }
  return refs;
}

export interface DomainDiff {
  partyChanged?: { before: string; after: string };
  added: DomainKeyRef[];
  removed: DomainKeyRef[];
  changed: { name: string; before: DomainKeyRef; after: DomainKeyRef }[];
  unchanged: number;
}

/** What a re-pin would change, for showing before asking. */
export function diffDomainFiles(before: DomainFile, after: DomainFile): DomainDiff {
  const beforeRefs = new Map(domainKeyRefs(before).map((r) => [r.name, r]));
  const afterRefs = new Map(domainKeyRefs(after).map((r) => [r.name, r]));
  const diff: DomainDiff = { added: [], removed: [], changed: [], unchanged: 0 };
  if (before.party !== after.party) diff.partyChanged = { before: before.party, after: after.party };
  for (const [name, ref] of afterRefs) {
    const prior = beforeRefs.get(name);
    if (prior === undefined) diff.added.push(ref);
    else if (prior.key.alg !== ref.key.alg || prior.key.publicKey !== ref.key.publicKey) {
      diff.changed.push({ name, before: prior, after: ref });
    } else diff.unchanged += 1;
  }
  for (const [name, ref] of beforeRefs) {
    if (!afterRefs.has(name)) diff.removed.push(ref);
  }
  return diff;
}

/**
 * The check-report adapter: what `check --from` consults per recording.
 * Defined as an interface in check.ts so the check module (which also
 * builds verify.html) never imports the crypto this module uses; the CLI
 * hands the report builder this object.
 */
export function checkDomain(file: DomainFile): CheckDomain {
  const actorNames = new Map<string, string>();
  for (const ref of domainKeyRefs(file)) {
    if (ref.key.alg !== "es256") continue;
    if (!actorNames.has(ref.fingerprint)) actorNames.set(ref.fingerprint, ref.name);
  }
  const sigKeys = domainKeyRefs(file)
    .map((ref) => ({ name: ref.name, key: ref.key, keyObject: keyObjectFor(ref.key) }))
    .filter((k) => k.keyObject !== undefined);

  return {
    domain: file.domain,
    party: file.party,
    keyCount: Object.keys(file.keys).length,
    actorKeyName: (keyId: string): string | undefined => actorNames.get(keyId.toLowerCase()),
    signatureKeyName: (targetSha256Hex: string, evidence: ReadonlyMap<string, Uint8Array>): string | undefined => {
      // Deterministic: candidates in ascending content-hash order, keys in
      // name order; the first verifying pair decides (SPEC §9.4 discipline).
      for (const sha256Hex of [...evidence.keys()].sort()) {
        const sig = parseSigFile(evidence.get(sha256Hex) as Uint8Array);
        if (sig === undefined) continue;
        for (const k of sigKeys) {
          if (verifySigFile(sig, k.key, k.keyObject as NonNullable<typeof k.keyObject>, targetSha256Hex, decodeDigestBytes)) {
            return k.name;
          }
        }
      }
      return undefined;
    },
  };
}
