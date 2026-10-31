// Copyright (c) Argento Computing Inc. All rights reserved. See LICENSE.

/**
 * Block sources for the timeline: what the parent reads from Base, Ethereum and Bitcoin before it binds a
 * bitgraph-block-read/1 file (packages/verify/src/block-read.ts). Nothing here writes to any chain.
 *
 * One source is one provider:
 *   EvmSource       JSON-RPC (Base, Ethereum). Every block is rebuilt into its header RLP and kept only when
 *                   keccak-256 of that reproduces the hash the node reported (base-head.ts), so the number, time and
 *                   parent hash are the block's own, not the node's say-so.
 *   EsploraSource   the Esplora HTTP API that mempool.space and blockstream.info both serve. The 80-byte header is
 *                   checked against the hash (double SHA-256, byte-reversed); the time and parent hash are read from
 *                   it. The height is the provider's word, which is why two providers are asked.
 *
 * CrossChecked takes two sources of one chain and keeps a block only when both report the same hash at that
 * height. When either cannot answer, the read fails: a chain with one provider up is a chain that is down, and the
 * poller reads the missed blocks in order once both are back.
 *
 * URLs may carry API keys, so only an endpoint's origin appears in any message.
 */

import { createHash } from "node:crypto";
import { checkedBaseHeaderRlp, type RpcBlock } from "./base-head.js";

export type TimelineChain = "base" | "ethereum" | "bitcoin";

/** A block as the timeline uses it. Hashes in the chain's own form: 0x hex on Base and Ethereum, plain hex on Bitcoin. */
export interface ChainHead {
  chain: TimelineChain;
  chainId: string;
  number: number;
  hash: string;
  parentHash: string;
  /** The block's own timestamp, Unix seconds. */
  timestamp: number;
}

export interface BlockSource {
  readonly chain: TimelineChain;
  readonly chainId: string;
  /** The endpoint's origin, for messages. */
  readonly origin: string;
  /** The newest block. */
  latest(): Promise<ChainHead>;
  /** The block at `n` on this provider's best chain. */
  at(n: number): Promise<ChainHead>;
  /** The block with this hash and whether it is on the best chain; null when the provider does not know it. */
  byHash(hash: string): Promise<{ head: ChainHead; canonical: boolean } | null>;
}

/** POST a JSON body and return the parsed answer; GET text. Injected in tests. */
export interface Http {
  postJson(url: string, body: unknown): Promise<unknown>;
  getText(url: string): Promise<string>;
}

export const defaultHttp = (timeoutMs = 8000): Http => ({
  async postJson(url, body) {
    const res = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body), signal: AbortSignal.timeout(timeoutMs) });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return res.json();
  },
  async getText(url) {
    const res = await fetch(url, { signal: AbortSignal.timeout(timeoutMs) });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return res.text();
  },
});

export function originOf(url: string): string {
  try { return new URL(url).origin; } catch { return "(bad url)"; }
}

// ---------------------------------------------------------------------------
// Base and Ethereum
// ---------------------------------------------------------------------------

export class EvmSource implements BlockSource {
  readonly origin: string;
  constructor(readonly chain: "base" | "ethereum", readonly chainId: string, private readonly url: string, private readonly http: Http = defaultHttp()) {
    this.origin = originOf(url);
  }

  private async call(method: string, params: unknown[]): Promise<unknown> {
    let j: { result?: unknown; error?: { message?: string } };
    try {
      j = (await this.http.postJson(this.url, { jsonrpc: "2.0", id: 1, method, params })) as typeof j;
    } catch (e) {
      throw new Error(`${this.origin}: ${e instanceof Error ? e.message : String(e)}`);
    }
    if (j?.error) throw new Error(`${this.origin}: ${j.error.message ?? "rpc error"}`);
    return j?.result ?? null;
  }

  private head(b: RpcBlock): ChainHead {
    try { checkedBaseHeaderRlp(b); } catch (e) {
      throw new Error(`${this.origin}: ${this.chain} block ${parseInt(b.number, 16)} does not reproduce its hash`);
    }
    return { chain: this.chain, chainId: this.chainId, number: parseInt(b.number, 16), hash: b.hash.toLowerCase(), parentHash: b.parentHash.toLowerCase(), timestamp: parseInt(b.timestamp, 16) };
  }

  async latest(): Promise<ChainHead> {
    const b = (await this.call("eth_getBlockByNumber", ["latest", false])) as RpcBlock | null;
    if (!b) throw new Error(`${this.origin}: no latest block`);
    return this.head(b);
  }

  async at(n: number): Promise<ChainHead> {
    const b = (await this.call("eth_getBlockByNumber", ["0x" + n.toString(16), false])) as RpcBlock | null;
    if (!b) throw new Error(`${this.origin}: no ${this.chain} block ${n} yet`);
    const h = this.head(b);
    if (h.number !== n) throw new Error(`${this.origin}: asked for block ${n}, answered with ${h.number}`);
    return h;
  }

  async byHash(hash: string): Promise<{ head: ChainHead; canonical: boolean } | null> {
    const b = (await this.call("eth_getBlockByHash", [hash, false])) as RpcBlock | null;
    if (!b) return null;
    const head = this.head(b);
    if (head.hash !== hash.toLowerCase()) throw new Error(`${this.origin}: asked for ${hash}, answered with ${head.hash}`);
    const best = await this.at(head.number);
    return { head, canonical: best.hash === head.hash };
  }
}

