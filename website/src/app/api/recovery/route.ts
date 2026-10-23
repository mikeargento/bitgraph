import { NextRequest, NextResponse } from "next/server";
import { MAX_BODY_BYTES } from "@/lib/recovery";
import { RECOVERY_POST_LIMIT, RateLimiter, handleRecoveryPost, recoveryWritesOn } from "@/lib/recovery-store";
import { s3RecoveryStore } from "@/lib/recovery-store-s3";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const NO_STORE = { "Cache-Control": "no-store" };
const limiter = new RateLimiter(RECOVERY_POST_LIMIT.max, RECOVERY_POST_LIMIT.windowMs);

/**
 * POST /api/recovery: store sealed recovery entries, create-only.
 *
 * Body { entries: [{ key, envelope }] }, 1 to 500 entries, each a key
 * recovery/v1/<address>/<entryId> and a base64 envelope the browser sealed.
 * This route never sees a digest or a plaintext and cannot open what it
 * stores; it checks the shapes and writes each entry only where nothing is.
 * A key already taken answers "exists" WITH the stored envelope, because only
 * the client holding the file can tell whether that entry is its own member.
 * Contract and formats: lib/recovery-store.ts and lib/recovery.ts.
 *
 * Off unless RECOVERY_WRITES=on (see recoveryWritesOn): writes here are
 * permanent, so the bucket policy in lib/recovery-store-s3.ts and a WAF rate
 * rule come first.
 */
export async function POST(req: NextRequest) {
  if (!recoveryWritesOn()) {
    return NextResponse.json({ error: "recovery writes are off on this site", code: "recovery-writes-off" }, { status: 503, headers: NO_STORE });
  }
  const caller = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || req.headers.get("x-real-ip") || "unknown";
  if (limiter.limited(caller)) {
    return NextResponse.json({ error: "too many recovery writes; try again shortly", code: "rate-limited" }, { status: 429, headers: { ...NO_STORE, "Retry-After": "30" } });
  }
  const declared = Number(req.headers.get("content-length") ?? "0");
  if (Number.isFinite(declared) && declared > MAX_BODY_BYTES) {
    return NextResponse.json({ error: `the body is over ${MAX_BODY_BYTES} bytes`, code: "too-large" }, { status: 413, headers: NO_STORE });
  }
  let text: string;
  try {
    text = await req.text();
  } catch {
    return NextResponse.json({ error: "the body could not be read", code: "bad-request" }, { status: 400, headers: NO_STORE });
  }
  const r = await handleRecoveryPost(text, s3RecoveryStore());
  return NextResponse.json(r.body, { status: r.status, headers: NO_STORE });
}
