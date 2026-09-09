/* The causal window: the two Ethereum anchors that bracket a position.
 *
 * ⚠️ EXTRACTED SO THERE IS ONE OF IT. This lived inside
 * app/api/proofs/digest/[digest]/route.ts, which can only answer for a proof
 * the ledger still holds — and since 2026-09-08 the ledger holds no user
 * proofs at all, so every local-first BitGraph lost its window and its page
 * said "Waiting for the next Ethereum block…" forever (Mike: "eth anchors dont
 * load into proofs but they should. they are accessible from the s3").
 *
 * They are. anchors/{epoch}/{counter}.json is keyed by COUNTER, not by digest,
 * which is exactly why that index survived phase 2 while by-digest did not. A
 * proof carries its own counter and epoch in its signed body, so the window is
 * always computable from the proof alone, with nothing looked up about the
 * file. Serving that is /api/proofs/window.
 *
 * A second implementation of this is how the old page generator drifted until
 * it had to be deleted; one copy, two callers.
 */
import { getAnchorsAfterCounter, getAnchorBeforeCounter } from "@/lib/s3";
import { anchorMarkOf, isAnchorProof, ANCHOR_ATTRIBUTION_NAME } from "@mikeargento/bitgraph-verify";

export type AnchorView = {
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
export async function buildAnchorView(anchor: Record<string, unknown>): Promise<AnchorView> {
  const anchorProof = anchor.proof as Record<string, unknown> | undefined;
  const anchorCommit = (anchorProof?.commit || anchor.commit) as { counter?: string } | undefined;
  const anchorAttr = (anchorProof?.attribution || anchor.attribution) as { name?: string; title?: string; message?: string } | undefined;
  const anchorArtifact = (anchorProof?.artifact || anchor.artifact) as { digestB64?: string } | undefined;
  const eth = anchor.ethereum as { blockNumber?: number; blockHash?: string; blockTime?: number; blockTimeISO?: string } | undefined;
  // The signed mark is the authority on which block this is. Attribution says
  // the same thing on every anchor since v7, but only by convention, and a
  // fused anchor spends its attribution on the fuse marker instead.
  const mark = anchorMarkOf(anchorProof ?? anchor);
  const blockNumber =
    mark?.blockNumber?.toString()
    ?? eth?.blockNumber?.toString()
    ?? anchorAttr?.title?.match(/\/block\/(\d+)/)?.[1];

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
    // The label names what the proof IS, not what its attribution happens to
    // say: a fused anchor's attribution reads "bitgraph-fuse/1", which is true
    // and useless here.
    attrName: isAnchorProof(anchorProof ?? anchor) ? ANCHOR_ATTRIBUTION_NAME : (anchorAttr?.name || ANCHOR_ATTRIBUTION_NAME),
    blockNumber: blockNumber ? parseInt(blockNumber, 10) : null,
    blockHash: mark?.blockHash ?? eth?.blockHash ?? anchorAttr?.message ?? null,
    etherscanUrl: blockNumber ? `https://etherscan.io/block/${blockNumber}` : (anchorAttr?.title || null),
    blockTime,
    digestB64: anchorArtifact?.digestB64 || null,
  };
}

/** Both sides for one position. Needs only the counter and epoch the proof
 *  already carries — never the digest, and never the ledger's copy of it. */
export async function computeWindow(counter: number, epochId: string): Promise<{
  anchorBefore: AnchorView | null;
  anchorAfter: AnchorView | null;
}> {
  const [after, beforeRaw] = await Promise.all([
    getAnchorsAfterCounter(counter, epochId, 1),
    getAnchorBeforeCounter(counter, epochId),
  ]);
  const [anchorAfter, anchorBefore] = await Promise.all([
    after.length > 0 ? buildAnchorView(after[0]) : Promise.resolve(null),
    beforeRaw ? buildAnchorView(beforeRaw) : Promise.resolve(null),
  ]);
  return { anchorBefore, anchorAfter };
}
