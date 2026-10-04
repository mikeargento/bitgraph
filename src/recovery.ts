/**
 * Recovering a BitGraph from the file: bitgraph-recovery/1 (2026-10-03).
 *
 * THE RULE (Mike): anyone holding a file can always get its proof back, and
 * export it again, if the export was lost.
 *
 * RECOVERY IS NOT VERIFICATION. Verification needs nothing of ours: an export
 * and the file check themselves (packages/verify, export.ts). Recovery uses
 * our bucket, and only to answer one question for whoever holds the bytes:
 * which BitGraphs hold these bytes, and where is each one's proof? Each entry
 * hands back exactly what a member's export carries (the root document and
 * the member's evidence) plus a locator for the proof itself, which is then
 * fetched from the public proof routes and verifies with nothing of ours.
 *
 * WHAT IS WRITTEN. For every member of a tree, up to two sealed entries: one
 * under the file's origin digest (the file as dropped) and one under its
 * artifact digest (the committed bytes), so either file in hand finds it. An
 * as-is leaf (placement 0x00) has one digest and earns one entry.
 *
 * FORMATS. Hex is lowercase. digest32 is the RAW 32-byte SHA-256, never its
 * text; proofHash32 is the raw 32 bytes of computeProofHash(proof) (the
 * ledger identity, base64 in the verify package).
 *
 *   address   = hex SHA-256( UTF-8 "bitgraph-lookup"       || digest32 )
 *   entryId   = hex SHA-256( UTF-8 "bitgraph-lookup-entry" || digest32 || proofHash32 || leafIndex u32 big-endian )
 *   saltedId  = hex SHA-256( UTF-8 "bitgraph-lookup-entry/salted" || digest32 || proofHash32 || leafIndex u32 big-endian || salt32 )
 *               the fallback name when the deterministic key is held by another entry (squatting, below);
 *               the salt (32 random bytes) is sealed in the plaintext, so a reader checks the name either way
 *   key       =     SHA-256( UTF-8 "bitgraph-lookup-key"   || digest32 )          the AES-256-GCM key
 *   objectKey = "recovery/v1/" + address + "/" + entryId
 *   envelope  = 0x01 || nonce (12 random bytes, fresh per entry) || ciphertext || tag (16)
 *               AAD = objectKey as UTF-8
 *   plaintext = UTF-8 JSON, written in this key order:
 *               { "format": "bitgraph-recovery/1",
 *                 "proofHash": base64 (44),
 *                 "leafIndex": n,
 *                 "rootDocument": hex (168),
 *                 "member": { "index", "count", "leaf", "path" }       TreeMemberEvidence
 *                 "proof": { "epochId", "counter", "artifactDigestB64" } a locator
 *                 "salt"?: base64 (44),                                 present exactly when the entry is salted
 *                 "name"?: string }                                     advisory, at most 512 UTF-8 bytes
 *
 * The four labels differ and every input after a label is fixed length, so
 * the four preimages (47, 51, 89 and 128 bytes) can never be confused with
 * one another. The address is public (it is in the object key); the key is
 * not derivable from it without the digest.
 *
 * SQUATTING, AND THE SALTED FALLBACK. Keys are deterministic and writes are
 * create-only, so whoever knows a file's digest and its proof hash can occupy
 * a member's deterministic key first. They cannot make a wrong proof come
 * back (a reader binds every entry to its proof and verifies the member), but
 * they could deny that one entry. So a writer that finds another member's
 * envelope at its deterministic key writes the same plaintext, plus a fresh
 * 32-byte salt, under the salted name instead; a reader accepts either name
 * when the plaintext derives it, and lists one member once however many
 * names it has. The salt is kept by the writer before the salted write, so a
 * retry lands on the same key. Listing spam under an address stays a
 * rate-limit matter.
 *
 * LOOKING UP MANY FILES AT ONCE. recoverFromDigests asks one request for the
 * first page of many addresses. That tells the server which addresses were
 * asked together, a linkage one-by-one requests only hint at by timing; the
 * route logs counts, never addresses, and the SPEC says so.
 *
 * WHY THE ENTRY ID IS A HASH. The first draft keyed entries
 * "<address>/<proofHash>/<leafIndex>", which let anyone listing the bucket
 * group every entry of one drop by the shared proofHash. The entryId is still
 * deterministic (a rewrite after a crash lands on the same key, so writes stay
 * idempotent) and two members of one tree never collide (the leaf index is in
 * it), but it says nothing about which tree it belongs to without the digest.
 *
 * PRIVACY, AND ITS LIMIT. The server sees object keys and opaque envelopes,
 * never a digest, a proof hash, a leaf or a name. But anyone who KNOWS a
 * file's digest (holding the file, a published digest, or guessing among a
 * few candidate files) can derive the address and key and test whether it was
 * recorded; that is the same ability recovery needs. The promise covers these
 * sealed entries only, not older plain-digest indexes, logs or metadata. (One
 * piece of metadata worth naming: the entries of one drop are written in the
 * same requests and land with near-identical write times, so whoever can list
 * the bucket can group them by time. Today that is only BitGraph.)
 *
 * WHAT A STORED ENTRY IS WORTH. Whoever holds the file can write an entry for
 * it; that is the rule working, not a hole. So an entry is never trusted for
 * holding the right key: it is opened (AES-GCM, AAD the object key), parsed
 * strictly, its entryId recomputed, its leaf checked to name the looked-up
 * digest, its path checked to reach the root inside its own root document,
 * and that document checked to hash to the locator's digest. Then the proof is
 * fetched and bound by proofHash and verifyTreeMember (fetchRecoveredProof).
 * A writer who knows the digest can occupy a key; they cannot make a wrong
 * proof come back as this file's. (The queue reports a member whose key was
 * occupied first as "blocked", and keeps writing its other entry.)
 *
 * CREATE-ONLY. Entries are written with If-None-Match: * and never replaced;
 * see recovery-store-s3.ts for the bucket policy that keeps a delete marker
 * from ever letting a second version in under the same key.
 *
 * SHA-256 here is @noble/hashes (as in packages/verify), AES-GCM is WebCrypto.
 * Both run unchanged in the browser and in node 20+. The hashes are noble's
 * rather than crypto.subtle.digest's because a tree of 100,000 files needs
 * 600,000 small hashes: measured on node 24, 300,000 cost 275 ms through
 * noble and 2,368 ms through subtle (one promise and thread hop each). The
 * bytes are identical; the test suite derives every format again with
 * node:crypto to prove it.
 */

// NODE TWIN of website/src/lib/recovery.ts (2026-10-03): the same formats and
// code, for the CLI, SDK and MCP, which make trees outside the browser. Three
// type-only differences (Node's WebCrypto types, no RequestInit.cache); a
// website test (recovery-parity.test.ts) proves the two seal and open each
// other's entries and derive the same addresses, keys and entry ids. Change
// both or neither.
import type { webcrypto } from "node:crypto";
type CryptoKey = webcrypto.CryptoKey;
type SubtleCrypto = webcrypto.SubtleCrypto;
import { sha256 } from "@noble/hashes/sha256";
import {
  LEAF_AS_IS,
  MerkleTree,
  TREE_LEAF_BYTES,
  base64ToBytes,
  buildTreeMemberEvidence,
  bytesEqual,
  bytesToBase64,
  bytesToHex,
  computeProofHash,
  decodeTreeLeaf,
  hexToBytes,
  isTreeProof,
  merkleLeafHash,
  parseTreeMemberEvidence,
  parseTreeRootDocument,
  readTreeMetadata,
  treeRootFromMember,
  verifyTreeMember,
  type BitGraphProof,
  type TreeLeaf,
  type TreeMemberEvidence,
  type TreeVerifyResult,
  type ByteSource,
} from "@mikeargento/bitgraph-verify";

