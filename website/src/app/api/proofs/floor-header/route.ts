import { NextRequest, NextResponse } from "next/server";
import { getObjectBytes } from "@/lib/s3";
import { parseFloorHeaderQuery, readBaseFloorHeader } from "@/lib/floor-header";

export const dynamic = "force-dynamic";

/**
 * GET /api/proofs/floor-header?chain=base&block=N&hash=0x...
 *
 * The header of a Base floor block (enclave v10: the block the enclave fixed
 * when a position opened and signed as commit.slotFloor), from the copy the
 * parent saved before any proof stood on it (base-floors/, Object Lock).
 * Served only when keccak-256 of it is the hash asked for and it is that
 * block: { chain, blockNumber, blockHash, blockTimestamp, header }. 404 when
 * no such header is saved. Ethereum floors (anchors) keep /api/proofs/witness.
 */
export async function GET(req: NextRequest) {
  const q = parseFloorHeaderQuery({
    chain: req.nextUrl.searchParams.get("chain"),
    block: req.nextUrl.searchParams.get("block"),
    hash: req.nextUrl.searchParams.get("hash"),
  });
  if (!q.ok) return NextResponse.json({ error: q.error }, { status: 400 });
  try {
    const answer = await readBaseFloorHeader(q.blockNumber, q.blockHash, getObjectBytes);
    if (answer === null) return NextResponse.json({ error: "no saved header for that Base block" }, { status: 404 });
    // A saved header never changes (Object Lock), so an answer can be cached for good.
    return NextResponse.json(answer, { headers: { "Cache-Control": "public, max-age=31536000, immutable" } });
  } catch (e) {
    console.error("GET /api/proofs/floor-header error:", (e as Error).message);
    return NextResponse.json({ error: "BitGraph's copy could not be read; try again", code: "ledger-unavailable" }, { status: 503 });
  }
}
