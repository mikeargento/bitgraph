// Copyright (c) 2024-2026 Argento Computing Inc. Licensed under the MIT License. See LICENSE.

/**
 * Settlement of a Base ceiling on Ethereum: L1 DATA INCLUSION.
 *
 * A Base block's transactions reach Ethereum as batch data: Base's batcher
 * posts blobs (EIP-4844) to the batch inbox address. The blob that carries the
 * batch containing the ceiling transaction was committed by an Ethereum block,
 * so the ceiling transaction's bytes existed by that Ethereum block's time,
 * whatever Base's own state says. This is a ceiling in time with Ethereum as
 * the root, and it arrives minutes after the Base block ("safe"), not after
 * the week-long fault-proof window.
 *
 * Two layers, because Ethereum nodes prune blob bytes after about 18 days and
 * keep only the commitment:
 *
 *   POINTER (this module, offline, no blobs): the Ethereum block header hashes
 *   to its hash; the batcher transaction is in that block (Merkle-Patricia
 *   proof against transactionsRoot); it is a type-3 transaction to the batch
 *   inbox, signed by the batcher; and it lists the blob versioned hashes the
 *   record names. Which addresses are Base's batcher and inbox is a PIN the
 *   verifier supplies; the record never vouches for its own pins.
 *
 *   BLOBS (bitgraph-audit, Node only): with the blob bytes kept beside the
 *   package, each blob is verified against its KZG commitment (versioned hash
 *   = 0x01 || SHA-256(commitment)[1:]), decoded to frames, assembled into the
 *   channel, decompressed, and the Base block and the ceiling transaction are
 *   located inside the batch. That closes the loop from Ethereum's block to the
 *   ceiling transaction's bytes.
 *
 * What it does not prove: that Base's derivation accepted the batch (a posted
 * batch can still be rejected by the rollup rules), and that the Ethereum
 * header is canonical (offline it is taken as given; one lookup confirms it).
 */

import { decodeHeader, hexToBytes, keccak256, mptVerify, txTrieKey, bytesEqual, bytesToHex } from "./ceiling-evm.js";
import { sha256 } from "@noble/hashes/sha256";

export const SETTLEMENT_VERSION = "bitgraph-settlement/1";

/** Base mainnet's batch inbox and batcher on Ethereum mainnet, as pins a verifier names (never read from the record). */
export const BASE_MAINNET_SETTLEMENT_PINS = Object.freeze({
  l1ChainId: 1,
  batchInbox: "0xff00000000000000000000000000000000008453",
  batcher: "0x5050f69a9786f081509234f1a7f4684b5e5b76c9",
});

export interface SettlementPins {
  l1ChainId: number;
  batchInbox: string;
  batcher: string;
}

export interface SettlementBlobRef {
  /** 0x01 || SHA-256(kzgCommitment)[1:], as the transaction lists it. */
  versionedHash: string;
  /** 48-byte KZG commitment, 0x hex. */
  kzgCommitment: string;
  /** Index among the transaction's blobs. */
  index: number;
  /** Where the blob bytes are kept beside the package (a file name), when they are. */
  file?: string;
}

/** The record a ceiling carries once its Base block's batch is on Ethereum. */
export interface SettlementPointer {
  version: typeof SETTLEMENT_VERSION;
  /** The Base block the ceiling transaction is in. */
  baseBlockNumber: number;
  baseBlockHash: string;
  l1: {
    chainId: number;
    txHash: string;
    /** The signed type-3 transaction without its blobs (the network form), 0x hex. */
    rawTx: string;
    blockNumber: number;
    blockHash: string;
    blockTimestamp: number;
    /** RLP, 0x hex; hashes to blockHash. */
    blockHeader: string;
    txIndex: number;
    /** Merkle-Patricia proof of rawTx in the header's transactionsRoot. */
    txInclusionProof: string[];
  };
  /** Every blob of that transaction that carries a frame of the channel holding this Base block. */
  blobs: SettlementBlobRef[];
  /** The channel the Base block was found in, for readers that decode the blobs. */
  channel?: { id: string; frames: number; compression: "brotli" | "zlib"; firstBaseBlock: number; lastBaseBlock: number };
  /** Where the ceiling transaction's bytes sit, once located by the blob layer. */
  located?: { baseTxIndex: number; txHash: string };
}

export interface SettlementCheck {
  name: string;
  ok: boolean;
  detail?: string;
}

export interface SettlementPointerResult {
  ok: boolean;
  reason?: string;
  checks: SettlementCheck[];
  /** The Ethereum block's time, read from the verified header; the ceiling transaction existed by it. */
  existedBy: { blockNumber: number; blockHash: string; blockTimestamp: number } | null;
  /** Always false here: the header is taken as given offline; see checkSettlementOnline. */
  headerCheckedAgainstChain: false;
}