// ---------------------------------------------------------------------------
// Constants (shared by the browser queue, the lookup and the routes)
// ---------------------------------------------------------------------------

export const RECOVERY_FORMAT = "bitgraph-recovery/1" as const;
export const RECOVERY_PREFIX = "recovery/v1/" as const;
export const ENVELOPE_VERSION = 0x01;
export const NONCE_BYTES = 12;
export const TAG_BYTES = 16;
/** Version byte, nonce and tag: 29 bytes around the ciphertext. */
export const ENVELOPE_OVERHEAD = 1 + NONCE_BYTES + TAG_BYTES;
/**
 * The largest envelope anyone may store. Sized from the response, not the
 * entry: a batch of MAX_BATCH_ENTRIES whose keys all exist comes back with
 * every stored envelope in it, and a Vercel function answers at most 4.5 MB.
 * 500 x 4,096 bytes is 2.7 MB as base64, in both directions. The largest
 * honest plaintext (a 1,000,000-leaf tree's 20-node path, the longest
 * locator, a 512-byte name) is about 3.1 KB; the suite pins that it fits.
 */
export const MAX_ENVELOPE_BYTES = 4096;
export const MIN_ENVELOPE_BYTES = ENVELOPE_OVERHEAD + 1;
export const MAX_PLAINTEXT_BYTES = MAX_ENVELOPE_BYTES - ENVELOPE_OVERHEAD;
/** A name longer than this keeps its last 509 bytes behind "…" (a path's tail is the file's own name). */
export const MAX_NAME_BYTES = 512;
/** Entries per POST. */
export const MAX_BATCH_ENTRIES = 500;
/** A POST body above this is refused before it is parsed. A full batch of the largest envelopes is about 2.8 MB. */
export const MAX_BODY_BYTES = 4_000_000;
/** Entries per page of GET /api/recovery/<address>. */
export const MAX_LIST_LIMIT = 100;

export const ADDRESS_PATTERN = /^[0-9a-f]{64}$/;
export const ENTRY_ID_PATTERN = /^[0-9a-f]{64}$/;
export const OBJECT_KEY_PATTERN = /^recovery\/v1\/[0-9a-f]{64}\/[0-9a-f]{64}$/;

const EPOCH_PATTERN = /^[A-Za-z0-9+/_-]{1,128}={0,2}$/;
const COUNTER_PATTERN = /^[0-9]{1,20}$/;

const encoder = new TextEncoder();
const utf8 = (s: string): Uint8Array => encoder.encode(s);

const LOOKUP_LABEL = utf8("bitgraph-lookup");
const ENTRY_LABEL = utf8("bitgraph-lookup-entry");
const SALTED_ENTRY_LABEL = utf8("bitgraph-lookup-entry/salted");
const KEY_LABEL = utf8("bitgraph-lookup-key");
/** A salted entry's salt: 32 random bytes, sealed in its plaintext. */
export const SALT_BYTES = 32;
/** Addresses one lookup request may ask for (POST /api/recovery/lookup). */
export const MAX_LOOKUP_ADDRESSES = 1000;
/** The most a lookup answer carries; addresses past it come back `truncated` and are listed one by one. */
export const MAX_LOOKUP_RESPONSE_BYTES = 4_000_000;
/** The most a lookup request's body may be (1,000 addresses are 70 KB). */
export const MAX_LOOKUP_BODY_BYTES = 131_072;

/** A caller handed the queue or the sealer something that must never be written. */
export class RecoveryInputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RecoveryInputError";
  }
}

/**
 * The recovery entries could not be READ. Never an answer about whether the
 * file was recorded: "we could not check" and "nothing is kept for these
 * bytes" are different claims, and only the second is a finding.
 */
export class RecoveryUnavailableError extends Error {
  constructor(where: string, cause?: unknown) {
    super(`recovery read failed (${where})${cause instanceof Error ? `: ${cause.message}` : ""}`);
    this.name = "RecoveryUnavailableError";
  }
}

export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;
const defaultFetch: FetchLike = (input, init) => fetch(input, init);

function concat(...parts: Uint8Array[]): Uint8Array {
  let n = 0;
  for (const p of parts) n += p.length;
  const out = new Uint8Array(n);
  let o = 0;
  for (const p of parts) {
    out.set(p, o);
    o += p.length;
  }
  return out;
}

function isPlainObject(x: unknown): x is Record<string, unknown> {
  if (x === null || typeof x !== "object" || Array.isArray(x)) return false;
  const proto = Object.getPrototypeOf(x);
  return proto === Object.prototype || proto === null;
}

const toUrlSafe = (b64: string): string => b64.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

function checkDigest(digest32: Uint8Array, what = "a digest"): void {
  if (!(digest32 instanceof Uint8Array) || digest32.length !== 32) throw new TypeError(`${what} is the raw 32-byte SHA-256`);
}

// ---------------------------------------------------------------------------
// Derivations
// ---------------------------------------------------------------------------

/** hex SHA-256("bitgraph-lookup" || digest32): the public folder a file's entries live in. */
export function recoveryAddress(digest32: Uint8Array): string {
  checkDigest(digest32);
  return bytesToHex(sha256(concat(LOOKUP_LABEL, digest32)));
}

/** SHA-256("bitgraph-lookup-key" || digest32): the AES-256-GCM key every entry under this digest is sealed with. */
export function recoveryKeyBytes(digest32: Uint8Array): Uint8Array {
  checkDigest(digest32);
  return sha256(concat(KEY_LABEL, digest32));
}

/** hex SHA-256("bitgraph-lookup-entry" || digest32 || proofHash32 || leafIndex u32 BE): one entry's name inside the address. */
export function recoveryEntryId(digest32: Uint8Array, proofHash32: Uint8Array, leafIndex: number): string {
  checkDigest(digest32);
  checkDigest(proofHash32, "a proof hash");
  if (!Number.isInteger(leafIndex) || leafIndex < 0 || leafIndex > 0xffffffff) throw new RangeError("a leaf index is a u32");
  const index = new Uint8Array(4);
  new DataView(index.buffer).setUint32(0, leafIndex, false);
  return bytesToHex(sha256(concat(ENTRY_LABEL, digest32, proofHash32, index)));
}

/** hex SHA-256("bitgraph-lookup-entry/salted" || digest32 || proofHash32 || leafIndex u32 BE || salt32): the entry's fallback name when its deterministic one is held. */
export function recoverySaltedEntryId(digest32: Uint8Array, proofHash32: Uint8Array, leafIndex: number, salt32: Uint8Array): string {
  checkDigest(digest32);
  checkDigest(proofHash32, "a proof hash");
  if (!(salt32 instanceof Uint8Array) || salt32.length !== SALT_BYTES) throw new TypeError(`a salt is ${SALT_BYTES} bytes`);
  if (!Number.isInteger(leafIndex) || leafIndex < 0 || leafIndex > 0xffffffff) throw new RangeError("a leaf index is a u32");
  const index = new Uint8Array(4);
  new DataView(index.buffer).setUint32(0, leafIndex, false);
  return bytesToHex(sha256(concat(SALTED_ENTRY_LABEL, digest32, proofHash32, index, salt32)));
}

/** A fresh salt for a salted entry. */
export function newRecoverySalt(): Uint8Array {
  const salt = new Uint8Array(SALT_BYTES);
  crypto.getRandomValues(salt);
  return salt;
}

export function recoveryObjectKey(address: string, entryId: string): string {
  if (!ADDRESS_PATTERN.test(address) || !ENTRY_ID_PATTERN.test(entryId)) throw new TypeError("an address and an entry id are 64 lowercase hex characters");
  return `${RECOVERY_PREFIX}${address}/${entryId}`;
}

