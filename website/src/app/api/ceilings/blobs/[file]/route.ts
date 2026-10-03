import { NextRequest, NextResponse } from "next/server";
import { getObjectBytes } from "@/lib/s3";

export const dynamic = "force-dynamic";

/**
 * One Ethereum blob's bytes, as the ceiling writer archived them when it built a
 * settlement pointer: `ceilings/blobs/<versioned hash>.bin` in the ledger bucket
 * (10-year Object Lock), 131,072 bytes each.
 *
 * Added 2026-10-02 after an outside review of a download package: the pointer
 * named six blobs, the package carried none, the bucket is private, and Ethereum
 * nodes prune blob data about 18 days after the block. Without these bytes nobody
 * can show the ceiling transaction is inside the batch the pointer names. The
 * proof page puts them in the package (base-ceiling/blobs/); this route is also
 * the address the package README gives for fetching them later.
 *
 * The bytes are evidence that checks itself: bitgraph-audit recomputes each
 * blob's KZG commitment and versioned hash, so a reader trusts the math, not
 * this route. The name is the versioned hash, so the content never changes.
 */
const NAME = /^0x01[0-9a-f]{62}\.bin$/;

export async function GET(_req: NextRequest, ctx: { params: Promise<{ file: string }> }) {
  const { file } = await ctx.params;
  const name = decodeURIComponent(file).toLowerCase();
  if (!NAME.test(name)) return NextResponse.json({ error: "expected <versioned hash>.bin: 0x01 and 62 hex digits" }, { status: 400 });
  let bytes: Uint8Array | null;
  try {
    bytes = await getObjectBytes(`ceilings/blobs/${name}`);
  } catch {
    return NextResponse.json({ error: "the archive did not answer; try again" }, { status: 503 });
  }
  if (!bytes) return NextResponse.json({ error: "no blob archived under that versioned hash" }, { status: 404 });
  return new NextResponse(bytes as unknown as BodyInit, {
    headers: {
      "content-type": "application/octet-stream",
      "content-disposition": `attachment; filename="${name}"`,
      "cache-control": "public, max-age=31536000, immutable",
    },
  });
}
