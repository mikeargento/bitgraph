import { NextRequest, NextResponse } from "next/server";
import { computeWindow } from "@/lib/causal-window";
import { LedgerUnavailableError } from "@/lib/s3";

export const dynamic = "force-dynamic";

/**
 * The two Ethereum anchors that bracket a position, by COUNTER.
 *
 * ⚠️ THIS EXISTS BECAUSE THE PROOF PAGE LOST ITS WINDOW. The window used to
 * arrive with the proof from /api/proofs/digest/{digest}, which finds nothing
 * for a proof made after 2026-09-08 — the ledger keeps only anchors now. So a
 * BitGraph opened from its own holder's folder showed no time at all, and the
 * anchor card sat on "Waiting for the next Ethereum block…" forever, which was
 * not true: the anchors had landed, nobody was asking for them.
 *
 * They were always askable. `anchors/{epoch}/{counter}.json` is keyed by
 * counter, which is exactly why it survived phase 2 when by-digest did not,
 * and a proof carries its own counter and epoch in its SIGNED body. So the
 * window is computable from the proof alone — nothing about the file is looked
 * up, nothing about the file is revealed, and the privacy the cutover bought
 * is untouched.
 *
 * A miss is not a verdict, same as everywhere else: `anchorAfter: null` means
 * no anchor follows this position IN THE INDEX, which for a position minted
 * seconds ago is the truth and for one minted last year would be a gap. The
 * caller says "waiting" only for the first, and /api/proofs/anchors carries
 * the `bound` state that tells them apart.
 */
export async function GET(req: NextRequest) {
  const counter = req.nextUrl.searchParams.get("counter");
  const epoch = req.nextUrl.searchParams.get("epoch");
  if (!counter || !epoch) {
    return NextResponse.json({ error: "counter and epoch params required" }, { status: 400 });
  }
  const n = parseInt(counter, 10);
  if (!Number.isFinite(n) || n < 0) {
    return NextResponse.json({ error: "counter must be a non-negative integer" }, { status: 400 });
  }
  try {
    const causalWindow = await computeWindow(n, epoch);
    return NextResponse.json({ causalWindow }, {
      // Anchors are permanent once written, so a settled window never changes.
      // An unsettled one is short-lived by nature and must not be pinned.
      headers: { "Cache-Control": causalWindow.anchorAfter
        ? "public, s-maxage=3600, stale-while-revalidate=86400"
        : "public, s-maxage=5" },
    });
  } catch (e) {
    // A read failure is 503 and never an empty window: "we could not look" and
    // "nothing is there" are opposite claims, and only one of them says your
    // BitGraph is unanchored.
    console.error("GET /api/proofs/window error:", e instanceof LedgerUnavailableError ? e.message : e);
    return NextResponse.json({ error: "the ledger could not be read", code: "ledger-unavailable" }, { status: 503 });
  }
}