/** The address and entry id of a well-formed object key; null for anything else. */
export function parseRecoveryObjectKey(key: unknown): { address: string; entryId: string } | null {
  if (typeof key !== "string" || !OBJECT_KEY_PATTERN.test(key)) return null;
  return { address: key.slice(RECOVERY_PREFIX.length, RECOVERY_PREFIX.length + 64), entryId: key.slice(RECOVERY_PREFIX.length + 65) };
}

// ---------------------------------------------------------------------------
// The envelope
// ---------------------------------------------------------------------------

function subtle(): SubtleCrypto {
  const s = globalThis.crypto?.subtle;
  if (!s) throw new Error("WebCrypto (crypto.subtle) is not available: recovery needs a secure context or node 20+");
  return s;
}

/** A fresh copy on its own ArrayBuffer, which is what WebCrypto's BufferSource type asks for. */
const own = (u: Uint8Array): Uint8Array<ArrayBuffer> => new Uint8Array(u);

async function importKey(keyBytes: Uint8Array): Promise<CryptoKey> {
  if (!(keyBytes instanceof Uint8Array) || keyBytes.length !== 32) throw new TypeError("an AES-256 key is 32 bytes");
  return subtle().importKey("raw", own(keyBytes), { name: "AES-GCM" }, false, ["encrypt", "decrypt"]);
}

/**
 * Seal one entry: 0x01 || nonce || AES-256-GCM(plaintext) || tag, with the
 * object key as associated data, so an envelope opens only at the key it was
 * written for. The nonce is 12 random bytes per call. A key encrypts one
 * entry per recording of one file, so random nonces are nowhere near their
 * limit.
 */
export async function sealRecoveryEnvelope(keyBytes: Uint8Array, objectKey: string, plaintext: Uint8Array): Promise<Uint8Array> {
  if (!OBJECT_KEY_PATTERN.test(objectKey)) throw new TypeError("not a recovery object key");
  if (plaintext.length === 0 || plaintext.length > MAX_PLAINTEXT_BYTES) throw new RangeError(`a plaintext is 1 to ${MAX_PLAINTEXT_BYTES} bytes`);
  const key = await importKey(keyBytes);
  const nonce = globalThis.crypto.getRandomValues(new Uint8Array(NONCE_BYTES));
  const sealed = new Uint8Array(await subtle().encrypt({ name: "AES-GCM", iv: nonce, additionalData: own(utf8(objectKey)), tagLength: TAG_BYTES * 8 }, key, own(plaintext)));
  const out = new Uint8Array(1 + NONCE_BYTES + sealed.length);
  out[0] = ENVELOPE_VERSION;
  out.set(nonce, 1);
  out.set(sealed, 1 + NONCE_BYTES);
  return out;
}

async function openWith(key: CryptoKey, objectKey: string, envelope: Uint8Array): Promise<Uint8Array | null> {
  // The version byte sits outside the AAD (the design binds the object key,
  // whose "v1" segment names the format), so it is checked here, exactly: an
  // envelope that is not version 1 is not opened at all.
  if (envelope.length < MIN_ENVELOPE_BYTES || envelope.length > MAX_ENVELOPE_BYTES || envelope[0] !== ENVELOPE_VERSION) return null;
  try {
    const plain = await subtle().decrypt(
      { name: "AES-GCM", iv: own(envelope.subarray(1, 1 + NONCE_BYTES)), additionalData: own(utf8(objectKey)), tagLength: TAG_BYTES * 8 },
      key,
      own(envelope.subarray(1 + NONCE_BYTES)),
    );
    return new Uint8Array(plain);
  } catch {
    return null;
  }
}

/** The plaintext, or null when the envelope is not version 1 or does not authenticate under this key at this object key. */
export async function openRecoveryEnvelope(keyBytes: Uint8Array, objectKey: string, envelope: Uint8Array): Promise<Uint8Array | null> {
  return openWith(await importKey(keyBytes), objectKey, envelope);
}

// ---------------------------------------------------------------------------
// The plaintext
// ---------------------------------------------------------------------------

/** Where the proof is: its position, and the digest the public proof routes find it under. */
export interface RecoveryLocator {
  epochId: string;
  counter: string;
  /** Standard base64 SHA-256 of the root document: the proof's signed artifact digest. */
  artifactDigestB64: string;
}

export interface RecoveryPlaintext {
  format: typeof RECOVERY_FORMAT;
  /** base64 computeProofHash(proof). */
  proofHash: string;
  leafIndex: number;
  /** The 84-byte root document, lowercase hex. */
  rootDocument: string;
  member: TreeMemberEvidence;
  proof: RecoveryLocator;
  /** Present exactly when the entry sits under its salted name: the 32-byte salt, base64. */
  salt?: string;
  /** Advisory, unsigned, like an export's names. */
  name?: string;
}

/** The canonical bytes: keys in the documented order, compact JSON, UTF-8. */
export function encodeRecoveryPlaintext(p: RecoveryPlaintext): Uint8Array {
  const ordered = {
    format: RECOVERY_FORMAT,
    proofHash: p.proofHash,
    leafIndex: p.leafIndex,
    rootDocument: p.rootDocument,
    member: { index: p.member.index, count: p.member.count, leaf: p.member.leaf, path: [...p.member.path] },
    proof: { epochId: p.proof.epochId, counter: p.proof.counter, artifactDigestB64: p.proof.artifactDigestB64 },
    ...(p.salt !== undefined ? { salt: p.salt } : {}),
    ...(p.name !== undefined ? { name: p.name } : {}),
  };
  return utf8(JSON.stringify(ordered));
}

function parseLocator(v: unknown): RecoveryLocator | null {
  if (!isPlainObject(v) || Object.keys(v).sort().join(",") !== "artifactDigestB64,counter,epochId") return null;
  const { epochId, counter, artifactDigestB64 } = v;
  if (typeof epochId !== "string" || !EPOCH_PATTERN.test(epochId)) return null;
  if (typeof counter !== "string" || !COUNTER_PATTERN.test(counter)) return null;
  if (typeof artifactDigestB64 !== "string") return null;
  const d = base64ToBytes(artifactDigestB64);
  if (d === null || d.length !== 32) return null;
  return { epochId, counter, artifactDigestB64 };
}

const PLAINTEXT_KEYS = "format,leafIndex,member,proof,proofHash,rootDocument";
const PLAINTEXT_KEYS_NAMED = "format,leafIndex,member,name,proof,proofHash,rootDocument";
const PLAINTEXT_KEYS_SALTED = "format,leafIndex,member,proof,proofHash,rootDocument,salt";
const PLAINTEXT_KEYS_SALTED_NAMED = "format,leafIndex,member,name,proof,proofHash,rootDocument,salt";

/**
 * Strict read, and every check that needs nothing but the plaintext: exactly
 * the documented keys, the format, a 32-byte proof hash, a root document that
 * parses, member evidence that parses (verify's own strict reader), the leaf
 * index and the tree size agreeing everywhere, the member's path reaching the
 * root inside this root document, and the locator naming this document's
 * hash. Null on any deviation. It does not say the proof exists or binds
 * this document; fetchRecoveredProof does.
 */
