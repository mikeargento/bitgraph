// Copyright (c) 2024-2026 Argento Computing Inc. Licensed under the MIT License. See LICENSE.

/**
 * bitgraph-epoch-genesis/1: an epoch opens with a write to Base, not a read of it.
 *
 * A block read bound as an epoch's first BitGraph proves the epoch began after that block, but the host chooses
 * the block, so an old one makes the floor loose, and nothing in the proofs says how old. With a genesis
 * transaction the choice is gone. The host puts the new epoch's id in a Base transaction from the ceiling writer's
 * address, waits for it to be mined, and binds a record of the mined transaction as the epoch's first BitGraph.
 *
 *   - The transaction carries the epoch id, which is derived from the epoch's key, so the transaction could not be
 *     made before the key existed: the key is older than the block that holds the transaction.
 *   - BitGraph 1 binds the mined transaction, so it could not be made before that block: every BitGraph of the
 *     epoch is younger than that block.
 *
 * Epochs therefore order by their genesis blocks on Base alone, and the transactions are a public list of every
 * epoch the writer opened. Calldata is "BGE1" followed by the 32 raw bytes of the epoch id. The record is a small
 * JSON file whose SHA-256 BitGraph 1 binds; this module makes, parses and checks it.
 */

import { sha256 } from "@noble/hashes/sha256";
import type { BitGraphProof } from "./types.js";

export const EPOCH_GENESIS_FORMAT = "bitgraph-epoch-genesis/1" as const;
export const EPOCH_GENESIS_REQUEST_FORMAT = "bitgraph-epoch-genesis-request/1" as const;
export const EPOCH_GENESIS_MAGIC = "BGE1";

export interface EpochGenesisFile {
  format: typeof EPOCH_GENESIS_FORMAT;
  epochId: string;
  chain: "base-mainnet" | "base-sepolia";
  chainId: 8453 | 84532;
  /** The sending (and receiving) address, lowercase 0x hex: the ceiling writer's. */
  writer: string;
  txHash: string;
  blockNumber: number;
  blockHash: string;
  blockTimestamp: number;
  note: string;
}

const enc = new TextEncoder();

