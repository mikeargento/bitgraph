import { NextResponse } from "next/server";
import { getObjectText } from "@/lib/s3";
import { PUBLICATION_METADATA_KEY, floorKey, publicationKey } from "@/lib/publication";

// GET /api/publication?epoch=<base64 or base64url>&counter=<count>: the BitGraph's bitgraph-publication/1 block (its
// path to its hour's root on Base, the write's evidence and its floor), once its hour is published. 404 until then.
// A block never changes once written, so a found one is cached for good; a miss is not cached, since the hour's write
// may land a minute later. With &kind=floor: the record of a floor BitGraph (the note it binds and the write it names),
// 404 for any BitGraph that is not a floor.

export const dynamic = "force-dynamic";

export async function GET(req: Request): Promise<NextResponse> {
  const url = new URL(req.url);
  const epoch = (url.searchParams.get("epoch") ?? "").trim();
  const counter = (url.searchParams.get("counter") ?? "").trim();
  if (!/^[A-Za-z0-9+/_-]{43}=?$/.test(epoch) || !/^[1-9][0-9]{0,11}$/.test(counter)) {
    return NextResponse.json({ error: "give epoch (base64 or base64url) and counter (a count)" }, { status: 400 });
  }
  const floor = url.searchParams.get("kind") === "floor";
  const text = await getObjectText(floor ? floorKey(epoch, counter) : publicationKey(epoch, counter));
  if (!text) return NextResponse.json({ error: "not published yet" }, { status: 404, headers: { "Cache-Control": "no-store" } });
  let block: unknown;
  try { block = JSON.parse(text); } catch { return NextResponse.json({ error: "unreadable" }, { status: 500 }); }
  if ((block as { format?: string }).format !== (floor ? "bitgraph-hour-floor/1" : PUBLICATION_METADATA_KEY)) return NextResponse.json({ error: "unreadable" }, { status: 500 });
  return NextResponse.json(block, { headers: { "Cache-Control": "public, max-age=31536000, immutable" } });
}