export function parseRecoveryPlaintext(bytes: Uint8Array): RecoveryPlaintext | null {
  let v: unknown;
  try {
    v = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
  } catch {
    return null;
  }
  if (!isPlainObject(v)) return null;
  const keys = Object.keys(v).sort().join(",");
  if (keys !== PLAINTEXT_KEYS && keys !== PLAINTEXT_KEYS_NAMED && keys !== PLAINTEXT_KEYS_SALTED && keys !== PLAINTEXT_KEYS_SALTED_NAMED) return null;
  if (v["format"] !== RECOVERY_FORMAT) return null;
  const proofHash = v["proofHash"];
  if (typeof proofHash !== "string") return null;
  const ph = base64ToBytes(proofHash);
  if (ph === null || ph.length !== 32) return null;
  const rootDocument = v["rootDocument"];
  if (typeof rootDocument !== "string") return null;
  const docBytes = hexToBytes(rootDocument);
  const doc = docBytes === null ? null : parseTreeRootDocument(docBytes);
  if (docBytes === null || doc === null) return null;
  const ev = parseTreeMemberEvidence(v["member"]);
  if (ev === null) return null;
  if (v["leafIndex"] !== ev.index || ev.count !== doc.count) return null;
  const reached = treeRootFromMember(ev.leaf, ev.index, ev.count, ev.path);
  if (reached === null || !bytesEqual(reached, doc.root)) return null;
  const proof = parseLocator(v["proof"]);
  if (proof === null || proof.artifactDigestB64 !== bytesToBase64(sha256(docBytes))) return null;
  const out: RecoveryPlaintext = {
    format: RECOVERY_FORMAT,
    proofHash,
    leafIndex: ev.index,
    rootDocument,
    member: v["member"] as TreeMemberEvidence,
    proof,
  };
  if ("salt" in v) {
    const salt = v["salt"];
    const bytes = typeof salt === "string" ? base64ToBytes(salt) : null;
    if (typeof salt !== "string" || bytes === null || bytes.length !== SALT_BYTES) return null;
    out.salt = salt;
  }
  if ("name" in v) {
    const name = v["name"];
    if (typeof name !== "string" || name.length === 0 || utf8(name).length > MAX_NAME_BYTES) return null;
    out.name = name;
  }
  return out;
}

/** The entry id a plaintext derives for digest `d`: the salted name when it carries a salt, else the deterministic one. */
export function recoveryEntryIdOf(digest32: Uint8Array, p: RecoveryPlaintext): string {
  const proofHash32 = base64ToBytes(p.proofHash)!;
  if (p.salt !== undefined) return recoverySaltedEntryId(digest32, proofHash32, p.leafIndex, base64ToBytes(p.salt)!);
  return recoveryEntryId(digest32, proofHash32, p.leafIndex);
}

/**
 * The same member of the same recording, field by field: proof hash, leaf
 * index, root document, the whole evidence (leaf and every path node) and the
 * locator. The design's first test was proof hash and leaf index only, and
 * that is not enough: anyone who knows the digest can seal an envelope that
 * carries the right two numbers around a wrong path or a wrong locator, and a
 * client that accepted it would mark the file recoverable while its only
 * entry is useless. The name is left out on purpose: it is advisory and
 * unsigned, and nothing recovered rests on it; so is the salt, which names
 * the entry and says nothing about the member.
 */
export function sameRecoveryMember(a: RecoveryPlaintext, b: RecoveryPlaintext): boolean {
  if (a.proofHash !== b.proofHash || a.leafIndex !== b.leafIndex || a.rootDocument !== b.rootDocument) return false;
  if (a.member.index !== b.member.index || a.member.count !== b.member.count || a.member.leaf !== b.member.leaf) return false;
  if (a.member.path.length !== b.member.path.length || a.member.path.some((n, i) => n !== b.member.path[i])) return false;
  return a.proof.epochId === b.proof.epochId && a.proof.counter === b.proof.counter && a.proof.artifactDigestB64 === b.proof.artifactDigestB64;
}

/** Keep a long name's tail (a path's tail is the file's own name) inside MAX_NAME_BYTES; undefined for no name. */
export function clampRecoveryName(name: string | null | undefined): string | undefined {
  if (typeof name !== "string" || name.length === 0) return undefined;
  if (utf8(name).length <= MAX_NAME_BYTES) return name;
  const budget = MAX_NAME_BYTES - utf8("…").length;
  const points = Array.from(name);
  let used = 0;
  let start = points.length;
  while (start > 0) {
    const n = utf8(points[start - 1]!).length;
    if (used + n > budget) break;
    used += n;
    start--;
  }
  return `…${points.slice(start).join("")}`;
}

// ---------------------------------------------------------------------------
// A tree, ready to seal
// ---------------------------------------------------------------------------

export interface RecoveryTreeParts {
  /** base64 computeProofHash(proof). */
  proofHash: string;
  locator: RecoveryLocator;
  /** The 84-byte root document. */
  rootDocument: Uint8Array;
  /** The owner's list: every leaf in tree order (count x 65 bytes). */
  leaves: Uint8Array;
}

export interface RecoveryTree {
  proofHash: string;
  proofHash32: Uint8Array;
  locator: RecoveryLocator;
  rootDocument: Uint8Array;
  rootDocumentHex: string;
  count: number;
  /** count x 65 bytes, tree order; a private copy. */
  leaves: Uint8Array;
  /** Over the leaf hashes, for every member's path. */
  tree: MerkleTree;
}

function compareBytes(a: Uint8Array, b: Uint8Array): number {
  for (let i = 0; i < a.length && i < b.length; i++) if (a[i] !== b[i]) return a[i]! - b[i]!;
  return a.length - b.length;
}

/**
 * Everything is checked before anything is sealed, because what is sealed is
 * written create-only under keys nobody can ever reuse: an entry built from a
 * list that does not rebuild the committed root would hold its member's key
 * for ten years and help nobody. The checks are verifyTreeLeaves' own (count,
 * every leaf valid, strictly ascending artifact digests, the rebuilt root
 * equal to the document's; the suite pins the two agreeing), done here so
 * the tree that proves the list is the tree that makes the paths.
 */
export function recoveryTreeFromParts(parts: RecoveryTreeParts): RecoveryTree {
  const proofHash32 = typeof parts.proofHash === "string" ? base64ToBytes(parts.proofHash) : null;
  if (proofHash32 === null || proofHash32.length !== 32) throw new RecoveryInputError("the proof hash is not the base64 of 32 bytes");
  const locator = parseLocator(parts.locator);
  if (locator === null) throw new RecoveryInputError("the locator is not { epochId, counter, artifactDigestB64 }");
  if (!(parts.rootDocument instanceof Uint8Array)) throw new RecoveryInputError("the root document is bytes");
  const doc = parseTreeRootDocument(parts.rootDocument);
  if (doc === null) throw new RecoveryInputError("the root document is not 84 bytes of tree/1");
  if (bytesToBase64(sha256(parts.rootDocument)) !== locator.artifactDigestB64) throw new RecoveryInputError("the root document does not hash to the proof's artifact digest");
  const leaves = parts.leaves;
  if (!(leaves instanceof Uint8Array) || leaves.length === 0 || leaves.length % TREE_LEAF_BYTES !== 0) throw new RecoveryInputError("the leaves are not a whole number of 65-byte leaves");
  const count = leaves.length / TREE_LEAF_BYTES;
  if (count !== doc.count) throw new RecoveryInputError(`the list holds ${count} leaves; the root document states ${doc.count}`);
  const hashes: Uint8Array[] = new Array(count);
  let previous: Uint8Array | null = null;
  for (let i = 0; i < count; i++) {
    const bytes = leaves.subarray(i * TREE_LEAF_BYTES, (i + 1) * TREE_LEAF_BYTES);
    if (decodeTreeLeaf(bytes) === null) throw new RecoveryInputError(`leaf ${i} is not a valid tree/1 leaf`);
    const artifact = bytes.subarray(1, 33);
    if (previous !== null) {
      const c = compareBytes(previous, artifact);
      if (c === 0) throw new RecoveryInputError(`duplicate artifact digest at leaves ${i - 1} and ${i}`);
      if (c > 0) throw new RecoveryInputError(`leaves ${i - 1} and ${i} are out of order`);
    }
    previous = artifact;
    hashes[i] = merkleLeafHash(bytes);
  }
  const tree = new MerkleTree(hashes);
  if (!bytesEqual(tree.root, doc.root)) throw new RecoveryInputError("the leaves do not rebuild the committed root");
  return {
    proofHash: parts.proofHash,
    proofHash32,
    locator,
    rootDocument: parts.rootDocument.slice(),
    rootDocumentHex: bytesToHex(parts.rootDocument),
    count,
    leaves: leaves.slice(),
    tree,
  };
}