/**
 * Offline checks of the pointer, no blobs needed. `expectBlobs` is the list of
 * versioned hashes the ceiling record names (all of the pointer's `blobs`
 * when the caller has no other source).
 */
export function verifySettlementPointer(pointer: SettlementPointer, pins: SettlementPins): SettlementPointerResult {
  const checks: SettlementCheck[] = [];
  const fail = (name: string, detail: string): SettlementPointerResult => {
    checks.push({ name, ok: false, detail });
    return { ok: false, reason: `${name}: ${detail}`, checks, existedBy: null, headerCheckedAgainstChain: false };
  };
  const pass = (name: string, detail?: string) => checks.push(detail === undefined ? { name, ok: true } : { name, ok: true, detail });

  if (pointer?.version !== SETTLEMENT_VERSION) return fail("format", `not a ${SETTLEMENT_VERSION} record`);
  const l1 = pointer.l1;
  if (!l1 || typeof l1 !== "object") return fail("format", "no l1 section");
  if (l1.chainId !== pins.l1ChainId) return fail("chain", `the record names chain ${l1.chainId}, expected ${pins.l1ChainId}`);

  // 1. The header is the one with that hash, and its time is the bound.
  let header;
  try {
    header = decodeHeader(hexToBytes(l1.blockHeader));
  } catch (e) {
    return fail("header", (e as Error).message);
  }
  if (header.hash !== l1.blockHash.toLowerCase()) return fail("header", "the header does not hash to blockHash");
  if (header.number !== l1.blockNumber) return fail("header", `the header is block ${header.number}, the record says ${l1.blockNumber}`);
  if (header.timestamp !== l1.blockTimestamp) return fail("header", `the header's timestamp is ${header.timestamp}, the record says ${l1.blockTimestamp}`);
  pass("header", `Ethereum block ${header.number} hashes to its hash`);

  // 2. The batcher transaction is in the block.
  let rawTx: Uint8Array;
  try {
    rawTx = hexToBytes(l1.rawTx);
  } catch (e) {
    return fail("transaction", (e as Error).message);
  }
  const txHash = "0x" + bytesToHex(keccak256(rawTx));
  if (txHash !== l1.txHash.toLowerCase()) return fail("transaction", "the raw transaction does not hash to txHash");
  const inBlock = mptVerify(hexToBytes(header.transactionsRoot), txTrieKey(l1.txIndex), l1.txInclusionProof.map(hexToBytes));
  if (!inBlock || !bytesEqual(inBlock, rawTx)) return fail("inclusion", "the transaction is not in this block");
  pass("inclusion", `transaction ${l1.txIndex} of block ${header.number}`);

  // 3. It is a blob transaction to the batch inbox, from the batcher, listing the blobs.
  let tx: Eip4844Tx;
  try {
    tx = decodeEip4844(rawTx);
  } catch (e) {
    return fail("transaction", (e as Error).message);
  }
  if (tx.chainId !== BigInt(pins.l1ChainId)) return fail("chain", `the transaction is for chain ${tx.chainId}`);
  if (tx.to !== pins.batchInbox.toLowerCase()) return fail("inbox", `the transaction is addressed to ${tx.to}, not the batch inbox`);
  if (tx.from !== pins.batcher.toLowerCase()) return fail("batcher", `the transaction was signed by ${tx.from}, not the batcher`);
  const listed = new Set(tx.blobVersionedHashes.map((h) => h.toLowerCase()));
  if (!Array.isArray(pointer.blobs) || pointer.blobs.length === 0) return fail("blobs", "the record names no blobs");
  for (const b of pointer.blobs) {
    const vh = b.versionedHash.toLowerCase();
    if (!listed.has(vh)) return fail("blobs", `blob ${vh.slice(0, 18)}… is not listed by the transaction`);
    const expect = versionedHashOf(hexToBytes(b.kzgCommitment));
    if (expect !== vh) return fail("blobs", `blob ${vh.slice(0, 18)}…: the versioned hash is not 0x01 || SHA-256(commitment)[1:]`);
  }
  pass("blobs", `${pointer.blobs.length} blob commitment${pointer.blobs.length === 1 ? "" : "s"} listed by the transaction`);

  return {
    ok: true,
    checks,
    existedBy: { blockNumber: header.number, blockHash: header.hash, blockTimestamp: header.timestamp },
    headerCheckedAgainstChain: false,
  };
}

