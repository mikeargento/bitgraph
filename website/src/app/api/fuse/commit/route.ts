import { NextRequest, NextResponse } from "next/server";
import { storeProofByDigest, getProofByDigest, getAnchorBeforeCounter, LedgerUnavailableError } from "@/lib/s3";
import { TEE_URL, teeRestarting503 } from "@/lib/anchor-gate";
import { FUSE_ATTRIBUTION_NAME, FUSE_CHAIN, FUSE_ENABLED, fuseDisabled, isDigestB64, isSlotRecord, retryAfterHeaders } from "@/lib/fuse";

export const dynamic = "force-dynamic";

const MAX_TITLE = 64;
const MAX_MESSAGE = 128;
const PRINTABLE = /^[\x20-\x7e]+$/;

/**
 * BitGraph Fuse, step two: commit the fused artifact's digest under the
 * exact slot allocated by POST /api/fuse/allocate.
 *
 * One digest per request. The request carries the signed slot record so this
 * route can make the anchor-first gate position-aware: an anchor must exist
 * in the slot's own epoch chain with a counter BELOW the slot counter, or the
 * fused floor is undefined. That condition can never heal for a given slot
 * (anchors only land at higher counters), so its failure is final for that
 * slot and the producer must allocate again.
 *
 * The proxy forwards the body to the parent's /commit with the slotId, then
 * writes the by-digest index the parent does not (per-position entries and,
 * for fused proofs, the origin digest's descendants). It refuses to return a
 * proof minted under any slot other than the one named, so a downgrade to an
 * ordinary recording can never look like success.
 */
export async function POST(req: NextRequest) {
  if (!FUSE_ENABLED) return fuseDisabled();

  try {
    const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
    if (body === null || typeof body !== "object" || Array.isArray(body)) {
      return NextResponse.json({ error: "body must be a JSON object" }, { status: 400 });
    }

    const slot = body.slot;
    if (!isSlotRecord(slot)) {
      return NextResponse.json({ error: "body.slot must be the slot record returned by /api/fuse/allocate (chain bitgraph:main)" }, { status: 400 });
    }
    if (body.slotId !== slot.nonceB64) {
      return NextResponse.json({ error: "body.slotId must equal body.slot.nonceB64" }, { status: 400 });
    }
    const digests = body.digests;
    if (!Array.isArray(digests) || digests.length !== 1) {
      return NextResponse.json({ error: "a fused commit carries exactly one digest" }, { status: 400 });
    }
    const d = digests[0] as { digestB64?: unknown; hashAlg?: unknown };
    if (!isDigestB64(d?.digestB64) || d.hashAlg !== "sha256") {
      return NextResponse.json({ error: "digests[0] must be { digestB64: <base64 SHA-256>, hashAlg: 'sha256' }" }, { status: 400 });
    }
    const digestB64 = d.digestB64;

    // Attribution is the signed carrier of the placement id (title) and the
    // origin digest (message). The name is fixed so readers can recognise a
    // fused proof from the signed bytes alone.
    const attr = body.attribution as Record<string, unknown> | undefined;
    if (attr === undefined || attr === null || typeof attr !== "object" || Array.isArray(attr)) {
      return NextResponse.json({ error: `body.attribution is required: { name: '${FUSE_ATTRIBUTION_NAME}', title: <placement id>, message?: <origin digest> }` }, { status: 400 });
    }
    if (attr.name !== FUSE_ATTRIBUTION_NAME) {
      return NextResponse.json({ error: `attribution.name must be "${FUSE_ATTRIBUTION_NAME}"` }, { status: 400 });
    }
    if (typeof attr.title !== "string" || attr.title.length === 0 || attr.title.length > MAX_TITLE || !PRINTABLE.test(attr.title)) {
      return NextResponse.json({ error: "attribution.title must be the placement id (printable ASCII, 1 to 64 characters)" }, { status: 400 });
    }
    if (attr.message !== undefined && (typeof attr.message !== "string" || attr.message.length > MAX_MESSAGE || !PRINTABLE.test(attr.message))) {
      return NextResponse.json({ error: "attribution.message, when present, must be the origin digest (printable ASCII, at most 128 characters)" }, { status: 400 });
    }
    const attribution: Record<string, string> = { name: FUSE_ATTRIBUTION_NAME, title: attr.title };
    if (typeof attr.message === "string" && attr.message.length > 0) attribution.message = attr.message;

    // Position-aware anchor-first gate: an anchor below N in the slot's epoch.
    let anchorBefore: Record<string, unknown> | null;
    try {
      anchorBefore = await getAnchorBeforeCounter(parseInt(slot.counter, 10), slot.epochId);
    } catch (err) {
      if (err instanceof LedgerUnavailableError) {
        return NextResponse.json({ error: "The ledger could not be read; try again", code: "ledger-unavailable" }, { status: 503 });
      }
      throw err;
    }
    if (anchorBefore === null) {
      return NextResponse.json(
        {
          error: "No anchor precedes this slot in its epoch, so a fused floor cannot be established for it. Allocate a new slot through /api/fuse/allocate.",
          code: "no-anchor-before-slot",
        },
        { status: 409 },
      );
    }

    // Snapshot the legacy by-digest key before committing (see api/commit).
    const priorLegacy = await getProofByDigest(digestB64);

    const auth = req.headers.get("authorization");
    const forward: Record<string, unknown> = {
      digests: [{ digestB64, hashAlg: "sha256" }],
      slotId: slot.nonceB64,
      chainId: FUSE_CHAIN,
      attribution,
    };
    if (body.agency !== undefined) forward.agency = body.agency;

    let teeRes: Response;
    try {
      teeRes = await fetch(`${TEE_URL}/commit`, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...(auth ? { Authorization: auth } : {}) },
        body: JSON.stringify(forward),
        signal: AbortSignal.timeout(30_000),
      });
    } catch {
      // The request may have reached the parent. The client's recovery rule
      // (read back by digest, match commit.slotHashB64) covers this.
      return teeRestarting503();
    }
    if ([502, 503, 504].includes(teeRes.status)) return teeRestarting503();
    if (!teeRes.ok) {
      const err = await teeRes.json().catch(() => ({ error: teeRes.statusText }));
      return NextResponse.json(err, { status: teeRes.status, headers: retryAfterHeaders(teeRes) });
    }

    const teeData = (await teeRes.json()) as unknown;
    const proof = (Array.isArray(teeData) ? teeData[0] : teeData) as Record<string, unknown> | undefined;
    const minted = proof?.slotAllocation as { nonceB64?: string } | undefined;
    const commit = proof?.commit as { nonceB64?: string } | undefined;
    if (!proof || minted?.nonceB64 !== slot.nonceB64 || commit?.nonceB64 !== slot.nonceB64) {
      // Never report success for a proof under any other slot.
      console.error("[api/fuse/commit] boundary returned a proof under a different slot");
      return NextResponse.json({ error: "The boundary did not commit under the named slot", code: "slot-mismatch" }, { status: 502 });
    }

    await storeProofByDigest(proof, priorLegacy);
    return NextResponse.json({ proof });
  } catch (e) {
    console.error("[api/fuse/commit] Error:", (e as Error).message);
    return NextResponse.json({ error: "Commit failed" }, { status: 500 });
  }
}
