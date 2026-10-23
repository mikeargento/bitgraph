import { NextResponse } from "next/server";
import { ledgerPage, rowsAfter } from "@/lib/running-ledger";

/* The running ledger's rows, for the live page (Mike, 2026-10-17: "bitgraph ledger needs to dynamically load"):
   ?after=<key>  today's BitGraphs made after that row, newest first (the poll; costs the same however long the day);
   ?day=<YYYY-MM-DD>&before=<key>  the 200 before that row (Show older). */

export const dynamic = "force-dynamic";

const KEY = /^proofs\/[A-Za-z0-9_=+-]+\/\d{12}-[A-Za-z0-9_-]{43}\.json$/;

export async function GET(req: Request) {
  const q = new URL(req.url).searchParams;
  const after = q.get("after");
  const before = q.get("before");
  const day = q.get("day");
  try {
    if (before !== null) {
      if (!KEY.test(before) || !day || !/^\d{4}-\d{2}-\d{2}$/.test(day)) return NextResponse.json({ error: "bad request" }, { status: 400 });
      return NextResponse.json(await ledgerPage(day, 200, before), { headers: { "Cache-Control": "public, s-maxage=30" } });
    }
    if (after !== null && after !== "" && !KEY.test(after)) return NextResponse.json({ error: "bad request" }, { status: 400 });
    return NextResponse.json(await rowsAfter(after || null), { headers: { "Cache-Control": "no-store" } });
  } catch {
    return NextResponse.json({ error: "ledger unavailable" }, { status: 503 });
  }
}