// ---------------------------------------------------------------------------
// Bitcoin
// ---------------------------------------------------------------------------

const BITCOIN_MAINNET = "bip122:000000000019d6689c085ae165831e93";

/** An 80-byte header's hash, time and parent, checked against the hash it is claimed for. */
export function parseBitcoinHeader(hex: string, expectedHash: string): { hash: string; parentHash: string; timestamp: number } {
  if (!/^[0-9a-f]{160}$/i.test(hex)) throw new Error("a Bitcoin header is 80 bytes of hex");
  const bytes = Buffer.from(hex, "hex");
  const once = createHash("sha256").update(bytes).digest();
  const hash = Buffer.from(createHash("sha256").update(once).digest()).reverse().toString("hex");
  if (hash !== expectedHash.toLowerCase()) throw new Error(`the header hashes to ${hash}, not ${expectedHash}`);
  const parentHash = Buffer.from(bytes.subarray(4, 36)).reverse().toString("hex");
  return { hash, parentHash, timestamp: bytes.readUInt32LE(68) };
}

export class EsploraSource implements BlockSource {
  readonly chain = "bitcoin" as const;
  readonly origin: string;
  private readonly base: string;
  constructor(baseUrl: string, private readonly http: Http = defaultHttp(), readonly chainId: string = BITCOIN_MAINNET) {
    this.base = baseUrl.replace(/\/+$/, "");
    this.origin = originOf(baseUrl);
  }

  private async get(path: string): Promise<string> {
    try {
      return (await this.http.getText(this.base + path)).trim();
    } catch (e) {
      throw new Error(`${this.origin}: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  private async headAt(hash: string, number: number): Promise<ChainHead> {
    if (!/^[0-9a-f]{64}$/.test(hash)) throw new Error(`${this.origin}: ${JSON.stringify(hash.slice(0, 80))} is not a block hash`);
    let h: ReturnType<typeof parseBitcoinHeader>;
    try { h = parseBitcoinHeader(await this.get(`/block/${hash}/header`), hash); } catch (e) {
      throw new Error(`${this.origin}: block ${number}: ${e instanceof Error ? e.message : String(e)}`);
    }
    return { chain: "bitcoin", chainId: this.chainId, number, ...h };
  }

  async latest(): Promise<ChainHead> {
    const height = Number(await this.get("/blocks/tip/height"));
    if (!Number.isSafeInteger(height) || height < 0) throw new Error(`${this.origin}: no tip height`);
    return this.at(height);
  }

  async at(n: number): Promise<ChainHead> {
    return this.headAt((await this.get(`/block-height/${n}`)).toLowerCase(), n);
  }

  async byHash(hash: string): Promise<{ head: ChainHead; canonical: boolean } | null> {
    let status: { in_best_chain?: boolean; height?: number };
    try {
      status = JSON.parse(await this.get(`/block/${hash}/status`)) as typeof status;
    } catch (e) {
      if (e instanceof Error && /HTTP 404|HTTP 400/.test(e.message)) return null;
      throw e;
    }
    if (typeof status.height !== "number") return null;
    return { head: await this.headAt(hash.toLowerCase(), status.height), canonical: status.in_best_chain === true };
  }
}

// ---------------------------------------------------------------------------
// Two providers, one answer
// ---------------------------------------------------------------------------

export class CrossChecked implements BlockSource {
  readonly chain: TimelineChain;
  readonly chainId: string;
  readonly origin: string;
  constructor(private readonly a: BlockSource, private readonly b: BlockSource) {
    if (a.chain !== b.chain || a.chainId !== b.chainId) throw new Error("both sources must read the same chain");
    if (a.origin === b.origin) throw new Error(`both sources are ${a.origin}: a cross-check needs two providers`);
    this.chain = a.chain;
    this.chainId = a.chainId;
    this.origin = `${a.origin} + ${b.origin}`;
  }

  private agree(x: ChainHead, y: ChainHead): ChainHead {
    if (x.hash !== y.hash || x.parentHash !== y.parentHash || x.timestamp !== y.timestamp) {
      throw new Error(`${this.chain} block ${x.number}: ${this.a.origin} says ${x.hash}, ${this.b.origin} says ${y.hash}`);
    }
    return x;
  }

  /** The first provider's newest block, once the second has the same block at that height. */
  async latest(): Promise<ChainHead> {
    const x = await this.a.latest();
    return this.agree(x, await this.b.at(x.number));
  }

  async at(n: number): Promise<ChainHead> {
    const [x, y] = await Promise.all([this.a.at(n), this.b.at(n)]);
    return this.agree(x, y);
  }

  async byHash(hash: string): Promise<{ head: ChainHead; canonical: boolean } | null> {
    const [x, y] = await Promise.all([this.a.byHash(hash), this.b.byHash(hash)]);
    if (x === null && y === null) return null;
    if (x === null || y === null) throw new Error(`${this.chain} block ${hash}: only ${x ? this.a.origin : this.b.origin} knows it`);
    if (x.canonical !== y.canonical) throw new Error(`${this.chain} block ${hash}: the providers disagree on whether it is canonical`);
    return { head: this.agree(x.head, y.head), canonical: x.canonical };
  }
}
