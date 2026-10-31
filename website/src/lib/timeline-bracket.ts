// Copyright (c) Argento Computing Inc. All rights reserved. See LICENSE.

/**
 * A BitGraph's place on the block timeline, for its proof page: the enclave host's bundle for the record
 * (GET /timeline/bundle), checked here with verifyTimelineBundle against the real chains. The floor is the Base (or,
 * with Base down, Ethereum) block the record was bound after; the ceiling, the first block stamped after the record's
 * Nitro time and read within the lag limits. No chain is written for either.
 *
 * The lookups ask two public nodes per chain, which must agree (the same rules as the SDK's rpcTimelineLookups,
 * packages/sdk/src/timeline.ts, kept here because the site does not depend on the SDK).
 */

import { headerRlpFromRpc, verifyTimelineBundle, type TimelineLookups, type TimelineBundleResult, type ChainBlock, type BlockReadChain } from "@mikeargento/bitgraph-verify";

const BUNDLE_URL = process.env.TIMELINE_BUNDLE_URL || "https://nitro.occproof.com/timeline/bundle";
const NODES: Record<BlockReadChain, string[]> = {
  base: (process.env.TIMELINE_VERIFY_BASE_RPCS || "https://base-rpc.publicnode.com,https://mainnet.base.org").split(","),
  ethereum: (process.env.TIMELINE_VERIFY_ETHEREUM_RPCS || "https://ethereum-rpc.publicnode.com,https://eth.drpc.org").split(","),
};

export interface TimelineBracket {
  /** verified: checked against the chains; pending: the ceiling's block is not read yet; none: no timeline record. */
  state: "verified" | "unconfirmed" | "failed" | "pending" | "none";
  /** Each with the block read's own BitGraph (its count and digest), whose page names the block. */
  floor: { chain: BlockReadChain; number: number; hash: string; timestamp: number; counter: string; digestB64: string } | null;
  ceiling: { chain: BlockReadChain; number: number; hash: string; timestamp: number; lagS: number; counter: string; digestB64: string } | null;
  genesis: TimelineBundleResult["genesis"] | null;
  preGenesis: boolean | null;
  reasons: string[];
}

async function rpc(url: string, method: string, params: unknown[]): Promise<unknown> {
  const r = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }), signal: AbortSignal.timeout(10_000), cache: "no-store" });
  if (!r.ok) throw new Error(`${new URL(url).origin}: HTTP ${r.status}`);
  const j = (await r.json()) as { result?: unknown; error?: { message?: string } };
  if (j.error) throw new Error(`${new URL(url).origin}: ${j.error.message ?? "rpc error"}`);
  return j.result ?? null;
}

async function blockOn(url: string, hash: string): Promise<ChainBlock | null> {
  const [id, b] = await Promise.all([rpc(url, "eth_chainId", []), rpc(url, "eth_getBlockByHash", [hash, false])]);
  if (b === null) return null;
  const blk = b as { hash: string; number: string; timestamp: string };
  if (!headerRlpFromRpc(blk as never, hash)) throw new Error(`${new URL(url).origin}: block ${hash} does not reproduce its hash`);
  const number = parseInt(blk.number, 16);
  const best = (await rpc(url, "eth_getBlockByNumber", ["0x" + number.toString(16), false])) as { hash?: string } | null;
  return { chainId: `eip155:${parseInt(String(id), 16)}`, hash: blk.hash.toLowerCase(), number, timestamp: parseInt(blk.timestamp, 16), canonical: best?.hash?.toLowerCase() === hash.toLowerCase() };
}

async function agreed<T>(urls: string[], ask: (u: string) => Promise<T>): Promise<T> {
  const answers = await Promise.all(urls.map(ask));
  if (answers.some((a) => JSON.stringify(a) !== JSON.stringify(answers[0]))) throw new Error("the nodes disagree");
  return answers[0]!;
}

const lookups: TimelineLookups = {
  block: (chain, _id, hash) => agreed(NODES[chain], (u) => blockOn(u, hash)),
  genesisTx: (txHash) => agreed(NODES.base, async (u) => {
    const t = (await rpc(u, "eth_getTransactionByHash", [txHash])) as { from: string; to: string | null; input: string; blockHash: string | null; blockNumber: string | null } | null;
    return t ? { from: t.from.toLowerCase(), to: t.to?.toLowerCase() ?? null, input: t.input.toLowerCase(), blockHash: t.blockHash?.toLowerCase() ?? null, blockNumber: t.blockNumber ? parseInt(t.blockNumber, 16) : null } : null;
  }),
  genesisBlock: (hash) => agreed(NODES.base, async (u) => {
    const b = await blockOn(u, hash);
    return b ? { hash: b.hash, number: b.number, timestamp: b.timestamp } : null;
  }),
};

const NONE: TimelineBracket = { state: "none", floor: null, ceiling: null, genesis: null, preGenesis: null, reasons: [] };

/** The record at `counter` of `epoch` (URL-safe base64), its bundle fetched and checked. */
export async function timelineBracket(epoch: string, counter: string): Promise<TimelineBracket> {
  let res: Response;
  try {
    res = await fetch(`${BUNDLE_URL}?epoch=${epoch}&counter=${counter}`, { cache: "no-store", signal: AbortSignal.timeout(10_000) });
  } catch {
    return { ...NONE, state: "unconfirmed", reasons: ["the enclave host could not be asked for the bundle"] };
  }
  if (res.status === 409) return { ...NONE, state: "pending" };
  if (!res.ok) return NONE;
  const j = (await res.json()) as { bundle?: { proofs?: Array<{ artifact?: { digestB64?: string } }> } };
  const r = await verifyTimelineBundle({ bundle: j.bundle, lookups });
  const digestAt = (i: number) => j.bundle?.proofs?.[i]?.artifact?.digestB64 ?? "";
  return {
    state: r.status,
    floor: r.floor ? { chain: r.floor.chain, number: r.floor.number, hash: r.floor.hash, timestamp: r.floor.timestamp, counter: r.floor.counter, digestB64: digestAt(r.floor.index) } : null,
    ceiling: r.ceiling ? { chain: r.ceiling.chain, number: r.ceiling.number, hash: r.ceiling.hash, timestamp: r.ceiling.timestamp, lagS: r.ceiling.lagS, counter: r.ceiling.counter, digestB64: digestAt(r.ceiling.index) } : null,
    genesis: r.genesis,
    preGenesis: r.preGenesis,
    reasons: [...r.reasons, ...r.unconfirmed],
  };
}
