// Copyright (c) Mike Argento. All rights reserved. See LICENSE.

/**
 * Shared fixture helpers for the bitgraph-audit test suites.
 *
 * Proofs that must be verifier-valid are built either through the root
 * Constructor (real commit path) or by manually signing the exact
 * canonical SignedBody layout with real Ed25519 keys, the same approach
 * as src/__tests__/proof-integrity.test.ts. Verifier semantics are never
 * bypassed.
 *
 * Also provides a minimal in-memory tar writer (ustar, PAX path records,
 * GNU long-name entries) so container tests never shell out.
 */

import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { getPublicKeyAsync, signAsync } from "@noble/ed25519";
import { sha256 } from "@noble/hashes/sha256";
import { canonicalize } from "@mikeargento/bitgraph-verify";
import type { BitGraphProof } from "@mikeargento/bitgraph-verify";
import { Constructor } from "../constructor.js";
import type { HostCapabilities } from "../host.js";

// ---------------------------------------------------------------------------
// Encoding helpers
// ---------------------------------------------------------------------------

export function b64(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString("base64");
}

export function utf8(text: string): Uint8Array {
  return new TextEncoder().encode(text);
}

// ---------------------------------------------------------------------------
// Proof fixtures
// ---------------------------------------------------------------------------

export interface ManualKey {
  privateKey: Uint8Array;
  publicKeyB64: string;
}

export async function makeKey(): Promise<ManualKey> {
  const privateKey = crypto.getRandomValues(new Uint8Array(32));
  const publicKeyB64 = b64(await getPublicKeyAsync(privateKey));
  return { privateKey, publicKeyB64 };
}

/**
 * Manually build and sign a proof over the exact canonical SignedBody the
 * verifier reconstructs. The commit object may carry extra fields (for
 * example the live enclave's undeclared chainId); because it is part of
 * the signed body, the signature covers them.
 */
export async function signBody(
  key: ManualKey,
  artifact: BitGraphProof["artifact"],
  commit: BitGraphProof["commit"],
  measurement: string
): Promise<BitGraphProof> {
  const signedBody = {
    version: "bitgraph/1" as const,
    artifact,
    commit,
    publicKeyB64: key.publicKeyB64,
    enforcement: "stub" as const,
    measurement,
  };
  const signatureB64 = b64(await signAsync(canonicalize(signedBody), key.privateKey));
  return {
    version: "bitgraph/1",
    artifact,
    commit,
    signer: { publicKeyB64: key.publicKeyB64, signatureB64 },
    environment: { enforcement: "stub", measurement },
  };
}

/**
 * Build a proof through the root Constructor (the real commit path).
 * Default fixtures are chainless: no counter, no epochId.
 */
export async function makeConstructorProof(opts?: {
  withCounter?: boolean;
  epochId?: string;
  payload?: string;
}): Promise<{ proof: BitGraphProof; bytes: Uint8Array }> {
  const privateKey = crypto.getRandomValues(new Uint8Array(32));
  const publicKeyBytes = await getPublicKeyAsync(privateKey);
  const measurement = "test-measurement-audit";

  let counter = 0;
  const base = {
    enforcementTier: "stub" as const,
    getMeasurement: async () => measurement,
    getFreshNonce: async () => crypto.getRandomValues(new Uint8Array(16)),
    sign: async (data: Uint8Array) => signAsync(data, privateKey),
    getPublicKey: async () => publicKeyBytes,
  };
  const host: HostCapabilities = opts?.withCounter
    ? { ...base, nextCounter: async () => String(++counter) }
    : base;

  const ctor = await Constructor.initialize(
    opts?.epochId !== undefined ? { host, epochId: opts.epochId } : { host }
  );
  const bytes = utf8(opts?.payload ?? "bitgraph-audit-test-payload");
  const proof = await ctor.commit({ bytes });
  return { proof, bytes };
}

/**
 * Build a verifier-valid proof carrying a chainId inside the signed
 * commit body, matching what the live enclave injects for non-default
 * chains.
 */
export async function makeChainIdProof(opts?: {
  chainId?: string;
  counter?: string;
  epochId?: string;
  payload?: string;
}): Promise<{ proof: BitGraphProof; bytes: Uint8Array }> {
  const key = await makeKey();
  const bytes = utf8(opts?.payload ?? "bitgraph-audit-chainid-payload");
  const commit: BitGraphProof["commit"] = {
    nonceB64: b64(crypto.getRandomValues(new Uint8Array(16))),
    ...(opts?.counter !== undefined ? { counter: opts.counter } : {}),
    ...(opts?.epochId !== undefined ? { epochId: opts.epochId } : {}),
  };
  (commit as unknown as Record<string, unknown>)["chainId"] = opts?.chainId ?? "bitgraph:main";
  const proof = await signBody(
    key,
    { hashAlg: "sha256", digestB64: b64(sha256(bytes)) },
    commit,
    "test-measurement-chainid"
  );
  return { proof, bytes };
}

/**
 * Build a verifier-valid epoch-genesis proof carrying an epochLink that
 * consumes the given predecessor into the given successor epoch.
 */
