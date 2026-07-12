import { NextRequest, NextResponse } from "next/server";
import { getProofByDigest, getProofsAroundCounter, getCurrentEpoch } from "@/lib/s3";
import { fromUrlSafeB64, toUrlSafeB64 } from "@/lib/explorer";

export const dynamic = "force-dynamic";

// Single-round-trip search: resolve a BitGraph number (#614589 / 614,589) or a
// hash to a proof digest, then CONFIRM the proof is retrievable by digest — the
// exact lookup the proof page does — before handing back a link. This way the
// search never resolves halfway and bounces the visitor to "Proof not found".
export async function GET(req: NextRequest) {
  try {
    const raw = (req.nextUrl.searchParams.get("q") || "").trim();
    if (!raw) return NextResponse.json({ found: false }, { status: 400 });

    let digestB64: string | null = null;
    // Commit counter the query resolved to (number searches only). Returned so
    // the proof link pins that exact causal position: the same bytes can be
    // BitGraphed more than once, and a number names one recording, not the
    // bytes. Hash searches leave it null and the page defaults to the earliest.
    let matchedCounter: string | null = null;

    // Number? strip #, commas, and whitespace first (the UI shows "#614,589").
    const num = raw.replace(/[#,\s]/g, "");
    if (/^\d+$/.test(num)) {
      const epoch = await getCurrentEpoch();
      if (!epoch) return NextResponse.json({ found: false });
      const counter = parseInt(num, 10);
      // Each event uses two counters: the causal slot is allocated one counter
      // before its commit. The proof is stored at the commit counter, but the
      // proof page shows the slot counter too, so accept either: match the exact
      // commit, else the commit that consumed slot==counter (it sits at counter+1).
      const around = await getProofsAroundCounter(epoch, counter, 1, 2);
      const is = (v: unknown) => String(v) === String(counter);
      const p =
        around.find((x) => is((x.commit as { counter?: string } | undefined)?.counter)) ||
        around.find((x) => is((x.commit as { slotCounter?: string } | undefined)?.slotCounter) || is((x.slotAllocation as { counter?: string } | undefined)?.counter));
      digestB64 = (p?.artifact as { digestB64?: string } | undefined)?.digestB64 || null;
      matchedCounter = (p?.commit as { counter?: string } | undefined)?.counter ?? null;
    } else {
      // Treat as a hash; accept url-safe or standard base64.
      digestB64 = fromUrlSafeB64(raw);
    }

    if (!digestB64) return NextResponse.json({ found: false });

    // Verify retrievability before returning a link.
    const proof = await getProofByDigest(digestB64);
    if (!proof) return NextResponse.json({ found: false });

    return NextResponse.json({ found: true, digest: toUrlSafeB64(digestB64), counter: matchedCounter });
  } catch (e) {
    console.error("GET /api/search error:", e);
    return NextResponse.json({ found: false }, { status: 500 });
  }
}
