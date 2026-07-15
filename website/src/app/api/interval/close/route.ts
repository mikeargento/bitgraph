import { NextRequest, NextResponse } from "next/server";
import { createHash } from "node:crypto";
import { storeProofByDigest, getProofByDigest, getIntervalRecord, putIntervalRecord, computeIntervalReport } from "@/lib/s3";

const TEE_URL = "https://nitro.occproof.com";

export const dynamic = "force-dynamic";

// Markers are ~60 bytes; anything past this is not a marker.
const MAX_MARKER_BYTES = 4096;

/**
 * Close an interval, possession-verified: the request body is the raw marker
 * bytes. The server hashes them, requires an OPEN interval registered for that
 * exact digest, commits the close as an ordinary BitGraph, and stamps the
 * registry. The bytes are hashed and discarded, never stored.
 *
 * This is the one place marker bytes transit the network, and it is what makes
 * "closed" mean "closed by the key-holder": a digest alone (public on every
 * proof page and in the explorer) can never flip an interval's state. Foreign
 * re-commits of the digest remain possible at the commit API, but they surface
 * as unverified recurrences, not as closes.
 */
export async function POST(req: NextRequest) {
  try {
    const bytes = Buffer.from(await req.arrayBuffer());
    if (bytes.length === 0 || bytes.length > MAX_MARKER_BYTES) {
      return NextResponse.json({ error: "Request body must be the raw interval key bytes" }, { status: 400 });
    }
    const digestB64 = createHash("sha256").update(bytes).digest("base64");

    const record = await getIntervalRecord(digestB64);
    if (!record) {
      return NextResponse.json({ error: "No interval is registered for this key" }, { status: 404 });
    }
    if (record.closed) {
      return NextResponse.json({ error: "This interval is already closed", interval: record }, { status: 409 });
    }

    // Pre-commit snapshot for storeProofByDigest's backfill (see api/commit).
    const prior = await getProofByDigest(digestB64);

    const teeRes = await fetch(`${TEE_URL}/commit`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        digests: [{ digestB64, hashAlg: "sha256" }],
        chainId: "bitgraph:main",
        metadata: { bitgraph: "interval-close" },
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

    await storeProofByDigest(proof, prior);

    record.closed = { epochId: commit.epochId, counter: String(commit.counter), at: new Date().toISOString() };
    // The report is computed once here (a closed interval is immutable) and
    // stored on the record; failure to compute never fails the close.
    try {
      record.report = await computeIntervalReport(record.opened, record.closed);
    } catch (e) {
      console.error("[api/interval/close] report failed:", (e as Error).message);
      record.report = null;
    }
    await putIntervalRecord(record);

    return NextResponse.json({ proof, interval: record });
  } catch (e) {
    console.error("[api/interval/close] Error:", (e as Error).message);
    return NextResponse.json({ error: "Interval close failed" }, { status: 500 });
  }
}
