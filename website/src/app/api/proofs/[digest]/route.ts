import { NextRequest, NextResponse } from "next/server";
import { getProofsByDigest, LedgerUnavailableError } from "@/lib/s3";
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
    // A read failure is 503 with a named reason, never an empty proof list:
    // the caller has to be able to say "could not check" instead of "not on
    // the ledger". 503 rather than 500 because it is transient by nature.
    if (e instanceof LedgerUnavailableError) {
      console.error("GET /api/proofs/[digest] ledger unavailable:", e.message);
      return NextResponse.json({ error: "ledger unavailable" }, { status: 503 });
    }
    console.error("GET /api/proofs/[digest] error:", e);
    return NextResponse.json({ error: "Failed" }, { status: 500 });
  }
}
