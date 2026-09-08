import { NextRequest, NextResponse } from "next/server";
import { getAnchorsAfterCounter, getAnchorBeforeCounter, listKeysUnderPrefix, LedgerUnavailableError } from "@/lib/s3";
import { currentEpochId, toSafeEpoch } from "@/lib/anchor-gate";

export const dynamic = "force-dynamic";

/**
 * The two ETH anchors that bracket a position, and — when one is not there —
 * WHY it is not there.
 *
 * ⚠️ AN EMPTY ANSWER USED TO MEAN FOUR THINGS AT ONCE. `{"anchors":[]}` with a
 * 200 was returned for a position nothing has anchored past YET, for an epoch
 * that closed without ever anchoring past it, for an epoch we hold no anchors
 * for at all, and for an S3 read that simply failed. A package built on that
 * answer omits `anchor-after.json` in every one of those cases, so its absence
 * tells the reader nothing: "no upper bound was fetched" and "no upper bound
 * exists" look identical on disk. That is the same failure family as the three
 * caught on 2026-09-07 — an absent answer shipping as a complete one.
 *
 * So the four are pulled apart here, in `bound`:
 *
 *   anchored       here it is.
 *   pending        this is the LIVE epoch and it has anchors, but none past
 *                  this counter yet. Temporary. Ask again later and it
 *                  resolves — the counter is in the signed body and anchors
 *                  are permanent, so this completes in a year if need be.
 *   closed         a PAST epoch, which has anchors, none of them past this
 *                  counter. Permanent: no upper bound will ever exist in this
 *                  epoch. (An epoch is one UTC day; a commit landing in its
 *                  last seconds can outlive its last anchor.)
 *   none           lower bound only: this position sits at or before the
 *                  epoch's first anchor. Also permanent — a lower bound can
 *                  never arrive later, which is the asymmetry between the two
 *                  sides and the whole reason "not yet" is an upper-bound word.
 *   unknown-epoch  we hold no anchors for that epoch at all, so we cannot say
 *                  anything about this position.
 *
 * And a read that FAILED is a 503, never a 200 with an empty list. "We could
 * not check" and "there is nothing there" are opposite claims.
 *
 * `bound` is ADDITIVE: `anchors` keeps the shape and meaning it has, so the
 * two existing callers (the camera's package export and the proof page's) are
 * unaffected by it.
 */

type BoundState = "anchored" | "pending" | "closed" | "none" | "unknown-epoch";

const NOTE: Record<BoundState, string> = {
  anchored: "An Ethereum anchor bounds this position on this side.",
  pending: "No anchor follows this position yet. Its epoch is still open, so one is still coming: ask again later and this side completes.",
  closed: "This position's epoch closed with no anchor after it. No upper bound exists in this epoch, and none ever will.",
  none: "No anchor precedes this position in its epoch: it sits at or before the epoch's first anchor. A lower bound cannot arrive later.",
  "unknown-epoch": "The ledger holds no anchors for this position's epoch, so nothing can be said about this side.",
};

const bound = (state: BoundState) => ({ state, note: NOTE[state] });

/**
 * Why is the answer empty? Only ever called when it IS empty, so a fully
 * anchored folder pays nothing for this. One LIST (MaxKeys 1) plus the
 * enclave's current epoch, which anchor-gate caches for 10s per instance.
 *
 * The enclave being unreachable is its own honest outcome, not a guess: with
 * no way to learn which epoch is live we cannot tell "not yet" from "never",
 * so we say which side we are unsure of rather than picking the cheerful one.
 */
async function classifyEmpty(epoch: string, side: "after" | "before"): Promise<BoundState | "undetermined"> {
  const keys = await listKeysUnderPrefix(`anchors/${toSafeEpoch(epoch)}/`, 1);
  if (keys.length === 0) return "unknown-epoch";
  // A lower bound is settled the moment it is missing: nothing anchored later
  // can ever come to precede this counter.
  if (side === "before") return "none";
  const live = await currentEpochId();
  if (live === null) return "undetermined";
  /* ⚠️ NORMALISE BOTH SIDES BEFORE COMPARING THEM. The enclave's /key returns
   * STANDARD base64 ("P1IPCIeBd/gb…qcs=") and every ledger surface uses the
   * URL-safe form ("P1IPCIeBd_gb…qcs"); callers send whichever they hold. A
   * bare === therefore never matched, and the live epoch read as a past one —
   * so a position recorded seconds ago was labelled `closed`, "no upper bound
   * exists and none ever will", when the truth was "not yet". That is this
   * phase's own bug in a new place, and only measuring found it. */
  return toSafeEpoch(live) === toSafeEpoch(epoch) ? "pending" : "closed";
}

export async function GET(req: NextRequest) {
  const counter = req.nextUrl.searchParams.get("counter");
  const epoch = req.nextUrl.searchParams.get("epoch");
  const before = req.nextUrl.searchParams.get("before");

  if (!counter || !epoch) {
    return NextResponse.json({ error: "counter and epoch params required" }, { status: 400 });
  }
  const n = parseInt(counter, 10);
  if (!Number.isFinite(n) || n < 0) {
    return NextResponse.json({ error: "counter must be a non-negative integer" }, { status: 400 });
  }

  try {
    const side = before === "1" ? "before" : "after";
    // strict: a read failure throws instead of returning the empty list that
    // every layer above would have shipped as a verdict.
    const anchors = side === "before"
      ? await (async () => { const a = await getAnchorBeforeCounter(n, epoch, true); return a ? [a] : []; })()
      : await getAnchorsAfterCounter(n, epoch, 2, true);

    if (anchors.length > 0) return NextResponse.json({ anchors, bound: bound("anchored") });

    const why = await classifyEmpty(epoch, side);
    if (why === "undetermined") {
      // We know the epoch has anchors and none bound this side, but not
      // whether the epoch is still running. Reporting either "pending" or
      // "closed" here would be a guess dressed as a finding.
      return NextResponse.json({
        anchors: [],
        bound: {
          state: "undetermined",
          note: "No anchor bounds this position on this side, and the enclave could not be reached to say whether its epoch is still open. Ask again rather than reading this as final.",
        },
      });
    }
    return NextResponse.json({ anchors: [], bound: bound(why) });
  } catch (e) {
    // Including LedgerUnavailableError, which is the point of the strict flag.
    console.error("GET /api/proofs/anchors error:", e instanceof LedgerUnavailableError ? e.message : e);
    return NextResponse.json(
      { error: "the ledger could not be read", code: "ledger-unavailable" },
      { status: 503 },
    );
  }
}
