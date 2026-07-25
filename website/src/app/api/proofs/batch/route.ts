import { NextRequest, NextResponse } from "next/server";
import { getProofsByDigest } from "@/lib/s3";
import { fromUrlSafeB64 } from "@/lib/explorer";

export const dynamic = "force-dynamic";

// Batch form of GET /api/proofs/[digest]: one round trip for a whole drop.
// Same lookup, same per-digest payload shape, keyed by the url-safe digest
// exactly as the caller sent it. Checking N files costs one HTTP round trip
// instead of N; the S3 fan-out happens here, capped.
const MAX_DIGESTS = 500;
const CONCURRENCY = 16;

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => null);
    const digests: unknown = body?.digests;
    if (
      !Array.isArray(digests) ||
      digests.length === 0 ||
      digests.length > MAX_DIGESTS ||
      digests.some((d) => typeof d !== "string" || d.length === 0 || d.length > 100)
    ) {
      return NextResponse.json({ error: "Bad request" }, { status: 400 });
    }
    const unique = [...new Set(digests as string[])];
    const results: Record<string, { proofs: Array<{ proof: unknown; writeTime: number | null }> }> = {};
    let next = 0;
    await Promise.all(
      Array.from({ length: Math.min(CONCURRENCY, unique.length) }, async () => {
        while (next < unique.length) {
          const d = unique[next++];
          try {
            const entries = await getProofsByDigest(fromUrlSafeB64(d));
            // writeTime (ledger write moment, ms) rides along so result rows
            // can show a compact "when" like the Roll's rows.
            results[d] = { proofs: entries.map(({ proof, writeTime }) => ({ proof, writeTime: writeTime ?? null })) };
          } catch {
            // Indistinguishable from "not on record" for the caller, which is
            // the same conservative degradation the per-digest route has.
            results[d] = { proofs: [] };
          }
        }
      }),
    );
    return NextResponse.json({ results });
  } catch (e) {
    console.error("POST /api/proofs/batch error:", e);
    return NextResponse.json({ error: "Failed" }, { status: 500 });
  }
}
