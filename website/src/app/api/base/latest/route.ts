// Copyright (c) Argento Computing Inc. All rights reserved. See LICENSE.

/**
 * The latest Base block, for the Base plugin's first BitGraph (Mike, 2026-10-18: "it reads in the most recent base
 * block in bitgraph 1, records the content in bitgraph 2, then writes to base"). Read here rather than in the
 * browser so the page needs no RPC of its own; the block is public, and anyone can look it up by number and hash.
 */
import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

const RPC = process.env.BASE_RPC_URL ?? "https://mainnet.base.org";

export async function GET() {
  try {
    const res = await fetch(RPC, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "eth_getBlockByNumber", params: ["latest", false] }),
      cache: "no-store",
      signal: AbortSignal.timeout(8000),
    });
    const body = (await res.json()) as { result?: { number?: string; hash?: string; timestamp?: string } };
    const b = body.result;
    if (!res.ok || !b?.number || !b.hash || !b.timestamp) return NextResponse.json({ error: "Base did not answer" }, { status: 502 });
    return NextResponse.json(
      { chain: "base-mainnet", chainId: 8453, number: parseInt(b.number, 16), hash: b.hash, timestamp: parseInt(b.timestamp, 16) },
      { headers: { "cache-control": "no-store" } },
    );
  } catch {
    return NextResponse.json({ error: "Base did not answer" }, { status: 502 });
  }
}
