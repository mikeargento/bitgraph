// Copyright (c) Argento Computing Inc. All rights reserved. See LICENSE.

/**
 * Floor links (2026-10-18: a Base floor is its own BitGraph, so BitGraph still writes each bind as
 * 2 counts). BitGraph 1 binds base-floor.json (the latest Base block) and BitGraph 2 binds the content right after it.
 * This route records, once, that BitGraph 1 is BitGraph 2's floor, after checking everything anyone could check
 * (lib/floor-link.ts):
 *   - both BitGraphs are in the ledger at the positions given, in the same epoch, BitGraph 2 after BitGraph 1;
 *   - base-floor.json hashes to BitGraph 1's signed digest;
 *   - Base has that block, with that hash and that time.
 * The bind is untouched: a link is a statement about two BitGraphs, never part of either proof.
 *
 * Since 2026-10-21 app/api/commit makes the floor for every bind and writes the link itself; this route stays for a
 * holder who has both proofs and the block file and wants the link written (or written again after a lost reply).
 *
 * GET  /api/floors?digest=&epoch=&counter=   the link for BitGraph 2 at that position, or 404
 * POST /api/floors { a: {digestB64, epochId, counter}, b: {digestB64, epochId, counter}, blockFile }
 */
import { NextResponse } from "next/server";
import { checkFloorLink } from "@/lib/floor-link";
import { getFloorLinkText, getProofAtPosition, putFloorLinkOnce, LedgerUnavailableError } from "@/lib/s3";

export const dynamic = "force-dynamic";

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
  if (typeof body.blockFile !== "string" || body.blockFile.length > 2048) return bad("blockFile is the text of base-floor.json");

  // Both BitGraphs in the ledger at the positions given.
  let pa: Record<string, unknown> | null, pb: Record<string, unknown> | null;
  try {
    [pa, pb] = await Promise.all([getProofAtPosition(a.digestB64, a.epochId, a.counter), getProofAtPosition(b.digestB64, b.epochId, b.counter)]);
  } catch (e) {
    if (e instanceof LedgerUnavailableError) return bad("the ledger could not be read just now", 503);
    throw e;
  }
  if (!pa || !pb) return bad("both BitGraphs must be in the ledger", 404);
  const ca = pa.commit as Commit, cb = pb.commit as Commit;
  if (ca.epochId !== a.epochId || cb.epochId !== b.epochId) return bad("the positions do not match the proofs");
  if (ca.counter !== a.counter || cb.counter !== b.counter) return bad("the positions do not match the proofs");

  const r = await checkFloorLink(pa, pb, body.blockFile);
  if (!r.ok) return bad(r.error, r.status);
  const stored = await putFloorLinkOnce(b.digestB64, b.epochId, b.counter, JSON.stringify(r.link, null, 2));
  return NextResponse.json({ verified: true, stored, link: r.link });
}
