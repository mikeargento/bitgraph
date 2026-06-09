import { NextRequest, NextResponse } from "next/server";
import { getAnchorsAfterCounter, getAnchorBeforeCounter } from "@/lib/s3";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  try {
    const counter = req.nextUrl.searchParams.get("counter");
    const epoch = req.nextUrl.searchParams.get("epoch");
    const before = req.nextUrl.searchParams.get("before");

    if (!counter || !epoch) {
      return NextResponse.json({ error: "counter and epoch params required" }, { status: 400 });
    }

    // before=1 returns the nearest same-epoch anchor BEFORE this counter (the
    // lower time bound). Default returns anchors AFTER this counter (upper bound).
    if (before === "1") {
      const anchor = await getAnchorBeforeCounter(parseInt(counter, 10), epoch);
      return NextResponse.json({ anchors: anchor ? [anchor] : [] });
    }

    const anchors = await getAnchorsAfterCounter(parseInt(counter, 10), epoch, 2);
    return NextResponse.json({ anchors });
  } catch (e) {
    console.error("GET /api/proofs/anchors error:", e);
    return NextResponse.json({ error: "Failed" }, { status: 500 });
  }
}
