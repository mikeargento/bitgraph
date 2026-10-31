// Copyright (c) 2024-2026 Argento Computing Inc. Licensed under the MIT License. See LICENSE.

/**
 * bitgraph-block-read/1: a read of a public chain's block, bound as a plain BitGraph.
 *
 * The host reads the newest block of Base, Ethereum or Bitcoin and binds the SHA-256 of a small JSON file naming
 * it, the same bind as any file: a fresh nonce at count N, the file's digest at N+1. Block reads and files share
 * one counter sequence, so a file's floor is the nearest block read before it and its ceiling the nearest block
 * read after it. The block read cannot predate its block, because a block hash cannot be known before its block.
 *
 * The file names the chain (CAIP-2), the block's number, hash and timestamp, and the epoch, so no two epochs bind
 * the same file. Only the hash is evidence. A verifier never takes the number or the timestamp from the file: it
 * looks the hash up on the chain itself and takes both from there, and a hash that is not on the canonical chain
 * fails (checkBlockRead). The file's number and timestamp are labels, and a file whose labels disagree with the
 * chain fails too, because the host that wrote it misreported the block.
 *
 * Nothing here fetches anything; the caller supplies what the chain says.
 */

import { sha256 } from "@noble/hashes/sha256";
import type { BitGraphProof } from "./types.js";

export const BLOCK_READ_FORMAT = "bitgraph-block-read/1" as const;

export type BlockReadChain = "base" | "ethereum" | "bitcoin";

/** Each chain's CAIP-2 ids, mainnet first. The test networks are for local runs. */
export const BLOCK_READ_CHAIN_IDS: Readonly<Record<BlockReadChain, readonly string[]>> = {
  base: ["eip155:8453", "eip155:84532"],
  ethereum: ["eip155:1", "eip155:11155111"],
  bitcoin: ["bip122:000000000019d6689c085ae165831e93"],
};

export interface BlockReadFile {
  format: typeof BLOCK_READ_FORMAT;
  epochId: string;
  chain: BlockReadChain;
  chainId: string;
  number: number;
  /** As the chain shows it: 0x and 64 lowercase hex on Base and Ethereum, 64 lowercase hex on Bitcoin. */
  hash: string;
  /** The block's own timestamp, Unix seconds. */
  timestamp: number;
}

const enc = new TextEncoder();

/** A block hash in the chain's own form. */
export function isBlockReadHash(chain: BlockReadChain, hash: string): boolean {
  return chain === "bitcoin" ? /^[0-9a-f]{64}$/.test(hash) : /^0x[0-9a-f]{64}$/.test(hash);
}

/** The file's text, byte for byte, as the host makes it and the BitGraph binds it. Throws on a malformed block. */
export function blockReadFileText(f: Omit<BlockReadFile, "format">): string {
  const body: BlockReadFile = {
    format: BLOCK_READ_FORMAT,
    epochId: f.epochId,
    chain: f.chain,
    chainId: f.chainId,
    number: f.number,
    hash: f.hash.toLowerCase(),
    timestamp: f.timestamp,
  };
  const reasons = shapeReasons(body as unknown as Record<string, unknown>);
  if (reasons.length > 0) throw new TypeError(`not a block read: ${reasons.join("; ")}`);
  return JSON.stringify(body, null, 2) + "\n";
}

/** The digest a BitGraph of this file binds: SHA-256 of its text, standard base64. */
export function blockReadDigestB64(text: string): string {
  return bytesToB64(sha256(enc.encode(text)));
}

/** Strict: the format, exactly its fields, a 32-byte epoch id, a known chain and CAIP-2 id, safe integers. Null otherwise. */
export function parseBlockReadFile(text: string): BlockReadFile | null {
  let o: unknown;
  try { o = JSON.parse(text); } catch { return null; }
  if (!o || typeof o !== "object" || Array.isArray(o)) return null;
  return shapeReasons(o as Record<string, unknown>).length === 0 ? (o as BlockReadFile) : null;
}

const FIELDS = new Set(["format", "epochId", "chain", "chainId", "number", "hash", "timestamp"]);

