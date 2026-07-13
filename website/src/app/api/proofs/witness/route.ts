import { NextRequest, NextResponse } from "next/server";
import { buildAnchorWitness } from "@/lib/eth-header";

export const dynamic = "force-dynamic";

// Build the offline block-header witness for one anchor's Ethereum block.
// ?block=<number>&hash=0x<64 hex>. Returns the bitgraph-anchor-witness/1 object
// (self-checked: only returned when keccak256(header) == the signed block hash),
// or 404 when the header can't be fetched or re-encoded to match.
export async function GET(req: NextRequest) {
  try {
    const blockStr = req.nextUrl.searchParams.get("block");
    const hash = req.nextUrl.searchParams.get("hash");
    const blockNumber = blockStr ? parseInt(blockStr, 10) : NaN;
    if (!Number.isInteger(blockNumber) || blockNumber < 0 || !hash || !/^0x[0-9a-fA-F]{64}$/.test(hash)) {
      return NextResponse.json({ error: "block (integer) and hash (0x+64 hex) required" }, { status: 400 });
    }
    const witness = await buildAnchorWitness(blockNumber, hash);
    if (!witness) return NextResponse.json({ error: "witness unavailable" }, { status: 404 });
    return NextResponse.json(witness);
  } catch (e) {
    console.error("GET /api/proofs/witness error:", (e as Error).message);
    return NextResponse.json({ error: "Failed" }, { status: 500 });
  }
}