function b64ToBytes(s: string): Uint8Array | null {
  if (!/^[A-Za-z0-9+/]*={0,2}$/.test(s) || s.length % 4 !== 0) return null;
  const bin = typeof atob === "function" ? atob(s) : Buffer.from(s, "base64").toString("binary");
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

function bytesToB64(u: Uint8Array): string {
  let bin = "";
  for (const x of u) bin += String.fromCharCode(x);
  return typeof btoa === "function" ? btoa(bin) : Buffer.from(bin, "binary").toString("base64");
}

const hex = (u: Uint8Array): string => Array.from(u, (b) => b.toString(16).padStart(2, "0")).join("");

/** "BGE1" || the 32 raw bytes of the epoch id: what the genesis transaction carries. */
export function epochGenesisCalldata(epochId: string): Uint8Array {
  const id = b64ToBytes(epochId);
  if (id === null || id.length !== 32) throw new TypeError("an epoch id is 32 bytes in standard base64");
  const out = new Uint8Array(4 + 32);
  out.set(enc.encode(EPOCH_GENESIS_MAGIC), 0);
  out.set(id, 4);
  return out;
}

/** The calldata as 0x hex, as a node reports a transaction's input. */
export function epochGenesisCalldataHex(epochId: string): string {
  return "0x" + hex(epochGenesisCalldata(epochId));
}

/** The epoch id carried by calldata, or null when the bytes are not a genesis. */
export function epochIdOfCalldata(input: string | Uint8Array): string | null {
  let bytes: Uint8Array;
  if (typeof input === "string") {
    const h = input.startsWith("0x") ? input.slice(2) : input;
    if (!/^[0-9a-fA-F]*$/.test(h) || h.length % 2 !== 0) return null;
    bytes = new Uint8Array(h.length / 2);
    for (let i = 0; i < bytes.length; i++) bytes[i] = parseInt(h.slice(i * 2, i * 2 + 2), 16);
  } else bytes = input;
  if (bytes.length !== 36) return null;
  for (let i = 0; i < 4; i++) if (bytes[i] !== EPOCH_GENESIS_MAGIC.charCodeAt(i)) return null;
  return bytesToB64(bytes.slice(4));
}

const CHAIN_NAMES = { 8453: "base-mainnet", 84532: "base-sepolia" } as const;

/** The file's text, byte for byte, as the writer makes it and the epoch's first BitGraph binds it. */
export function epochGenesisFileText(f: Omit<EpochGenesisFile, "format" | "chain" | "note">): string {
  const chain = CHAIN_NAMES[f.chainId];
  const body: EpochGenesisFile = {
    format: EPOCH_GENESIS_FORMAT,
    epochId: f.epochId,
    chain,
    chainId: f.chainId,
    writer: f.writer.toLowerCase(),
    txHash: f.txHash.toLowerCase(),
    blockNumber: f.blockNumber,
    blockHash: f.blockHash.toLowerCase(),
    blockTimestamp: f.blockTimestamp,
    note: `The first BitGraph of this epoch. Base transaction ${f.txHash.toLowerCase()} carries this epoch's id and was mined in block ${f.blockNumber}, so this epoch's key existed before that block and every BitGraph of this epoch was made after it.`,
  };
  return JSON.stringify(body, null, 2) + "\n";
}

/** Strict: the format, a 32-byte epoch id, a known chain, hex hashes, integers. Null otherwise. */
export function parseEpochGenesisFile(text: string): EpochGenesisFile | null {
  let o: Record<string, unknown>;
  try { o = JSON.parse(text) as Record<string, unknown>; } catch { return null; }
  if (!o || typeof o !== "object" || o["format"] !== EPOCH_GENESIS_FORMAT) return null;
  const epochId = o["epochId"];
  if (typeof epochId !== "string" || b64ToBytes(epochId)?.length !== 32) return null;
  const chainId = o["chainId"];
  if (chainId !== 8453 && chainId !== 84532) return null;
  if (o["chain"] !== CHAIN_NAMES[chainId]) return null;
  const writer = o["writer"], txHash = o["txHash"], blockHash = o["blockHash"];
  if (typeof writer !== "string" || !/^0x[0-9a-f]{40}$/.test(writer)) return null;
  if (typeof txHash !== "string" || !/^0x[0-9a-f]{64}$/.test(txHash)) return null;
  if (typeof blockHash !== "string" || !/^0x[0-9a-f]{64}$/.test(blockHash)) return null;
  const blockNumber = o["blockNumber"], blockTimestamp = o["blockTimestamp"];
  if (!Number.isSafeInteger(blockNumber) || (blockNumber as number) < 0) return null;
  if (!Number.isSafeInteger(blockTimestamp) || (blockTimestamp as number) < 0) return null;
  const note = typeof o["note"] === "string" ? o["note"] : "";
  return { format: EPOCH_GENESIS_FORMAT, epochId, chain: CHAIN_NAMES[chainId], chainId, writer, txHash, blockNumber: blockNumber as number, blockHash, blockTimestamp: blockTimestamp as number, note };
}

/** What a node says about the transaction, from eth_getTransactionByHash. */
export interface EpochGenesisTx {
  from: string;
  to: string | null;
  input: string;
  blockHash: string | null;
  blockNumber: number | null;
}

/** What a node says about the block, from eth_getBlockByHash. */
export interface EpochGenesisBlock {
  hash: string;
  number: number;
  timestamp: number;
}

export interface EpochGenesisCheck {
  ok: boolean;
  reasons: string[];
  genesis: EpochGenesisFile | null;
}

/**
 * Check a genesis record against the epoch's first BitGraph and, when given, against what Base says.
 *
 * The file must hash to the proof's digest; the proof must be the epoch's first (counts 1 and 2) and name the
 * file's epoch; the transaction, when supplied, must be the writer's self-addressed transaction carrying this
 * epoch's id, mined in the block the file names; the block, when supplied, must be that block with that time.
 * Without `tx` and `block` only the file and the proof are checked (offline).
 *
 * `position: "any"` drops the counts-1-and-2 rule, for a timeline epoch that read blocks and bound files while the
 * Base write was still pending: its genesis record is the first record that ends pre-genesis, wherever it falls.
 */
export function checkEpochGenesis(args: { file: string; proof: BitGraphProof; tx?: EpochGenesisTx | null; block?: EpochGenesisBlock | null; position?: "first" | "any" }): EpochGenesisCheck {
  const reasons: string[] = [];
  const genesis = parseEpochGenesisFile(args.file);
  if (!genesis) return { ok: false, reasons: ["the file is not a bitgraph-epoch-genesis/1 record"], genesis: null };
  const digest = bytesToB64(sha256(enc.encode(args.file)));
  if (digest !== args.proof.artifact?.digestB64) reasons.push("the file does not hash to the proof's digest");
  const commit = args.proof.commit as { counter?: string; slotCounter?: string; epochId?: string };
  if (commit.epochId !== genesis.epochId) reasons.push("the proof is not of the epoch the file names");
  if (args.position !== "any" && (commit.slotCounter !== "1" || commit.counter !== "2")) reasons.push("the proof is not the epoch's first BitGraph (counts 1 and 2)");
  if (args.tx) {
    const t = args.tx;
    if (t.from.toLowerCase() !== genesis.writer) reasons.push("the transaction was not sent by the writer the file names");
    if ((t.to ?? "").toLowerCase() !== genesis.writer) reasons.push("the transaction is not self-addressed to the writer");
    if (t.input.toLowerCase() !== epochGenesisCalldataHex(genesis.epochId)) reasons.push("the transaction does not carry this epoch's id");
    if ((t.blockHash ?? "").toLowerCase() !== genesis.blockHash) reasons.push("the transaction is not in the block the file names");
    if (t.blockNumber !== null && t.blockNumber !== genesis.blockNumber) reasons.push("the transaction's block number is not the one the file names");
  }
  if (args.block) {
    const b = args.block;
    if (b.hash.toLowerCase() !== genesis.blockHash) reasons.push("Base's block hash differs from the file's");
    if (b.number !== genesis.blockNumber) reasons.push("Base's block number differs from the file's");
    if (b.timestamp !== genesis.blockTimestamp) reasons.push("Base's block time differs from the file's");
  }
  return { ok: reasons.length === 0, reasons, genesis };
}
