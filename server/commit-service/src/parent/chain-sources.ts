// Copyright (c) Argento Computing Inc. All rights reserved. See LICENSE.

/**
 * Block sources for the timeline: what the parent reads from Base and Ethereum before it binds a
 * bitgraph-block-read/1 file (packages/verify/src/block-read.ts). Nothing here writes to any chain. Base and Ethereum
 * only: their block timestamps follow real time closely enough for the verifier's time checks, and Ethereum keeps
 * brackets coming while Base is down.
 *
 * One source is one JSON-RPC provider (EvmSource). Every block is rebuilt into its header RLP and kept only when
 * keccak-256 of that reproduces the hash the node reported (base-head.ts), so the number, time and parent hash are the
 * block's own, not the node's say-so. ready() checks that the node serves the chain id it is configured for.
 *
 * CrossChecked takes two sources of one chain and keeps a block only when both report the same hash at that
 * height. When either cannot answer, the read fails: a chain with one provider up is a chain that is down, and the
 * poller reads the missed blocks in order once both are back. The first source is the one polled for the head; the
 * second only confirms blocks, which keeps a metered provider's use to one call per block.
 *
 * URLs may carry API keys, so only an endpoint's origin appears in any message.
 */

import { checkedBaseHeaderRlp, type RpcBlock } from "./base-head.js";

export type TimelineChain = "base" | "ethereum";

/** A block as the timeline uses it. Hashes are 0x and lowercase hex. */
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
  /** Throws unless the provider serves the configured chain. */
  ready(): Promise<void>;
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

  async ready(): Promise<void> {
    const id = (await this.call("eth_chainId", [])) as string | null;
    const want = this.chainId.replace(/^eip155:/, "");
    if (typeof id !== "string" || parseInt(id, 16) !== Number(want)) {
      throw new Error(`${this.origin}: serves chain ${id === null ? "?" : parseInt(id, 16)}, not ${this.chainId}`);
    }
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

  async ready(): Promise<void> {
    await Promise.all([this.a.ready(), this.b.ready()]);
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

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

/** The CAIP-2 ids each chain may be configured with: mainnet, then the test network for local runs. */
export const TIMELINE_CHAIN_IDS: Readonly<Record<TimelineChain, readonly string[]>> = {
  base: ["eip155:8453", "eip155:84532"],
  ethereum: ["eip155:1", "eip155:11155111"],
};

/**
 * The cross-checked sources, from the environment. Each list is exactly two comma-separated URLs, the head poller
 * first and the confirmer second:
 *
 *   TIMELINE_BASE_RPC_URLS          e.g. a Coinbase Developer Platform endpoint, then an Alchemy one
 *   TIMELINE_ETHEREUM_RPC_URLS      e.g. https://ethereum-rpc.publicnode.com, then an Alchemy one
 *   TIMELINE_BASE_CHAIN_ID          default eip155:8453
 *   TIMELINE_ETHEREUM_CHAIN_ID      default eip155:1
 *
 * A chain whose list is missing or malformed is not read, and the reason is in `problems`.
 */
export function timelineSourcesFromEnv(env: NodeJS.ProcessEnv = process.env, http: Http = defaultHttp()): { sources: Partial<Record<TimelineChain, CrossChecked>>; problems: string[] } {
  const sources: Partial<Record<TimelineChain, CrossChecked>> = {};
  const problems: string[] = [];
  for (const chain of ["base", "ethereum"] as const) {
    const key = `TIMELINE_${chain.toUpperCase()}_RPC_URLS`;
    const urls = (env[key] ?? "").split(",").map((u) => u.trim()).filter(Boolean);
    const chainId = env[`TIMELINE_${chain.toUpperCase()}_CHAIN_ID`]?.trim() || TIMELINE_CHAIN_IDS[chain][0]!;
    if (!TIMELINE_CHAIN_IDS[chain].includes(chainId)) { problems.push(`${chain}: ${chainId} is not one of ${TIMELINE_CHAIN_IDS[chain].join(", ")}`); continue; }
    if (urls.length !== 2) { problems.push(`${chain}: ${key} needs exactly two URLs, has ${urls.length}`); continue; }
    if (urls.some((u) => !/^https:\/\//.test(u))) { problems.push(`${chain}: every URL in ${key} must be https`); continue; }
    try {
      sources[chain] = new CrossChecked(new EvmSource(chain, chainId, urls[0]!, http), new EvmSource(chain, chainId, urls[1]!, http));
    } catch (e) {
      problems.push(`${chain}: ${e instanceof Error ? e.message : String(e)}`);
    }
  }
  return { sources, problems };
}
