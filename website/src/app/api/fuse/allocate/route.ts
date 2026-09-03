import { NextRequest, NextResponse } from "next/server";
import { currentEpochHasAnchor, currentEpochId, TEE_URL, teeRestarting503 } from "@/lib/anchor-gate";
import { FUSE_CHAIN, FUSE_ENABLED, fuseDisabled, isSlotRecord, retryAfterHeaders } from "@/lib/fuse";

export const dynamic = "force-dynamic";

/**
 * BitGraph Fuse, step one: a client-held slot.
 *
 * The producer asks for the slot BEFORE its artifact is finished, writes a
 * commitment to the signed slot record into the artifact, and later commits
 * the artifact's digest under this exact slot (POST /api/fuse/commit). The
 * slot's counter N is the floor of the fused span [N, M]; the floor's wall
 * clock is the last anchored block preceding N in this epoch's chain, which
 * is why THIS call, not only the commit, sits behind the anchor-first gate:
 * a slot allocated before the epoch's first anchor has no floor at all.
 *
 * The chain is bound at allocation and pinned to the anchored chain here; a
 * slot on any other chain would be incomparable with every anchor.
 *
 * The returned slotId is the slot's nonce: a bearer ticket until it is
 * consumed. It must never be written into the artifact raw (the artifact
 * carries a derived commitment) and never logged.
 */
export async function POST(req: NextRequest) {
  if (!FUSE_ENABLED) return fuseDisabled();

  try {
    const gate = await currentEpochHasAnchor();
    if (gate !== "yes") return teeRestarting503();
    const gatedEpoch = await currentEpochId();
    if (gatedEpoch === null) return teeRestarting503();

    // Keyed callers keep their parent-side exemption, as on /api/commit.
    const auth = req.headers.get("authorization");
    let teeRes: Response;
    try {
      teeRes = await fetch(`${TEE_URL}/allocate-slot`, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...(auth ? { Authorization: auth } : {}) },
        body: JSON.stringify({ chainId: FUSE_CHAIN }),
        signal: AbortSignal.timeout(10_000),
      });
    } catch {
      return teeRestarting503();
    }
    if ([502, 503, 504].includes(teeRes.status)) return teeRestarting503();
    if (!teeRes.ok) {
      const err = await teeRes.json().catch(() => ({ error: teeRes.statusText }));
      return NextResponse.json(err, { status: teeRes.status, headers: retryAfterHeaders(teeRes) });
    }

    const data = (await teeRes.json()) as { slotId?: unknown; slot?: unknown; chainId?: unknown };
    if (!isSlotRecord(data.slot) || data.slotId !== data.slot.nonceB64 || data.chainId !== FUSE_CHAIN) {
      return NextResponse.json({ error: "Unexpected allocation response from the boundary" }, { status: 502 });
    }

    // The epoch the gate approved must be the epoch that issued the slot. The
    // gate's epoch identity is cached for 10 s; a rotation inside that window
    // would otherwise hand out a slot in a new epoch that has no anchor yet.
    // The orphaned slot expires in the enclave on its own.
    if (data.slot.epochId !== gatedEpoch) return teeRestarting503();

    return NextResponse.json({ slotId: data.slotId, slot: data.slot, chainId: data.chainId });
  } catch (e) {
    console.error("[api/fuse/allocate] Error:", (e as Error).message);
    return NextResponse.json({ error: "Allocation failed" }, { status: 500 });
  }
}
