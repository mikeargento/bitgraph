// Copyright (c) Argento Computing Inc. All rights reserved. See LICENSE.

/**
 * The evidence a ceiling carries about its block: the header RLP (whose
 * keccak256 IS the block hash) and the transaction's inclusion proof against
 * that header's transactionsRoot. Both are SELF-CHECKED here against values
 * the chain supplied: a header that does not hash to the block hash, or a
 * rebuilt trie whose root is not the header's transactionsRoot, yields an
 * error, never evidence. Same discipline as packages/hosted/src/eth-header.ts,
 * whose field order this mirrors (and extends for any chain on the same
 * header format: Base's OP Stack headers are Ethereum-shaped).
 */

import { evmBytesToHex as bytesToHex, evmHexToBytes as hexToBytes, keccak256, rlpEncode, txTrieProof } from "@mikeargento/bitgraph-verify";
import { chainConfig, serializeTransaction } from "viem/op-stack";
import type { Hex } from "viem";

/** `eth_getBlockByNumber` result, header fields plus transactions as hashes or objects. */
export interface RpcBlock {
  hash: string; parentHash: string; sha3Uncles: string; miner: string; stateRoot: string;
  transactionsRoot: string; receiptsRoot: string; logsBloom: string;
  difficulty: string; number: string; gasLimit: string; gasUsed: string;
  timestamp: string; extraData: string; mixHash: string; nonce: string;
  baseFeePerGas?: string; withdrawalsRoot?: string; blobGasUsed?: string;
  excessBlobGas?: string; parentBeaconBlockRoot?: string; requestsHash?: string;
  transactions: Array<string | { hash: string }>;
}

/** Integer field: minimal big-endian, no leading zeros (0 -> empty). */
function q(hex: string | undefined): Uint8Array {
  if (hex == null) return new Uint8Array(0);
  const h = hex.replace(/^0x/, "").replace(/^0+/, "");
  return h === "" ? new Uint8Array(0) : hexToBytes(h);
}
/** Fixed-width data field: exact bytes. */
function d(hex: string | undefined): Uint8Array {
  return hex == null ? new Uint8Array(0) : hexToBytes(hex);
}

export function encodeHeaderRlp(b: RpcBlock): Uint8Array {
  const fields = [
    d(b.parentHash), d(b.sha3Uncles), d(b.miner), d(b.stateRoot), d(b.transactionsRoot),
    d(b.receiptsRoot), d(b.logsBloom), q(b.difficulty), q(b.number), q(b.gasLimit),
    q(b.gasUsed), q(b.timestamp), d(b.extraData), d(b.mixHash), d(b.nonce),
  ];
  if (b.baseFeePerGas != null) fields.push(q(b.baseFeePerGas));
  if (b.withdrawalsRoot != null) fields.push(d(b.withdrawalsRoot));
  if (b.blobGasUsed != null) fields.push(q(b.blobGasUsed));
  if (b.excessBlobGas != null) fields.push(q(b.excessBlobGas));
  if (b.parentBeaconBlockRoot != null) fields.push(d(b.parentBeaconBlockRoot));
  if (b.requestsHash != null) fields.push(d(b.requestsHash));
  return rlpEncode(fields);
}

/** The header RLP, or an error when it does not reproduce the block's own hash. */
export function checkedHeaderRlp(b: RpcBlock): Uint8Array {
  const rlp = encodeHeaderRlp(b);
  if (bytesToHex(keccak256(rlp)) !== b.hash.toLowerCase()) {
    throw new Error(`header for block ${parseInt(b.number, 16)} does not reproduce its hash (unknown header field?)`);
  }
  return rlp;
}

export type Rpc = (method: string, params: unknown[]) => Promise<unknown>;

