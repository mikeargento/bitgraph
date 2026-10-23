import { NextRequest, NextResponse } from "next/server";
import { RECOVERY_LIST_RATE, RateLimiter, handleRecoveryList } from "@/lib/recovery-store";
import { s3RecoveryStore } from "@/lib/recovery-store-s3";

export const dynamic = "force-dynamic";

const limiter = new RateLimiter(RECOVERY_LIST_RATE.max, RECOVERY_LIST_RATE.windowMs);

/**
 * GET /api/recovery/<address>?after=<entryId>&limit=<1..100>: the sealed
 * entries under one address, ascending by entry id, a page at a time.
 *
 * The address is SHA-256("bitgraph-lookup" || digest), so only someone who
 * knows a file's digest can name it, and only the same knowledge opens what
 * comes back (lib/recovery.ts, recoverFromDigest). Never cached: an entry
 * written a second ago must be found now, and a cached empty page would say
 * a just-recorded file has nothing kept. A read failure is a 503, never an
 * empty page.
 */
export async function GET(req: NextRequest, { params }: { params: Promise<{ address: string }> }) {
  const caller = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || req.headers.get("x-real-ip") || "unknown";
  if (limiter.limited(caller)) {
    return NextResponse.json({ error: "too many recovery listings; try again shortly", code: "rate-limited" }, { status: 429, headers: { "Cache-Control": "no-store", "Retry-After": "30" } });
  }
  const { address } = await params;
  const r = await handleRecoveryList(address, req.nextUrl.searchParams, s3RecoveryStore());
  return NextResponse.json(r.body, { status: r.status, headers: { "Cache-Control": "no-store" } });
}
