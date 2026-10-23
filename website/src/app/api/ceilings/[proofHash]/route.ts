import { NextRequest, NextResponse } from "next/server";
import { readSidecarText } from "@/lib/ceilings";

export const dynamic = "force-dynamic";

// One record's Base ceiling sidecar (bitgraph-ceiling/1), by proofHash in
// either base64 form. 404 when the writer has not written one: the page then
// shows nothing rather than implying a ceiling exists. Served as the file it
// is, so "Download" hands over exactly what verifyCeiling checks.
export async function GET(_req: NextRequest, ctx: { params: Promise<{ proofHash: string }> }) {
  const { proofHash } = await ctx.params;
  const std = decodeURIComponent(proofHash).replace(/-/g, "+").replace(/_/g, "/");
  const padded = std.length === 43 ? `${std}=` : std;
  const text = await readSidecarText(padded);
  if (!text) return NextResponse.json({ error: "no ceiling recorded" }, { status: 404 });
  return new NextResponse(text, { headers: { "content-type": "application/json", "cache-control": "no-cache" } });
}