/** The proof's own parts: its proof hash, its position and its signed artifact digest. Throws for anything that is not a tree/1 proof with a position. */
export function recoveryProofParts(proof: BitGraphProof): { proofHash: string; locator: RecoveryLocator } {
  if (!isTreeProof(proof)) throw new RecoveryInputError("recovery entries are made for tree/1 proofs only");
  const c = proof.commit as { epochId?: unknown; counter?: unknown } | undefined;
  const locator = parseLocator({ epochId: c?.epochId, counter: c?.counter, artifactDigestB64: proof.artifact?.digestB64 });
  if (locator === null) throw new RecoveryInputError("the proof carries no well-formed position (commit.epochId, commit.counter) or artifact digest");
  return { proofHash: computeProofHash(proof), locator };
}

export interface RecoveryTreeInput {
  proof: BitGraphProof;
  /** The 84-byte root document; read from proof.metadata when omitted. */
  rootDocument?: Uint8Array | null;
  /** Every leaf in tree order: the 65-byte encodings concatenated, or the leaves themselves. */
  leaves?: Uint8Array | readonly TreeLeaf[];
  /** The same list already encoded (fuse-tree-make's MadeTree carries both); preferred when present. */
  leavesBytes?: Uint8Array;
}

/** A tree/1 proof and its owner's list, checked and ready to seal. */
export function recoveryTreeFrom(input: RecoveryTreeInput): RecoveryTree {
  const { proofHash, locator } = recoveryProofParts(input.proof);
  const rootDocument = input.rootDocument ?? readTreeMetadata(input.proof);
  if (!rootDocument) throw new RecoveryInputError("no root document: neither supplied nor in the proof's metadata");
  return recoveryTreeFromParts({ proofHash, locator, rootDocument, leaves: leavesBytesOf(input) });
}

/** The owner's list as bytes, from whichever form the caller holds. */
export function leavesBytesOf(input: { leaves?: Uint8Array | readonly TreeLeaf[]; leavesBytes?: Uint8Array }): Uint8Array {
  if (input.leavesBytes instanceof Uint8Array) return input.leavesBytes;
  const l = input.leaves;
  if (l instanceof Uint8Array) return l;
  if (!Array.isArray(l) || l.length === 0) throw new RecoveryInputError("no leaves: the owner's list is required to seal entries");
  const out = new Uint8Array(l.length * TREE_LEAF_BYTES);
  (l as readonly TreeLeaf[]).forEach((leaf, i) => {
    if (!(leaf.artifact instanceof Uint8Array) || leaf.artifact.length !== 32 || !(leaf.origin instanceof Uint8Array) || leaf.origin.length !== 32) {
      throw new RecoveryInputError(`leaf ${i} is not a tree/1 leaf`);
    }
    out[i * TREE_LEAF_BYTES] = leaf.placement;
    out.set(leaf.artifact, i * TREE_LEAF_BYTES + 1);
    out.set(leaf.origin, i * TREE_LEAF_BYTES + 33);
  });
  return out;
}

/** Leaf `index` of the list, raw. */
export function leafBytesAt(tree: { leaves: Uint8Array }, index: number): Uint8Array {
  return tree.leaves.subarray(index * TREE_LEAF_BYTES, (index + 1) * TREE_LEAF_BYTES);
}

/**
 * Member `index`'s plaintext and its bytes. A name that would push the
 * plaintext past MAX_PLAINTEXT_BYTES (only possible with hundreds of escaped
 * control characters) is dropped, never the entry.
 */
export function recoveryPlaintextFor(tree: RecoveryTree, index: number, name?: string | null, salt?: Uint8Array | null): { plaintext: RecoveryPlaintext; bytes: Uint8Array } {
  if (!Number.isInteger(index) || index < 0 || index >= tree.count) throw new RangeError("member index out of range");
  const leaf = decodeTreeLeaf(leafBytesAt(tree, index));
  if (leaf === null) throw new RecoveryInputError(`leaf ${index} is not a valid tree/1 leaf`);
  if (salt !== undefined && salt !== null && salt.length !== SALT_BYTES) throw new TypeError(`a salt is ${SALT_BYTES} bytes`);
  const base: RecoveryPlaintext = {
    format: RECOVERY_FORMAT,
    proofHash: tree.proofHash,
    leafIndex: index,
    rootDocument: tree.rootDocumentHex,
    member: buildTreeMemberEvidence(leaf, index, tree.count, tree.tree.path(index)),
    proof: { ...tree.locator },
    ...(salt !== undefined && salt !== null ? { salt: bytesToBase64(salt) } : {}),
  };
  const clamped = clampRecoveryName(name);
  if (clamped !== undefined) {
    const named = { ...base, name: clamped };
    const bytes = encodeRecoveryPlaintext(named);
    if (bytes.length <= MAX_PLAINTEXT_BYTES) return { plaintext: named, bytes };
  }
  const bytes = encodeRecoveryPlaintext(base);
  if (bytes.length > MAX_PLAINTEXT_BYTES) throw new RecoveryInputError(`member ${index}'s plaintext is ${bytes.length} bytes, over ${MAX_PLAINTEXT_BYTES}`);
  return { plaintext: base, bytes };
}

/** Which of a leaf's digests an entry is filed under. An as-is leaf has one digest and one entry. */
export type RecoverySide = "origin" | "artifact" | "as-is";

export interface RecoveryWrite {
  side: RecoverySide;
  /** The digest the entry is sealed under (a private copy). */
  digest: Uint8Array;
  objectKey: string;
  envelope: Uint8Array;
  /** The entry's deterministic key: its own key, or the held key a salted entry stands in for. */
  deterministicKey: string;
  /** True when the entry sits under its salted name. */
  salted: boolean;
  /** The plaintext sealed into this envelope (the salt is in it when salted). */
  plaintext: RecoveryPlaintext;
}

/** The sides member `index` is filed under: ["as-is"] for placement 0x00, else ["origin", "artifact"]. */
export function recoverySidesOf(tree: { leaves: Uint8Array }, index: number): RecoverySide[] {
  return leafBytesAt(tree, index)[0] === LEAF_AS_IS ? ["as-is"] : ["origin", "artifact"];
}

/** The digest one side of member `index` is filed under. */
export function recoveryDigestOf(tree: { leaves: Uint8Array }, index: number, side: RecoverySide): Uint8Array {
  const leaf = leafBytesAt(tree, index);
  return (side === "artifact" ? leaf.subarray(1, 33) : leaf.subarray(33, 65)).slice();
}

// ---------------------------------------------------------------------------
// Progress: one byte per member, the same for every writer that resumes
// ---------------------------------------------------------------------------

/** Bit 0 origin kept, bit 1 committed bytes kept, bit 2 origin blocked, bit 3 committed bytes blocked. An as-is member sets both bits of a kind at once. */
export const ORIGIN_KEPT = 1;
export const ARTIFACT_KEPT = 2;
export const ORIGIN_BLOCKED = 4;
export const ARTIFACT_BLOCKED = 8;
export const RECOVERY_SIDE_BITS: Record<RecoverySide, { kept: number; blocked: number }> = {
  origin: { kept: ORIGIN_KEPT, blocked: ORIGIN_BLOCKED },
  artifact: { kept: ARTIFACT_KEPT, blocked: ARTIFACT_BLOCKED },
  "as-is": { kept: ORIGIN_KEPT | ARTIFACT_KEPT, blocked: ORIGIN_BLOCKED | ARTIFACT_BLOCKED },
};

