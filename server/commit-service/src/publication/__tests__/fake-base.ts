// Copyright (c) Argento Computing Inc. All rights reserved. See LICENSE.

/**
 * A small Base node for tests: a JSON-RPC server that takes signed transactions, mines them into blocks on request,
 * and answers the calls the publisher makes. Blocks are real: the header's hash is keccak256 of its RLP and its
 * transactionsRoot is the trie root over the block's raw transactions, so the evidence the publisher collects is
 * checked here exactly as it would be against Base.
 */

import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { parseTransaction, recoverTransactionAddress, type TransactionSerialized } from "viem";
import { evmBytesToHex, evmHexToBytes, keccak256, txTrieProof } from "@mikeargento/bitgraph-verify";
import { encodeHeaderRlp, type RpcBlock } from "../base.js";

const h = (n: number | bigint): string => "0x" + n.toString(16);
const z = (bytes: number, fill = 0): string => "0x" + fill.toString(16).padStart(2, "0").repeat(bytes);

export class FakeBase {
  readonly chainId: number;
  private server: Server | null = null;
  url = "";
  private mempool: string[] = [];
  private blocks: RpcBlock[] = [];
  private byHash = new Map<string, RpcBlock>();
  private raws = new Map<string, string>();
  private receipts = new Map<string, { blockHash: string; status: string }>();
  private nonces = new Map<string, number>();
  /** Drop transactions instead of mining them (a stalled write). */
  stall = false;
  /** Answer receipt lookups with nothing (a node that is behind on receipts). */
  hideReceipts = false;
  calls: string[] = [];
  /** Mined nonces per sender (eth_getTransactionCount "latest"). */
  private mined = new Map<string, number>();
  private senders = new Map<string, string>();

  /** Another transaction from this sender is mined with its next nonce (a manual send from the same key). */
  consumeNonce(address: string): void {
    const who = address.toLowerCase();
    const n = Math.max(this.mined.get(who) ?? 0, this.nonces.get(who) ?? 0) + 1;
    this.mined.set(who, n);
    this.nonces.set(who, n);
    this.mempool = this.mempool.filter((r) => parseTransaction(r as TransactionSerialized).nonce! >= n);
  }

  /** Replace the newest block with a different one at the same height (a reorg); its transactions go back to waiting. */
  reorg(): void {
    const old = this.blocks.pop()!;
    this.byHash.delete(old.hash);
    for (const t of old.transactions) {
      const r = this.receipts.get(t.hash);
      if (r) {
        this.receipts.delete(t.hash);
        const raw = this.raws.get(t.hash);
        if (raw) {
          this.mempool.push(raw);
          // Its nonce is no longer mined.
          const who = this.senders.get(t.hash);
          const n = parseTransaction(raw as TransactionSerialized).nonce ?? 0;
          if (who && (this.mined.get(who) ?? 0) > n) this.mined.set(who, n);
        }
      }
    }
    const b = this.makeBlock([], parseInt(old.number, 16));
    this.blocks.push(b);
    this.byHash.set(b.hash, b);
  }

  constructor(chainId = 8453) {
    this.chainId = chainId;
    this.blocks.push(this.makeBlock([], 37_999_999));
  }

