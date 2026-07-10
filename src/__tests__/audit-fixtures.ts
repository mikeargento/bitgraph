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
import { keccak_256 } from "@noble/hashes/sha3";
import { canonicalize, computeProofHash } from "@mikeargento/bitgraph-verify";
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

/**
 * Source of random bytes for fixture generation. Defaults everywhere to
 * crypto.getRandomValues; property-based suites pass a seeded deterministic
 * source so the same seed always regenerates byte-identical fixtures.
 */
export type RandomSource = (byteLength: number) => Uint8Array;

const defaultRandom: RandomSource = (n) => crypto.getRandomValues(new Uint8Array(n));

export interface ManualKey {
  privateKey: Uint8Array;
  publicKeyB64: string;
}

export async function makeKey(random?: RandomSource): Promise<ManualKey> {
  const privateKey = (random ?? defaultRandom)(32);
  const publicKeyB64 = b64(await getPublicKeyAsync(privateKey));
  return { privateKey, publicKeyB64 };
}

/**
 * Manually build and sign a proof over the exact canonical SignedBody the
 * verifier reconstructs. The commit object may carry extra fields (for
 * example the live enclave's undeclared chainId); because it is part of
 * the signed body, the signature covers them.
 *
 * Optional extras follow the canonical SignedBody rules: attribution is
 * included in the signed body when provided; attestationFormat is
 * included when an attestation is provided (the reportB64 itself stays
 * OUTSIDE the signed body, exactly like the enclave output, so the
 * report can be attached or swapped after signing without changing the
 * canonical hash).
 */
