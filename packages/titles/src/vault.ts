// Copyright (c) 2024-2026 Mike Argento. Licensed under the MIT License. See LICENSE.

/**
 * The vault: one file of sealed envelopes, opened by content.
 *
 * Every entry is a possession message's canonical PLAINTEXT bytes —
 * the recorded unit, which must survive byte-exactly forever — stored
 * encrypted under a key derived from the SUBJECT's full bytes:
 *
 *   entry key  = SHA-256("bitgraph-vault-key/1\n"    + subject bytes)
 *   lookup id  = SHA-256("bitgraph-vault-lookup/1\n" + subject bytes)
 *
 * No file, no author: a leaked vault is a bag of unlinkable ciphertexts,
 * and handing someone the whole vault plus one work opens exactly that
 * work's messages. Disclosure is self-selecting.
 *
 * The one trap, spelled out because it is the difference between this
 * design working and being decorative: derivation is from the BYTES,
 * never from the plain digest — plain digests of recorded works are
 * public on the ledger, and a digest-derived key would let anyone open
 * tickets using values scraped from proof pages.
 *
 * The vault is a CONTAINER, never the recorded unit. Recording the
 * vault's own digest would seal a snapshot that is stale by tomorrow and
 * collapse per-message positions into one blob; each message is sealed
 * individually, and the vault only keeps their frozen bytes safe.
 *
 * Writes are atomic (temp file + rename). Backup doctrine: this is the
 * one file that must be backed up — a lost message is a permanently
 * mute digest — and the subject originals need backing up too, because
 * losing the work seals its messages forever, including to their author.
 */

import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";
import { readFileSync, renameSync, writeFileSync } from "node:fs";

const VAULT_VERSION = "bitgraph-vault/1";
const KEY_DOMAIN = "bitgraph-vault-key/1\n";
const LOOKUP_DOMAIN = "bitgraph-vault-lookup/1\n";

interface VaultEntry {
  lookup: string;
  iv: string;
  ciphertext: string;
  tag: string;
}

interface VaultFile {
  vault: typeof VAULT_VERSION;
  entries: VaultEntry[];
}

export function vaultKeyFor(subjectBytes: Uint8Array): Buffer {
  return createHash("sha256").update(Buffer.from(KEY_DOMAIN, "utf8")).update(subjectBytes).digest();
}

export function lookupIdFor(subjectBytes: Uint8Array): string {
  return createHash("sha256")
    .update(Buffer.from(LOOKUP_DOMAIN, "utf8"))
    .update(subjectBytes)
    .digest("hex");
}

export class VaultError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "VaultError";
  }
}

function readVault(path: string): VaultFile {
  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(path, "utf8"));
  } catch (err) {
    throw new VaultError(`cannot read vault: ${(err as Error).message}`);
  }
  if (
    typeof raw !== "object" ||
    raw === null ||
    (raw as Record<string, unknown>)["vault"] !== VAULT_VERSION ||
    !Array.isArray((raw as Record<string, unknown>)["entries"])
  ) {
    throw new VaultError(`not a ${VAULT_VERSION} file`);
  }
  return raw as unknown as VaultFile;
}

function writeVault(path: string, vault: VaultFile): void {
  const bytes = JSON.stringify(vault, null, 2) + "\n";
  const tmp = `${path}.tmp-${randomBytes(6).toString("hex")}`;
  writeFileSync(tmp, bytes, { mode: 0o600 });
  renameSync(tmp, path);
}

/**
 * Create an empty vault file. Refuses to clobber an existing one: the
 * guard is O_EXCL ("wx"), which can never replace an existing file
 * regardless of its readability or permissions — a probe-then-write
 * would destroy an existing vault the probe merely failed to read.
 */
export function initVault(path: string): void {
  const bytes = JSON.stringify({ vault: VAULT_VERSION, entries: [] }, null, 2) + "\n";
  try {
    writeFileSync(path, bytes, { flag: "wx", mode: 0o600 });
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "EEXIST") {
      throw new VaultError(`refusing to overwrite existing file: ${path}`);
    }
    throw err;
  }
}

/** Seal one message's canonical bytes into the vault, keyed by the subject's bytes. */
export function vaultPut(path: string, subjectBytes: Uint8Array, messageBytes: Uint8Array): void {
  const vault = readVault(path);
  const key = vaultKeyFor(subjectBytes);
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const ciphertext = Buffer.concat([cipher.update(messageBytes), cipher.final()]);
  vault.entries.push({
    lookup: lookupIdFor(subjectBytes),
    iv: iv.toString("base64"),
    ciphertext: ciphertext.toString("base64"),
    tag: cipher.getAuthTag().toString("base64"),
  });
  writeVault(path, vault);
}

/**
 * Open every message sealed for these exact subject bytes. Entries that
 * fail authentication are skipped silently: a vault may legitimately
 * hold entries for other subjects that happen to share nothing.
 */
export function vaultGet(path: string, subjectBytes: Uint8Array): Buffer[] {
  const vault = readVault(path);
  const lookup = lookupIdFor(subjectBytes);
  const key = vaultKeyFor(subjectBytes);
  const out: Buffer[] = [];
  for (const entry of vault.entries) {
    if (entry.lookup !== lookup) continue;
    try {
      const decipher = createDecipheriv("aes-256-gcm", key, Buffer.from(entry.iv, "base64"));
      decipher.setAuthTag(Buffer.from(entry.tag, "base64"));
      out.push(Buffer.concat([decipher.update(Buffer.from(entry.ciphertext, "base64")), decipher.final()]));
    } catch {
      continue;
    }
  }
  return out;
}

/** Count entries without opening anything: the vault's only unauthenticated fact. */
export function vaultCount(path: string): number {
  return readVault(path).entries.length;
}
