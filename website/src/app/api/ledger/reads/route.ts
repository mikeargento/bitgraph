import { NextResponse } from "next/server";
import { readsBetween } from "@/lib/timeline-ledger";

/* The records inside one of the ledger's collapsed reads rows (lib/timeline-ledger.ts):
   ?epoch=<url-safe id>&from=<count>&to=<count>, newest first, each block read with its chain and block number. */

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const q = new URL(req.url).searchParams;
  const epoch = q.get("epoch") ?? "";
  const from = Number(q.get("from"));
  const to = Number(q.get("to"));
  if (!/^[A-Za-z0-9_-]{43}$/.test(epoch) || !Number.isSafeInteger(from) || !Number.isSafeInteger(to) || from < 2 || to < from || from % 2 || to % 2) {
    return NextResponse.json({ error: "bad request" }, { status: 400 });
  }
  try {
    const r = await readsBetween(epoch, from, to);
    // The newest run includes live records, so nothing is cached at the edge for long.
    return NextResponse.json(r, { headers: { "Cache-Control": "public, s-maxage=2" } });
  } catch {
    return NextResponse.json({ error: "the timeline could not be read" }, { status: 503 });
  }
}
