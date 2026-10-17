import { NextResponse } from "next/server";
import { countToday } from "@/lib/running-ledger";

/* The running ledger's heartbeat: today's UTC day and how many proofs it has.
   The /ledger page polls this and refreshes its rows only when the count moves.
   A count, never a row: nothing here names a record. */

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    return NextResponse.json(await countToday(), { headers: { "Cache-Control": "public, s-maxage=5" } });
  } catch {
    return NextResponse.json({ error: "ledger unavailable" }, { status: 503 });
  }
}
