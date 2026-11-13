// Copyright (c) 2025-2026 Argento Computing Inc. Licensed under the MIT License. See LICENSE.

/**
 * Hourly publication: the formats and the offline check.
 *
 * Every hour the operator writes one small transaction to Base (an "hourly write") holding the root of a tree over the
 * chain hashes of that hour's BitGraphs and a link to the previous hourly write. Right after the write lands, the
 * operator binds a short note naming the write's block as an ordinary BitGraph (the "floor"): it is provably after that
 * block, and every later BitGraph of the epoch is after it by its count. Each proof can then carry, in its unsigned
 * metadata, a `bitgraph-publication/1` block linking it to its hour's write.
 *
 *   hourly write calldata (bitgraph-hour/1), big-endian:
 *     "BGH1" | flags (1: bit 0 = carries the epoch's public key) | epoch id (32) | first count (8) | last count (8)
 *     | leaves (4) | root (32, zeros when leaves = 0) | previous link (32, zeros for the first write ever)
 *     | epoch public key (32, only when flag bit 0 is set)
 *   link  = SHA-256(calldata)
 *   tree  = RFC 6962 over leaf = SHA-256(0x00 || published chain hash), in count order (the tree BitGraph uses for
 *           files); the published chain hash is computeChainHash over the proof without its unsigned metadata
 *
 * A write covers one epoch's counts first..last. An hour in which nothing was made still gets a write, with leaves = 0,
 * so the record shows the quiet hour. The first write of an epoch carries the epoch's public key.
 *
 * checkPublication() needs nothing live. It checks: the proof's chain hash walks up its path to the root in the write;
 * the write's transaction is the one the evidence names, sits in the block's transaction trie, and the block header
 * hashes to the block hash; the proof's count is inside the write's range; and, when there is a floor, that the floor
 * BitGraph is in a published tree, binds the note it names, and comes before the proof in the same epoch. What it
 * cannot check offline is that the block is on Base's canonical chain: compare `ceiling.blockHash` (and the floor's
 * block hash) with Base from any source you trust.
 */

import { sha256 } from "@noble/hashes/sha256";
import {
  computeChainHash,
  verifyProofIntegrity,
  createVerificationContext,
  merkleLeafHash,
  merkleRoot,
  merklePath,
  merkleRootFromPath,
  decodeHeader,
  decodeEip1559,
  mptVerify,
  txTrieKey,
  evmHexToBytes,
  evmBytesToHex,
  b64ToBytes,
  bytesToB64,
} from "@mikeargento/bitgraph-verify";

export const PUBLICATION_METADATA_KEY = "bitgraph-publication/1" as const;
export const HOUR_RECORD_FORMAT = "bitgraph-hour/1" as const;
export const FLOOR_NOTE_FORMAT = "bitgraph-hour-floor/1" as const;
/** "BGH1": BitGraph hourly write, version 1. */
export const HOUR_MAGIC = new Uint8Array([0x42, 0x47, 0x48, 0x31]);
const FLAG_KEY = 1;

// ── small byte helpers ──────────────────────────────────────────────────────