export async function signBody(
  key: ManualKey,
  artifact: BitGraphProof["artifact"],
  commit: BitGraphProof["commit"],
  measurement: string,
  extras?: {
    attribution?: { name?: string; title?: string; message?: string };
    attestation?: { format: string; reportB64: string };
  }
): Promise<BitGraphProof> {
  const signedBody: Record<string, unknown> = {
    version: "bitgraph/1" as const,
    artifact,
    commit,
    publicKeyB64: key.publicKeyB64,
    enforcement: "stub" as const,
    measurement,
  };
  if (extras?.attribution !== undefined) signedBody["attribution"] = extras.attribution;
  if (extras?.attestation !== undefined) signedBody["attestationFormat"] = extras.attestation.format;
  const signatureB64 = b64(await signAsync(canonicalize(signedBody), key.privateKey));
  const proof: BitGraphProof = {
    version: "bitgraph/1",
    artifact,
    commit,
    signer: { publicKeyB64: key.publicKeyB64, signatureB64 },
    environment: {
      enforcement: "stub",
      measurement,
      ...(extras?.attestation !== undefined
        ? { attestation: { format: extras.attestation.format, reportB64: extras.attestation.reportB64 } }
        : {}),
    },
  };
  if (extras?.attribution !== undefined) {
    (proof as unknown as Record<string, unknown>)["attribution"] = extras.attribution;
  }
  return proof;
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
 *
 * By default the predecessor key is a fresh random key; pass
 * prevPublicKeyB64 to reference the actual signer of an observed
 * predecessor. Optional counter, slotCounter, prevB64, and chainId land
 * in the signed commit body, matching real enclave output shapes.
 */
export async function makeEpochLinkProof(opts: {
  prevEpochId: string;
  prevCounter: string;
  prevProofHashB64: string;
  toEpochId: string;
  prevPublicKeyB64?: string;
  key?: ManualKey;
  counter?: string;
  slotCounter?: string;
  prevB64?: string;
  chainId?: string;
  measurement?: string;
  payload?: string;
  random?: RandomSource;
}): Promise<{ proof: BitGraphProof; bytes: Uint8Array; key: ManualKey }> {
  const random = opts.random ?? defaultRandom;
  const key = opts.key ?? (await makeKey(random));
  const prevPublicKeyB64 = opts.prevPublicKeyB64 ?? (await makeKey(random)).publicKeyB64;
  const bytes = utf8(opts.payload ?? `bitgraph-audit-epochlink-${opts.toEpochId}`);
  const commit: BitGraphProof["commit"] = {
    nonceB64: b64(random(16)),
    ...(opts.counter !== undefined ? { counter: opts.counter } : {}),
    ...(opts.slotCounter !== undefined ? { slotCounter: opts.slotCounter } : {}),
    ...(opts.prevB64 !== undefined ? { prevB64: opts.prevB64 } : {}),
    epochId: opts.toEpochId,
    epochLink: {
      prevEpochId: opts.prevEpochId,
      prevPublicKeyB64,
      prevCounter: opts.prevCounter,
      prevProofHashB64: opts.prevProofHashB64,
      toEpochId: opts.toEpochId,
      toPublicKeyB64: key.publicKeyB64,
    },
  };
  if (opts.chainId !== undefined) {
    (commit as unknown as Record<string, unknown>)["chainId"] = opts.chainId;
  }
  const proof = await signBody(
    key,
    { hashAlg: "sha256", digestB64: b64(sha256(bytes)) },
    commit,
    opts.measurement ?? "test-measurement-epochlink"
  );
  return { proof, bytes, key };
}

// ---------------------------------------------------------------------------
// Linked slot/commit counter chains (real enclave shape)
// ---------------------------------------------------------------------------

export interface CounterChainLink {
  proof: BitGraphProof;
  bytes: Uint8Array;
  proofHash: string;
}

/**
 * Build a linked chain of verifier-valid proofs under one signer key,
 * epoch, and chain, with explicit counter positions per proof. Each
 * non-first proof carries prevB64 equal to the canonical proof hash of
 * its predecessor; the first proof omits prevB64 entirely (genesis per
 * G1) unless prevB64OfFirst continues the chain from an existing proof.
 * Pass pairs like real enclave output (slot 1/commit 2, slot 3/
 * commit 4, ...) or leave positions out for counterless link chains.
 */
export async function makeCounterChain(opts: {
  epochId: string;
  pairs: Array<{ slot?: string; commit?: string }>;
  key?: ManualKey;
  chainId?: string;
  measurement?: string;
  payloadPrefix?: string;
  /** Continue an existing chain: the first proof carries this prevB64 instead of being a genesis. */
  prevB64OfFirst?: string;
  random?: RandomSource;
}): Promise<{ key: ManualKey; proofs: CounterChainLink[] }> {
  const random = opts.random ?? defaultRandom;
  const key = opts.key ?? (await makeKey(random));
  const measurement = opts.measurement ?? "test-measurement-chain";
  const proofs: CounterChainLink[] = [];

  for (let i = 0; i < opts.pairs.length; i++) {
    const pair = opts.pairs[i]!;
    const bytes = utf8(`${opts.payloadPrefix ?? opts.epochId}-payload-${i}`);
    const prevB64 = i > 0 ? proofs[i - 1]!.proofHash : opts.prevB64OfFirst;
    const commit: BitGraphProof["commit"] = {
      nonceB64: b64(random(16)),
      ...(pair.commit !== undefined ? { counter: pair.commit } : {}),
      ...(pair.slot !== undefined ? { slotCounter: pair.slot } : {}),
      ...(prevB64 !== undefined ? { prevB64 } : {}),
      epochId: opts.epochId,
    };
    if (opts.chainId !== undefined) {
      (commit as unknown as Record<string, unknown>)["chainId"] = opts.chainId;
    }
    const proof = await signBody(
      key,
      { hashAlg: "sha256", digestB64: b64(sha256(bytes)) },
      commit,
      measurement
    );
    proofs.push({ proof, bytes, proofHash: computeProofHash(proof) });
  }

  return { key, proofs };
}

/**
 * The standard healthy enclave counter sequence: slot 1/commit 2,
 * slot 3/commit 4, ... for `length` proofs.
 */
export function healthyPairs(length: number): Array<{ slot: string; commit: string }> {
  const pairs: Array<{ slot: string; commit: string }> = [];
  for (let i = 0; i < length; i++) {
    pairs.push({ slot: String(2 * i + 1), commit: String(2 * i + 2) });
  }
  return pairs;
}

// ---------------------------------------------------------------------------
// Ethereum anchor fixtures (matching packages/hosted/src/bitcoin-anchor.ts)
// ---------------------------------------------------------------------------

/**
 * Build a verifier-valid Ethereum anchor proof: signed attribution
 * name "Ethereum Anchor", message = the block hash string, title = the
 * Etherscan block URL, artifact digest = SHA-256 over the block-hash
 * STRING (exactly like bitcoin-anchor.ts lines 188-189). Unsigned
 * metadata is attached after signing when provided.
 */
export async function makeAnchorProof(opts: {
  blockHash: string;
  blockNumber?: string | number;
  /** Overrides the Etherscan URL entirely (for unparseable-title cases). */
  title?: string;
  /** Omit the title field entirely. */
  noTitle?: boolean;
  /** Overrides the artifact digest (for digest-binding failure cases; the proof stays validly signed). */
  digestB64?: string;
  key?: ManualKey;
  epochId?: string;
  counter?: string;
  slotCounter?: string;
  prevB64?: string;
  chainId?: string;
  measurement?: string;
  /** Unsigned metadata object attached verbatim after signing. */
  metadata?: unknown;
  /** Overrides attribution.name (for non-anchor attribution cases). */
  attributionName?: string;
  random?: RandomSource;
}): Promise<{ proof: BitGraphProof; proofHash: string; key: ManualKey }> {
  const random = opts.random ?? defaultRandom;
  const key = opts.key ?? (await makeKey(random));
  const commit: BitGraphProof["commit"] = {
    nonceB64: b64(random(16)),
    ...(opts.counter !== undefined ? { counter: opts.counter } : {}),
    ...(opts.slotCounter !== undefined ? { slotCounter: opts.slotCounter } : {}),
    ...(opts.prevB64 !== undefined ? { prevB64: opts.prevB64 } : {}),
    ...(opts.epochId !== undefined ? { epochId: opts.epochId } : {}),
  };
  if (opts.chainId !== undefined) {
    (commit as unknown as Record<string, unknown>)["chainId"] = opts.chainId;
  }
  const attribution: { name: string; title?: string; message: string } = {
    name: opts.attributionName ?? "Ethereum Anchor",
    message: opts.blockHash,
  };
  if (opts.noTitle !== true) {
    attribution.title = opts.title ?? `https://etherscan.io/block/${opts.blockNumber ?? 0}`;
  }
  const proof = await signBody(
    key,
    {
      hashAlg: "sha256",
      digestB64: opts.digestB64 ?? b64(sha256(utf8(opts.blockHash))),
    },
    commit,
    opts.measurement ?? "test-measurement-anchor",
    { attribution }
  );
  if (opts.metadata !== undefined) {
    (proof as unknown as Record<string, unknown>)["metadata"] = opts.metadata;
  }
  return { proof, proofHash: computeProofHash(proof), key };
}

// ---------------------------------------------------------------------------
// Minimal RLP encoder + synthetic Ethereum block headers (test side only;
// the audit package carries its own independent decoder)
// ---------------------------------------------------------------------------

export type RlpInput = Uint8Array | RlpInput[];

export function encodeRlp(item: RlpInput): Uint8Array {
  if (item instanceof Uint8Array) {
    if (item.length === 1 && (item[0] as number) < 0x80) return item;
    return concatBytes([encodeRlpLength(item.length, 0x80), item]);
  }
  const payload = concatBytes(item.map(encodeRlp));
  return concatBytes([encodeRlpLength(payload.length, 0xc0), payload]);
}

function encodeRlpLength(length: number, offset: number): Uint8Array {
  if (length <= 55) return new Uint8Array([offset + length]);
  const bytes: number[] = [];
  let v = length;
  while (v > 0) {
    bytes.unshift(v & 0xff);
    v = Math.floor(v / 256);
  }
  return new Uint8Array([offset + 55 + bytes.length, ...bytes]);
}

/** Minimal big-endian bytes of a non-negative integer; empty for zero (Ethereum header integer encoding). */
export function beBytes(value: number | bigint): Uint8Array {
  let v = BigInt(value);
  const bytes: number[] = [];
  while (v > 0n) {
    bytes.unshift(Number(v & 0xffn));
    v >>= 8n;
  }
  return new Uint8Array(bytes);
}

/**
 * Build a synthetic 20-item RLP block header with the number at index 8
 * and the timestamp at index 11 (the stable Ethereum header positions).
 * Other items are deterministic filler byte strings.
 */
export function makeEthereumHeader(opts: {
  blockNumber: number | bigint;
  timestamp: number | bigint;
  itemCount?: number;
}): { headerBytes: Uint8Array; headerRlpHex: string } {
  const count = opts.itemCount ?? 20;
  const items: RlpInput[] = [];
  for (let i = 0; i < count; i++) {
    if (i === 8) items.push(beBytes(opts.blockNumber));
    else if (i === 11) items.push(beBytes(opts.timestamp));
    else items.push(new Uint8Array(32).fill(i + 1));
  }
  const headerBytes = encodeRlp(items);
  return {
    headerBytes,
    headerRlpHex: `0x${Buffer.from(headerBytes).toString("hex")}`,
  };
}

/** JSON string of a bitgraph-anchor-witness/1 file. */
export function witnessJson(opts: {
  headerRlpHex?: unknown;
  blockNumber?: unknown;
  blockHash?: unknown;
  network?: string;
  omit?: Array<"headerRlpHex" | "blockNumber" | "blockHash">;
}): string {
  const witness: Record<string, unknown> = { version: "bitgraph-anchor-witness/1" };
  if (!(opts.omit ?? []).includes("headerRlpHex")) witness["headerRlpHex"] = opts.headerRlpHex;
  if (!(opts.omit ?? []).includes("blockNumber")) witness["blockNumber"] = opts.blockNumber;
  if (!(opts.omit ?? []).includes("blockHash")) witness["blockHash"] = opts.blockHash;
  if (opts.network !== undefined) witness["network"] = opts.network;
  return JSON.stringify(witness);
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

// ---------------------------------------------------------------------------
// Standard mixed audit bundle (shared by the report and CLI suites)
// ---------------------------------------------------------------------------

export interface StandardAuditBundle {
  dir: string;
  epochId: string;
  anchorEpochId: string;
  chainId: string;
  /** Canonical hashes of the four chain proofs, in chain order, INCLUDING the dropped one. */
  chainProofHashes: string[];
  /** Canonical hash of the chain proof deliberately absent from the bundle (index 1, slot 3/commit 4). */
  droppedProofHash: string;
  forkAProofHash: string;
  forkBProofHash: string;
  anchorProofHash: string;
  blockNumber: number;
  blockTimestamp: number;
  /** Bundle path of the occ/1 reject. */
  unsupportedPath: string;
  /** Expected counts for assertions. */
  expected: {
    observed: number;
    proofFiles: number;
    exactDuplicates: number;
    semanticDuplicates: number;
    unsupportedVersion: number;
    verified: number;
    failed: number;
    artifactUnavailable: number;
    chainless: number;
  };
}

/**
 * Build the standard mixed bundle in a temp directory, per the Phase 4d
 * brief: a healthy signed chain (4 proofs, slot/commit pairs 1..8) with
 * one proof missing (index 1, producing an unexplained-position gap and
 * a chain break), a predecessor-reuse fork off the chain tail, an occ/1
 * unsupported-version reject, one artifact-present proof (chain genesis)
 * and artifact-absent proofs (everything else), an Ethereum anchor in
 * its own epoch with a valid offline witness, plus one exact-duplicate
 * copy and one semantic-duplicate (stored-form) copy of the genesis.
 */
export async function makeStandardAuditBundle(): Promise<StandardAuditBundle> {
  const dir = await makeTempDir("bitgraph-audit-standard-");
  const epochId = "epoch-standard-main";
  const anchorEpochId = "epoch-standard-anchor";
  const chainId = "bitgraph:main";
  const measurement = "test-measurement-chain";

  const chain = await makeCounterChain({
    epochId,
    pairs: healthyPairs(4),
    chainId,
    measurement,
    payloadPrefix: "standard-bundle",
  });

  const tail = chain.proofs[3]!;
  const forkChild = async (slot: string, commit: string, payload: string) => {
    const bytes = utf8(payload);
    const commitBody: BitGraphProof["commit"] = {
      nonceB64: b64(crypto.getRandomValues(new Uint8Array(16))),
      counter: commit,
      slotCounter: slot,
      prevB64: tail.proofHash,
      epochId,
    };
    (commitBody as unknown as Record<string, unknown>)["chainId"] = chainId;
    const proof = await signBody(
      chain.key,
      { hashAlg: "sha256", digestB64: b64(sha256(bytes)) },
      commitBody,
      measurement
    );
    return { proof, proofHash: computeProofHash(proof) };
  };
  const forkA = await forkChild("9", "10", "standard-bundle-fork-a");
  const forkB = await forkChild("11", "12", "standard-bundle-fork-b");

  const blockNumber = 123456;
  const blockTimestamp = 1_700_000_000;
  const { headerBytes, headerRlpHex } = makeEthereumHeader({ blockNumber, timestamp: blockTimestamp });
  const blockHash = `0x${Buffer.from(keccak_256(headerBytes)).toString("hex")}`;
  const anchor = await makeAnchorProof({
    blockHash,
    blockNumber,
    epochId: anchorEpochId,
    counter: "2",
    slotCounter: "1",
  });

  const unsupportedPath = "legacy/old.json";
  const occProof = JSON.stringify({
    version: "occ/1",
    artifact: { hashAlg: "sha256", digestB64: "b2NjLWxlZ2FjeQ==" },
    commit: { nonceB64: "b2NjLW5vbmNl" },
    signer: { publicKeyB64: "b2NjLWtleQ==", signatureB64: "b2NjLXNpZw==" },
  });

  const genesis = chain.proofs[0]!;
  await writeBundleDir(dir, {
    "proofs/chain-0.json": proofJson(genesis.proof),
    "proofs/chain-0-copy.json": proofJson(genesis.proof),
    "proofs/chain-0-stored.json": storedProofJson(genesis.proof, genesis.proofHash),
    // chain-1 (slot 3 / commit 4) is deliberately absent: the gap.
    "proofs/chain-2.json": proofJson(chain.proofs[2]!.proof),
    "proofs/chain-3.json": proofJson(tail.proof),
    "proofs/fork-a.json": proofJson(forkA.proof),
    "proofs/fork-b.json": proofJson(forkB.proof),
    "proofs/anchor.json": proofJson(anchor.proof),
    "witnesses/block.json": witnessJson({ headerRlpHex, blockNumber, blockHash }),
    "artifacts/payload-0.bin": genesis.bytes,
    [unsupportedPath]: occProof,
  });

  return {
    dir,
    epochId,
    anchorEpochId,
    chainId,
    chainProofHashes: chain.proofs.map((p) => p.proofHash),
    droppedProofHash: chain.proofs[1]!.proofHash,
    forkAProofHash: forkA.proofHash,
    forkBProofHash: forkB.proofHash,
    anchorProofHash: anchor.proofHash,
    blockNumber,
    blockTimestamp,
    unsupportedPath,
    expected: {
      observed: 6,
      proofFiles: 8,
      exactDuplicates: 1,
      semanticDuplicates: 1,
      unsupportedVersion: 1,
      verified: 1,
      failed: 0,
      artifactUnavailable: 5,
      chainless: 0,
    },
  };
}
