// Copyright (c) 2024-2026 Mike Argento. Licensed under the MIT License. See LICENSE.

/**
 * bitgraph-sig/1: detached signature evidence over a digest.
 *
 * A signature file states that a key signed a domain-separated message
 * derived from an artifact digest. Verification here is pure math over
 * supplied bytes: no filesystem, no network, no clock. What a valid
 * signature MEANS (that the key belongs to a named party) is never
 * derived; the rule's trustedKeys block is a DECLARED binding and the
 * verdict says so.
 *
 * The signed message is:
 *
 *     "bitgraph-sig/1\n" + lowercase hex SHA-256 of the target bytes
 *
 * as UTF-8. Domain separation keeps a signature made in any other
 * protocol from being replayed as a bitgraph-sig, and signing the digest
 * spelling (not the raw 32 bytes) keeps the message printable and
 * auditable by eye.
 *
 * Algorithms:
 *   "ed25519"  publicKey is the raw 32-byte key, standard base64 — the
 *              same spelling bitgraph/1 proofs use for signer keys.
 *              signature is the raw 64-byte Ed25519 signature, base64.
 *   "es256"    ECDSA P-256 over SHA-256. publicKey is SPKI DER, base64
 *              (the export format of every platform keystore, including
 *              Secure Enclave keys surfaced through WebCrypto).
 *              signature is DER-encoded ECDSA, base64.
 *
 * A signature claim can be TRUE or UNDETERMINED, never FALSE: "this key
 * never signed these bytes" is a negative over an open world no bundle
 * can close. A malformed or non-verifying signature file is not evidence
 * of anything.
 */

import { createPublicKey, verify as cryptoVerify } from "node:crypto";
import type { KeyObject } from "node:crypto";

export type SigAlg = "ed25519" | "es256";

export interface TrustedKey {
  alg: SigAlg;
  /** ed25519: raw 32-byte key, standard base64. es256: SPKI DER, base64. */
  publicKey: string;
}

/** A parsed, well-formed bitgraph-sig/1 object (not yet verified). */
export interface SigFile {
  sig: "bitgraph-sig/1";
  /** Digest of the target bytes, in any accepted canonical spelling. */
  over: string;
  alg: SigAlg;
  publicKey: string;
  signature: string;
}

/** SPKI DER prefix for a raw Ed25519 public key (RFC 8410). */
const ED25519_SPKI_PREFIX = Buffer.from("302a300506032b6570032100", "hex");

/** The domain-separated message a bitgraph-sig/1 signature covers. */
export function sigMessage(targetSha256Hex: string): Buffer {
  return Buffer.from(`bitgraph-sig/1\n${targetSha256Hex.toLowerCase()}`, "utf8");
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/**
 * Parse candidate bytes as a bitgraph-sig/1 file. Returns undefined for
 * anything malformed: a broken signature file is noise, never evidence,
 * and never an error that stops evaluation.
 */
export function parseSigFile(bytes: Uint8Array): SigFile | undefined {
  let raw: unknown;
  try {
    raw = JSON.parse(Buffer.from(bytes).toString("utf8"));
  } catch {
    return undefined;
  }
  if (!isPlainObject(raw)) return undefined;
  if (raw["sig"] !== "bitgraph-sig/1") return undefined;
  const over = raw["over"];
  const alg = raw["alg"];
  const publicKey = raw["publicKey"];
  const signature = raw["signature"];
  if (typeof over !== "string" || over.length === 0) return undefined;
  if (alg !== "ed25519" && alg !== "es256") return undefined;
  if (typeof publicKey !== "string" || publicKey.length === 0) return undefined;
  if (typeof signature !== "string" || signature.length === 0) return undefined;
  return { sig: "bitgraph-sig/1", over, alg, publicKey, signature };
}

/** Strict base64 decode: the spelling must round-trip byte-exactly. */
function decodeB64Strict(s: string): Buffer | undefined {
  if (!/^[A-Za-z0-9+/]+=*$/.test(s)) return undefined;
  const bytes = Buffer.from(s, "base64");
  return bytes.toString("base64") === s ? bytes : undefined;
}

/**
 * Build a KeyObject for a trusted key. Returns undefined when the key
 * material is malformed — a rule declaring an undecodable key can never
 * make a signedBy claim TRUE, and the verdict's reason says why.
 */
export function keyObjectFor(key: TrustedKey): KeyObject | undefined {
  const material = decodeB64Strict(key.publicKey);
  if (material === undefined) return undefined;
  try {
    if (key.alg === "ed25519") {
      if (material.length !== 32) return undefined;
      return createPublicKey({
        key: Buffer.concat([ED25519_SPKI_PREFIX, material]),
        format: "der",
        type: "spki",
      });
    }
    const keyObject = createPublicKey({ key: material, format: "der", type: "spki" });
    // es256 means ECDSA over P-256 specifically. SPKI decodes many key
    // types; anything that is not an EC key on prime256v1 is not es256
    // key material, and verification against it must never proceed.
    if (
      keyObject.asymmetricKeyType !== "ec" ||
      keyObject.asymmetricKeyDetails?.namedCurve !== "prime256v1"
    ) {
      return undefined;
    }
    return keyObject;
  } catch {
    return undefined;
  }
}

/**
 * Verify one parsed signature file against a trusted key and a target
 * digest (lowercase hex). TRUE means: the file's `over` names exactly
 * these bytes, its key material equals the trusted key, and the
 * signature verifies over the domain-separated message.
 */
export function verifySigFile(
  sig: SigFile,
  key: TrustedKey,
  keyObject: KeyObject,
  targetSha256Hex: string,
  decodeDigestBytes: (s: string) => Buffer | undefined
): boolean {
  if (sig.alg !== key.alg) return false;
  if (sig.publicKey !== key.publicKey) return false;
  // `over` accepts the same spellings as rule digests, including the
  // "sha256:" prefix, which the byte-level decoder does not strip itself.
  let over = sig.over.trim();
  if (over.toLowerCase().startsWith("sha256:")) over = over.slice("sha256:".length);
  const overBytes = decodeDigestBytes(over);
  const targetBytes = decodeDigestBytes(targetSha256Hex);
  if (overBytes === undefined || targetBytes === undefined) return false;
  if (!overBytes.equals(targetBytes)) return false;
  const signature = decodeB64Strict(sig.signature);
  if (signature === undefined) return false;
  if (sig.alg === "ed25519" && signature.length !== 64) return false;
  const message = sigMessage(targetSha256Hex);
  try {
    if (sig.alg === "ed25519") {
      return cryptoVerify(null, message, keyObject, signature);
    }
    return cryptoVerify("sha256", message, keyObject, signature);
  } catch {
    return false;
  }
}