function shapeReasons(o: Record<string, unknown>): string[] {
  const reasons: string[] = [];
  if (o["format"] !== BLOCK_READ_FORMAT) return [`not ${BLOCK_READ_FORMAT}`];
  for (const k of Object.keys(o)) if (!FIELDS.has(k)) reasons.push(`unexpected field ${k}`);
  const epochId = o["epochId"];
  if (typeof epochId !== "string" || !isB64Of32(epochId)) reasons.push("epochId is not 32 bytes of standard base64");
  const chain = o["chain"];
  if (chain !== "base" && chain !== "ethereum" && chain !== "bitcoin") {
    reasons.push(`unknown chain ${JSON.stringify(chain)}`);
  } else {
    if (typeof o["chainId"] !== "string" || !BLOCK_READ_CHAIN_IDS[chain].includes(o["chainId"])) reasons.push(`chainId is not one of ${chain}'s`);
    if (typeof o["hash"] !== "string" || !isBlockReadHash(chain, o["hash"])) reasons.push(`hash is not a ${chain} block hash`);
  }
  if (!isCount(o["number"])) reasons.push("number is not a safe non-negative integer");
  if (!isCount(o["timestamp"])) reasons.push("timestamp is not a safe non-negative integer (Unix seconds)");
  return reasons;
}

/** What the chain says about a block hash, from the caller's lookup (eth_getBlockByHash, a Bitcoin block API). */
export interface ChainBlock {
  hash: string;
  number: number;
  timestamp: number;
  /** True only when the block is on the chain's canonical (best) chain. */
  canonical: boolean;
}

export interface BlockReadCheck {
  /** True only when confirmed: the chain itself vouched for the block. */
  ok: boolean;
  /** confirmed: the chain vouched; unconfirmed: nothing failed but the chain was not asked; failed: see reasons. */
  status: "confirmed" | "unconfirmed" | "failed";
  /** What failed; empty unless failed. */
  reasons: string[];
  file: BlockReadFile | null;
  /** The block's number and timestamp as the CHAIN reports them; set only when the chain confirmed the block. */
  block: { chain: BlockReadChain; chainId: string; hash: string; number: number; timestamp: number } | null;
}

/**
 * Check a block read against its BitGraph and against the chain.
 *
 * The file must hash to the proof's digest and name the proof's epoch. `chain` is the lookup of the file's hash on
 * the file's chain: null means the chain does not know the hash. The block must be that hash, on the canonical
 * chain, with the number and timestamp the file names. Without `chain` (undefined) the read is unconfirmed and
 * not ok: the file alone says nothing about time. The number and timestamp returned are the chain's.
 */
export function checkBlockRead(args: { file: string; proof: BitGraphProof; chain?: ChainBlock | null }): BlockReadCheck {
  const file = parseBlockReadFile(args.file);
  if (!file) return { ok: false, status: "failed", reasons: [`the file is not a ${BLOCK_READ_FORMAT} record`], file: null, block: null };
  const reasons: string[] = [];
  if (blockReadDigestB64(args.file) !== args.proof.artifact?.digestB64) reasons.push("the file does not hash to the proof's digest");
  if (args.proof.commit?.epochId !== file.epochId) reasons.push("the proof is not of the epoch the file names");

  const c = args.chain;
  if (c === undefined) {
    // Not looked up: nothing more to check, and nothing about time is known.
  } else if (c === null) {
    reasons.push(`${file.chain} does not know block ${file.hash}`);
  } else {
    if (c.hash.toLowerCase() !== file.hash) reasons.push(`${file.chain} answered for another block`);
    if (!c.canonical) reasons.push(`block ${file.hash} is not on ${file.chain}'s canonical chain`);
    if (c.number !== file.number) reasons.push(`the file says block ${file.number}; ${file.chain} says ${c.number}`);
    if (c.timestamp !== file.timestamp) reasons.push(`the file says time ${file.timestamp}; ${file.chain} says ${c.timestamp}`);
  }
  const confirmed = reasons.length === 0 && c;
  const status = reasons.length > 0 ? "failed" : c ? "confirmed" : "unconfirmed";
  return {
    ok: status === "confirmed",
    status,
    reasons,
    file,
    block: confirmed ? { chain: file.chain, chainId: file.chainId, hash: file.hash, number: c.number, timestamp: c.timestamp } : null,
  };
}

function isCount(v: unknown): v is number {
  return typeof v === "number" && Number.isSafeInteger(v) && v >= 0;
}

function isB64Of32(s: string): boolean {
  if (!/^[A-Za-z0-9+/]{43}=$/.test(s)) return false;
  const bin = typeof atob === "function" ? atob(s) : Buffer.from(s, "base64").toString("binary");
  return bin.length === 32;
}

function bytesToB64(u: Uint8Array): string {
  let bin = "";
  for (const x of u) bin += String.fromCharCode(x);
  return typeof btoa === "function" ? btoa(bin) : Buffer.from(bin, "binary").toString("base64");
}
