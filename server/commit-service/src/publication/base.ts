// Copyright (c) Argento Computing Inc. All rights reserved. See LICENSE.

/**
 * The publisher's chain: one self-addressed transaction per hourly write, signed with a key read once from a file the
 * operator made (never logged, printed or returned), and, once mined, the evidence that ties it to its block without
 * asking anyone later: the header RLP (whose keccak256 is the block hash) and the transaction's inclusion proof against
 * the header's transactionsRoot. Both are checked here against what the chain supplied; a header that does not hash to
 * its block hash, or a rebuilt trie whose root is not the header's, is an error, never evidence.
 *
 * Ported from the Base writer removed on 2026-11-08 (src/ceiling/base-chain.ts and block.ts), without the per-file
 * block read and the floor header lookups it also did.
 */

import { readFileSync, statSync } from "node:fs";
import { createPublicClient, defineChain, http, keccak256 as viemKeccak, type Hex, type PublicClient, type Chain as ViemChain } from "viem";
import { privateKeyToAccount, type PrivateKeyAccount } from "viem/accounts";
import { base, baseSepolia } from "viem/chains";
import { chainConfig, serializeTransaction } from "viem/op-stack";
import { evmBytesToHex as bytesToHex, evmHexToBytes as hexToBytes, keccak256, rlpEncode, txTrieProof } from "@mikeargento/bitgraph-verify";
import type { WriteEvidence } from "@mikeargento/bitgraph-audit";

export interface SignedTx { rawTx: string; txHash: string; maxFeePerGas: string; maxPriorityFeePerGas: string }

/** The chain, as the publisher needs it: viem over a Base RPC in production, a fake in tests. */
export interface Chain {
  readonly chainId: number;
  readonly writer: string;
  head(): Promise<number>;
  nextNonce(): Promise<number>;
  /** Sign a self-addressed transaction carrying `data`. `bump` > 0 raises the fees for a replacement. */
  sign(data: Uint8Array, nonce: number, bump: number): Promise<SignedTx>;
  broadcast(rawTx: string): Promise<void>;
  /** The write's evidence once its block exists; null until then. */
  evidence(txHash: string): Promise<WriteEvidence | null>;
  /** The hash of the block at a height on the chain as it stands now; null when the node does not have it. */
  blockHashAt(n: number): Promise<string | null>;
  /** The writer's nonce counting mined transactions only. */
  confirmedNonce(): Promise<number>;
  /** Whether the chain knows a transaction: not at all, waiting to be mined, or mined. */
  txStatus(txHash: string): Promise<"unknown" | "pending" | "mined">;
  balanceWei(): Promise<bigint>;
}

