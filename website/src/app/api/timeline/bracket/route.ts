import { NextResponse } from "next/server";
import { unstable_cache } from "next/cache";
import { timelineBracket } from "@/lib/timeline-bracket";

/* A BitGraph's place on the block timeline (lib/timeline-bracket.ts), for its proof page: ?epoch=<url-safe id>&counter=<n>.
   A verified bracket is kept for an hour (only a reorg deeper than the bracket could change it); anything else is
   asked again. */

export const dynamic = "force-dynamic";
export const maxDuration = 30;

const verified = unstable_cache(async (epoch: string, counter: string) => timelineBracket(epoch, counter), ["timeline-bracket-v1"], { revalidate: 3600 });

export async function GET(req: Request) {
  const q = new URL(req.url).searchParams;
  const epoch = q.get("epoch") ?? "";
  const counter = q.get("counter") ?? "";
  if (!/^[A-Za-z0-9_-]{43}$/.test(epoch) || !/^[1-9][0-9]*$/.test(counter)) return NextResponse.json({ error: "bad request" }, { status: 400 });
  let b = await timelineBracket(epoch, counter);
  if (b.state === "verified") b = await verified(epoch, counter);
  return NextResponse.json(b, { headers: { "Cache-Control": b.state === "verified" ? "public, s-maxage=3600" : "no-store" } });
}