export async function makeEpochLinkProof(opts: {
  prevEpochId: string;
  prevCounter: string;
  prevProofHashB64: string;
  toEpochId: string;
  payload?: string;
}): Promise<{ proof: BitGraphProof; bytes: Uint8Array }> {
  const key = await makeKey();
  const prevKey = await makeKey();
  const bytes = utf8(opts.payload ?? `bitgraph-audit-epochlink-${opts.toEpochId}`);
  const commit: BitGraphProof["commit"] = {
    nonceB64: b64(crypto.getRandomValues(new Uint8Array(16))),
    epochId: opts.toEpochId,
    epochLink: {
      prevEpochId: opts.prevEpochId,
      prevPublicKeyB64: prevKey.publicKeyB64,
      prevCounter: opts.prevCounter,
      prevProofHashB64: opts.prevProofHashB64,
      toEpochId: opts.toEpochId,
      toPublicKeyB64: key.publicKeyB64,
    },
  };
  const proof = await signBody(
    key,
    { hashAlg: "sha256", digestB64: b64(sha256(bytes)) },
    commit,
    "test-measurement-epochlink"
  );
  return { proof, bytes };
}

// ---------------------------------------------------------------------------
// Bundle-on-disk helpers
// ---------------------------------------------------------------------------

export async function makeTempDir(prefix: string): Promise<string> {
  return mkdtemp(join(tmpdir(), prefix));
}

/**
 * Write a bundle directory from a path -> content map. Paths use "/"
 * separators; parent directories are created as needed.
 */
export async function writeBundleDir(
  root: string,
  files: Record<string, Uint8Array | string>
): Promise<void> {
  for (const [relPath, content] of Object.entries(files)) {
    const abs = join(root, ...relPath.split("/"));
    await mkdir(dirname(abs), { recursive: true });
    await writeFile(abs, typeof content === "string" ? utf8(content) : content);
  }
}

// ---------------------------------------------------------------------------
// Minimal in-memory tar writer
// ---------------------------------------------------------------------------

export interface TarWriteEntry {
  /** Header name field (up to 100 bytes). */
  name: string;
  content: Uint8Array | string;
  /** Defaults to "0" (regular file). */
  typeflag?: string;
  /** Emit a PAX extended header carrying path=<value> before the entry. */
  paxPath?: string;
  /** Emit a GNU long-name ('L') entry carrying this name before the entry. */
  gnuLongName?: string;
}

/** Build a complete tar archive in memory (ustar, PAX, GNU long-name). */
export function makeTar(entries: TarWriteEntry[]): Uint8Array {
  const parts: Uint8Array[] = [];
  for (const entry of entries) {
    const content = typeof entry.content === "string" ? utf8(entry.content) : entry.content;
    if (entry.paxPath !== undefined) {
      const record = paxRecord("path", entry.paxPath);
      parts.push(tarHeaderBlock("PaxHeaders.0/entry", record.length, "x"), padTo512(record));
    }
    if (entry.gnuLongName !== undefined) {
      const nameBytes = utf8(`${entry.gnuLongName}\0`);
      parts.push(tarHeaderBlock("././@LongLink", nameBytes.length, "L"), padTo512(nameBytes));
    }
    parts.push(tarHeaderBlock(entry.name, content.length, entry.typeflag ?? "0"), padTo512(content));
  }
  parts.push(new Uint8Array(512), new Uint8Array(512));
  return concatBytes(parts);
}

function tarHeaderBlock(name: string, size: number, typeflag: string): Uint8Array {
  const block = new Uint8Array(512);
  const ascii = (text: string, offset: number, length: number): void => {
    const bytes = utf8(text);
    block.set(bytes.subarray(0, Math.min(bytes.length, length)), offset);
  };
  ascii(name, 0, 100);
  block.set(octalField(0o644, 8), 100); // mode
  block.set(octalField(0, 8), 108); // uid
  block.set(octalField(0, 8), 116); // gid
  block.set(octalField(size, 12), 124); // size
  block.set(octalField(0, 12), 136); // mtime
  for (let i = 148; i < 156; i++) block[i] = 0x20; // checksum spaces
  block[156] = typeflag.charCodeAt(0);
  ascii("ustar", 257, 6); // magic, NUL-terminated by the zero block
  ascii("00", 263, 2); // version
  let sum = 0;
  for (let i = 0; i < 512; i++) sum += block[i] as number;
  ascii(sum.toString(8).padStart(6, "0"), 148, 6);
  block[154] = 0;
  block[155] = 0x20;
  return block;
}

function octalField(value: number, length: number): Uint8Array {
  const out = new Uint8Array(length);
  const text = value.toString(8).padStart(length - 1, "0");
  for (let i = 0; i < text.length; i++) out[i] = text.charCodeAt(i);
  out[length - 1] = 0;
  return out;
}

/** PAX record: "<len> <key>=<value>\n" where len counts the whole record. */
function paxRecord(key: string, value: string): Uint8Array {
  const baseBytes = utf8(` ${key}=${value}\n`);
  let length = baseBytes.length + 1;
  while (String(length).length + baseBytes.length !== length) {
    length = String(length).length + baseBytes.length;
  }
  return concatBytes([utf8(String(length)), baseBytes]);
}

function padTo512(content: Uint8Array): Uint8Array {
  const padding = (512 - (content.length % 512)) % 512;
  if (padding === 0) return content;
  const out = new Uint8Array(content.length + padding);
  out.set(content, 0);
  return out;
}

function concatBytes(parts: Uint8Array[]): Uint8Array {
  const total = parts.reduce((sum, part) => sum + part.length, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }
  return out;
}

// ---------------------------------------------------------------------------
// Serialization helpers
// ---------------------------------------------------------------------------

/** Compact JSON serialization of a proof, the usual on-disk form. */
export function proofJson(proof: BitGraphProof): string {
  return JSON.stringify(proof);
}

/** Stored form: the proof with a trailing proofHash field, as the ledger serves it. */
export function storedProofJson(proof: BitGraphProof, proofHash: string): string {
  return JSON.stringify({ ...proof, proofHash });
}
