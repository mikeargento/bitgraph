// Copyright (c) Argento Computing Inc. All rights reserved. See LICENSE.

/**
 * Floor links (Mike, 2026-10-18: "base floors are just their own bitgraph"; "it keeps bitgraph just writing bitgraph as
 * 2 counts"). With the Base switch on, BitGraph 1 binds base-block.json (the latest Base block) and BitGraph 2 binds the
 * content right after it. This route records, once, that BitGraph 1 is BitGraph 2's floor, after checking everything
 * anyone could check:
 *   - both BitGraphs are in the ledger at the positions given, in the same epoch, BitGraph 2 after BitGraph 1;
 *   - base-block.json hashes to BitGraph 1's signed digest;
 *   - Base has that block, with that hash and that time.
 * The bind is untouched: a link is a statement about two BitGraphs, never part of either proof.
 *
 * GET  /api/floors?digest=&epoch=&counter=   the link for BitGraph 2 at that position, or 404
 * POST /api/floors { a: {digestB64, epochId, counter}, b: {digestB64, epochId, counter}, blockFile }
 */
import { NextResponse } from "next/server";
import { verifyAttested } from "@mikeargento/bitgraph-verify";
import { createHash } from "node:crypto";
import { getFloorLinkText, getProofAtPosition, putFloorLinkOnce, LedgerUnavailableError } from "@/lib/s3";

export const dynamic = "force-dynamic";

const RPC = process.env.BASE_RPC_URL ?? "https://mainnet.base.org";
const B64 = /^[A-Za-z0-9+/_-]{43}=?$/;
const COUNTER = /^\d{1,15}$/;

type Ref = { digestB64: string; epochId: string; counter: string };
type Commit = { epochId?: string; counter?: string; slotCounter?: string };
const std = (s: string) => { const t = s.replace(/-/g, "+").replace(/_/g, "/"); return t.length === 43 ? `${t}=` : t; };
const refOf = (x: unknown): Ref | null => {
  const r = x as Partial<Ref> | null;
  if (!r || typeof r.digestB64 !== "string" || typeof r.epochId !== "string" || typeof r.counter !== "string") return null;
  if (!B64.test(r.digestB64) || !B64.test(r.epochId) || !COUNTER.test(r.counter)) return null;
  return { digestB64: std(r.digestB64), epochId: std(r.epochId), counter: r.counter };
};
const bad = (error: string, status = 400) => NextResponse.json({ error }, { status });

export async function GET(req: Request) {
  const q = new URL(req.url).searchParams;
  const ref = refOf({ digestB64: q.get("digest"), epochId: q.get("epoch"), counter: q.get("counter") });
  if (!ref) return bad("digest, epoch and counter are required");
  try {
    const text = await getFloorLinkText(ref.digestB64, ref.epochId, ref.counter);
    if (!text) return NextResponse.json({ error: "no floor link" }, { status: 404 });
    return new NextResponse(text, { headers: { "content-type": "application/json", "cache-control": "public, max-age=60" } });
  } catch (e) {
    if (e instanceof LedgerUnavailableError) return bad("the ledger could not be read just now", 503);
    throw e;
  }
}

