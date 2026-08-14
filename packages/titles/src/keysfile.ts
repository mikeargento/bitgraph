// Copyright (c) 2024-2026 Mike Argento. Licensed under the MIT License. See LICENSE.

/**
 * File-based signing keys, for the CLI and non-enclave environments.
 *
 * The key here is a PEN, not a wallet: it holds nothing and only signs.
 * Losing it never touches past messages (they verify against the public
 * key forever); it only ends this identity's ability to write new ones,
 * answered by the continuity pattern (the old key signs a controls-key
 * message naming its successor) and the recorded-revocation pattern.
 *
 * Storage: a JSON file, mode 0600. With a passphrase (via environment
 * variable, never argv — argv is visible in `ps`), the private key is
 * encrypted with scrypt + AES-256-GCM. Without one, it is written plain
 * with a warning: named, not hidden.
 *
 * Secure Enclave / passkey keys are the recommended home for product
 * surfaces; this module exists so the protocol works anywhere Node does.
 * Never keep a key file in any folder that records things.
 */

import {
  createCipheriv,
  createDecipheriv,
  createPrivateKey,
  generateKeyPairSync,
  randomBytes,
  scryptSync,
} from "node:crypto";
import type { KeyObject } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";

const KEYFILE_VERSION = "bitgraph-key/1";
const SCRYPT = { N: 1 << 15, r: 8, p: 1, maxmem: 128 * 1024 * 1024 };

export interface KeyFile {
  key: typeof KEYFILE_VERSION;
  alg: "ed25519";
  publicKey: string;
  /** Present when unencrypted: PKCS8 DER, base64. */
  privateKey?: string;
  /** Present when passphrase-encrypted. */
  encrypted?: { saltB64: string; ivB64: string; ciphertextB64: string; tagB64: string };
}

export class KeyFileError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "KeyFileError";
  }
}

/** Generate an ed25519 keypair and write it. Returns the public key (raw 32-byte b64). */
export function keygen(path: string, passphrase?: string): string {
  const { publicKey, privateKey } = generateKeyPairSync("ed25519");
  const spki = publicKey.export({ format: "der", type: "spki" }) as Buffer;
  const publicKeyB64 = spki.subarray(spki.length - 32).toString("base64");
  const pkcs8 = privateKey.export({ format: "der", type: "pkcs8" }) as Buffer;

  const file: KeyFile = { key: KEYFILE_VERSION, alg: "ed25519", publicKey: publicKeyB64 };
  if (passphrase !== undefined && passphrase.length > 0) {
    const salt = randomBytes(16);
    const derived = scryptSync(passphrase, salt, 32, SCRYPT);
    const iv = randomBytes(12);
    const cipher = createCipheriv("aes-256-gcm", derived, iv);
    const ciphertext = Buffer.concat([cipher.update(pkcs8), cipher.final()]);
    file.encrypted = {
      saltB64: salt.toString("base64"),
      ivB64: iv.toString("base64"),
      ciphertextB64: ciphertext.toString("base64"),
      tagB64: cipher.getAuthTag().toString("base64"),
    };
  } else {
    file.privateKey = pkcs8.toString("base64");
  }
  writeFileSync(path, JSON.stringify(file, null, 2) + "\n", { mode: 0o600, flag: "wx" });
  return publicKeyB64;
}

/** Load a key file for signing. */
export function loadKey(path: string, passphrase?: string): {
  alg: "ed25519";
  publicKey: string;
  privateKey: KeyObject;
} {
  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(path, "utf8"));
  } catch (err) {
    throw new KeyFileError(`cannot read key file: ${(err as Error).message}`);
  }
  const file = raw as KeyFile;
  if (file.key !== KEYFILE_VERSION || file.alg !== "ed25519" || typeof file.publicKey !== "string") {
    throw new KeyFileError(`not a ${KEYFILE_VERSION} ed25519 key file`);
  }

  let pkcs8: Buffer;
  if (file.encrypted !== undefined) {
    if (passphrase === undefined || passphrase.length === 0) {
      throw new KeyFileError("key file is passphrase-encrypted; supply the passphrase via the environment");
    }
    const derived = scryptSync(passphrase, Buffer.from(file.encrypted.saltB64, "base64"), 32, SCRYPT);
    try {
      const decipher = createDecipheriv(
        "aes-256-gcm",
        derived,
        Buffer.from(file.encrypted.ivB64, "base64")
      );
      decipher.setAuthTag(Buffer.from(file.encrypted.tagB64, "base64"));
      pkcs8 = Buffer.concat([
        decipher.update(Buffer.from(file.encrypted.ciphertextB64, "base64")),
        decipher.final(),
      ]);
    } catch {
      throw new KeyFileError("wrong passphrase (or corrupted key file)");
    }
  } else if (file.privateKey !== undefined) {
    pkcs8 = Buffer.from(file.privateKey, "base64");
  } else {
    throw new KeyFileError("key file carries neither a private key nor an encrypted one");
  }

  return {
    alg: "ed25519",
    publicKey: file.publicKey,
    privateKey: createPrivateKey({ key: pkcs8, format: "der", type: "pkcs8" }),
  };
}
