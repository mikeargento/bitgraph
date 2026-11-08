import { NextRequest, NextResponse } from "next/server";
import { fusedOriginDigestOf, isFusedProof } from "@/lib/fuse-core";
import { bindSet, isSetProof, memberOf } from "@/lib/fuse-set";
import { getProofsByDigest, LedgerUnavailableError, DISCOVERY_RETIRED, ledgerWritesOn } from "@/lib/s3";
import { fromUrlSafeB64, toUrlSafeB64 } from "@/lib/explorer";
import { recordedMsOf } from "@/lib/recorded-time";
import { timelineRecordAt } from "@/lib/timeline-ledger";

export const dynamic = "force-dynamic";


export async function GET(req: NextRequest, { params }: { params: Promise<{ digest: string }> }) {
  try {
    const { digest } = await params;
    const standardB64 = fromUrlSafeB64(decodeURIComponent(digest));
    // The same bytes can occupy several causal positions (BitGraphed more than
    // once). Fetch them all, earliest first; ?counter= (plus optional ?epoch=,
    // url-safe) selects which position this page load describes. Default: the
    // earliest, i.e. the originating proof.
    const all = await getProofsByDigest(standardB64);
    if (all.length === 0) {
      // A record kept only in the timeline's batches (an epoch's closing BitGraph, and some older system records) has no
      // per-proof object: it is found by its epoch and count, and served when it binds these bytes.
      const c = req.nextUrl.searchParams.get("counter"), e = req.nextUrl.searchParams.get("epoch");
      if (c && e && /^[1-9][0-9]*$/.test(c) && /^[A-Za-z0-9_-]{43}$/.test(e)) {
        const rec = await timelineRecordAt(e, Number(c)).catch(() => null);
        if (rec && rec.proof.artifact.digestB64 === standardB64) {
          return NextResponse.json({
            proofs: [{ proof: rec.proof }], lookupKind: "recorded", positions: [],
            timelineRecord: { kind: rec.kind, ...(rec.endFile ? { endFile: rec.endFile } : {}) },
          }, { headers: { "Cache-Control": "public, s-maxage=3600" } });
        }
      }
      // A miss can become a hit once the bytes are recorded, so keep it brief.
      // A miss is no longer a finding: see DISCOVERY_RETIRED. Additive —
      // `proofs: []` keeps the shape every existing reader parses.
      return NextResponse.json({ proofs: [], ...(ledgerWritesOn() ? {} : DISCOVERY_RETIRED) },
        { headers: { "Cache-Control": "public, s-maxage=10, stale-while-revalidate=30" } });
    }
    const selCounter = req.nextUrl.searchParams.get("counter");
    const selEpoch = req.nextUrl.searchParams.get("epoch");
    // The originating proof is the earliest RECORDING of these bytes. A fused
    // descendant (a fused artifact naming these bytes as origin) never stands
    // in for it: when only descendants exist, the bytes themselves are not
    // on record and the response says so with lookupKind "origin-only".
    const recorded = all.filter((e) => e.kind === "recorded");
    const lookupKind: "recorded" | "origin-only" = recorded.length > 0 ? "recorded" : "origin-only";
    let proof = (recorded[0] ?? all[0]).proof;
    if (selCounter) {
      const match = all.find((e) => {
        const c = e.proof.commit as { counter?: string; epochId?: string } | undefined;
        if (String(c?.counter) !== String(parseInt(selCounter, 10))) return false;
        return !selEpoch || toUrlSafeB64(c?.epochId ?? "") === selEpoch;
      });
      if (match) proof = match.proof;
    }

    /* WHICH BYTES' HISTORY THE POSITIONS CARD SHOWS.
       The list is the history of the file the visitor has in hand. When the
       digest looked up is a FUSED ARTIFACT, that history lives under its
       ORIGIN: a file BitGraphed five times has five positions, and the origin
       is what every one of them names. The artifact's own set holds exactly one
       entry, its own commit, which is why a fused artifact's page said
       "Positions (1)" while the original's said "Positions (6)" for the same
       file (2026-09-04). Dropping the original and dropping the new file
       must land on the same list.

       Deliberately separate from `all`: that set still drives the lead card,
       lookupKind and the proof selection above, all of which are about the
       bytes actually looked up. Only the list widens. */
    let positionEntries = all;
    const selfFused = all.find(
      (e) =>
        isFusedProof(e.proof) &&
        toUrlSafeB64((e.proof.artifact as { digestB64?: string } | undefined)?.digestB64 ?? "") ===
          toUrlSafeB64(standardB64)
    );
    // A set member's NEW file names its origin through the set's manifest
    // rather than a signed message, so the widening reads the bound manifest
    // (hydrated by the index) and takes the row's origin. An origin match wins
    // in memberOf, so bytes that are both an origin and a member's fused
    // bytes already sit on the origin's list and widen nowhere.
    let originB64: string | null = null;
    if (selfFused) {
      originB64 = fusedOriginDigestOf(selfFused.proof);
    } else {
      const asMember = all.find((e) => e.member?.role === "fused");
      if (asMember) {
        const bound = await bindSet(asMember.proof);
        const row = bound ? memberOf(bound, standardB64) : null;
        if (row?.role === "fused") originB64 = row.originDigestB64;
      }
    }
    if (originB64) {
      try {
        const originEntries = await getProofsByDigest(originB64);
        // Never shrink the list: a widening that came back short (a lagging
        // index, a partial read) leaves the page saying exactly what it said
        // before this existed.
        if (originEntries.length > positionEntries.length) positionEntries = originEntries;
      } catch { /* keep the artifact's own list */ }
    }

    // A set entry's member count, from the manifest the index hydrated and
    // bindSet bound (hash to the signed digest, commitment to the slot);
    // absent when the entry could not be bound, never guessed from raw metadata.
    const setCounts = await Promise.all(positionEntries.map(async (e) =>
      isSetProof(e.proof) ? (await bindSet(e.proof))?.members.length ?? null : null));

    const positions = positionEntries.map((e, idx) => {
      const c = e.proof.commit as { counter?: string; epochId?: string } | undefined;
      const artifact = (e.proof.artifact as { digestB64?: string } | undefined)?.digestB64;
      const attr = e.proof.attribution as { title?: string } | undefined;
      return {
        counter: c?.counter ?? null,
        epoch: c?.epochId ? toUrlSafeB64(c.epochId) : null,
        // When BitGraph recorded this position, by the TEE's signed clock: the
        // same time the proof page leads with, so a Positions row and the page
        // it opens never disagree (one clock everywhere, 2026-09-27).
        recordedMs: recordedMsOf(e.proof),
        kind: e.kind,
        // For a fused descendant: the fused artifact's own digest (url-safe) and placement.
        artifactDigest: artifact ? toUrlSafeB64(artifact) : null,
        // Any proof carrying the signed fused marker names its placement and
        // origin, whichever digest was looked up: the origin's page lists it
        // as a descendant, the fused artifact's own page shows where it came from.
        ...(isFusedProof(e.proof) ? { placement: attr?.title ?? null, fusedOrigin: (() => { const o = fusedOriginDigestOf(e.proof); return o ? toUrlSafeB64(o) : null; })() } : {}),
        // For a set member's entry: the row these bytes are (origin or fused
        // bytes, one of N); for any set entry: how many members it lists.
        ...(e.member ? { member: e.member } : {}),
        ...(setCounts[idx] !== null ? { setCount: setCounts[idx] } : {}),
      };
    });

    const selCommit = proof.commit as { counter?: string; epochId?: string } | undefined;
    // CDN caching. A recorded proof never changes; the one thing that can is the Recordings list growing (the same
    // bytes BitGraphed again), which stale-while-revalidate refreshes in the background, so SWR is minutes, not days.
    const cacheControl = "public, s-maxage=60, stale-while-revalidate=300";
    // The epoch's closing record: its note goes with it, so its page can name it and offer the note.
    let timelineRecord: { kind: string; endFile?: string } | undefined;
    // A lookup cut short by the timeout is not an answer: that response is not cached, so the next visit asks again.
    let timelineTimedOut = false;
    // Only for a link naming its position, and never for long: an older epoch has no timeline.
    if (selCounter && selEpoch && selCommit?.counter && selCommit.epochId) {
      const ep = selCommit.epochId.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
      const TIMED_OUT = Symbol("timed out");
      const got = await Promise.race([timelineRecordAt(ep, Number(selCommit.counter)).catch(() => null), new Promise<typeof TIMED_OUT>((r) => setTimeout(() => r(TIMED_OUT), 2000))]);
      if (got === TIMED_OUT) timelineTimedOut = true;
      const rec = got === TIMED_OUT ? null : got;
      if (rec?.kind === "end" && rec.endFile && rec.proof.artifact.digestB64 === standardB64) timelineRecord = { kind: "end", endFile: rec.endFile };
    }
    return NextResponse.json({ proofs: [{ proof }],
        lookupKind, positions, ...(timelineRecord ? { timelineRecord } : {}) }, { headers: { "Cache-Control": timelineTimedOut ? "no-store" : cacheControl } });
  } catch (e) {
    // Never cached, and never confusable with the `{ proofs: [] }` miss above:
    // that answer means the ledger has nothing, this one means we could not
    // ask it.
    if (e instanceof LedgerUnavailableError) {
      console.error("GET /api/proofs/digest ledger unavailable:", e.message);
      return NextResponse.json({ error: "ledger unavailable" }, { status: 503, headers: { "Cache-Control": "no-store" } });
    }
    console.error("GET /api/proofs/digest error:", e);
    return NextResponse.json({ error: "Failed" }, { status: 500, headers: { "Cache-Control": "no-store" } });
  }
}
