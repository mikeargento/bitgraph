import { NextRequest, NextResponse } from "next/server";
import { getProofsByDigest } from "@/lib/s3";
import { fromUrlSafeB64 } from "@/lib/explorer";

export const dynamic = "force-dynamic";

export async function GET(_req: NextRequest, { params }: { params: Promise<{ digest: string }> }) {
  try {
    const { digest } = await params;
    const standardB64 = fromUrlSafeB64(decodeURIComponent(digest));
    // Every proof recorded for these bytes, earliest causal position first.
    // The same bits can be BitGraphed more than once (each time occupies a new
    // causal position), so the lookup returns all of them.
    const entries = await getProofsByDigest(standardB64);
    return NextResponse.json({ proofs: entries.map(({ proof, writeTime }) => ({ proof, writeTime: writeTime ?? null })) });
  } catch (e) {
    console.error("GET /api/proofs/[digest] error:", e);
    return NextResponse.json({ error: "Failed" }, { status: 500 });
  }
}
