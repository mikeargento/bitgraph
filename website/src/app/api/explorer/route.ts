import { NextRequest, NextResponse } from "next/server";
import { rollFeed } from "@/lib/roll-feed";

// Read-only explorer feed. A thin adapter over lib/roll-feed, which the
// server-rendered /roll page calls directly (a route handler is only reachable
// over HTTP, and the page fetching itself would put the network back in the
// path this exists to take it out of).

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  try {
    const p = req.nextUrl.searchParams;
    const result = await rollFeed({
      day: p.get("day"),
      before: p.get("before"),
      bepoch: p.get("bepoch"),
      // Archived days page by page NUMBER, and it is a separate parameter from
      // `before` on purpose: the two cursors mean different things and must
      // never be handed to the reader that understands the other one.
      page: p.get("page"),
      filesOnly: p.get("files") === "1",
    });
    return NextResponse.json(result.body, {
      status: result.status,
      ...(result.cacheControl ? { headers: { "Cache-Control": result.cacheControl } } : {}),
    });
  } catch (e) {
    console.error("GET /api/explorer error:", e);
    return NextResponse.json({ error: "failed" }, { status: 500 });
  }
}
