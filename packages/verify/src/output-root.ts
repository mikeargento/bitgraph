// Copyright (c) 2024-2026 Argento Computing Inc. Licensed under the MIT License. See LICENSE.

/**
 * bitgraph-output-root/1: settling a Base ceiling on Ethereum without blobs
 * (2026-10-03).
 *
 * A Base ceiling is a transaction in Base block B. Base posts an OUTPUT ROOT
 * for one of its blocks P to Ethereum about every 600 Base blocks, as the
 * rootClaim of a dispute game:
 *
 *   outputRoot = keccak256(version (32 zero bytes) || stateRoot_P || messagePasserStorageRoot_P || blockHash_P)
 *
 * Base runs the EIP-2935 history contract, which keeps the hashes of the
 * previous 8,191 blocks in its storage, so B's hash is provable from P's state
 * when 1 <= P - B <= 8,191 (the contract holds earlier blocks only). When
 * B = P the output root names P's hash directly.
 *
 * The chain this module checks, every link by hash:
 *   Ethereum tx in block H carries outputRoot
 *     -> outputRoot preimage (stateRoot_P, blockHash_P)
 *     -> B's hash (from P's state by storage proof, or blockHash_P when B = P)
 *     -> B's header (checked by the ceiling sidecar)
 *
 * What it proves: the ceiling transaction, and so the root it carries, existed
 * by Ethereum block H. Any Ethereum transaction whose bytes commit to the
 * output root by hash proves that, whoever sent it and whether or not Base's
 * claim is ever upheld; so the sender and the game's outcome are not checked.
 * What it does NOT prove: that B is canonical on Base, or B's timestamp. Those
 * need Base itself (checkCeilingOnline). Whether H is canonical is the one
 * outside lookup this leaves.
 */

import { bytesEqual, decodeHeader, hexToBytes, bytesToHex, keccak256, mptVerify, rlpDecode, txTrieKey, type RlpItem } from "./ceiling-evm.js";

export const OUTPUT_ROOT_VERSION = "bitgraph-output-root/1" as const;
/** EIP-2935 history storage contract (the same address on Ethereum and on OP Stack chains). */
export const HISTORY_STORAGE_ADDRESS = "0x0000f90827f1c53a10cb7a02335b175320002935" as const;
/** EIP-2935 ring buffer size: the contract keeps the previous 8,191 block hashes. */
export const HISTORY_SERVE_WINDOW = 8191;
/** Base mainnet's dispute game factory on Ethereum (OptimismPortal 0x49048044D57e1C92A77f79988d21Fa8fAF74E97e). Informational. */
export const BASE_DISPUTE_GAME_FACTORY = "0x43edb88c4b80fdd2adff2412a7bebf9df42cb40e" as const;

export interface OutputRootSettlement {
  version: typeof OUTPUT_ROOT_VERSION;
  /** The ceiling's Base block: number and hash (the hash is also the ceiling sidecar's). */
  base: { chainId: number; blockNumber: number; blockHash: string };
  /** The output-root preimage for Base block P. */
  outputRoot: {
    blockNumber: number;
    /** 32 bytes, all zero for output-root version 0. */
    version: string;
    stateRoot: string;
    messagePasserStorageRoot: string;
    blockHash: string;
  };
  /** B's hash in P's state. Null exactly when B = P. */
  history: {
    address: string;
    /** uint256(B mod 8191), 32 bytes. */
    slot: string;
    accountProof: string[];
    storageProof: string[];
  } | null;
  /** The Ethereum transaction that carries the output root, and its block. */
  ethereum: {
    chainId: number;
    blockNumber: number;
    blockHash: string;
    blockTimestamp: number;
    header: string;
    txHash: string;
    txIndex: number;
    rawTx: string;
    txInclusionProof: string[];
  };
  /** Informational, never verified: which dispute game this was. */
  game?: { factory: string; gameType: number; index: number; proxy: string };
}

export interface OutputRootCheck { name: string; ok: boolean; detail?: string }

export interface OutputRootVerifyResult {
  ok: boolean;
  reason?: string;
  checks: OutputRootCheck[];
  /** On success: the ceiling transaction existed by this Ethereum block. Canonicality of the block is not checked here. */
  existedBy?: { chainId: number; blockNumber: number; blockHash: string; blockTimestamp: number };
  /** The output root that was recomputed (0x hex). */
  outputRootHex?: string;
}

const ZERO32 = new Uint8Array(32);

function b32(hex: string, name: string): Uint8Array {
  const b = hexToBytes(hex);
  if (b.length !== 32) throw new TypeError(`${name} must be 32 bytes`);
  return b;
}

/** keccak256(version || stateRoot || messagePasserStorageRoot || blockHash). */
export function computeOutputRoot(o: OutputRootSettlement["outputRoot"]): Uint8Array {
  const parts = [b32(o.version, "outputRoot.version"), b32(o.stateRoot, "outputRoot.stateRoot"), b32(o.messagePasserStorageRoot, "outputRoot.messagePasserStorageRoot"), b32(o.blockHash, "outputRoot.blockHash")];
  const pre = new Uint8Array(128);
  parts.forEach((p, i) => pre.set(p, i * 32));
  return keccak256(pre);
}

