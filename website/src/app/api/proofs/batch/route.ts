import { NextRequest, NextResponse } from "next/server";
import { getProofsByDigest, readSetPosition, runPool, LedgerUnavailableError } from "@/lib/s3";
import { fromUrlSafeB64 } from "@/lib/explorer";

export const dynamic = "force-dynamic";

// Batch form of GET /api/proofs/[digest]: one round trip for a whole drop.
// Same lookup, same per-digest payload shape, keyed by the url-safe digest
// exactly as the caller sent it. Checking N files costs one HTTP round trip
// instead of N; the S3 fan-out happens here, capped.
const MAX_DIGESTS = 500;
// ⚠️ This multiplies. The viewer keeps three of these requests in flight, so
// the real S3 fan-out is 3 x CONCURRENCY x (1 listing + n position reads),
// from one function instance. At 16 a 2000-recording drop pushed the reads
// into throttling, which is what surfaced the reporting bug below. Eight
// leaves the sweep comfortably fast (the cost is round trips, not S3 ops)
// with far more headroom.
const CONCURRENCY = 8;

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => null);
    const digests: unknown = body?.digests;
    if (
      !Array.isArray(digests) ||
      digests.length === 0 ||
      digests.length > MAX_DIGESTS ||
      digests.some((d) => typeof d !== "string" || d.length === 0 || d.length > 100)
    ) {
      return NextResponse.json({ error: "Bad request" }, { status: 400 });
    }
    const unique = [...new Set(digests as string[])];
    const results: Record<string, {
      proofs: Array<{
        proof: unknown;
        writeTime: number | null;
        kind: "recorded" | "fused";
        /** A set member's row (origin or fused bytes, one of N), when the entry is one. */
        member?: { index: number; count: number; role: "origin" | "fused" };
        /** A set member's set, by digest (url-safe): its proof here lacks the manifest, which `sets` carries once. */
        setDigest?: string;
      }>;
      /** The read FAILED. Not an answer about these bytes; see below. */
      unavailable?: true;
    }> = {};
    let next = 0;
    await Promise.all(
      Array.from({ length: Math.min(CONCURRENCY, unique.length) }, async () => {
        while (next < unique.length) {
          const d = unique[next++];
          try {
            // Member entries come back WITHOUT their set's manifest: a batch
            // over a set's originals would otherwise carry one N-row manifest
            // per row (N squared bytes; 400 members passed the 4.5 MB
            // function limit) and fetch the same set key once per digest.
            // Each distinct set is read once below and sent once, in `sets`.
            const entries = await getProofsByDigest(fromUrlSafeB64(d), { hydrate: false });
            // writeTime (ledger write moment, ms) rides along so result rows
            // can show a compact "when" like the ledger's rows.
            results[d] = { proofs: entries.map(({ proof, writeTime, kind, member, setDigest }) => ({ proof, writeTime: writeTime ?? null, kind, ...(member ? { member } : {}), ...(setDigest ? { setDigest } : {}) })) };
          } catch (err) {
            // ⚠️ THIS USED TO REPORT `{ proofs: [] }`, and it was the whole
            // bug: an empty list is the wire form of "these bytes were never
            // recorded", so every throttled read became a public accusation
            // that a genuine recording was not on the ledger. A reader cannot
            // recover the distinction once it is erased here, so it is kept:
            // `unavailable` means we failed, not that the ledger is silent.
            console.error("[batch] lookup failed for one digest:",
              err instanceof LedgerUnavailableError ? err.message : err);
            results[d] = { proofs: [], unavailable: true };
          }
        }
      }),
    );
    // The side table: every set named by a member entry, ONCE, as its own
    // bound position copy (with the manifest). A set's digest is its
    // manifest's, which names the slot, so one digest is one position. A
    // set that cannot be read or does not bind is simply absent: the entry
    // still says what it is; only the export of that row goes without the
    // manifest, which is never a verdict about the bytes.
    const wanted = new Map<string, { epochId: string; counter: string }>();
    for (const r of Object.values(results)) {
      for (const e of r.proofs) {
        if (!e.setDigest || wanted.has(e.setDigest)) continue;
        const c = (e.proof as { commit?: { epochId?: string; counter?: string } }).commit;
        if (c?.epochId && c?.counter) wanted.set(e.setDigest, { epochId: c.epochId, counter: String(c.counter) });
      }
    }
    const sets: Record<string, unknown> = {};
    if (wanted.size) {
      const read = await runPool([...wanted.entries()], CONCURRENCY, async ([digest, pos]) => {
        const proof = await readSetPosition(digest, pos.epochId, pos.counter);
        if (proof) sets[digest] = proof;
      });
      for (const r of read) if (r.status === "rejected") console.error("[batch] set position read failed:",
        r.reason instanceof LedgerUnavailableError ? r.reason.message : r.reason);
    }
    return NextResponse.json(wanted.size ? { results, sets } : { results });
  } catch (e) {
    console.error("POST /api/proofs/batch error:", e);
    return NextResponse.json({ error: "Failed" }, { status: 500 });
  }
}
