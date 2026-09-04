import { NextRequest, NextResponse } from "next/server";
import { fusedOriginDigestOf, isFusedProof } from "@/lib/fuse-core";
import { getProofsByDigest, getAnchorsAfterCounter, getAnchorBeforeCounter, LedgerUnavailableError } from "@/lib/s3";
import { fromUrlSafeB64, toUrlSafeB64 } from "@/lib/explorer";

export const dynamic = "force-dynamic";

type AnchorView = {
  counter: string;
  attrName: string;
  blockNumber: number | null;
  blockHash: string | null;
  etherscanUrl: string | null;
  blockTime: string | null;
  digestB64: string | null;
};

// Build the display view for one anchor (a raw anchor proof object from S3).
// Block timestamp is read from the anchor's own metadata.anchor.blockTimeISO,
// written at commit time — fast, reliable, no runtime dependency on a third-party
// Ethereum RPC. The RPC fallback only fires for the rare anchor that lacks the
// field, with a tight timeout and multiple endpoints so a slow node cannot hang
// the page.
async function buildAnchorView(anchor: Record<string, unknown>): Promise<AnchorView> {
  const anchorProof = anchor.proof as Record<string, unknown> | undefined;
  const anchorCommit = (anchorProof?.commit || anchor.commit) as { counter?: string } | undefined;
  const anchorAttr = (anchorProof?.attribution || anchor.attribution) as { name?: string; title?: string; message?: string } | undefined;
  const anchorArtifact = (anchorProof?.artifact || anchor.artifact) as { digestB64?: string } | undefined;
  const eth = anchor.ethereum as { blockNumber?: number; blockHash?: string; blockTime?: number; blockTimeISO?: string } | undefined;
  const blockNumber = eth?.blockNumber?.toString() || anchorAttr?.title?.match(/\/block\/(\d+)/)?.[1];

  const anchorMetadata = ((anchorProof?.metadata || anchor.metadata) as
    { anchor?: { blockTimeISO?: string; blockTime?: number } } | undefined)?.anchor;
  let blockTime: string | null =
    anchorMetadata?.blockTimeISO
    ?? eth?.blockTimeISO
    ?? (anchorMetadata?.blockTime ? new Date(anchorMetadata.blockTime * 1000).toISOString() : null)
    ?? (eth?.blockTime ? new Date(eth.blockTime * 1000).toISOString() : null);

  if (!blockTime && blockNumber) {
    const rpcEndpoints = [
      "https://ethereum-rpc.publicnode.com",
      "https://cloudflare-eth.com",
      "https://rpc.ankr.com/eth",
    ];
    for (const endpoint of rpcEndpoints) {
      try {
        const rpcRes = await fetch(endpoint, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ jsonrpc: "2.0", method: "eth_getBlockByNumber", params: ["0x" + parseInt(blockNumber, 10).toString(16), false], id: 1 }),
          signal: AbortSignal.timeout(2500),
        });
        if (!rpcRes.ok) continue;
        const rpcData = await rpcRes.json() as { result?: { timestamp?: string } };
        if (rpcData.result?.timestamp) {
          blockTime = new Date(parseInt(rpcData.result.timestamp, 16) * 1000).toISOString();
          break;
        }
      } catch (_) { /* try next endpoint */ }
    }
  }

  return {
    counter: (anchor.counter as string) || anchorCommit?.counter || "?",
    attrName: anchorAttr?.name || "Ethereum Anchor",
    blockNumber: blockNumber ? parseInt(blockNumber, 10) : null,
    blockHash: eth?.blockHash || anchorAttr?.message || null,
    etherscanUrl: anchorAttr?.title || (blockNumber ? `https://etherscan.io/block/${blockNumber}` : null),
    blockTime,
    digestB64: anchorArtifact?.digestB64 || null,
  };
}

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
      // A miss can become a hit once the bytes are recorded, so keep it brief.
      return NextResponse.json({ proofs: [] }, { headers: { "Cache-Control": "public, s-maxage=10, stale-while-revalidate=30" } });
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
       file (Mike, 2026-09-04). Dropping the original and dropping the new file
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
    if (selfFused) {
      const originB64 = fusedOriginDigestOf(selfFused.proof);
      if (originB64) {
        try {
          const originEntries = await getProofsByDigest(originB64);
          // Never shrink the list: a widening that came back short (a lagging
          // index, a partial read) leaves the page saying exactly what it said
          // before this existed.
          if (originEntries.length > positionEntries.length) positionEntries = originEntries;
        } catch { /* keep the artifact's own list */ }
      }
    }

    // The two-sided ETH anchor window for one counter+epoch. NOTE the naming
    // inversion the UI depends on: anchorBefore is the anchor with the LOWER
    // counter (earlier Ethereum block) — the proof was BitGraphed AFTER it
    // (lower time bound). anchorAfter is the HIGHER counter (later block) — the
    // proof was BitGraphed BEFORE it (upper time bound). Together they bracket
    // the proof to roughly one anchor interval of public Ethereum time.
    const computeWindow = async (counter: number, epochId: string) => {
      const [anchorsAfter, anchorBeforeRaw] = await Promise.all([
        getAnchorsAfterCounter(counter, epochId, 1),
        getAnchorBeforeCounter(counter, epochId),
      ]);
      const [anchorAfter, anchorBefore] = await Promise.all([
        anchorsAfter.length > 0 ? buildAnchorView(anchorsAfter[0]) : Promise.resolve(null),
        anchorBeforeRaw ? buildAnchorView(anchorBeforeRaw) : Promise.resolve(null),
      ]);
      return { anchorBefore, anchorAfter };
    };

    // Compute EVERY position's anchor window in parallel. The anchor window is
    // the defensible time statement (the S3 write time is just our server
    // clock, not part of the proof), so each position in the Causal Positions
    // card shows the same two-sided "between X and Y" as the lead card.
    const positionWindows = await Promise.all(positionEntries.map(async (e) => {
      const c = e.proof.commit as { counter?: string; epochId?: string } | undefined;
      if (!c?.counter || !c?.epochId) return { anchorBefore: null, anchorAfter: null };
      try { return await computeWindow(parseInt(c.counter, 10), c.epochId); }
      catch { return { anchorBefore: null, anchorAfter: null }; }
    }));

    const positions = positionEntries.map((e, idx) => {
      const c = e.proof.commit as { counter?: string; epochId?: string } | undefined;
      const w = positionWindows[idx];
      const artifact = (e.proof.artifact as { digestB64?: string } | undefined)?.digestB64;
      const attr = e.proof.attribution as { title?: string } | undefined;
      return {
        counter: c?.counter ?? null,
        epoch: c?.epochId ? toUrlSafeB64(c.epochId) : null,
        lowerTime: w.anchorBefore?.blockTime ?? null,
        upperTime: w.anchorAfter?.blockTime ?? null,
        kind: e.kind,
        // For a fused descendant: the fused artifact's own digest (url-safe) and placement.
        artifactDigest: artifact ? toUrlSafeB64(artifact) : null,
        // Any proof carrying the signed fused marker names its placement and
        // origin, whichever digest was looked up: the origin's page lists it
        // as a descendant, the fused artifact's own page shows where it came from.
        ...(isFusedProof(e.proof) ? { placement: attr?.title ?? null, fusedOrigin: (() => { const o = fusedOriginDigestOf(e.proof); return o ? toUrlSafeB64(o) : null; })() } : {}),
      };
    });

    // The lead card's window is the selected proof's — reuse it from the set
    // just computed instead of looking it up a second time.
    let causalWindow = null;
    // Matched on counter+epoch, not object identity: when the list widened to
    // the origin's entries above, the selected proof is a different instance of
    // the same record. A counter is unique within an epoch, so this is exact.
    const selCommit = proof.commit as { counter?: string; epochId?: string } | undefined;
    const selIdx = positionEntries.findIndex((e) => {
      const c = e.proof.commit as { counter?: string; epochId?: string } | undefined;
      return c?.counter === selCommit?.counter && c?.epochId === selCommit?.epochId;
    });
    if (selIdx >= 0) {
      const w = positionWindows[selIdx];
      if (w.anchorAfter || w.anchorBefore) causalWindow = { anchorBefore: w.anchorBefore, anchorAfter: w.anchorAfter };
    } else if (selCommit?.counter && selCommit?.epochId) {
      // The selected proof is not in the list at all. Not expected, and the
      // lead card must still carry its window rather than silently losing it.
      try {
        const w = await computeWindow(parseInt(selCommit.counter, 10), selCommit.epochId);
        if (w.anchorAfter || w.anchorBefore) causalWindow = { anchorBefore: w.anchorBefore, anchorAfter: w.anchorAfter };
      } catch { /* leave it null, as before */ }
    }

    // For an Ethereum anchor, resolve its OWN block (number + timestamp) so the
    // proof page can show a "Recorded: Ethereum Block #N at <time>" line, the
    // anchor's equivalent of a user proof's causal time window. The stored
    // anchor proof carries the block hash/number but not the timestamp, so
    // buildAnchorView fills it in (from the block number via RPC fallback).
    let anchorBlock = null;
    try {
      const anchorAttr = proof.attribution as { name?: string } | undefined;
      if (anchorAttr?.name?.startsWith("Ethereum")) {
        anchorBlock = await buildAnchorView(proof);
      }
    } catch (_) { /* non-critical */ }

    // CDN caching. This response is expensive (per position: two S3 anchor-window
    // scans), yet for a SETTLED proof it never changes — both anchors have landed
    // and the causal window is fixed. Serve those from the CDN so a warm/prefetch,
    // and every subsequent visit, is instant instead of re-running the S3 work.
    // The one thing that can still change is the Recordings list growing (the same
    // bytes BitGraphed again), which stale-while-revalidate refreshes in the
    // background — so SWR is minutes, not days: a stale list must heal on the
    // next visit soon after, not whenever a second visitor happens by. The page
    // also self-corrects the worst case (viewing a position the cached list
    // doesn't contain) by refetching on a fresh cache key. A proof still waiting
    // on its upper anchor gets a short TTL so the pending "waiting on Ethereum"
    // window fills in promptly (the client also polls).
    const settled = !!causalWindow?.anchorAfter?.blockTime;
    const cacheControl = settled
      ? "public, s-maxage=60, stale-while-revalidate=300"
      : "public, s-maxage=5, stale-while-revalidate=30";
    return NextResponse.json({ proofs: [{ proof }],
        lookupKind, positions, causalWindow, anchorBlock }, { headers: { "Cache-Control": cacheControl } });
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
