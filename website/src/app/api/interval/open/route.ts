import { NextRequest, NextResponse } from "next/server";
import { storeProofByDigest, getProofsByDigest, claimIntervalRecord, type IntervalRecord } from "@/lib/s3";

const TEE_URL = "https://nitro.occproof.com";

export const dynamic = "force-dynamic";

/**
 * Open an interval: commit a fresh marker digest as an ordinary BitGraph and
 * register it in the interval registry. The marker bytes never reach this
 * endpoint; the browser generates them, hashes locally, and sends the digest
 * only (same privacy model as every other commit).
 *
 * Only FRESH digests can become intervals: a digest with any existing causal
 * position is refused, so an existing proof (someone's photo) can never be
 * hijacked into interval UI. Markers carry 256 bits of local randomness, so a
 * legitimate open never trips this.
 */
export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => null) as { digestB64?: string } | null;
    const digestB64 = body?.digestB64;
    if (typeof digestB64 !== "string" || Buffer.from(digestB64, "base64").length !== 32) {
      return NextResponse.json({ error: "digestB64 must be a base64 SHA-256 digest" }, { status: 400 });
    }

    const existing = await getProofsByDigest(digestB64);
    if (existing.length > 0) {
      return NextResponse.json({ error: "This digest already has causal positions and cannot open an interval" }, { status: 409 });
    }

    const teeRes = await fetch(`${TEE_URL}/commit`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        digests: [{ digestB64, hashAlg: "sha256" }],
        chainId: "bitgraph:main",
        metadata: { bitgraph: "interval-open" },
      }),
    });
    if (!teeRes.ok) {
      const err = await teeRes.json().catch(() => ({ error: teeRes.statusText }));
      return NextResponse.json(err, { status: teeRes.status });
    }
    const teeData = await teeRes.json();
    const proof = (Array.isArray(teeData) ? teeData[0] : teeData) as Record<string, unknown>;
    const commit = proof?.commit as { epochId?: string; counter?: string } | undefined;
    if (!commit?.epochId || !commit?.counter) {
      return NextResponse.json({ error: "Commit returned no position" }, { status: 500 });
    }

    // Digest was verified fresh above, so there is no legacy prior to backfill.
    await storeProofByDigest(proof, null);

    const record: IntervalRecord = {
      kind: "bitgraph-interval/1",
      digestB64,
      opened: { epochId: commit.epochId, counter: String(commit.counter), at: new Date().toISOString() },
      closed: null,
      report: null,
    };
    const claimed = await claimIntervalRecord(record);
    if (!claimed) {
      return NextResponse.json({ error: "Interval already registered for this digest" }, { status: 409 });
    }

    return NextResponse.json({ proof, interval: record });
  } catch (e) {
    console.error("[api/interval/open] Error:", (e as Error).message);
    return NextResponse.json({ error: "Interval open failed" }, { status: 500 });
  }
}
