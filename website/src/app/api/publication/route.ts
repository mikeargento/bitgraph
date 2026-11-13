import { NextResponse } from "next/server";
import { getObjectText } from "@/lib/s3";
import { PUBLICATION_METADATA_KEY, publicationKey } from "@/lib/publication";

// GET /api/publication?epoch=<base64 or base64url>&counter=<count>: the BitGraph's bitgraph-publication/1 block (its
// path to its hour's root on Base, the write's evidence and its floor), once its hour is published. 404 until then.
// A block never changes once written, so a found one is cached for good; a miss is not cached, since the hour's write
// may land a minute later.

export const dynamic = "force-dynamic";

export async function GET(req: Request): Promise<NextResponse> {
  const url = new URL(req.url);
  const epoch = (url.searchParams.get("epoch") ?? "").trim();
  const counter = (url.searchParams.get("counter") ?? "").trim();
  if (!/^[A-Za-z0-9+/_-]{43}=?$/.test(epoch) || !/^[1-9][0-9]{0,11}$/.test(counter)) {
    return NextResponse.json({ error: "give epoch (base64 or base64url) and counter (a count)" }, { status: 400 });
  }
  const text = await getObjectText(publicationKey(epoch, counter));
  if (!text) return NextResponse.json({ error: "not published yet" }, { status: 404, headers: { "Cache-Control": "no-store" } });
  let block: unknown;
  try { block = JSON.parse(text); } catch { return NextResponse.json({ error: "unreadable" }, { status: 500 }); }
  if ((block as { format?: string }).format !== PUBLICATION_METADATA_KEY) return NextResponse.json({ error: "unreadable" }, { status: 500 });
  return NextResponse.json(block, { headers: { "Cache-Control": "public, max-age=31536000, immutable" } });
}
