import { NextRequest, NextResponse } from "next/server";
import { getProofsByDigest, readSetPosition, readSetMemberList, runPool, LedgerUnavailableError, DISCOVERY_RETIRED, ledgerWritesOn } from "@/lib/s3";
import { digestIndex } from "@/lib/digest-index";
import { fromUrlSafeB64 } from "@/lib/explorer";
import { splitEnvironments } from "@/lib/proof-environment";
import { liftSetProofs, toSafe as toSafeB64 } from "@/lib/set-members";
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
/**
 * Digests looked up the ordinary way before the sets they name are expanded.
 *
 * Enough to find every set a drop touches without paying for many: a folder
 * made in one go is a handful of sets, and each probe reports EVERY position
 * its digest holds, so one probe that lands on a thrice-made file names all
 * three sets at once. Digests not covered by any expanded list are looked up
 * exactly as before, so a low number costs speed, never correctness.
 */
const SET_PROBE = 24;

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
    /**
     * `members: "full"` turns the member-list shortcut OFF and reads every
     * position, so each set member entry carries its OWN evidence again.
     *
     * ⚠️ AN EXPORT MUST ASK FOR THIS. A member answered from a set's list
     * gets the set's proof with the row's index and count but NOT its Merkle
     * path, and without the path no reader can place that member under the
     * root. Checking never needs it; a zip always does.
     */
    const useLists = body?.members !== "full";

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
    /**
     * ⚠️ A SET IS ONE POSITION, AND WE WERE ASKING ABOUT IT ONCE PER MEMBER.
     *
     * A set/2 of 48,000 files holds ONE position, but every member has its
     * own `by-digest` key holding the whole set proof, so re-dropping the
     * folder cost 48,000 listings and ~104,000 reads: about 152,000 S3
     * operations, 70s measured against production on 2026-09-07, while the
     * SAME folder checked in 4.0s before it was ever recorded.
     *
     * Mike's read of it: "look up the FIRST available proof and if it's in a
     * big group it looks up the rest by logic". So a few digests are probed
     * normally; a probe that lands on a set member names its set, and that
     * set's member list answers every other file in the drop from memory.
     * ~25 reads instead of 152,000.
     *
     * ⚠️ THE LIST IS AN INDEX AND NEVER A VERDICT. A digest the list does not
     * name is looked up exactly as before, so a missing, stale or partial
     * list costs speed and nothing else. And a set is only used once its
     * PROOF has actually been read: claiming membership while unable to
     * produce the proof would be an answer with nothing behind it.
     */
    const probeCount = useLists ? Math.min(SET_PROBE, toRead.length) : 0;
    const sets: Record<string, unknown> = {};
    type MemberAt = { ref: string; writeTime: number | null; index: number; count: number; role: "origin" | "fused" };
    const memberOf = new Map<string, MemberAt>();
    /**
     * Every position a digest holds IN AN EXPANDED SET, keyed by digest.
     *
     * ⚠️ THIS IS NOT NECESSARILY ALL OF ITS POSITIONS, which is the whole
     * reason answers built from it are marked `partial`. A digest can also
     * sit in a set nothing probed, or hold a plain recording of its own, and
     * only the per-digest listing knows that. See the ruling below.
     */
    const memberPositions = new Map<string, MemberAt[]>();
    const setsTried = new Set<string>();
    async function expandSetsFrom(entries: Array<{ proof: unknown; setDigest?: string }>): Promise<void> {
      for (const e of entries) {
        const c = (e.proof as { commit?: { epochId?: string; counter?: string } }).commit;
        if (!e.setDigest || !c?.epochId || c?.counter === undefined) continue;
        const at = `${c.epochId}/${c.counter}`;
        if (setsTried.has(at)) continue;
        setsTried.add(at);
        try {
          const proof = await readSetPosition(e.setDigest, c.epochId, String(c.counter));
          if (proof === null) continue;
          const list = await readSetMemberList(c.epochId, String(c.counter));
          if (list === null) continue;
          sets[e.setDigest] = proof;
          for (const [d, m] of list) {
            // Keyed by POSITION and digest, because the listing asks about
            // one position at a time and a digest may sit in several sets.
            // ⚠️ url-safe on BOTH sides: the resolver is handed the epoch
            // parsed out of an S3 key, while this one comes from the proof,
            // and those are two spellings of the same value.
            const at = `${toSafeB64(c.epochId)}/${c.counter}|${d}`;
            if (memberOf.has(at)) continue;
            const rec: MemberAt = {
              ref: m.setDigest,
              writeTime: m.writeTime,
              index: m.index,
              count: m.count,
              // bg-kind "set-member" is the member's FUSED bytes; a
              // "fused-descendant" key is its origin. Same mapping as
              // memberOfHeaders, which these lists stand in for.
              role: m.kind === "set-member" ? "fused" : "origin",
            };
            memberOf.set(at, rec);
            const held = memberPositions.get(d);
            if (held) held.push(rec);
            else memberPositions.set(d, [rec]);
          }
          console.log(`[batch] set ${at} expanded: ${list.size} members from its list`);
        } catch (err) {
          // A set that cannot be read is simply not expanded. Its members
          // fall through to the per-digest path, which is what happened
          // before this existed.
          console.warn(`[batch] set ${at} not expanded:`, err instanceof Error ? err.message : err);
        }
      }
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
      /**
       * These positions came from set member lists, WITHOUT the per-digest
       * listing, so they are positions this digest holds and not necessarily
       * ALL of them. A reader must not present a count.
       */
      partial?: true;
    }> = {};
    // A digest the index ruled out is answered here, with the same shape a
    // read would have produced for bytes that are not on record.
    const reading = new Set(toRead);
    for (const d of unique) if (!reading.has(d)) results[d] = { proofs: [] };

    /** The resolver handed to the lookup: a position a member list already describes. */
    const resolveMember = (digestSafe: string, epochId: string, counter: string) => {
      const m = memberOf.get(`${toSafeB64(epochId)}/${counter}|${digestSafe}`);
      if (!m) return null;
      const proof = sets[m.ref];
      // Only ever answer with a proof actually in hand. Without it there is
      // nothing behind the claim, so fall through to the read.
      if (!proof) return null;
      return {
        proof: proof as Record<string, unknown>,
        writeTime: m.writeTime,
        // The set's artifact is its root document, never a member's bytes,
        // so a member position is always "fused"; the role below says which
        // side of the row these bytes are. Same mapping as memberOfHeaders.
        kind: "fused" as const,
        member: { index: m.index, count: m.count, role: m.role },
        setDigest: m.ref,
      };
    };

    const lookupOne = async (d: string) => {
      try {
        // Member entries come back WITHOUT their set's manifest: a batch
        // over a set's originals would otherwise carry one N-row manifest
        // per row (N squared bytes; 400 members passed the 4.5 MB
        // function limit) and fetch the same set key once per digest.
        // Each distinct set is read once below and sent once, in `sets`.
        const entries = await getProofsByDigest(fromUrlSafeB64(d), { hydrate: false, ...(useLists ? { resolveMember } : {}) });
        // writeTime (ledger write moment, ms) rides along so result rows
        // can show a compact "when" like the ledger's rows.
        results[d] = { proofs: entries.map(({ proof, writeTime, kind, member, setDigest }) => ({ proof, writeTime: writeTime ?? null, kind, ...(member ? { member } : {}), ...(setDigest ? { setDigest } : {}) })) };
        return entries;
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
        return [];
      }
    };

    // Probe first, so the sets this drop touches are known before the rest
    // is read. Nothing is skipped by probing: these are ordinary lookups
    // whose answers are kept.
    const probe = toRead.slice(0, probeCount);
    if (probe.length) {
      const probed = await runPool(probe, Math.min(CONCURRENCY, probe.length), lookupOne);
      await expandSetsFrom(probed.flatMap((r) => (r.status === "fulfilled" ? r.value : [])));
    }

    /**
     * ⚠️ RULING (Mike, 2026-09-08): "the row shouldnt claim a count until you
     * open it."
     *
     * This is what makes a check cost what a make costs. Making 48,000
     * BitGraphs is ONE request, because the set is one tick; checking them
     * was 48,000 separate questions about that same tick, and came out FOUR
     * TIMES more expensive than making them (make ~16s, check 64s). The
     * listing per digest was the whole remaining cost, and it exists for one
     * purpose: to promise the positions returned are ALL of them.
     *
     * That promise is worth paying for when you open a row. It is not worth
     * paying 48,000 times to draw a list. So a digest a member list already
     * places is answered from the list alone, no listing, and the entry says
     * `partial` — these are positions it holds, not a complete count. The row
     * prints no "1 of 3", the proof page still reads everything when opened,
     * and an export asks with `members: "full"`, which restores the listing.
     *
     * A digest no list places is looked up exactly as before.
     */
    const fromList: string[] = [];
    const mustRead: string[] = [];
    for (const d of toRead.slice(probeCount)) (memberPositions.has(d) ? fromList : mustRead).push(d);
    for (const d of fromList) {
      const held = memberPositions.get(d)!;
      results[d] = {
        partial: true,
        proofs: held
          .filter((m) => sets[m.ref])
          .map((m) => ({
            proof: sets[m.ref] as Record<string, unknown>,
            writeTime: m.writeTime,
            kind: "fused" as const,
            member: { index: m.index, count: m.count, role: m.role },
            setDigest: m.ref,
          })),
      };
      // A list that placed it but whose set is not in hand answers nothing,
      // so read it properly rather than report an empty position list.
      if (results[d].proofs.length === 0) { delete results[d]; mustRead.push(d); }
    }
    if (fromList.length) console.log(`[batch] ${fromList.length} digests answered from member lists, ${mustRead.length} read`);

    let next = 0;
    await Promise.all(
      Array.from({ length: Math.min(CONCURRENCY, mustRead.length) }, async () => {
        while (next < mustRead.length) await lookupOne(mustRead[next++]);
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
        // A set expanded above is already in `sets`; re-reading its
        // position here would be the same object fetched twice.
        if (!e.setDigest || wanted.has(e.setDigest) || sets[e.setDigest]) continue;
        const c = (e.proof as { commit?: { epochId?: string; counter?: string } }).commit;
        if (c?.epochId && c?.counter) wanted.set(e.setDigest, { epochId: c.epochId, counter: String(c.counter) });
      }
    }
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
    // A set member's proof is the set's, already in `sets`. Send it once.
    // This is what makes a set re-drop small: 48,000 members referencing one
    // proof instead of carrying 48,000 copies of it.
    const lifted = envTable ? liftSetProofs(results, sets) : 0;
    if (lifted) console.log(`[batch] ${lifted} member entries reference their set instead of copying it`);
    const environments = envTable
      ? splitEnvironments(
          results as unknown as Parameters<typeof splitEnvironments>[0],
          (json) => createHash("sha256").update(json).digest("base64url").slice(0, 16),
        )
      : {};
    /**
     * ⚠️ SEND `sets` WHENEVER IT HAS ANYTHING, never when `wanted` does.
     *
     * This said `wanted.size`, which was true only while every set arrived
     * through the per-digest read path. Expanding a set from its member list
     * populates `sets` WITHOUT ever putting it in `wanted` (it is already in
     * hand, so the later pass skips re-reading it), and the answer then went
     * out with 5,928 entries naming a set it did not carry. Those entries
     * lose their proof on the client, and a row with no proof reads as NOT
     * ON THE LEDGER — bytes that hold a permanent position offered up to be
     * recorded again. Caught on production before any drop hit it.
     */
    /* The retired-discovery note rides ONCE at the top level, never per
       entry: a 48,000 digest answer must not carry 48,000 copies of the same
       sentence. It is additive — `results` keeps the exact shape every
       existing reader parses, including the published MCP and the Zapier app,
       which is why this route's answer can change at all. */
    return NextResponse.json({
      results,
      ...(Object.keys(sets).length ? { sets } : {}),
      ...(Object.keys(environments).length ? { environments } : {}),
      ...(ledgerWritesOn() ? {} : DISCOVERY_RETIRED),
    });
  } catch (e) {
    console.error("POST /api/proofs/batch error:", e);
    return NextResponse.json({ error: "Failed" }, { status: 500 });
  }
}