/** The EIP-2935 storage slot holding block n's hash: uint256(n mod 8191), big-endian. */
export function historySlot(blockNumber: number): Uint8Array {
  const slot = new Uint8Array(32);
  let v = blockNumber % HISTORY_SERVE_WINDOW;
  for (let i = 31; i >= 0 && v > 0; i--) {
    slot[i] = v & 0xff;
    v = Math.floor(v / 256);
  }
  return slot;
}

function indexOfBytes(hay: Uint8Array, needle: Uint8Array): number {
  outer: for (let i = 0; i + needle.length <= hay.length; i++) {
    for (let j = 0; j < needle.length; j++) if (hay[i + j] !== needle[j]) continue outer;
    return i;
  }
  return -1;
}

/** RLP bytes as an unsigned integer value padded to 32 bytes (storage values are RLP of the minimal big-endian bytes). */
function storageWord(item: RlpItem): Uint8Array | null {
  if (!(item instanceof Uint8Array) || item.length > 32) return null;
  const out = new Uint8Array(32);
  out.set(item, 32 - item.length);
  return out;
}

/**
 * Verify an output-root settlement, offline. Every link is recomputed from
 * bytes; the result names the Ethereum block whose canonicality is the one
 * remaining lookup.
 */
export interface OutputRootVerifyOptions {
  /** The chain the ceiling is on. Default Base mainnet, 8453. */
  baseChainId?: number;
  /** The chain the settlement is on. Default Ethereum mainnet, 1. */
  ethereumChainId?: number;
}

/** The chain a raw Ethereum transaction is signed for: field 0 of a typed transaction, or EIP-155's v. Null when it names none. */
function transactionChainId(raw: Uint8Array): bigint | null {
  if (raw.length === 0) return null;
  const big = (b: Uint8Array) => b.reduce((n, x) => (n << 8n) | BigInt(x), 0n);
  try {
    if (raw[0]! <= 0x7f) {
      const item = rlpDecode(raw.subarray(1));
      return Array.isArray(item) && item[0] instanceof Uint8Array ? big(item[0]) : null;
    }
    const item = rlpDecode(raw);
    if (!Array.isArray(item) || item.length !== 9 || !(item[6] instanceof Uint8Array)) return null;
    const v = big(item[6]);
    return v >= 35n ? (v - 35n) / 2n : null;
  } catch {
    return null;
  }
}

export function verifyOutputRootSettlement(s: OutputRootSettlement, opts: OutputRootVerifyOptions = {}): OutputRootVerifyResult {
  const checks: OutputRootCheck[] = [];
  const fail = (name: string, detail: string): OutputRootVerifyResult => {
    checks.push({ name, ok: false, detail });
    return { ok: false, reason: `${name}: ${detail}`, checks };
  };
  // A malformed field anywhere is a failed check, never an exception.
  try {
    return verifyOutputRootChecks(s, opts, checks, fail);
  } catch (e) {
    return fail("malformed", `a field of the settlement is malformed: ${e instanceof Error ? e.message : String(e)}`);
  }
}