export type RecoveryMemberStatus = "pending" | "recoverable" | "blocked";
export type RecoverySideState = "kept" | "pending" | "blocked";

/** A member's status from its progress byte alone (so a finished job, whose list is gone, still answers). */
export function recoveryMemberStatus(b: number): RecoveryMemberStatus {
  if ((b & (ORIGIN_KEPT | ARTIFACT_KEPT)) === (ORIGIN_KEPT | ARTIFACT_KEPT)) return "recoverable";
  if ((b & (ORIGIN_BLOCKED | ARTIFACT_BLOCKED)) !== 0) return "blocked";
  return "pending";
}

export function recoverySideState(b: number, side: RecoverySide): RecoverySideState {
  const s = RECOVERY_SIDE_BITS[side];
  if ((b & s.kept) === s.kept) return "kept";
  if ((b & s.blocked) === s.blocked) return "blocked";
  return "pending";
}

export const recoverySideResolved = (b: number, side: RecoverySide): boolean => recoverySideState(b, side) !== "pending";

/** The key a member's side has in a writer's salt table: "<leafIndex>:<side>". */
export const recoverySaltKey = (index: number, side: RecoverySide): string => `${index}:${side}`;

/** A writer's salt table (base64 salts by recoverySaltKey) as the `salts` sealRecoveryMember takes for member `index`; null when it holds none for that member. */
export function recoverySaltsFor(salts: Readonly<Record<string, string>> | null | undefined, index: number): Partial<Record<RecoverySide, Uint8Array>> | null {
  if (salts === null || salts === undefined) return null;
  let out: Partial<Record<RecoverySide, Uint8Array>> | null = null;
  for (const side of ["origin", "artifact", "as-is"] as const) {
    const b64 = salts[recoverySaltKey(index, side)];
    if (b64 === undefined) continue;
    const salt = base64ToBytes(b64);
    if (salt === null || salt.length !== SALT_BYTES) throw new RecoveryInputError(`the salt kept for member ${index} (${side}) is not ${SALT_BYTES} bytes`);
    (out ??= {})[side] = salt;
  }
  return out;
}

/** The object key one side of member `index` is filed under: deterministic, or salted when a salt is given. */
export function recoveryObjectKeyFor(tree: RecoveryTree, index: number, side: RecoverySide, salt?: Uint8Array | null): string {
  const digest = recoveryDigestOf(tree, index, side);
  const id = salt !== undefined && salt !== null ? recoverySaltedEntryId(digest, tree.proofHash32, index, salt) : recoveryEntryId(digest, tree.proofHash32, index);
  return recoveryObjectKey(recoveryAddress(digest), id);
}

/**
 * Seal member `index`: one envelope per side (or only the sides asked for),
 * each under its own key, nonce and AAD. A side named in `salts` is sealed
 * under its salted name, with the salt in its plaintext; `plaintext` is the
 * unsalted one, the member all of them describe.
 */
export async function sealRecoveryMember(
  tree: RecoveryTree,
  index: number,
  name?: string | null,
  only?: readonly RecoverySide[],
  salts?: Partial<Record<RecoverySide, Uint8Array>> | null,
): Promise<{ plaintext: RecoveryPlaintext; writes: RecoveryWrite[] }> {
  const { plaintext } = recoveryPlaintextFor(tree, index, name);
  const sides = recoverySidesOf(tree, index).filter((s) => only === undefined || only.includes(s));
  const writes = await Promise.all(sides.map(async (side): Promise<RecoveryWrite> => {
    const digest = recoveryDigestOf(tree, index, side);
    const salt = salts?.[side] ?? null;
    const deterministicKey = recoveryObjectKey(recoveryAddress(digest), recoveryEntryId(digest, tree.proofHash32, index));
    const objectKey = salt === null ? deterministicKey : recoveryObjectKey(recoveryAddress(digest), recoverySaltedEntryId(digest, tree.proofHash32, index, salt));
    const sealed = salt === null ? recoveryPlaintextFor(tree, index, name) : recoveryPlaintextFor(tree, index, name, salt);
    return { side, digest, objectKey, envelope: await sealRecoveryEnvelope(recoveryKeyBytes(digest), objectKey, sealed.bytes), deterministicKey, salted: salt !== null, plaintext: sealed.plaintext };
  }));
  return { plaintext, writes };
}

/**
 * The 412 path's test: the envelope already stored at `objectKey` holds THIS
 * member (sameRecoveryMember), opened with the digest's key at that key. A
 * stored envelope that does not open, does not parse, or holds anything else
 * is somebody else's entry, and the write is not a success.
 */
export async function existingEntryHoldsMember(digest32: Uint8Array, objectKey: string, envelope: Uint8Array, expected: RecoveryPlaintext): Promise<boolean> {
  const plain = await openRecoveryEnvelope(recoveryKeyBytes(digest32), objectKey, envelope);
  if (plain === null) return false;
  const found = parseRecoveryPlaintext(plain);
  if (found === null || !sameRecoveryMember(found, expected)) return false;
  // And it must sit under the name its own plaintext derives, exactly as a
  // reader demands: this member's plaintext with a salt in it, parked at the
  // deterministic name, is nobody's entry (no reader accepts it), and a
  // writer that took it for its own would never write the copy that works.
  const parsed = parseRecoveryObjectKey(objectKey);
  return parsed !== null && recoveryEntryIdOf(digest32, found) === parsed.entryId;
}

/**
 * This member's own entry under its address, if one is already there under
 * any name: the deterministic one, or a salted one from an earlier run whose
 * salt was lost (a job finished and removed, a browser tab's save that
 * failed). Returns the entry's key and, for a salted one, its salt, so the
 * writer counts it kept and reuses the salt instead of leaving a second copy.
 * Null when none is there; raises RecoveryUnavailableError when the address
 * cannot be read (then the writer must not guess).
 */
export async function findOwnRecoveryEntry(digest32: Uint8Array, expected: RecoveryPlaintext, fetchFn: FetchLike = defaultFetch, opts: RecoveryLookupOptions = {}): Promise<{ objectKey: string; salt: Uint8Array | null } | null> {
  checkDigest(digest32);
  const address = recoveryAddress(digest32);
  const key = await importKey(recoveryKeyBytes(digest32));
  const entries = await collectPages(address, digest32, key, null, fetchFn, opts, false);
  for (const e of entries) {
    const found: RecoveryPlaintext = { format: RECOVERY_FORMAT, proofHash: e.proofHash, leafIndex: e.leafIndex, rootDocument: e.rootDocument, member: e.member, proof: e.proof };
    if (!sameRecoveryMember(found, expected)) continue;
    if (!e.salted) return { objectKey: e.objectKey, salt: null };
    const salt = e.salt !== null ? base64ToBytes(e.salt) : null;
    if (salt !== null && salt.length === SALT_BYTES) return { objectKey: e.objectKey, salt };
  }
  return null;
}

// ---------------------------------------------------------------------------
// Lookup
// ---------------------------------------------------------------------------

export interface RecoveredEntry {
  objectKey: string;
  entryId: string;
  /** True when the entry sits under its salted name (its deterministic one was held by another entry). */
  salted: boolean;
  /** The salted entry's salt, base64; null under the deterministic name. */
  salt: string | null;
  /** Which of the leaf's digests the looked-up digest is: "as-is" when the leaf has one. */
  matched: RecoverySide;
  /** base64 computeProofHash(proof) of the recording. */
  proofHash: string;
  leafIndex: number;
  /** Hex, 84 bytes: an export's tree.rootDocument. */
  rootDocument: string;
  /** An export's tree.member. */
  member: TreeMemberEvidence;
  proof: RecoveryLocator;
  name: string | null;
}

