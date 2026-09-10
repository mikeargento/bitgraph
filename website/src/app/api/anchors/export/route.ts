import { NextRequest, NextResponse } from "next/server";
import { ledgerFeed, type LedgerFeedBody } from "@/lib/ledger-feed";

/* The anchors of one day, as a file (Mike, 2026-09-09: "a way to export them
   easily"). The same feed the anchors page reads, walked to its end and served
   whole, one object per anchor: the position, the block, the block hash where
   the signed mark carries it, the time, and the proof's URL on this site.

   GET /api/anchors/export            the live day (today, UTC)
   GET /api/anchors/export?day=YYYY-MM-DD

   `complete` says whether the walk reached the end of the day. A walk that
   stops early (the page budget, or the ledger declining mid-run) says so
   rather than handing over a short list as if it were the whole day. */

export const dynamic = "force-dynamic";

const MAX_PAGES = 400;

type Exported = {
  position: { epochId: string | null; counter: number };
  kind: "anchor" | "interval";
  blockNumber: number | null;
  blockHash: string | null;
  etherscanUrl: string | null;
  at: string | null;
  proofUrl: string;
};

export async function GET(req: NextRequest) {
  const day = req.nextUrl.searchParams.get("day");
  const origin = req.nextUrl.origin;
  const anchors: Exported[] = [];
  let before: string | null = null;
  let bepoch: string | null = null;
  let page: string | null = null;
  let complete = false;
  let hops = 0;
  try {
    while (hops++ < MAX_PAGES) {
      const result = await ledgerFeed({ day, before, bepoch, page, filesOnly: false });
      if (result.status !== 200) {
        return NextResponse.json(result.body, { status: result.status });
      }
      const body: LedgerFeedBody = result.body;
      for (const e of body.entries) {
        if (e.type === "proof") continue;
        anchors.push({
          position: { epochId: e.ep ?? null, counter: e.counter },
          kind: e.type,
          blockNumber: e.blockNumber,
          blockHash: e.blockHash ?? null,
          etherscanUrl: e.etherscanUrl,
          at: e.at ? new Date(e.at).toISOString() : null,
          proofUrl: `${origin}/proof/${e.digest}?counter=${encodeURIComponent(e.counter)}${e.ep ? `&epoch=${encodeURIComponent(e.ep)}` : ""}`,
        });
      }
      if (!body.hasMore) { complete = true; break; }
      if (body.nextPage != null) {
        page = String(body.nextPage); before = null; bepoch = null;
      } else if (body.nextBefore != null) {
        before = String(body.nextBefore); bepoch = body.nextEpoch ?? null; page = null;
      } else {
        break;
      }
    }
  } catch (e) {
    console.error("GET /api/anchors/export error:", e);
    return NextResponse.json({ error: "failed" }, { status: 500 });
  }
  const name = `bitgraph-anchors-${day ?? new Date().toISOString().slice(0, 10)}.json`;
  return NextResponse.json(
    { day: day ?? new Date().toISOString().slice(0, 10), exportedAt: new Date().toISOString(), complete, count: anchors.length, anchors },
    { headers: { "Content-Disposition": `attachment; filename="${name}"`, "Cache-Control": "no-store" } },
  );
}