  async start(): Promise<void> {
    this.server = createServer((req, res) => {
      let body = "";
      req.on("data", (c) => (body += c));
      req.on("end", async () => {
        const msg = JSON.parse(body) as { id: number; method: string; params: unknown[] } | Array<{ id: number; method: string; params: unknown[] }>;
        const one = async (m: { id: number; method: string; params: unknown[] }) => {
          try { return { jsonrpc: "2.0", id: m.id, result: await this.handle(m.method, m.params) }; } catch (e) { return { jsonrpc: "2.0", id: m.id, error: { code: -32000, message: (e as Error).message } }; }
        };
        const out = Array.isArray(msg) ? await Promise.all(msg.map(one)) : await one(msg);
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify(out));
      });
    });
    await new Promise<void>((r) => this.server!.listen(0, "127.0.0.1", () => r()));
    this.url = `http://127.0.0.1:${(this.server!.address() as AddressInfo).port}`;
  }

  stop(): void { this.server?.close(); }

  get head(): number { return parseInt(this.blocks[this.blocks.length - 1]!.number, 16); }

  private makeBlock(raws: string[], number: number): RpcBlock {
    const filler = this.filler(number);
    const all = [filler, ...raws];
    const txRoot = evmBytesToHex(txTrieProof(all.map(evmHexToBytes), 0).root);
    const parent = this.blocks.length ? this.blocks[this.blocks.length - 1]!.hash : z(32);
    const b: RpcBlock = {
      hash: "", parentHash: parent, sha3Uncles: z(32, 0x1d), miner: z(20, 0x42), stateRoot: z(32, 5), transactionsRoot: txRoot,
      receiptsRoot: z(32, 6), logsBloom: z(256), difficulty: "0x0", number: h(number), gasLimit: h(30_000_000), gasUsed: h(100_000),
      timestamp: h(1_794_000_000 + 2 * number), extraData: "0x", mixHash: z(32, 8), nonce: z(8), baseFeePerGas: h(1_000_000),
      withdrawalsRoot: z(32, 9), blobGasUsed: "0x0", excessBlobGas: "0x0", parentBeaconBlockRoot: z(32, 10),
      transactions: all.map((r) => ({ hash: evmBytesToHex(keccak256(evmHexToBytes(r))) })),
    };
    b.hash = evmBytesToHex(keccak256(encodeHeaderRlp(b)));
    all.forEach((r) => this.raws.set(evmBytesToHex(keccak256(evmHexToBytes(r))), r));
    return b;
  }

  /** A stand-in for another sender's transaction in the same block (the raw bytes are what matter to the trie). */
  private filler(number: number): string {
    return "0x02" + "c0".repeat(1) + number.toString(16).padStart(8, "0");
  }

  /** Mine everything waiting into one new block. */
  mine(): RpcBlock {
    const raws = this.stall ? [] : this.mempool.splice(0);
    const b = this.makeBlock(raws, this.head + 1);
    this.blocks.push(b);
    this.byHash.set(b.hash, b);
    for (const r of raws) {
      const hash = evmBytesToHex(keccak256(evmHexToBytes(r)));
      this.receipts.set(hash, { blockHash: b.hash, status: "0x1" });
      const who = this.senders.get(hash);
      const n = (parseTransaction(r as TransactionSerialized).nonce ?? 0) + 1;
      if (who && (this.mined.get(who) ?? 0) < n) this.mined.set(who, n);
    }
    return b;
  }

  /** Advance the head without mining anything waiting. */
  skip(n: number): void { for (let i = 0; i < n; i++) { const b = this.makeBlock([], this.head + 1); this.blocks.push(b); this.byHash.set(b.hash, b); } }

  sentCount(): number { return this.raws.size; }

  private async handle(method: string, params: unknown[]): Promise<unknown> {
    this.calls.push(method);
    const latest = this.blocks[this.blocks.length - 1]!;
    switch (method) {
      case "eth_chainId": return h(this.chainId);
      case "eth_blockNumber": return latest.number;
      case "eth_getTransactionCount": {
        const who = String(params[0]).toLowerCase();
        const mined = this.mined.get(who) ?? 0;
        return h(params[1] === "latest" ? mined : Math.max(mined, this.nonces.get(who) ?? 0));
      }
      case "eth_estimateGas": return h(30_000);
      case "eth_maxPriorityFeePerGas": return h(1_000);
      case "eth_getBalance": return h(10n ** 16n);
      case "eth_getBlockByNumber": {
        const at = params[0] === "latest" ? latest : this.blocks.find((b) => parseInt(b.number, 16) === parseInt(String(params[0]), 16));
        return at ? { ...at, transactions: at.transactions.map((t) => t.hash), size: "0x100", totalDifficulty: "0x0", uncles: [] } : null;
      }
      case "eth_sendRawTransaction": {
        const raw = String(params[0]);
        const tx = parseTransaction(raw as TransactionSerialized);
        const from = (await recoverTransactionAddress({ serializedTransaction: raw as TransactionSerialized })).toLowerCase();
        if (Number(tx.chainId) !== this.chainId) throw new Error("wrong chain");
        const next = this.nonces.get(from) ?? 0;
        if ((tx.nonce ?? 0) < next) throw new Error("nonce too low");
        this.mempool = this.mempool.filter((r) => parseTransaction(r as TransactionSerialized).nonce !== tx.nonce);
        this.mempool.push(raw);
        this.raws.set(evmBytesToHex(keccak256(evmHexToBytes(raw))), raw);
        this.senders.set(evmBytesToHex(keccak256(evmHexToBytes(raw))), from);
        if (!this.stall) this.nonces.set(from, Math.max(next, (tx.nonce ?? 0) + 1));
        return evmBytesToHex(keccak256(evmHexToBytes(raw)));
      }
      case "eth_getTransactionReceipt": return this.hideReceipts ? null : this.receipts.get(String(params[0]).toLowerCase()) ?? null;
      case "eth_getTransactionByHash": {
        const hash = String(params[0]).toLowerCase();
        const r = this.receipts.get(hash);
        if (r) return { hash, blockHash: r.blockHash, blockNumber: this.byHash.get(r.blockHash)?.number ?? null };
        const raw = this.raws.get(hash);
        return raw && this.mempool.includes(raw) ? { hash, blockHash: null, blockNumber: null } : null;
      }
      case "eth_getBlockByHash": return this.byHash.get(String(params[0]).toLowerCase()) ?? null;
      case "eth_getRawTransactionByHash": return this.raws.get(String(params[0]).toLowerCase()) ?? null;
      default: throw new Error(`unsupported ${method}`);
    }
  }
}