export interface RecoveryLookupOptions {
  /** Origin of the site's routes; "" (same origin) in the browser. */
  baseUrl?: string;
  /** A guard against a server whose pages never end. Default 1,000 (100,000 entries). */
  maxPages?: number;
}

/** One page of a listing, checked: { entries, next }. */
interface ListingPage {
  entries: unknown[];
  next: string | null;
}

function checkPage(body: unknown): ListingPage {
  if (!isPlainObject(body) || !Array.isArray(body["entries"]) || !(body["next"] === null || typeof body["next"] === "string")) {
    throw new RecoveryUnavailableError("the listing is not { entries, next }");
  }
  return { entries: body["entries"] as unknown[], next: body["next"] as string | null };
}

/** Run `fn` over `items`, at most `limit` at once, results in item order. */
async function mapPool<T, R>(items: readonly T[], limit: number, fn: (item: T, index: number) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  await Promise.all(Array.from({ length: Math.max(1, Math.min(limit, items.length)) }, async () => {
    while (next < items.length) {
      const i = next++;
      out[i] = await fn(items[i]!, i);
    }
  }));
  return out;
}

const asPlaintext = (e: RecoveredEntry): RecoveryPlaintext => ({ format: RECOVERY_FORMAT, proofHash: e.proofHash, leafIndex: e.leafIndex, rootDocument: e.rootDocument, member: e.member, proof: e.proof });

/**
 * One listing per member: the same member under its deterministic name and
 * under a salted one (a writer that met a held key, or wrote twice) is one
 * recovery. Two entries that name the same proof and leaf but describe
 * different members are both kept; binding each to its proof sorts them out.
 */
function dedupeRecovered(entries: RecoveredEntry[]): RecoveredEntry[] {
  const out: RecoveredEntry[] = [];
  for (const e of entries) if (!out.some((o) => sameRecoveryMember(asPlaintext(o), asPlaintext(e)))) out.push(e);
  return out;
}

/**
 * Every entry under `address` that opens for `digest32`. `first` is a page
 * already in hand (from a batch lookup); otherwise the pages are read with
 * GET /api/recovery/<address> from the start. Either way the listing is
 * followed to its end, or the lookup fails: a partial listing is never an
 * answer.
 */
async function collectPages(address: string, digest32: Uint8Array, key: CryptoKey, first: ListingPage | null, fetchFn: FetchLike, opts: RecoveryLookupOptions, emptyOn404 = true): Promise<RecoveredEntry[]> {
  const base = opts.baseUrl ?? "";
  const maxPages = opts.maxPages ?? 1000;
  const out: RecoveredEntry[] = [];
  let after: string | null = null;
  let page: ListingPage | null = first;
  for (let n = 0; ; n++) {
    if (n >= maxPages) throw new RecoveryUnavailableError(`more than ${maxPages} pages under one address`);
    if (page === null) {
      const url = `${base}/api/recovery/${address}${after !== null ? `?after=${after}` : ""}`;
      let body: unknown;
      try {
        const res = await fetchFn(url, { headers: { accept: "application/json" } });
        // A site without the route keeps no entries at all: that is an
        // answer (nothing is kept here), not a failed read. Only a 404, only
        // on the first page, and never for an address already known to hold
        // entries (emptyOn404 false: the batch route named it).
        if (res.status === 404 && after === null && first === null && emptyOn404) return [];
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        body = await res.json();
      } catch (e) {
        throw new RecoveryUnavailableError(`GET /api/recovery/${address.slice(0, 8)}…`, e);
      }
      page = checkPage(body);
    }
    for (const item of page.entries) {
      const found = await openListed(item, digest32, address, key);
      if (found !== null) out.push(found);
    }
    const next = page.next;
    if (next === null) break;
    if (!ENTRY_ID_PATTERN.test(next) || (after !== null && next <= after)) throw new RecoveryUnavailableError("the listing's cursor does not advance");
    after = next;
    page = null;
  }
  return dedupeRecovered(out);
}

/**
 * Every recording of the file whose SHA-256 is `digest32`, from the sealed
 * entries under its address: one entry per member per recording, so the same
 * file recorded twice comes back twice (and the same member under two names
 * once). An entry that does not authenticate, does not parse, sits under an
 * entry id its own contents do not derive, or names a leaf that is not this
 * digest is skipped: it is not ours to show. The list is in the server's
 * listing order; order the recordings by their proofs' own times once
 * fetched.
 *
 * Raises RecoveryUnavailableError when the entries cannot be read. An empty
 * array is an answer (nothing is kept for these bytes, or the site keeps no
 * recovery entries at all: its route answers 404); a failure never is.
 */
export async function recoverFromDigest(digest32: Uint8Array, fetchFn: FetchLike = defaultFetch, opts: RecoveryLookupOptions = {}): Promise<RecoveredEntry[]> {
  checkDigest(digest32);
  const address = recoveryAddress(digest32);
  const key = await importKey(recoveryKeyBytes(digest32));
  return collectPages(address, digest32, key, null, fetchFn, opts);
}

/** One digest's lookup in a batch: every page read and every entry opened, or why it could not be. A failure is never a verdict. */
export type RecoveryLookupAnswer = { ok: true; entries: RecoveredEntry[] } | { ok: false; reason: string };

/**
 * recoverFromDigest for many files at once: the first page of every address
 * in one request (POST /api/recovery/lookup, at most MAX_LOOKUP_ADDRESSES per
 * request), then the rest of any longer listing page by page. One answer per
 * digest, in order; a digest whose entries could not all be read answers
 * { ok: false }, never an empty list. A site without the route (404) is asked
 * one address at a time instead.
 *
 * Asking many addresses in one request tells the server which files were
 * dropped together, which one-by-one requests only hint at by timing. The
 * route logs counts, never addresses (SPEC section 13).
 */