/** 0x01 || SHA-256(commitment)[1:], lowercase 0x hex. */
export function versionedHashOf(kzgCommitment: Uint8Array): string {
  const h = sha256(kzgCommitment);
  h[0] = 0x01;
  return "0x" + bytesToHex(h);
}

/** The one online question: is that Ethereum header the chain's own block? `getBlockHash` is injected; this module never fetches. */
export async function checkSettlementOnline(
  pointer: SettlementPointer,
  getBlockHash: (blockNumber: number) => Promise<string | null>,
): Promise<{ ok: boolean; detail: string }> {
  const chainHash = await getBlockHash(pointer.l1.blockNumber);
  if (chainHash === null) return { ok: false, detail: `the node has no block ${pointer.l1.blockNumber}` };
  if (chainHash.toLowerCase() !== pointer.l1.blockHash.toLowerCase()) return { ok: false, detail: `the node's block ${pointer.l1.blockNumber} is ${chainHash}, not the record's header` };
  return { ok: true, detail: `Ethereum block ${pointer.l1.blockNumber} confirmed against the node` };
}

/* ── EIP-4844 (type 3) transaction decoding, network form without blobs ─── */

import { rlpDecode, rlpEncode, rlpUint, type RlpItem } from "./ceiling-evm.js";
import { secp256k1 } from "@noble/curves/secp256k1.js";

export interface Eip4844Tx {
  chainId: bigint;
  nonce: bigint;
  to: string | null;
  data: Uint8Array;
  blobVersionedHashes: string[];
  /** Address recovered from the signature, lowercase 0x hex. */
  from: string;
  /** keccak256 of the raw transaction: its hash on chain. */
  hash: string;
}

function asList(item: RlpItem | undefined, what: string): RlpItem[] {
  if (!Array.isArray(item)) throw new TypeError(`${what}: expected a list`);
  return item;
}
function asBytes(item: RlpItem | undefined, what: string): Uint8Array {
  if (!(item instanceof Uint8Array)) throw new TypeError(`${what}: expected bytes`);
  return item;
}

/**
 * Decode a signed type-3 transaction, 0x03 || rlp([chain_id, nonce,
 * max_priority_fee_per_gas, max_fee_per_gas, gas_limit, to, value, data,
 * access_list, max_fee_per_blob_gas, blob_versioned_hashes, y_parity, r, s]),
 * and recover its sender. This is the network form the block's trie holds;
 * the blob-carrying wrapper is not accepted.
 */
export function decodeEip4844(raw: Uint8Array): Eip4844Tx {
  if (raw.length < 2 || raw[0] !== 0x03) throw new TypeError("tx: not an EIP-4844 (type 3) transaction");
  const f = asList(rlpDecode(raw.slice(1)), "tx");
  if (f.length !== 14) throw new TypeError("tx: a type-3 transaction has 14 fields");
  const chainId = rlpUint(f[0], "tx.chainId");
  const nonce = rlpUint(f[1], "tx.nonce");
  const toBytes = asBytes(f[5], "tx.to");
  if (toBytes.length !== 20) throw new TypeError("tx: a blob transaction names a recipient");
  const data = asBytes(f[7], "tx.data");
  asList(f[8], "tx.accessList");
  const hashes = asList(f[10], "tx.blobVersionedHashes").map((h) => "0x" + bytesToHex(asBytes(h, "tx.blobVersionedHashes[]")));
  if (hashes.length === 0) throw new TypeError("tx: a blob transaction lists at least one blob");
  const yParity = rlpUint(f[11], "tx.yParity");
  const r = rlpUint(f[12], "tx.r");
  const s = rlpUint(f[13], "tx.s");
  if (yParity > 1n) throw new TypeError("tx: yParity must be 0 or 1");
  const unsigned = rlpEncode(f.slice(0, 11));
  const preimage = new Uint8Array(1 + unsigned.length);
  preimage[0] = 0x03;
  preimage.set(unsigned, 1);
  const signingHash = keccak256(preimage);
  const compact = hexToBytes(r.toString(16).padStart(64, "0") + s.toString(16).padStart(64, "0"));
  const sig = secp256k1.Signature.fromBytes(compact, "compact");
  if (sig.hasHighS()) throw new TypeError("tx: high-s signature");
  const pub = sig.addRecoveryBit(Number(yParity)).recoverPublicKey(signingHash).toBytes(false);
  const from = "0x" + bytesToHex(keccak256(pub.slice(1)).slice(12));
  return { chainId, nonce, to: "0x" + bytesToHex(toBytes), data, blobVersionedHashes: hashes, from, hash: "0x" + bytesToHex(keccak256(raw)) };
}
