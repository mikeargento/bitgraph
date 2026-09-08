import { NextRequest, NextResponse } from "next/server";
import { sha256 } from "@noble/hashes/sha256.js";
import { keccak_256 } from "@noble/hashes/sha3.js";
import { buildAnchorWitness, type AnchorWitness } from "@/lib/eth-header";
import { getProofsByDigest, LedgerUnavailableError } from "@/lib/s3";

export const dynamic = "force-dynamic";

// Build the offline block-header witness for one anchor's Ethereum block.
// ?block=<number>&hash=0x<64 hex>. Returns the bitgraph-anchor-witness/1 object
// (self-checked: only returned when keccak256(header) == the signed block hash),
// or 404 when the header can't be found or re-encoded to match.

function hex(bytes: Uint8Array): string {
  let s = "0x";
  for (const b of bytes) s += b.toString(16).padStart(2, "0");
  return s;
}
function bytesFromHex(h: string): Uint8Array {
  const clean = h.replace(/^0x/, "");
  return Uint8Array.from((clean.match(/../g) ?? []).map((x) => parseInt(x, 16)));
}

/**
 * The header the anchor itself carries, when it has one.
 *
 * An anchor commits SHA-256 of its block hash, so the ledger can be asked for
 * it directly: the digest IS derivable from the hash in the query. Anchors
 * written from 2026-09-08 keep the RLP header in their metadata, which makes
 * this answerable with no Ethereum RPC at all.
 *
 * ⚠️ metadata is UNSIGNED, so the header is re-checked here exactly as a
 * reader would: keccak256 of it must reproduce the block hash. A stored
 * header that does not is ignored, not served, and the RPC path runs instead.
 */
async function storedHeader(blockNumber: number, blockHash: string): Promise<AnchorWitness | null> {
  try {
    const digest = Buffer.from(sha256(new TextEncoder().encode(blockHash.toLowerCase()))).toString("base64");
    const entries = await getProofsByDigest(digest, { hydrate: false });
    for (const e of entries) {
      const md = (e.proof as { metadata?: { anchor?: { headerRlpHex?: unknown; blockNumber?: unknown } } }).metadata;
      const h = md?.anchor?.headerRlpHex;
      if (typeof h !== "string" || !/^0x[0-9a-fA-F]+$/.test(h)) continue;
      if (md?.anchor?.blockNumber !== blockNumber) continue;
      if (hex(keccak_256(bytesFromHex(h))).toLowerCase() !== blockHash.toLowerCase()) continue;
      return {
        version: "bitgraph-anchor-witness/1",
        headerRlpHex: h.toLowerCase(),
        blockNumber,
        blockHash: blockHash.toLowerCase(),
      };
    }
  } catch (err) {
    // A ledger that cannot be read is not a missing header; fall through to
    // the RPC rather than reporting the witness unavailable.
    console.warn("[witness] ledger lookup failed:",
      err instanceof LedgerUnavailableError ? err.message : err);
  }
  return null;
}

export async function GET(req: NextRequest) {
  try {
    const blockStr = req.nextUrl.searchParams.get("block");
    const hash = req.nextUrl.searchParams.get("hash");
    const blockNumber = blockStr ? parseInt(blockStr, 10) : NaN;
    if (!Number.isInteger(blockNumber) || blockNumber < 0 || !hash || !/^0x[0-9a-fA-F]{64}$/.test(hash)) {
      return NextResponse.json({ error: "block (integer) and hash (0x+64 hex) required" }, { status: 400 });
    }
    // The anchor's own copy first: no RPC, and it is the same bytes the
    // anchor was written with rather than a re-fetch that has to agree.
    const witness = (await storedHeader(blockNumber, hash)) ?? (await buildAnchorWitness(blockNumber, hash));
    if (!witness) return NextResponse.json({ error: "witness unavailable" }, { status: 404 });
    return NextResponse.json(witness);
  } catch (e) {
    console.error("GET /api/proofs/witness error:", (e as Error).message);
    return NextResponse.json({ error: "Failed" }, { status: 500 });
  }
}
