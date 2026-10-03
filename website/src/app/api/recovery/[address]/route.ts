import { NextRequest, NextResponse } from "next/server";
import { handleRecoveryList } from "@/lib/recovery-store";
import { s3RecoveryStore } from "@/lib/recovery-store-s3";

export const dynamic = "force-dynamic";

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
  const { address } = await params;
  const r = await handleRecoveryList(address, req.nextUrl.searchParams, s3RecoveryStore());
  return NextResponse.json(r.body, { status: r.status, headers: { "Cache-Control": "no-store" } });
}
