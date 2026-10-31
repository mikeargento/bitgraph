// Copyright (c) Argento Computing Inc. All rights reserved. See LICENSE.

/**
 * The canonical Base blocks of a range, from JSON-RPC nodes, for the daily audit: batched eth_getBlockByNumber
 * (headers only), from every node given; a block counts only when every node gives the same hash and time. Nodes
 * that rate-limit are retried with backoff; a block still unanswered is left out (the audit reports it unchecked).
 */

import type { CanonicalBlock } from "./base-day.js";

export type PostJson = (url: string, body: unknown) => Promise<{ status: number; json: unknown }>;

export const defaultPost: PostJson = async (url, body) => {
  const r = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body), signal: AbortSignal.timeout(30_000) });
  return { status: r.status, json: await r.json().catch(() => null) };
};

const origin = (u: string) => { try { return new URL(u).origin; } catch { return "(bad url)"; } };
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function batchFrom(post: PostJson, url: string, numbers: number[], tries = 6): Promise<Map<number, CanonicalBlock>> {
  const body = numbers.map((n, i) => ({ jsonrpc: "2.0", id: i, method: "eth_getBlockByNumber", params: ["0x" + n.toString(16), false] }));
  for (let t = 0; ; t++) {
    let r: { status: number; json: unknown };
    try { r = await post(url, body); } catch (e) { r = { status: 0, json: String(e) }; }
    if (r.status === 200 && Array.isArray(r.json)) {
      const out = new Map<number, CanonicalBlock>();
      for (const item of r.json as Array<{ id?: number; result?: { number?: string; hash?: string; timestamp?: string } | null }>) {
        const b = item.result;
        if (b?.number && b.hash && b.timestamp) out.set(parseInt(b.number, 16), { number: parseInt(b.number, 16), hash: b.hash.toLowerCase(), timestamp: parseInt(b.timestamp, 16) });
      }
      if (out.size === numbers.length || t >= tries) return out;
    } else if (t >= tries) {
      throw new Error(`${origin(url)}: HTTP ${r.status} after ${tries + 1} tries`);
    }
    await sleep(Math.min(30_000, 500 * 2 ** t));
  }
}

export async function canonicalBlocks(args: { urls: readonly string[]; first: number; last: number; post?: PostJson; batch?: number; concurrency?: number; log?: (m: string) => void }): Promise<{ blocks: Map<number, CanonicalBlock>; disagreements: number[] }> {
  const post = args.post ?? defaultPost;
  const size = args.batch ?? 50;
  const chunks: number[][] = [];
  for (let n = args.first; n <= args.last; n += size) chunks.push(Array.from({ length: Math.min(size, args.last - n + 1) }, (_, i) => n + i));
  const perNode = args.urls.map(() => new Map<number, CanonicalBlock>());
  let next = 0;
  let done = 0;
  const worker = async () => {
    for (;;) {
      const i = next++;
      if (i >= chunks.length) return;
      await Promise.all(args.urls.map(async (u, k) => {
        try { for (const [n, b] of await batchFrom(post, u, chunks[i]!)) perNode[k]!.set(n, b); }
        catch (e) { args.log?.(`[audit] ${e instanceof Error ? e.message : String(e)}`); }
      }));
      done++;
      if (done % 100 === 0) args.log?.(`[audit] ${done}/${chunks.length} batches`);
    }
  };
  await Promise.all(Array.from({ length: args.concurrency ?? 3 }, worker));
  const blocks = new Map<number, CanonicalBlock>();
  const disagreements: number[] = [];
  for (let n = args.first; n <= args.last; n++) {
    const answers = perNode.map((m) => m.get(n));
    if (answers.some((a) => !a)) continue;
    const a0 = answers[0]!;
    if (answers.every((a) => a!.hash === a0.hash && a!.timestamp === a0.timestamp)) blocks.set(n, a0);
    else disagreements.push(n);
  }
  return { blocks, disagreements };
}
