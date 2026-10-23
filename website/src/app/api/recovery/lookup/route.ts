import { NextRequest, NextResponse } from "next/server";
import { MAX_LOOKUP_BODY_BYTES } from "@/lib/recovery";
import { RECOVERY_LOOKUP_RATE, RateLimiter, handleRecoveryLookup } from "@/lib/recovery-store";
import { s3RecoveryStore } from "@/lib/recovery-store-s3";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const NO_STORE = { "Cache-Control": "no-store" };
const limiter = new RateLimiter(RECOVERY_LOOKUP_RATE.max, RECOVERY_LOOKUP_RATE.windowMs);

/**
 * POST /api/recovery/lookup { addresses }: the first page of up to 1,000
 * addresses' listings in one answer, for a drop or a record of many files
 * (lib/recovery.ts, recoverFromDigests). The same data GET
 * /api/recovery/<address> serves, one request instead of one per file; a
 * longer listing is finished through that route. Reads are never switched
 * off and never cached. An address the store cannot read answers with an
 * error for that address, never an empty page.
 *
 * The addresses in one request say which files were dropped together. That
 * stays in the request: the route logs counts, never addresses (SPEC
 * section 13).
 */
export async function POST(req: NextRequest) {
  const caller = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || req.headers.get("x-real-ip") || "unknown";
  if (limiter.limited(caller)) {
    return NextResponse.json({ error: "too many recovery lookups; try again shortly", code: "rate-limited" }, { status: 429, headers: { ...NO_STORE, "Retry-After": "30" } });
  }
  const declared = Number(req.headers.get("content-length") ?? "0");
  if (Number.isFinite(declared) && declared > MAX_LOOKUP_BODY_BYTES) {
    return NextResponse.json({ error: `the body is over ${MAX_LOOKUP_BODY_BYTES} bytes`, code: "too-large" }, { status: 413, headers: NO_STORE });
  }
  let text: string;
  try {
    text = await req.text();
  } catch {
    return NextResponse.json({ error: "the body could not be read", code: "bad-request" }, { status: 400, headers: NO_STORE });
  }
  const r = await handleRecoveryLookup(text, s3RecoveryStore());
  return NextResponse.json(r.body, { status: r.status, headers: NO_STORE });
}
