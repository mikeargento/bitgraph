import { NextRequest, NextResponse } from "next/server";
import { getProofByDigest } from "@/lib/s3";
import { fromUrlSafeB64, toUrlSafeB64 } from "@/lib/explorer";

export const dynamic = "force-dynamic";

// Single-round-trip search: resolve a hash to a proof digest, then CONFIRM the
// proof is retrievable by digest — the exact lookup the proof page does —
// before handing back a link. This way the search never resolves halfway and
// bounces the visitor to "Proof not found".
//
// ❄️ SEARCH BY BITGRAPH NUMBER WAS REMOVED, AND MUST NOT COME BACK. A counter
// is a position within one epoch, and an epoch is one UTC day, so counters
// restart at zero daily and the chain runs to roughly twelve thousand of them
// before it does. A bare number therefore names one recording per day for as
// long as the service has run, and identifies none of them.
//
// It resolved against the current epoch alone, which read as working: today's
// numbers answered, and yesterday's either said "not found" or, once today's
// head passed them, returned a DIFFERENT recording while reporting success.
// The second case is the common one, not the edge. Verified 2026-08-04: a real
// recording at #12680 on 2026-08-02 returned found:false, purely because the
// day's head had not yet reached 12680.
//
// The rest of the codebase already had this right. Explorer rows, feed cursors
// and proof links are all keyed by (epoch, counter); the number search predated
// daily rotation, when one epoch lasted weeks and a counter was unique by
// accident. Anything that names a causal position needs the epoch with it.
export async function GET(req: NextRequest) {
  try {
    const raw = (req.nextUrl.searchParams.get("q") || "").trim();
    if (!raw) return NextResponse.json({ found: false }, { status: 400 });

    // Answer a number specifically rather than letting it fall through and
    // decode into a nonsense digest. Someone typing one has read it off a Ledger
    // row, and "not found" would leave them thinking the recording was gone.
    if (/^\d+$/.test(raw.replace(/[#,\s]/g, ""))) {
      return NextResponse.json({ found: false, reason: "number" });
    }

    // Accept url-safe or standard base64.
    const digestB64 = fromUrlSafeB64(raw);
    if (!digestB64) return NextResponse.json({ found: false });

    // Verify retrievability before returning a link.
    const proof = await getProofByDigest(digestB64);
    if (!proof) return NextResponse.json({ found: false });

    return NextResponse.json({ found: true, digest: toUrlSafeB64(digestB64) });
  } catch (e) {
    console.error("GET /api/search error:", e);
    return NextResponse.json({ found: false }, { status: 500 });
  }
}