/** Read a 0x-hex private key from a file that only its owner can read. */
export function loadKey(path: string): PrivateKeyAccount {
  const mode = statSync(path).mode & 0o777;
  if (mode & 0o077) throw new Error(`${path} is readable by others (mode ${mode.toString(8)}); chmod 600 it`);
  const key = readFileSync(path, "utf8").trim();
  if (!/^0x[0-9a-fA-F]{64}$/.test(key)) throw new Error(`${path} does not hold a 0x-prefixed 32-byte hex key`);
  return privateKeyToAccount(key as Hex);
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

// ── block evidence ──────────────────────────────────────────────────────────

/** `eth_getBlockByHash` result: header fields, and the transactions as objects. */
export interface RpcBlock {
  hash: string; parentHash: string; sha3Uncles: string; miner: string; stateRoot: string;
  transactionsRoot: string; receiptsRoot: string; logsBloom: string;
  difficulty: string; number: string; gasLimit: string; gasUsed: string;
  timestamp: string; extraData: string; mixHash: string; nonce: string;
  baseFeePerGas?: string; withdrawalsRoot?: string; blobGasUsed?: string;
  excessBlobGas?: string; parentBeaconBlockRoot?: string; requestsHash?: string;
  transactions: Array<Record<string, unknown> & { hash: string }>;
}

/** Integer field: minimal big-endian, no leading zeros (0 is empty). */
function q(hex: string | undefined): Uint8Array {
  if (hex == null) return new Uint8Array(0);
  const h = hex.replace(/^0x/, "").replace(/^0+/, "");
  return h === "" ? new Uint8Array(0) : hexToBytes(h.length % 2 ? "0" + h : h);
}
/** Fixed-width data field: exact bytes. */
const d = (hex: string | undefined): Uint8Array => (hex == null ? new Uint8Array(0) : hexToBytes(hex));

/** The header RLP in Ethereum field order (Base's OP Stack headers have the same shape). */
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

/** The exact bytes of one transaction from its RPC object; checked against its hash by the caller. */
function rawFromRpc(tx: Record<string, unknown>): Uint8Array {
  const formatted = chainConfig.formatters.transaction.format(tx as never) as unknown as Record<string, unknown>;
  const sig = formatted["type"] === "deposit"
    ? undefined
    : { r: formatted["r"] as Hex, s: formatted["s"] as Hex, ...(formatted["type"] === "legacy" ? { v: formatted["v"] as bigint } : { yParity: formatted["yParity"] as number }) };
  return hexToBytes(serializeTransaction({ ...formatted, data: formatted["input"] } as never, sig as never));
}

/**
 * The evidence for `txHash` in block `blockHash`: every transaction's bytes must hash to its listed hash (asked for
 * directly when they cannot be re-serialized), the rebuilt trie's root must equal the header's, and the header must
 * hash to the block hash, or this throws.
 */
export async function blockEvidence(rpc: Rpc, blockHash: string, txHash: string): Promise<Omit<WriteEvidence, "chain" | "chainId" | "writer">> {
  const block = (await rpc("eth_getBlockByHash", [blockHash, true])) as RpcBlock | null;
  if (!block) throw new Error(`block ${blockHash} not found`);
  const headerRlp = encodeHeaderRlp(block);
  if (bytesToHex(keccak256(headerRlp)) !== block.hash.toLowerCase()) {
    throw new Error(`header for block ${parseInt(block.number, 16)} does not reproduce its hash (unknown header field?)`);
  }
  const hashes = block.transactions.map((t) => t.hash.toLowerCase());
  const txIndex = hashes.indexOf(txHash.toLowerCase());
  if (txIndex < 0) throw new Error(`transaction ${txHash} is not in block ${blockHash}`);
  const raws: Uint8Array[] = [];
  for (let i = 0; i < block.transactions.length; i++) {
    let raw: Uint8Array | null = null;
    try { raw = rawFromRpc(block.transactions[i]!); } catch { raw = null; }
    if (!raw || bytesToHex(keccak256(raw)) !== hashes[i]) raw = hexToBytes((await rpc("eth_getRawTransactionByHash", [hashes[i]])) as string);
    if (bytesToHex(keccak256(raw)) !== hashes[i]) throw new Error(`transaction ${i} bytes do not hash to its listed hash`);
    raws.push(raw);
  }
  const { root, proof } = txTrieProof(raws, txIndex);
  if (bytesToHex(root) !== block.transactionsRoot.toLowerCase()) {
    throw new Error(`rebuilt transaction trie root ${bytesToHex(root)} is not the header's ${block.transactionsRoot}`);
  }
  return {
    txHash: txHash.toLowerCase(),
    blockNumber: parseInt(block.number, 16),
    blockHash: block.hash.toLowerCase(),
    blockTimestamp: parseInt(block.timestamp, 16),
    headerRlp: bytesToHex(headerRlp),
    txIndex,
    txInclusionProof: proof.map(bytesToHex),
    rawTx: bytesToHex(raws[txIndex]!),
  };
}

// ── viem over a Base RPC ────────────────────────────────────────────────────

export interface BaseChainOptions {
  chainId: number;
  rpcUrl: string;
  account: PrivateKeyAccount;
  /** Floor for the tip, in wei. Base takes ~0.001 gwei. */
  minPriorityFeePerGas?: bigint;
}

const KNOWN: Record<number, ViemChain> = { 8453: base, 84532: baseSepolia };

export class BaseChain implements Chain {
  readonly chainId: number;
  readonly writer: string;
  private readonly client: PublicClient;
  private readonly rpc: Rpc;
  private readonly account: PrivateKeyAccount;
  private readonly minTip: bigint;
  private gas: Map<number, bigint> = new Map();

  constructor(o: BaseChainOptions) {
    this.chainId = o.chainId;
    this.account = o.account;
    this.writer = o.account.address.toLowerCase();
    const chain = KNOWN[o.chainId] ?? defineChain({ id: o.chainId, name: `chain ${o.chainId}`, nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 }, rpcUrls: { default: { http: [o.rpcUrl] } } });
    this.client = createPublicClient({ chain, transport: http(o.rpcUrl) }) as PublicClient;
    this.rpc = jsonRpc(o.rpcUrl);
    this.minTip = o.minPriorityFeePerGas ?? 1_000_000n;
  }

  async head(): Promise<number> { return Number(await this.client.getBlockNumber({ cacheTime: 0 })); }

  nextNonce(): Promise<number> { return this.client.getTransactionCount({ address: this.account.address, blockTag: "pending" }); }

  async sign(data: Uint8Array, nonce: number, bump: number): Promise<SignedTx> {
    const dataHex = bytesToHex(data) as Hex;
    let gas = this.gas.get(data.length);
    if (gas === undefined) {
      const est = await this.client.estimateGas({ account: this.account.address, to: this.account.address, value: 0n, data: dataHex });
      gas = (est * 12n) / 10n; // 20% headroom; a write of this size always costs the same
      this.gas.set(data.length, gas);
    }
    const block = await this.client.getBlock({ blockTag: "latest" });
    const baseFee = block.baseFeePerGas ?? 0n;
    let tip = await this.client.estimateMaxPriorityFeePerGas().catch(() => this.minTip);
    if (tip < this.minTip) tip = this.minTip;
    // Each replacement raises both caps by at least 25% over the last (nodes require 10%).
    for (let i = 0; i < bump; i++) tip = (tip * 125n) / 100n + 1n;
    let maxFee = baseFee * 2n + tip;
    for (let i = 0; i < bump; i++) maxFee = (maxFee * 125n) / 100n + 1n;
    const rawTx = await this.account.signTransaction({
      type: "eip1559", chainId: this.chainId, nonce, to: this.account.address, value: 0n, data: dataHex, gas, maxFeePerGas: maxFee, maxPriorityFeePerGas: tip,
    });
    return { rawTx, txHash: viemKeccak(rawTx), maxFeePerGas: maxFee.toString(), maxPriorityFeePerGas: tip.toString() };
  }

  async broadcast(rawTx: string): Promise<void> { await this.rpc("eth_sendRawTransaction", [rawTx]); }

  async evidence(txHash: string): Promise<WriteEvidence | null> {
    const r = (await this.rpc("eth_getTransactionReceipt", [txHash])) as { blockHash?: string; status?: string } | null;
    // Base's RPC can answer with a Flashblocks preconfirmation: a receipt whose blockHash is all zeros, before the block
    // exists. That is not an inclusion yet.
    if (!r || !r.blockHash || /^0x0*$/.test(r.blockHash)) return null;
    if (r.status !== "0x1") throw new Error(`transaction ${txHash} reverted`);
    const ev = await blockEvidence(this.rpc, r.blockHash, txHash);
    return { chain: "base", chainId: this.chainId, writer: this.writer, ...ev };
  }

  async blockHashAt(n: number): Promise<string | null> {
    const b = (await this.rpc("eth_getBlockByNumber", ["0x" + n.toString(16), false])) as { hash?: string } | null;
    return b?.hash ? b.hash.toLowerCase() : null;
  }

  confirmedNonce(): Promise<number> { return this.client.getTransactionCount({ address: this.account.address, blockTag: "latest" }); }

  async txStatus(txHash: string): Promise<"unknown" | "pending" | "mined"> {
    const tx = (await this.rpc("eth_getTransactionByHash", [txHash])) as { blockNumber?: string | null } | null;
    if (!tx) return "unknown";
    return tx.blockNumber ? "mined" : "pending";
  }

  balanceWei(): Promise<bigint> { return this.client.getBalance({ address: this.account.address }); }
}
