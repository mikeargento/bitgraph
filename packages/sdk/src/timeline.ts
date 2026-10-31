// Copyright (c) 2024-2026 Argento Computing Inc. Licensed under the MIT License. See LICENSE.

/**
 * Checking a timeline bundle (bitgraph-timeline-bundle/1) against the real chains. verifyTimelineBundle never
 * fetches; this supplies its lookups from JSON-RPC nodes, one or two per chain:
 *
 *   block        eth_getBlockByHash; kept only when the header the node returns reproduces the hash
 *                (headerRlpFromRpc), so number and time are the block's own; canonical when eth_getBlockByNumber
 *                at that height returns the same hash; the chain id is the node's own (eth_chainId).
 *   genesisTx    eth_getTransactionByHash on Base, for the epoch's genesis write.
 *   genesisBlock eth_getBlockByHash on Base, header checked the same way.
 *
 * With two nodes for a chain both are asked and must agree, or the lookup throws and the bundle is unconfirmed
 * rather than judged on one node's word. Defaults are public endpoints, for occasional checks.
 */

import {
  verifyTimelineBundle, headerRlpFromRpc,
  type TimelineLookups, type TimelineBundleResult, type ChainBlock, type BlockReadChain, type EpochGenesisTx, type EpochGenesisBlock,
} from "@mikeargento/bitgraph-verify";

export const DEFAULT_TIMELINE_RPCS: Readonly<Record<BlockReadChain, readonly string[]>> = {
  base: ["https://mainnet.base.org"],
  ethereum: ["https://ethereum-rpc.publicnode.com"],
};

type Fetch = (url: string, init: { method: string; headers: Record<string, string>; body: string; signal?: AbortSignal }) => Promise<{ ok: boolean; status: number; json(): Promise<unknown> }>;

const origin = (u: string) => { try { return new URL(u).origin; } catch { return "(bad url)"; } };

async function rpc(fetchFn: Fetch, url: string, method: string, params: unknown[]): Promise<unknown> {
  let res: Awaited<ReturnType<Fetch>>;
  try {
    res = await fetchFn(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }), signal: AbortSignal.timeout(15_000) });
  } catch (e) {
    throw new Error(`${origin(url)}: ${e instanceof Error ? e.message : String(e)}`);
  }
  if (!res.ok) throw new Error(`${origin(url)}: HTTP ${res.status}`);
  const j = (await res.json()) as { result?: unknown; error?: { message?: string } };
  if (j.error) throw new Error(`${origin(url)}: ${j.error.message ?? "rpc error"}`);
  return j.result ?? null;
}

interface RpcBlockJson { hash: string; number: string; timestamp: string; [k: string]: unknown }

async function blockOn(fetchFn: Fetch, url: string, hash: string): Promise<ChainBlock | null> {
  const [id, b] = await Promise.all([rpc(fetchFn, url, "eth_chainId", []), rpc(fetchFn, url, "eth_getBlockByHash", [hash, false])]);
  if (b === null) return null;
  const blk = b as RpcBlockJson;
  if (!headerRlpFromRpc(blk as never, hash)) throw new Error(`${origin(url)}: block ${hash} does not reproduce its hash`);
  const number = parseInt(blk.number, 16);
  const best = (await rpc(fetchFn, url, "eth_getBlockByNumber", ["0x" + number.toString(16), false])) as RpcBlockJson | null;
  return { chainId: `eip155:${parseInt(String(id), 16)}`, hash: blk.hash.toLowerCase(), number, timestamp: parseInt(blk.timestamp, 16), canonical: best?.hash?.toLowerCase() === hash.toLowerCase() };
}

/** Ask every node; they must agree. */
async function agreed<T>(urls: readonly string[], ask: (url: string) => Promise<T>, what: string): Promise<T> {
  if (urls.length === 0) throw new Error(`no node configured for ${what}`);
  const answers = await Promise.all(urls.map(ask));
  const first = JSON.stringify(answers[0]);
  for (let i = 1; i < answers.length; i++) {
    if (JSON.stringify(answers[i]) !== first) throw new Error(`${what}: ${origin(urls[0]!)} and ${origin(urls[i]!)} disagree`);
  }
  return answers[0]!;
}

export function rpcTimelineLookups(opts: { base?: readonly string[]; ethereum?: readonly string[]; fetch?: Fetch } = {}): TimelineLookups {
  const fetchFn = opts.fetch ?? (globalThis.fetch as unknown as Fetch);
  const nodes: Record<BlockReadChain, readonly string[]> = { base: opts.base ?? DEFAULT_TIMELINE_RPCS.base, ethereum: opts.ethereum ?? DEFAULT_TIMELINE_RPCS.ethereum };
  return {
    block: (chain, _chainId, hash) => agreed(nodes[chain], (u) => blockOn(fetchFn, u, hash), `${chain} block ${hash}`),
    genesisTx: (txHash) => agreed(nodes.base, async (u): Promise<EpochGenesisTx | null> => {
      const t = (await rpc(fetchFn, u, "eth_getTransactionByHash", [txHash])) as { from: string; to: string | null; input: string; blockHash: string | null; blockNumber: string | null } | null;
      return t ? { from: t.from.toLowerCase(), to: t.to?.toLowerCase() ?? null, input: t.input.toLowerCase(), blockHash: t.blockHash?.toLowerCase() ?? null, blockNumber: t.blockNumber ? parseInt(t.blockNumber, 16) : null } : null;
    }, `Base transaction ${txHash}`),
    genesisBlock: (hash) => agreed(nodes.base, async (u): Promise<EpochGenesisBlock | null> => {
      const b = await blockOn(fetchFn, u, hash);
      return b ? { hash: b.hash, number: b.number, timestamp: b.timestamp } : null;
    }, `Base block ${hash}`),
  };
}

/** verifyTimelineBundle with the real chains as lookups (or none, offline). */
export async function verifyTimelineBundleOnline(bundle: unknown, opts: { fileBytes?: Uint8Array; base?: readonly string[]; ethereum?: readonly string[]; offline?: boolean; fetch?: Fetch } = {}): Promise<TimelineBundleResult> {
  return verifyTimelineBundle({
    bundle,
    ...(opts.fileBytes ? { fileBytes: opts.fileBytes } : {}),
    ...(opts.offline ? {} : { lookups: rpcTimelineLookups({ ...(opts.base ? { base: opts.base } : {}), ...(opts.ethereum ? { ethereum: opts.ethereum } : {}), ...(opts.fetch ? { fetch: opts.fetch } : {}) }) }),
  });
}