const HEX = "0123456789abcdef";
export function toHex(b: Uint8Array): string { let s = ""; for (const x of b) s += HEX[x >> 4]! + HEX[x & 15]!; return s; }
function fromHex(h: string): Uint8Array | null {
  const t = h.replace(/^0x/, "");
  if (t.length % 2 !== 0 || !/^[0-9a-fA-F]*$/.test(t)) return null;
  const out = new Uint8Array(t.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(t.slice(i * 2, i * 2 + 2), 16);
  return out;
}
function b64To32(b64: string, what: string): Uint8Array {
  const b = b64ToBytes(b64);
  if (!b || b.length !== 32) throw new TypeError(`${what} is not 32 bytes of base64`);
  return b;
}
function eq(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  let d = 0;
  for (let i = 0; i < a.length; i++) d |= a[i]! ^ b[i]!;
  return d === 0;
}
function u64(n: number): Uint8Array {
  if (!Number.isSafeInteger(n) || n < 0) throw new RangeError("count out of range");
  const out = new Uint8Array(8);
  let v = BigInt(n);
  for (let i = 7; i >= 0; i--) { out[i] = Number(v & 0xffn); v >>= 8n; }
  return out;
}
function readU64(b: Uint8Array, at: number): number {
  let v = 0n;
  for (let i = 0; i < 8; i++) v = (v << 8n) | BigInt(b[at + i]!);
  if (v > BigInt(Number.MAX_SAFE_INTEGER)) throw new RangeError("count out of range");
  return Number(v);
}
function u32(n: number): Uint8Array {
  if (!Number.isInteger(n) || n < 0 || n > 0xffffffff) throw new RangeError("leaf count out of range");
  return new Uint8Array([(n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255]);
}
const readU32 = (b: Uint8Array, at: number): number => ((b[at]! << 24) >>> 0) + (b[at + 1]! << 16) + (b[at + 2]! << 8) + b[at + 3]!;

// ── the hourly write ────────────────────────────────────────────────────────

export interface HourWrite {
  epochId: string;        // standard base64, 32 bytes
  first: number;          // first count covered (0 with leaves = 0 when the epoch has none yet)
  last: number;           // last count covered
  leaves: number;         // how many BitGraphs the tree holds
  rootHex: string;        // 64 hex, zeros when leaves = 0
  prevLinkHex: string;    // 64 hex, zeros for the first write ever
  epochPublicKeyB64?: string; // only on an epoch's first write
}

export function encodeHourCalldata(w: HourWrite): Uint8Array {
  const root = fromHex(w.rootHex), prev = fromHex(w.prevLinkHex);
  if (!root || root.length !== 32) throw new TypeError("root is not 32 bytes of hex");
  if (!prev || prev.length !== 32) throw new TypeError("previous link is not 32 bytes of hex");
  if (w.leaves === 0 ? !eq(root, new Uint8Array(32)) : w.last < w.first) throw new RangeError("range and leaves disagree");
  const key = w.epochPublicKeyB64 !== undefined ? b64To32(w.epochPublicKeyB64, "the epoch public key") : null;
  const out = new Uint8Array(121 + (key ? 32 : 0));
  out.set(HOUR_MAGIC, 0);
  out[4] = key ? FLAG_KEY : 0;
  out.set(b64To32(w.epochId, "the epoch id"), 5);
  out.set(u64(w.first), 37);
  out.set(u64(w.last), 45);
  out.set(u32(w.leaves), 53);
  out.set(root, 57);
  out.set(prev, 89);
  if (key) out.set(key, 121);
  return out;
}

export function decodeHourCalldata(b: Uint8Array): HourWrite | null {
  if (b.length !== 121 && b.length !== 153) return null;
  if (!eq(b.subarray(0, 4), HOUR_MAGIC)) return null;
  const flags = b[4]!;
  if ((flags & ~FLAG_KEY) !== 0) return null;
  const hasKey = (flags & FLAG_KEY) !== 0;
  if (hasKey !== (b.length === 153)) return null;
  try {
    const w: HourWrite = {
      epochId: bytesToB64(b.subarray(5, 37)),
      first: readU64(b, 37),
      last: readU64(b, 45),
      leaves: readU32(b, 53),
      rootHex: toHex(b.subarray(57, 89)),
      prevLinkHex: toHex(b.subarray(89, 121)),
    };
    if (hasKey) w.epochPublicKeyB64 = bytesToB64(b.subarray(121, 153));
    if (w.leaves > 0 && w.last < w.first) return null;
    return w;
  } catch {
    return null;
  }
}

/** The link the next write names: SHA-256 of this write's calldata, hex. */
export const hourLink = (calldata: Uint8Array): string => toHex(sha256(calldata));

// ── the hour's tree ─────────────────────────────────────────────────────────

/** A BitGraph's leaf in its hour's tree: SHA-256(0x00 || its published chain hash). */
export function hourLeaf(chainHashB64: string): Uint8Array {
  return merkleLeafHash(b64To32(chainHashB64, "the chain hash"));
}

export interface HourTree { rootHex: string; paths: string[] }

/** The root over chain hashes in count order, and each one's path (siblings from the leaf up, concatenated, base64). */
export function hourTree(chainHashesB64: readonly string[]): HourTree {
  if (chainHashesB64.length === 0) return { rootHex: "0".repeat(64), paths: [] };
  const leaves = chainHashesB64.map(hourLeaf);
  const rootHex = toHex(merkleRoot(leaves));
  const paths = leaves.map((_, i) => {
    const p = merklePath(leaves, i);
    const cat = new Uint8Array(p.length * 32);
    p.forEach((s, j) => cat.set(s, j * 32));
    return bytesToB64(cat);
  });
  return { rootHex, paths };
}

function rootFromPath(chainHashB64: string, index: number, leaves: number, pathB64: string): string | null {
  const cat = pathB64 === "" ? new Uint8Array(0) : b64ToBytes(pathB64);
  if (!cat || cat.length % 32 !== 0) return null;
  const sibs: Uint8Array[] = [];
  for (let i = 0; i < cat.length; i += 32) sibs.push(cat.subarray(i, i + 32));
  let leaf: Uint8Array;
  try { leaf = hourLeaf(chainHashB64); } catch { return null; }
  const r = merkleRootFromPath(leaf, index, leaves, sibs);
  return r ? toHex(r) : null;
}

// ── the floor note ──────────────────────────────────────────────────────────

export interface FloorNote {
  chainId: number;
  blockNumber: number;
  blockHash: string;      // 0x + 64 hex, lowercase
  blockTimestamp: number; // unix seconds, from the block header
  txHash: string;         // 0x + 64 hex, lowercase
  writeLinkHex: string;   // the link of the write it binds back
}

export function floorNoteText(n: FloorNote): string {
  return [
    `BitGraph hourly publication floor (${FLOOR_NOTE_FORMAT})`,
    `chain: base ${n.chainId}`,
    `block: ${n.blockNumber}`,
    `block hash: ${n.blockHash.toLowerCase()}`,
    `block time: ${n.blockTimestamp}`,
    `transaction: ${n.txHash.toLowerCase()}`,
    `write: ${n.writeLinkHex.toLowerCase()}`,
    "",
  ].join("\n");
}

export function parseFloorNote(text: string): FloorNote | null {
  const m = /^BitGraph hourly publication floor \(bitgraph-hour-floor\/1\)\nchain: base (\d+)\nblock: (\d+)\nblock hash: (0x[0-9a-f]{64})\nblock time: (\d+)\ntransaction: (0x[0-9a-f]{64})\nwrite: ([0-9a-f]{64})\n$/.exec(text);
  if (!m) return null;
  const n: FloorNote = { chainId: Number(m[1]), blockNumber: Number(m[2]), blockHash: m[3]!, blockTimestamp: Number(m[4]), txHash: m[5]!, writeLinkHex: m[6]! };
  return Number.isSafeInteger(n.chainId) && Number.isSafeInteger(n.blockNumber) && Number.isSafeInteger(n.blockTimestamp) ? n : null;
}

/** The digest a floor BitGraph binds: SHA-256 of the note's UTF-8 bytes, standard base64. */
export const floorNoteDigestB64 = (text: string): string => bytesToB64(sha256(new TextEncoder().encode(text)));

// ── what a proof carries ────────────────────────────────────────────────────

/** The write's evidence: enough to tie the calldata to a block without asking anyone. */
export interface WriteEvidence {
  chain: "base";
  chainId: number;
  writer: string;           // 0x address, lowercase
  txHash: string;           // 0x + 64 hex
  blockNumber: number;
  blockHash: string;        // 0x + 64 hex
  blockTimestamp: number;
  headerRlp: string;        // 0x hex; keccak256 of it is the block hash
  txIndex: number;
  txInclusionProof: string[]; // 0x hex trie nodes, from the header's transactionsRoot to the transaction
  rawTx: string;            // 0x hex, the signed transaction; keccak256 of it is txHash
}

export interface PublicationFloor {
  /** The floor BitGraph itself, whole. */
  proof: Record<string, unknown>;
  /** The note it binds. */
  note: string;
  /** Where the floor sits: in the tree of the write whose calldata this is (the proof's own write, or the one it links back to). */
  hourCalldata: string;     // 0x hex
  leafIndex: number;
  path: string;             // base64, siblings concatenated
}

export interface PublicationBlock {
  format: typeof PUBLICATION_METADATA_KEY;
  epochId: string;
  counter: string;
  chainHashB64: string;
  leafIndex: number;
  path: string;
  calldata: string;         // 0x hex, the hourly write's calldata
  write: WriteEvidence;
  /** Null when the proof came before its epoch's first floor. */
  floor: PublicationFloor | null;
}

export function publicationOf(proof: unknown): PublicationBlock | null {
  const md = (proof as { metadata?: Record<string, unknown> } | null)?.metadata;
  const b = md?.[PUBLICATION_METADATA_KEY] as PublicationBlock | undefined;
  if (!b || typeof b !== "object" || b.format !== PUBLICATION_METADATA_KEY) return null;
  return b;
}

// ── the check ───────────────────────────────────────────────────────────────

export interface PublicationCheck {
  ok: boolean;
  problems: string[];
  /** The block that published the proof's hour: the proof existed by it. Confirm the hash is on Base. */
  ceiling: { chainId: number; blockNumber: number; blockHash: string; blockTimestamp: number; txHash: string } | null;
  /** The block the proof is provably after, when it has a floor. Confirm the hash is on Base. */
  floor: { chainId: number; blockNumber: number; blockHash: string; blockTimestamp: number; floorCounter: string } | null;
  write: HourWrite | null;
}

export interface PublicationCheckOptions {
  /** The writer address to accept (lowercase 0x). When given, the transaction must be signed by it and sent to itself. */
  writer?: string;
  /** The chain id to accept; default 8453 (Base mainnet). */
  chainId?: number;
}

/**
 * The fingerprint a BitGraph is published under: its chain hash (computeChainHash) taken over the proof without its
 * `metadata`. Metadata is unsigned and added after the fact (a tree member's block, this publication block), so a copy
 * of a proof with or without it publishes under the same leaf.
 */
export function publishedChainHash(proof: Record<string, unknown>): string {
  if (!("metadata" in proof)) return computeChainHash(proof);
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(proof)) if (k !== "metadata") out[k] = v;
  return computeChainHash(out);
}

export function checkPublication(proofIn: unknown, opts: PublicationCheckOptions = {}): PublicationCheck {
  const problems: string[] = [];
  const out: PublicationCheck = { ok: false, problems, ceiling: null, floor: null, write: null };
  const proof = proofIn as Record<string, unknown>;
  const b = publicationOf(proof);
  if (!b) { problems.push("the proof carries no bitgraph-publication/1 block"); return out; }
  const commit = (proof["commit"] ?? {}) as { epochId?: string; counter?: string };
  const wantChain = opts.chainId ?? 8453;

  // The proof is the one the block is about.
  const chainHash = publishedChainHash(proof);
  if (chainHash !== b.chainHashB64) problems.push("the block's chain hash is not this proof's");
  if (commit.epochId !== b.epochId || commit.counter !== b.counter) problems.push("the block names a different epoch or count");

  // The write's calldata.
  const calldata = evmHexToBytesSafe(b.calldata);
  const w = calldata ? decodeHourCalldata(calldata) : null;
  if (!calldata || !w) { problems.push("the hourly write's calldata does not decode"); return out; }
  out.write = w;
  if (w.epochId !== b.epochId) problems.push("the write is for a different epoch");
  const count = Number(b.counter);
  if (!(w.leaves > 0 && count >= w.first && count <= w.last)) problems.push("the proof's count is outside the write's range");
  if (!(Number.isInteger(b.leafIndex) && b.leafIndex >= 0 && b.leafIndex < w.leaves)) problems.push("the leaf index is outside the tree");
  else if (rootFromPath(b.chainHashB64, b.leafIndex, w.leaves, b.path) !== w.rootHex) problems.push("the path does not reach the write's root");

  // The write's transaction, its block, and the block's transaction trie.
  const e = b.write;
  try {
    const raw = evmHexToBytes(e.rawTx);
    const tx = decodeEip1559(raw);
    if (tx.hash !== e.txHash.toLowerCase()) problems.push("the raw transaction does not hash to the transaction hash");
    if (evmBytesToHex(tx.data) !== evmBytesToHex(calldata)) problems.push("the transaction does not carry this calldata");
    if (Number(tx.chainId) !== wantChain || e.chainId !== wantChain) problems.push(`the transaction is not on chain ${wantChain}`);
    if (opts.writer !== undefined) {
      if (tx.from !== opts.writer.toLowerCase()) problems.push("the transaction is not from the expected writer");
      if ((tx.to ?? "") !== opts.writer.toLowerCase()) problems.push("the transaction is not sent to the writer itself");
    }
    const header = decodeHeader(evmHexToBytes(e.headerRlp));
    if (header.hash !== e.blockHash.toLowerCase()) problems.push("the header does not hash to the block hash");
    if (header.number !== e.blockNumber || header.timestamp !== e.blockTimestamp) problems.push("the header's number or time differs from the evidence");
    const leaf = mptVerify(evmHexToBytes(header.transactionsRoot), txTrieKey(e.txIndex), e.txInclusionProof.map(evmHexToBytes));
    if (!leaf || evmBytesToHex(leaf) !== evmBytesToHex(raw)) problems.push("the transaction is not in the block's transaction trie at that index");
    out.ceiling = { chainId: e.chainId, blockNumber: header.number, blockHash: header.hash, blockTimestamp: header.timestamp, txHash: tx.hash };
  } catch (err) {
    problems.push(`the write's evidence does not hold together: ${(err as Error).message}`);
  }

  // The floor.
  if (b.floor && (typeof b.floor.proof !== "object" || b.floor.proof === null || typeof b.floor.note !== "string")) {
    problems.push("the floor is malformed");
  } else if (b.floor) {
    const f = b.floor;
    const fp = f.proof;
    // The floor must be a BitGraph of the same epoch, made by the same enclave key. Its own signature and attestation
    // are checked like any proof's: verifyPublication() does both.
    const fKey = (fp["signer"] as { publicKeyB64?: unknown } | undefined)?.publicKeyB64;
    const pKey = (proof["signer"] as { publicKeyB64?: unknown } | undefined)?.publicKeyB64;
    if (typeof fKey !== "string" || fKey !== pKey) problems.push("the floor is not signed by the proof's epoch key");
    const fc = (fp["commit"] ?? {}) as { epochId?: string; counter?: string };
    const fArtifact = (fp["artifact"] ?? {}) as { digestB64?: string };
    const note = parseFloorNote(f.note);
    const fCalldata = evmHexToBytesSafe(f.hourCalldata);
    const fw = fCalldata ? decodeHourCalldata(fCalldata) : null;
    if (!note) problems.push("the floor note does not parse");
    else if (note.chainId !== wantChain) problems.push(`the floor's block is not on chain ${wantChain}`);
    if (fArtifact.digestB64 !== floorNoteDigestB64(f.note)) problems.push("the floor BitGraph does not bind its note");
    if (fc.epochId !== b.epochId) problems.push("the floor is in a different epoch");
    if (!(Number(fc.counter) < count)) problems.push("the floor does not come before the proof");
    if (!fCalldata || !fw) problems.push("the floor's hourly write does not decode");
    else {
      const same = evmBytesToHex(fCalldata) === evmBytesToHex(calldata);
      if (!same && hourLink(fCalldata) !== w.prevLinkHex) problems.push("the floor's write is neither this write nor the one it links back to");
      const fHash = publishedChainHash(fp);
      if (!(Number.isInteger(f.leafIndex) && f.leafIndex >= 0 && f.leafIndex < fw.leaves) || rootFromPath(fHash, f.leafIndex, fw.leaves, f.path) !== fw.rootHex) {
        problems.push("the floor BitGraph is not in its write's tree");
      }
      if (note && note.writeLinkHex !== fw.prevLinkHex) problems.push("the floor names a write other than the one before its tree");
    }
    if (note) out.floor = { chainId: note.chainId, blockNumber: note.blockNumber, blockHash: note.blockHash, blockTimestamp: note.blockTimestamp, floorCounter: String(fc.counter) };
  }

  out.ok = problems.length === 0;
  return out;
}

export interface PublicationVerifyOptions extends PublicationCheckOptions {
  /** Passed to the verifier for both proofs: the accepted measurements, as for any proof. */
  trustAnchors?: Parameters<typeof verifyProofIntegrity>[0]["trustAnchors"];
}

/**
 * checkPublication(), plus the signatures and attestations of the proof and of its floor BitGraph, through the
 * verifier's integrity check. A publication block says nothing unless both proofs are sound, so this is the check to use.
 */
export async function verifyPublication(proofIn: unknown, opts: PublicationVerifyOptions = {}): Promise<PublicationCheck> {
  const out = checkPublication(proofIn, opts);
  const proof = proofIn as Record<string, unknown>;
  const integrity = async (p: Record<string, unknown>, what: string): Promise<void> => {
    try {
      const r = await verifyProofIntegrity({ proof: p as never, ...(opts.trustAnchors ? { trustAnchors: opts.trustAnchors } : {}), context: createVerificationContext() });
      if (!r.valid) out.problems.push(`${what} does not verify: ${(r as { reason?: string }).reason ?? "invalid"}`);
    } catch (e) {
      out.problems.push(`${what} does not verify: ${(e as Error).message}`);
    }
  };
  await integrity(proof, "the proof");
  const b = publicationOf(proof);
  if (b?.floor && typeof b.floor.proof === "object" && b.floor.proof !== null) await integrity(b.floor.proof, "the floor BitGraph");
  out.ok = out.problems.length === 0;
  return out;
}

function evmHexToBytesSafe(h: string): Uint8Array | null {
  if (typeof h !== "string") return null;
  return fromHex(h);
}

// ── the operator's record of each write, and the chain of writes ────────────

/** One hourly write as the operator stores it (publication/hours/... in the ledger). */
export interface HourRecord {
  format: typeof HOUR_RECORD_FORMAT;
  calldata: string;              // 0x hex
  link: string;                  // hex, SHA-256 of the calldata
  write: WriteEvidence;
  /** The BitGraphs the tree holds, in count order. */
  members: Array<{ counter: string; chainHashB64: string }>;
  /** Counts in the range with no BitGraph found when the write was made. */
  missing: string[];
  /** The floor bound right after this write landed, once it exists. */
  floorCounter?: string;
  writtenAt: string;
}

export interface HourChainCheck { ok: boolean; problems: string[]; writes: number; quietHours: number }

/** Check a run of hour records in order: each calldata decodes, its tree is its members, and each links to the one before. */
export function checkHourChain(records: readonly HourRecord[]): HourChainCheck {
  const problems: string[] = [];
  let quiet = 0;
  let prevLink: string | null = null;
  records.forEach((r, i) => {
    const cd = fromHex(r.calldata);
    const w = cd ? decodeHourCalldata(cd) : null;
    if (!cd || !w) { problems.push(`write ${i}: calldata does not decode`); prevLink = null; return; }
    if (hourLink(cd) !== r.link) problems.push(`write ${i}: link is not the calldata's hash`);
    if (prevLink !== null && w.prevLinkHex !== prevLink) problems.push(`write ${i}: does not link to the write before it`);
    if (w.leaves !== r.members.length) problems.push(`write ${i}: leaf count differs from its members`);
    if (w.leaves === 0) quiet++;
    else if (hourTree(r.members.map((m) => m.chainHashB64)).rootHex !== w.rootHex) problems.push(`write ${i}: members do not make its root`);
    prevLink = r.link;
  });
  return { ok: problems.length === 0, problems, writes: records.length, quietHours: quiet };
}
