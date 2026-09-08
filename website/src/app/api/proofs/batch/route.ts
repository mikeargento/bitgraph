import { NextRequest, NextResponse } from "next/server";
import { getProofsByDigest, readSetPosition, runPool, LedgerUnavailableError } from "@/lib/s3";
import { digestIndex } from "@/lib/digest-index";
import { fromUrlSafeB64 } from "@/lib/explorer";
import { splitEnvironments } from "@/lib/proof-environment";
import { createHash } from "node:crypto";

export const dynamic = "force-dynamic";
/**
 * A request that has to READ every digest it was sent is the slow case: at
 * CONCURRENCY below, 2,000 reads is roughly 2,000/8 rounds of S3 latency, well
 * over the platform default. A fresh drop, where the index rules everything
 * out, returns in about a tenth of a second and never comes near this.
 */
export const maxDuration = 60;

// Batch form of GET /api/proofs/[digest]: one round trip for a whole drop.
// Same lookup, same per-digest payload shape, keyed by the url-safe digest
// exactly as the caller sent it. Checking N files costs one HTTP round trip
// instead of N; the S3 fan-out happens here, capped.
/**
 * Digests one request may carry.
 *
 * 500 was calibrated when EVERY digest cost an S3 listing, so the cap was
 * really a cap on reads. The digest index changed that: a digest the filter
 * rules out costs nothing at all, and a fresh drop rules out essentially all
 * of them, so the only remaining cost there is the round trip itself. At 500 a
 * 48,000 file drop was 96 round trips; at 2,000 it is 24 (Mike, 2026-09-07:
 * "why does checking only go in chunks of 500").
 *
 * The slow case is unchanged rather than made worse: a drop of files that are
 * all on record still costs one read each at the same CONCURRENCY, so the same
 * total S3 work happens in fewer, longer requests. That is what maxDuration
 * above is sized for.
 */
const MAX_DIGESTS = 2_000;
/**
 * Reads in flight per request.
 *
 * ⚠️ This multiplies: the viewer keeps five of these requests going, so the
 * real fan-out is 5 x CONCURRENCY from one function instance.
 *
 * Eight dates from before the digest index, when EVERY digest cost a listing
 * and a 2,000-file drop meant 2,000 of them per request. Sixteen throttled
 * under that load. The index changed the shape completely: a digest it rules
 * out costs nothing at all, so the only work left is genuine hits, and a hit
 * is two serialised round trips (a listing, then the read) — latency, not
 * throughput.
 *
 * That made eight the wrong number for the one case that is still slow:
 * re-dropping a folder already on record. Every digest hits, 2,000 of them
 * took 25s, and a 48,000 file re-drop spent about two minutes in lookups
 * (Mike, 2026-09-07: "checking takes FOREVER").
 *
 * Measured against the real bucket on the same data, per digest:
 *   8 -> 15.0ms   16 -> 7.6ms   32 -> 3.8ms   64 -> 2.9ms
 * with zero throttling at any level. 24 is three times faster than eight and
 * keeps the total in flight at 120, well under both that measurement and S3's
 * own per-prefix ceiling. 32 also measured clean if this ever needs more.
 */
const CONCURRENCY = 24;

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
    /**
     * Send each distinct `environment` ONCE, in a side table, instead of
     * inside every proof.
     *
     * ⚠️ OPT-IN, AND IT MUST STAY OPT-IN. This endpoint is public and has
     * consumers that cannot be updated in step with it: the published
     * @mikeargento/bitgraph-mcp, the Zapier app, the export client, and this
     * site's own folder-check, which VERIFIES SIGNATURES. A proof missing its
     * `environment` does not verify, so making the table the default would
     * turn every one of those into a checker that calls genuine recordings
     * invalid. Callers that know to put the table back ask for it; everyone
     * else gets exactly the bytes they got yesterday.
     */
    const envTable = body?.environments === "table";

    // Nearly every digest in a big drop is new, and every one of them costs an
    // S3 listing that returns nothing: 30,000 files was 30,000 listings, and
    // batching them only halved the wait (measured 2026-09-07). The digest
    // index answers "certainly not on record" from memory, so only the few it
    // cannot rule out reach S3 at all. It reports no opinion whenever it might
    // be out of date, and then this route does exactly what it always did.
    const index = await digestIndex();
    const toRead = index === null ? unique : unique.filter((d) => !index.absent(fromUrlSafeB64(d)));
    // How much the index actually saved. A healthy filter rules out nearly
    // every digest in a fresh drop; ruling out fewer than half of a large one
    // is the signature of a filter carrying more entries than it was sized
    // for, which is exactly how the 2026-09-07 sizing bug hid (correct answers
    // at 57x the reads). Logged only when it looks wrong, so it stays quiet.
    if (index !== null && unique.length >= 100 && toRead.length * 2 > unique.length) {
      console.warn(`[batch] digest index ruled out only ${unique.length - toRead.length}/${unique.length}; the filter may be past its capacity (rebuild it)`);
    }
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
    // A digest the index ruled out is answered here, with the same shape a
    // read would have produced for bytes that are not on record.
    const reading = new Set(toRead);
    for (const d of unique) if (!reading.has(d)) results[d] = { proofs: [] };
    let next = 0;
    await Promise.all(
      Array.from({ length: Math.min(CONCURRENCY, toRead.length) }, async () => {
        while (next < toRead.length) {
          const d = toRead[next++];
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
    // The attestation is ~6 KB and identical for every proof in an epoch, so
    // a re-drop of a large folder answered with the same two blobs thousands
    // of times: 64% of a 37.4 MB response for 2,000 digests, measured
    // 2026-09-07. Sent once each and named from the entry instead; the client
    // puts them back before it reads a proof. See lib/proof-environment.ts.
    const environments = envTable
      ? splitEnvironments(
          results as unknown as Parameters<typeof splitEnvironments>[0],
          (json) => createHash("sha256").update(json).digest("base64url").slice(0, 16),
        )
      : {};
    return NextResponse.json({
      results,
      ...(wanted.size ? { sets } : {}),
      ...(Object.keys(environments).length ? { environments } : {}),
    });
  } catch (e) {
    console.error("POST /api/proofs/batch error:", e);
    return NextResponse.json({ error: "Failed" }, { status: 500 });
  }
}
