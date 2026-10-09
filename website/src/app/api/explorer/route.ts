import { NextRequest, NextResponse } from "next/server";
import { ledgerFeed } from "@/lib/ledger-feed";

// Read-only explorer feed, Ethereum anchors only. A thin adapter over lib/ledger-feed, which the
// server-rendered /day page calls directly (a route handler is only reachable
// over HTTP, and the page fetching itself would put the network back in the
// path this exists to take it out of).

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  try {
    const p = req.nextUrl.searchParams;
    const result = await ledgerFeed({
      day: p.get("day"),
      before: p.get("before"),
      bepoch: p.get("bepoch"),
      // Archived days page by page NUMBER, and it is a separate parameter from
      // `before` on purpose: the two cursors mean different things and must
      // never be handed to the reader that understands the other one.
      page: p.get("page"),
      // `files=1` (recordings only) is ignored, not honoured: the feed is the
      // Ethereum anchors and nothing else (Mike, 2026-10-09: "We don't want that
      // ledger."). A record is found by its file, its digest or a link its maker
      // shared, never by listing. See lib/ledger-feed.ts.
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
