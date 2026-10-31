import { NextResponse } from "next/server";
import { batchKeysWithLive, spanState } from "@/lib/timeline-ledger";

/* The state of one of the ledger's reads rows (lib/timeline-ledger.ts), recounted now: the live page asks again for a
   row it showed as uploading once its batch should be in the bucket. ?epoch=<url-safe id>&from=<count>&to=<count> */

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
    return NextResponse.json({ state: spanState(from, to, await batchKeysWithLive(epoch, true)) }, { headers: { "Cache-Control": "no-store" } });
  } catch {
    return NextResponse.json({ error: "the timeline could not be read" }, { status: 503 });
  }
}