export async function POST(req: Request) {
  let body: { a?: unknown; b?: unknown; blockFile?: unknown };
  try { body = await req.json(); } catch { return bad("not JSON"); }
  const a = refOf(body.a), b = refOf(body.b);
  if (!a || !b) return bad("a and b need digestB64, epochId and counter");
  if (typeof body.blockFile !== "string" || body.blockFile.length > 2048) return bad("blockFile is the text of base-block.json");
  const blockFile = body.blockFile;

  // base-block.json is BitGraph 1's content: its SHA-256 must be BitGraph 1's digest.
  if (createHash("sha256").update(blockFile, "utf8").digest("base64") !== a.digestB64) return bad("blockFile is not BitGraph 1's content");
  let block: { format?: string; chainId?: number; number?: number; hash?: string; timestamp?: number };
  try { block = JSON.parse(blockFile); } catch { return bad("blockFile is not JSON"); }
  if (block.format !== "bitgraph-base-floor/1" || block.chainId !== 8453 || !Number.isSafeInteger(block.number) || typeof block.hash !== "string" || !/^0x[0-9a-f]{64}$/.test(block.hash) || !Number.isSafeInteger(block.timestamp)) {
    return bad("blockFile is not a Base block record");
  }

  // Both BitGraphs in the ledger, same epoch, B after A.
  let pa: Record<string, unknown> | null, pb: Record<string, unknown> | null;
  try {
    [pa, pb] = await Promise.all([getProofAtPosition(a.digestB64, a.epochId, a.counter), getProofAtPosition(b.digestB64, b.epochId, b.counter)]);
  } catch (e) {
    if (e instanceof LedgerUnavailableError) return bad("the ledger could not be read just now", 503);
    throw e;
  }
  if (!pa || !pb) return bad("both BitGraphs must be in the ledger", 404);
  const ca = pa.commit as Commit, cb = pb.commit as Commit;
  if (ca.epochId !== a.epochId || cb.epochId !== b.epochId || a.epochId !== b.epochId) return bad("BitGraph 1 and 2 must be in the same epoch");
  if (ca.counter !== a.counter || cb.counter !== b.counter) return bad("the positions do not match the proofs");
  if (!(Number(cb.slotCounter ?? cb.counter) > Number(ca.counter))) return bad("BitGraph 2 must come after BitGraph 1");

  // Both proofs checked in full (2026-10-18 audit): signature, counts and the AWS Nitro attestation, pinned to
  // BitGraph's published images; never the ledger's word alone. BitGraph 1 with its own content, the block file.
  const [va, vb] = await Promise.all([
    verifyAttested({ proof: pa as never, bytes: new TextEncoder().encode(blockFile) }),
    verifyAttested({ proof: pb as never }),
  ]);
  if (!va.valid) return bad(`BitGraph 1 does not verify: ${va.reason}`);
  if (!vb.valid) return bad(`BitGraph 2 does not verify: ${vb.reason}`);
  // A fresh read: the block is at most two minutes older than BitGraph 1's attested bind, and BitGraph 2 was bound
  // after BitGraph 1. A stale block would still be a true floor, only a loose one; first writer wins, so refuse it.
  const blockMs = block.timestamp! * 1000;
  if (va.attestedAtMs === null || vb.attestedAtMs === null) return bad("the attestations carry no time");
  if (blockMs > va.attestedAtMs + 5_000) return bad("the block is newer than BitGraph 1's bind");
  if (va.attestedAtMs - blockMs > 120_000) return bad("the block was more than two minutes old when BitGraph 1 was bound");
  if (vb.attestedAtMs < va.attestedAtMs) return bad("BitGraph 2's attested time is before BitGraph 1's");

  // Base has the block, with that hash and time.
  try {
    const res = await fetch(RPC, {
      method: "POST", headers: { "content-type": "application/json" }, cache: "no-store", signal: AbortSignal.timeout(8000),
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "eth_getBlockByNumber", params: [`0x${block.number!.toString(16)}`, false] }),
    });
    const onchain = ((await res.json()) as { result?: { hash?: string; timestamp?: string } }).result;
    if (!onchain?.hash) return bad("Base did not answer for that block", 502);
    if (onchain.hash.toLowerCase() !== block.hash || parseInt(onchain.timestamp ?? "0x0", 16) !== block.timestamp) return bad("that block is not on Base with that hash and time");
  } catch {
    return bad("Base did not answer just now", 502);
  }

  const link = {
    format: "bitgraph-floor-link/1",
    floor: { bitgraph: { ...a, proofHash: (pa as { proofHash?: string }).proofHash ?? null }, chain: "base-mainnet", chainId: 8453, blockNumber: block.number, blockHash: block.hash, blockTimestamp: block.timestamp },
    record: { ...b, proofHash: (pb as { proofHash?: string }).proofHash ?? null },
    blockFile,
    checked: ["blockFile hashes to BitGraph 1's digest", "Base has that block with that hash and time", "both in the ledger, same epoch, BitGraph 2 after BitGraph 1", "both proofs verified in full, AWS Nitro attestation included, on BitGraph's published images", "the block was at most two minutes old at BitGraph 1's attested bind"],
  };
  const stored = await putFloorLinkOnce(b.digestB64, b.epochId, b.counter, JSON.stringify(link, null, 2));
  return NextResponse.json({ verified: true, stored, link });
}