function verifyOutputRootChecks(
  s: OutputRootSettlement,
  opts: OutputRootVerifyOptions,
  checks: OutputRootCheck[],
  fail: (name: string, detail: string) => OutputRootVerifyResult,
): OutputRootVerifyResult {
  const pass = (name: string, detail?: string) => checks.push(detail === undefined ? { name, ok: true } : { name, ok: true, detail });

  if (s?.version !== OUTPUT_ROOT_VERSION) return fail("format", `not a ${OUTPUT_ROOT_VERSION} settlement`);

  // 0. The chains: the labels are part of what the result reports, so they are checked, never echoed.
  const baseChain = opts.baseChainId ?? 8453;
  const l1Chain = opts.ethereumChainId ?? 1;
  if (s.base?.chainId !== baseChain) return fail("chain", `the settlement is for chain ${String(s.base?.chainId)}; this verifier settles Base ${baseChain}`);
  if (s.ethereum?.chainId !== l1Chain) return fail("chain", `the settlement names chain ${String(s.ethereum?.chainId)}; this verifier settles on Ethereum ${l1Chain}`);

  // 1. The output root from its preimage.
  let outputRoot: Uint8Array;
  try {
    if (!bytesEqual(b32(s.outputRoot.version, "outputRoot.version"), ZERO32)) return fail("output-root", "only output-root version 0 (32 zero bytes) is defined");
    outputRoot = computeOutputRoot(s.outputRoot);
  } catch (e) {
    return fail("output-root", (e as Error).message);
  }
  pass("output-root", `${bytesToHex(outputRoot)} for Base block ${s.outputRoot.blockNumber}`);

  // 2. B's hash from P: directly when B = P, else by EIP-2935 storage proof.
  const B = s.base.blockNumber;
  const P = s.outputRoot.blockNumber;
  let bHash: Uint8Array;
  try {
    bHash = b32(s.base.blockHash, "base.blockHash");
  } catch (e) {
    return fail("base", (e as Error).message);
  }
  if (!Number.isInteger(B) || !Number.isInteger(P) || B < 0) return fail("base", "block numbers must be non-negative integers");
  if (B === P) {
    if (s.history !== null) return fail("history", "B = P needs no history proof, and one was given");
    if (!bytesEqual(b32(s.outputRoot.blockHash, "outputRoot.blockHash"), bHash)) return fail("history", "B = P, but the output root names a different block hash");
    pass("history", `B = P: the output root names block ${B}'s hash directly`);
  } else {
    const d = P - B;
    if (d < 1 || d > HISTORY_SERVE_WINDOW) return fail("history", `P - B is ${d}; the history contract holds blocks 1 to ${HISTORY_SERVE_WINDOW} before P`);
    const h = s.history;
    if (!h) return fail("history", "B < P needs a history storage proof");
    if (h.address.toLowerCase() !== HISTORY_STORAGE_ADDRESS) return fail("history", `the proof is for ${h.address}, not the EIP-2935 contract`);
    let slot: Uint8Array;
    try {
      slot = b32(h.slot, "history.slot");
    } catch (e) {
      return fail("history", (e as Error).message);
    }
    if (!bytesEqual(slot, historySlot(B))) return fail("history", `the slot is not B mod ${HISTORY_SERVE_WINDOW}`);
    let account: Uint8Array | null;
    try {
      account = mptVerify(b32(s.outputRoot.stateRoot, "outputRoot.stateRoot"), keccak256(hexToBytes(HISTORY_STORAGE_ADDRESS)), h.accountProof.map(hexToBytes));
    } catch {
      account = null;
    }
    if (!account) return fail("history", "the account proof does not reach P's state root");
    let storageRoot: Uint8Array;
    try {
      const fields = rlpDecode(account);
      if (!Array.isArray(fields) || fields.length !== 4 || !(fields[2] instanceof Uint8Array) || fields[2].length !== 32) throw new TypeError("account");
      storageRoot = fields[2];
    } catch {
      return fail("history", "the account record is not [nonce, balance, storageRoot, codeHash]");
    }
    let raw: Uint8Array | null;
    try {
      raw = mptVerify(storageRoot, keccak256(slot), h.storageProof.map(hexToBytes));
    } catch {
      raw = null;
    }
    if (!raw) return fail("history", "the storage proof does not reach the contract's storage root");
    let word: Uint8Array | null;
    try {
      word = storageWord(rlpDecode(raw));
    } catch {
      word = null;
    }
    if (!word || !bytesEqual(word, bHash)) return fail("history", `P's state does not hold block ${B}'s hash at that slot`);
    pass("history", `block ${B}'s hash is in block ${P}'s state (${d} blocks back)`);
  }

  // 3. The Ethereum transaction carries the output root, and is in block H.
  const e = s.ethereum;
  let header;
  try {
    header = decodeHeader(hexToBytes(e.header));
  } catch (err) {
    return fail("ethereum", `header: ${(err as Error).message}`);
  }
  if (header.hash !== e.blockHash.toLowerCase()) return fail("ethereum", "the header does not hash to blockHash");
  if (header.number !== e.blockNumber) return fail("ethereum", `the header is block ${header.number}, the settlement says ${e.blockNumber}`);
  if (header.timestamp !== e.blockTimestamp) return fail("ethereum", `the header's timestamp is ${header.timestamp}, the settlement says ${e.blockTimestamp}`);
  let rawTx: Uint8Array;
  try {
    rawTx = hexToBytes(e.rawTx);
  } catch {
    return fail("ethereum", "rawTx is not hex");
  }
  if (bytesToHex(keccak256(rawTx)) !== e.txHash.toLowerCase()) return fail("ethereum", "the raw transaction does not hash to txHash");
  const txChain = transactionChainId(rawTx);
  if (txChain === null) return fail("ethereum", "the transaction names no chain (a legacy transaction without EIP-155)");
  if (txChain !== BigInt(l1Chain)) return fail("ethereum", `the transaction is signed for chain ${txChain}, not Ethereum ${l1Chain}`);
  let inBlock: Uint8Array | null;
  try {
    inBlock = mptVerify(hexToBytes(header.transactionsRoot), txTrieKey(e.txIndex), e.txInclusionProof.map(hexToBytes));
  } catch {
    inBlock = null;
  }
  if (!inBlock || !bytesEqual(inBlock, rawTx)) return fail("ethereum", "the transaction is not in this block");
  if (indexOfBytes(rawTx, outputRoot) < 0) return fail("ethereum", "the transaction's bytes do not contain the output root");
  pass("ethereum", `transaction ${e.txIndex} of Ethereum block ${header.number} carries the output root`);

  return {
    ok: true,
    checks,
    existedBy: { chainId: e.chainId, blockNumber: header.number, blockHash: header.hash, blockTimestamp: header.timestamp },
    outputRootHex: bytesToHex(outputRoot),
  };
}
