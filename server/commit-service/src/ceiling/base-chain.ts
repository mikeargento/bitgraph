// Copyright (c) Argento Computing Inc. All rights reserved. See LICENSE.

/**
 * The writer's Chain over viem and a Base RPC. The key is read here, once,
 * from a file the operator made; it is never logged, printed, or returned.
 */

import { readFileSync, statSync } from "node:fs";
import { createPublicClient, http, type Hex, type PublicClient } from "viem";
import { privateKeyToAccount, type PrivateKeyAccount } from "viem/accounts";
import { base, baseSepolia } from "viem/chains";
import { blockEvidence, checkedHeaderRlp, jsonRpc, type Rpc, type RpcBlock } from "./block.js";
import type { Chain, Inclusion } from "./writer.js";

export const CHAINS = { 8453: base, 84532: baseSepolia } as const;

/** Read a 0x-hex private key from a file that only its owner can read. */
export function loadKey(path: string): PrivateKeyAccount {
  const mode = statSync(path).mode & 0o777;
  if (mode & 0o077) throw new Error(`${path} is readable by others (mode ${mode.toString(8)}); chmod 600 it`);
  const key = readFileSync(path, "utf8").trim();
  if (!/^0x[0-9a-fA-F]{64}$/.test(key)) throw new Error(`${path} does not hold a 0x-prefixed 32-byte hex key`);
  return privateKeyToAccount(key as Hex);
}

export interface BaseChainOptions {
  chainId: 8453 | 84532;
  rpcUrl: string;
  ethRpcUrl: string;
  account: PrivateKeyAccount;
  /** Floor for the tip, in wei. Base Sepolia and mainnet both take ~0.001 gwei. */
  minPriorityFeeWei?: bigint;
}

export class BaseChain implements Chain {
  readonly chainId: number;
  readonly writer: string;
  private readonly client: PublicClient;
  private readonly rpc: Rpc;
  private readonly ethRpc: Rpc;
  private readonly account: PrivateKeyAccount;
  private readonly minTip: bigint;
  private gas: bigint | null = null;

  constructor(o: BaseChainOptions) {
    this.chainId = o.chainId;
    this.account = o.account;
    this.writer = o.account.address.toLowerCase();
    this.client = createPublicClient({ chain: CHAINS[o.chainId], transport: http(o.rpcUrl) }) as PublicClient;
    this.rpc = jsonRpc(o.rpcUrl);
    this.ethRpc = jsonRpc(o.ethRpcUrl);
    this.minTip = o.minPriorityFeeWei ?? 1_000_000n; // 0.001 gwei
  }

  async head(): Promise<number> {
    return Number(await this.client.getBlockNumber({ cacheTime: 0 }));
  }

  async nextNonce(): Promise<number> {
    return this.client.getTransactionCount({ address: this.account.address, blockTag: "pending" });
  }

  async sign(data: Uint8Array, nonce: number, bump: number): Promise<{ rawTx: string; txHash: string; maxFeePerGas: string; maxPriorityFeePerGas: string }> {
    const dataHex = ("0x" + Buffer.from(data).toString("hex")) as Hex;
    if (this.gas === null) {
      const est = await this.client.estimateGas({ account: this.account.address, to: this.account.address, value: 0n, data: dataHex });
      this.gas = (est * 12n) / 10n; // 20% headroom; the calldata never changes size
    }
    const block = await this.client.getBlock({ blockTag: "latest" });
    const baseFee = block.baseFeePerGas ?? 0n;
    let tip = await this.client.estimateMaxPriorityFeePerGas().catch(() => this.minTip);
    if (tip < this.minTip) tip = this.minTip;
    // Each replacement raises both caps by at least 25% over the last (nodes require >= 10%).
    for (let i = 0; i < bump; i++) tip = (tip * 125n) / 100n + 1n;
    let maxFee = baseFee * 2n + tip;
    for (let i = 0; i < bump; i++) maxFee = (maxFee * 125n) / 100n + 1n;
    const rawTx = await this.account.signTransaction({
      type: "eip1559",
      chainId: this.chainId,
      nonce,
      to: this.account.address,
      value: 0n,
      data: dataHex,
      gas: this.gas,
      maxFeePerGas: maxFee,
      maxPriorityFeePerGas: tip,
    });
    const { keccak256 } = await import("viem");
    return { rawTx, txHash: keccak256(rawTx), maxFeePerGas: maxFee.toString(), maxPriorityFeePerGas: tip.toString() };
  }

  async broadcast(rawTx: string): Promise<void> {
    await this.rpc("eth_sendRawTransaction", [rawTx]);
  }

  async inclusion(txHash: string): Promise<Inclusion | null> {
    const r = (await this.rpc("eth_getTransactionReceipt", [txHash])) as
      | { blockHash: string; gasUsed: string; effectiveGasPrice: string; l1Fee?: string; status: string }
      | null;
    // Base's RPC can answer with a Flashblocks preconfirmation: a receipt whose
    // blockHash is all zeros, before the 2-second block exists. That is not an
    // inclusion (the ceiling is the full block's timestamp), so it is "not yet".
    if (!r || !r.blockHash || /^0x0*$/.test(r.blockHash)) return null;
    if (r.status !== "0x1") throw new Error(`transaction ${txHash} reverted`);
    const ev = await blockEvidence(this.rpc, r.blockHash, txHash);
    const l2 = BigInt(r.gasUsed) * BigInt(r.effectiveGasPrice);
    const l1 = r.l1Fee ? BigInt(r.l1Fee) : 0n;
    return {
      blockNumber: ev.blockNumber, blockHash: ev.blockHash, blockTimestamp: ev.blockTimestamp, headerRlp: ev.headerRlp,
      txIndex: ev.txIndex, txInclusionProof: ev.txInclusionProof,
      fees: { l2Wei: l2.toString(), l1Wei: l1.toString(), totalWei: (l2 + l1).toString(), gasUsed: BigInt(r.gasUsed).toString() },
    };
  }

  async blockHashAt(n: number): Promise<string | null> {
    const b = (await this.rpc("eth_getBlockByNumber", ["0x" + n.toString(16), false])) as { hash?: string } | null;
    return b?.hash ?? null;
  }

  private async tagNumber(tag: "safe" | "finalized"): Promise<number> {
    const b = (await this.rpc("eth_getBlockByNumber", [tag, false])) as { number?: string } | null;
    return b?.number ? parseInt(b.number, 16) : 0;
  }
  safeHead(): Promise<number> { return this.tagNumber("safe"); }
  finalizedHead(): Promise<number> { return this.tagNumber("finalized"); }

  balanceWei(): Promise<bigint> {
    return this.client.getBalance({ address: this.account.address });
  }

  async floorHeader(blockHash: string): Promise<{ blockNumber: number; blockTimestamp: number; headerRlp: string } | null> {
    const b = (await this.ethRpc("eth_getBlockByHash", [blockHash, false])) as RpcBlock | null;
    if (!b) return null;
    try {
      const rlp = checkedHeaderRlp(b);
      return { blockNumber: parseInt(b.number, 16), blockTimestamp: parseInt(b.timestamp, 16), headerRlp: "0x" + Buffer.from(rlp).toString("hex") };
    } catch {
      return null;
    }
  }
}