export async function recoverFromDigests(digests: readonly Uint8Array[], fetchFn: FetchLike = defaultFetch, opts: RecoveryLookupOptions = {}): Promise<RecoveryLookupAnswer[]> {
  for (const d of digests) checkDigest(d);
  const base = opts.baseUrl ?? "";
  const out: RecoveryLookupAnswer[] = new Array(digests.length);
  const messageOf = (e: unknown): string => (e instanceof Error ? e.message : String(e));
  // The same digest asked twice (an as-is file's original and committed bytes
  // are one digest) is one address in the request and one answer for both.
  const indexesByAddress = new Map<string, number[]>();
  for (let i = 0; i < digests.length; i++) {
    const address = recoveryAddress(digests[i]!);
    const list = indexesByAddress.get(address);
    if (list === undefined) indexesByAddress.set(address, [i]);
    else list.push(i);
  }
  const unique = [...indexesByAddress.keys()];
  const slices: string[][] = [];
  for (let at = 0; at < unique.length; at += MAX_LOOKUP_ADDRESSES) slices.push(unique.slice(at, at + MAX_LOOKUP_ADDRESSES));
  const answerAll = (address: string, a: RecoveryLookupAnswer): void => {
    for (const i of indexesByAddress.get(address)!) out[i] = a;
  };

  /** POST one slice, trying again after a 429 or a 5xx (Retry-After honoured, at most 30 s) or a network failure, three times in all. */
  async function postLookup(addresses: string[]): Promise<{ kind: "answered"; body: unknown } | { kind: "no-route" } | { kind: "failed"; reason: string }> {
    let reason = "";
    let retryAfterSec = 0;
    for (let attempt = 0; attempt < 3; attempt++) {
      if (attempt > 0) await sleep(Math.min(30_000, retryAfterSec > 0 ? retryAfterSec * 1000 : 500 * 2 ** (attempt - 1)));
      try {
        const res = await fetchFn(`${base}/api/recovery/lookup`, { method: "POST", headers: { "content-type": "application/json", accept: "application/json" }, body: JSON.stringify({ addresses }) });
        if (res.status === 404 || res.status === 405 || res.status === 501) return { kind: "no-route" };
        if (res.status === 429 || res.status >= 500) {
          reason = `POST /api/recovery/lookup answered ${res.status}`;
          retryAfterSec = Number(res.headers.get("retry-after")) || 0;
          continue;
        }
        if (!res.ok) return { kind: "failed", reason: `POST /api/recovery/lookup answered ${res.status}` };
        return { kind: "answered", body: await res.json() };
      } catch (e) {
        reason = `POST /api/recovery/lookup: ${messageOf(e)}`;
      }
    }
    return { kind: "failed", reason };
  }

  // Up to four requests in flight: 100,000 files are 100 requests.
  await mapPool(slices, 4, async (addresses): Promise<void> => {
    const posted = await postLookup(addresses);
    if (posted.kind === "failed") {
      for (const address of addresses) answerAll(address, { ok: false, reason: posted.reason });
      return;
    }
    const results = new Map<string, Record<string, unknown>>();
    if (posted.kind === "answered") {
      if (!isPlainObject(posted.body) || !Array.isArray(posted.body["results"])) {
        for (const address of addresses) answerAll(address, { ok: false, reason: "the lookup's answer is not { results }" });
        return;
      }
      for (const r of posted.body["results"] as unknown[]) if (isPlainObject(r) && typeof r["address"] === "string") results.set(r["address"], r);
    }
    // A site without the route is asked one address at a time (GET), from the start of each listing.
    const oneByOne = posted.kind === "no-route";
    await mapPool(addresses, 8, async (address): Promise<void> => {
      const digest32 = digests[indexesByAddress.get(address)![0]!]!;
      try {
        const key = await importKey(recoveryKeyBytes(digest32));
        let first: ListingPage | null = null;
        if (!oneByOne) {
          const r = results.get(address);
          if (r === undefined) throw new RecoveryUnavailableError("the lookup's answer has no result for this address");
          if (r["error"] !== undefined) throw new RecoveryUnavailableError(`the site could not read this address (${String(r["error"])})`);
          if (r["truncated"] !== true) first = checkPage(r);
        }
        // Through the batch route the site has recovery; a 404 on a page is then a failed read, never "nothing kept".
        answerAll(address, { ok: true, entries: await collectPages(address, digest32, key, first, fetchFn, opts, oneByOne) });
      } catch (e) {
        answerAll(address, { ok: false, reason: messageOf(e) });
      }
    });
  });
  return out;
}

async function openListed(item: unknown, digest32: Uint8Array, address: string, key: CryptoKey): Promise<RecoveredEntry | null> {
  if (!isPlainObject(item) || typeof item["key"] !== "string" || typeof item["envelope"] !== "string") return null;
  const parsedKey = parseRecoveryObjectKey(item["key"]);
  if (parsedKey === null || parsedKey.address !== address) return null;
  const envelope = base64ToBytes(item["envelope"]);
  if (envelope === null) return null;
  const plain = await openWith(key, item["key"], envelope);
  if (plain === null) return null;
  const p = parseRecoveryPlaintext(plain);
  if (p === null) return null;
  // The name must be the one this plaintext derives: salted when it carries a salt, deterministic when it does not.
  if (recoveryEntryIdOf(digest32, p) !== parsedKey.entryId) return null;
  const leaf = parseTreeMemberEvidence(p.member)!.leaf;
  const isArtifact = bytesEqual(leaf.artifact, digest32);
  const isOrigin = bytesEqual(leaf.origin, digest32);
  if (!isArtifact && !isOrigin) return null;
  return {
    objectKey: item["key"],
    entryId: parsedKey.entryId,
    salted: p.salt !== undefined,
    salt: p.salt ?? null,
    matched: leaf.placement === LEAF_AS_IS ? "as-is" : isOrigin ? "origin" : "artifact",
    proofHash: p.proofHash,
    leafIndex: p.leafIndex,
    rootDocument: p.rootDocument,
    member: p.member,
    proof: p.proof,
    name: p.name ?? null,
  };
}

export interface RecoveredProof {
  proof: BitGraphProof;
  /**
   * verifyTreeMember on the fetched proof with this entry's root document and
   * evidence (and the file, when given): TREE_PATH_VALID, or one of the
   * TREE_MEMBER categories with the file, is a recovered BitGraph. Anything
   * else is a reason, never a verdict about the file.
   */
  check: TreeVerifyResult;
}

/**
 * The proof a recovered entry points at, from the public proof routes by its
 * artifact digest, bound by proof hash (a proof whose computeProofHash is not
 * the entry's is not this recording) and checked with verifyTreeMember.
 * Null when no proof under that digest has this proof hash. Raises
 * RecoveryUnavailableError when the route cannot be read.
 *
 * With the proof and the entry in hand an export is the existing machinery:
 * fuse-tree's buildTreeExport(proof, memberTree(rootDocument, member),
 * await fetchTreeEvidence(proof)).
 *
 * ⚠️ THIS READ NEEDS THE LEDGER'S BY-DIGEST INDEX for the tree's artifact
 * digest, which exists while per-proof writes are on (LEDGER_WRITES). If they
 * are ever switched off, the entry still names the proof exactly: the
 * parent's own key is proofs/<url-safe epochId>/<counter, 12 digits>-<url-safe
 * proofHash>.json, and a read-only route serving that key is all this needs.
 */
export async function fetchRecoveredProof(
  entry: Pick<RecoveredEntry, "proofHash" | "rootDocument" | "member" | "proof">,
  fetchFn: FetchLike = defaultFetch,
  opts: { baseUrl?: string; bytes?: Uint8Array; source?: ByteSource; extraSpecHashes?: readonly string[] } = {},
): Promise<RecoveredProof | null> {
  const url = `${opts.baseUrl ?? ""}/api/proofs/${toUrlSafe(entry.proof.artifactDigestB64)}`;
  let body: unknown;
  try {
    const res = await fetchFn(url, { headers: { accept: "application/json" } });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    body = await res.json();
  } catch (e) {
    throw new RecoveryUnavailableError("GET /api/proofs/<artifact digest>", e);
  }
  const proofs = isPlainObject(body) && Array.isArray(body["proofs"]) ? (body["proofs"] as unknown[]) : [];
  // The route says so itself when a miss is not a finding: the ledger no longer
  // indexes proofs by digest. The entry may well name a real proof; nothing here
  // can read it, so this is unavailable, never "not this file's recording".
  if (proofs.length === 0 && isPlainObject(body) && body["discovery"] === "retired") throw new RecoveryUnavailableError("the ledger's index of proofs by digest is retired; the entry's proof cannot be read through this route");
  const rootDocument = hexToBytes(entry.rootDocument);
  if (rootDocument === null) return null;
  for (const item of proofs) {
    const proof = isPlainObject(item) && isPlainObject(item["proof"]) ? (item["proof"] as unknown as BitGraphProof) : null;
    if (proof === null) continue;
    let hash: string;
    try {
      hash = computeProofHash(proof);
    } catch {
      continue;
    }
    if (hash !== entry.proofHash) continue;
    const check = await verifyTreeMember({
      proof,
      member: entry.member,
      rootDocument,
      ...(opts.bytes !== undefined ? { bytes: opts.bytes } : {}),
      ...(opts.source !== undefined ? { source: opts.source } : {}),
      ...(opts.extraSpecHashes !== undefined ? { extraSpecHashes: opts.extraSpecHashes } : {}),
    });
    return { proof, check };
  }
  return null;
}