export function jsonRpc(url: string): Rpc {
  let id = 0;
  return async (method, params) => {
    const res = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: ++id, method, params }),
      signal: AbortSignal.timeout(20_000),
    });
    if (!res.ok) throw new Error(`${method}: HTTP ${res.status}`);
    const j = (await res.json()) as { result?: unknown; error?: { message?: string } };
    if (j.error) throw new Error(`${method}: ${j.error.message ?? "rpc error"}`);
    return j.result;
  };
}

export interface BlockEvidence {
  blockNumber: number;
  blockHash: string;
  blockTimestamp: number;
  headerRlp: string;
  txIndex: number;
  txInclusionProof: string[];
  /** The transaction's own bytes, checked against its hash (the trie leaf the proof reaches). */
  rawTx: string;
}

/**
 * The exact bytes of one transaction from its RPC object. viem's OP Stack
 * serializer covers every type Base carries (deposits, legacy, 2930, 1559,
 * 7702). Each result is checked against the transaction's listed hash before
 * use, so a serializer gap is an error here, never a wrong proof.
 */
function rawFromRpc(tx: Record<string, unknown>): Uint8Array {
  const formatted = chainConfig.formatters.transaction.format(tx as never) as unknown as Record<string, unknown>;
  const sig = formatted["type"] === "deposit"
    ? undefined
    : { r: formatted["r"] as Hex, s: formatted["s"] as Hex, ...(formatted["type"] === "legacy" ? { v: formatted["v"] as bigint } : { yParity: formatted["yParity"] as number }) };
  // The RPC names calldata `input`; the serializer reads `data`.
  return hexToBytes(serializeTransaction({ ...formatted, data: formatted["input"] } as never, sig as never));
}

/**
 * Header and inclusion proof for `txHash` in block `blockHash`. Every
 * transaction's bytes must hash to its listed hash, and the rebuilt trie's
 * root must equal the header's transactionsRoot, or this throws. When a
 * transaction cannot be re-serialized, its bytes are asked for directly
 * (eth_getRawTransactionByHash), which some public RPCs refuse.
 */
export async function blockEvidence(rpc: Rpc, blockHash: string, txHash: string): Promise<BlockEvidence> {
  type FullBlock = Omit<RpcBlock, "transactions"> & { transactions: Array<Record<string, unknown> & { hash: string }> };
  const block = (await rpc("eth_getBlockByHash", [blockHash, true])) as FullBlock | null;
  if (!block) throw new Error(`block ${blockHash} not found`);
  const headerRlp = checkedHeaderRlp(block as unknown as RpcBlock);
  const hashes = block.transactions.map((t) => t.hash.toLowerCase());
  const txIndex = hashes.indexOf(txHash.toLowerCase());
  if (txIndex < 0) throw new Error(`transaction ${txHash} is not in block ${blockHash}`);
  const raws: Uint8Array[] = [];
  for (let i = 0; i < block.transactions.length; i++) {
    let raw: Uint8Array | null = null;
    try {
      raw = rawFromRpc(block.transactions[i]!);
    } catch {
      raw = null;
    }
    if (!raw || bytesToHex(keccak256(raw)) !== hashes[i]) {
      raw = hexToBytes((await rpc("eth_getRawTransactionByHash", [hashes[i]])) as string);
    }
    if (bytesToHex(keccak256(raw)) !== hashes[i]) throw new Error(`transaction ${i} bytes do not hash to its listed hash`);
    raws.push(raw);
  }
  const { root, proof } = txTrieProof(raws, txIndex);
  if (bytesToHex(root) !== block.transactionsRoot.toLowerCase()) {
    throw new Error(`rebuilt transaction trie root ${bytesToHex(root)} is not the header's ${block.transactionsRoot}`);
  }
  return {
    blockNumber: parseInt(block.number, 16),
    blockHash: block.hash.toLowerCase(),
    blockTimestamp: parseInt(block.timestamp, 16),
    headerRlp: bytesToHex(headerRlp),
    txIndex,
    txInclusionProof: proof.map(bytesToHex),
    rawTx: bytesToHex(raws[txIndex]!),
  };
}
