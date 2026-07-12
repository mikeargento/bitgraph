import { NextRequest, NextResponse } from "next/server";
import { getProofsByDigest, getAnchorsAfterCounter, getAnchorBeforeCounter } from "@/lib/s3";
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
      return NextResponse.json({ proofs: [] });
    }
    const selCounter = req.nextUrl.searchParams.get("counter");
    const selEpoch = req.nextUrl.searchParams.get("epoch");
    let proof = all[0].proof;
    if (selCounter) {
      const match = all.find((e) => {
        const c = e.proof.commit as { counter?: string; epochId?: string } | undefined;
        if (String(c?.counter) !== String(parseInt(selCounter, 10))) return false;
        return !selEpoch || toUrlSafeB64(c?.epochId ?? "") === selEpoch;
      });
      if (match) proof = match.proof;
    }

    // Summary of every causal position for these bytes, in the same order, so
    // the page can offer the full set. `time` is the index entry's S3 write
    // time — advisory display only (stored proofs carry no clock field); the
    // Ethereum window remains the time mechanism.
    const positions = all.map((e) => {
      const c = e.proof.commit as { counter?: string; epochId?: string } | undefined;
      return {
        counter: c?.counter ?? null,
        epoch: c?.epochId ? toUrlSafeB64(c.epochId) : null,
        time: e.writeTime,
      };
    });

    // Causal time window from S3 anchors. NOTE the naming inversion that the UI
    // depends on: anchorBefore is the anchor with the LOWER counter (earlier
    // Ethereum block) — the proof was BitGraphed AFTER it (lower time bound).
    // anchorAfter is the anchor with the HIGHER counter (later block) — the
    // proof was BitGraphed BEFORE it (upper time bound). Both together bracket
    // the proof to roughly one anchor interval of public Ethereum time.
    let causalWindow = null;
    try {
      const commit = proof.commit as { counter?: string; epochId?: string };
      if (commit?.counter && commit?.epochId) {
        const counter = parseInt(commit.counter, 10);
        const [anchorsAfter, anchorBeforeRaw] = await Promise.all([
          getAnchorsAfterCounter(counter, commit.epochId, 1),
          getAnchorBeforeCounter(counter, commit.epochId),
        ]);
        const [anchorAfter, anchorBefore] = await Promise.all([
          anchorsAfter.length > 0 ? buildAnchorView(anchorsAfter[0]) : Promise.resolve(null),
          anchorBeforeRaw ? buildAnchorView(anchorBeforeRaw) : Promise.resolve(null),
        ]);
        if (anchorAfter || anchorBefore) {
          causalWindow = { anchorBefore, anchorAfter };
        }
      }
    } catch (_) { /* non-critical */ }

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

    return NextResponse.json({ proofs: [{ proof }], positions, causalWindow, anchorBlock });
  } catch (e) {
    console.error("GET /api/proofs/digest error:", e);
    return NextResponse.json({ error: "Failed" }, { status: 500 });
  }
}
