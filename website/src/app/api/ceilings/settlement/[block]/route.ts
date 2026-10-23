import { NextRequest, NextResponse } from "next/server";
import { getObjectBytes } from "@/lib/s3";

export const dynamic = "force-dynamic";

/**
 * One Base ceiling block's settlement on Ethereum through Base's output root
 * (bitgraph-output-root/1), as the ceiling writer stored it:
 * `ceilings/settlements/output-root/<Base block>.json` in the ledger bucket
 * (10-year Object Lock), written create-only once the dispute-game claim for
 * a summary block covering the ceiling's block was final on Ethereum.
 *
 * Added 2026-10-03 with the writer's output-root settlement
 * (server/commit-service/src/ceiling/output-root-settler.ts). An export made
 * before the settlement existed carries `{"status":"pending","baseBlock":B}`
 * (SPEC.md section 12); this is where it is completed from, about an hour
 * after the commit. Until then: 404, never cached.
 *
 * The file is evidence that checks itself: verifyOutputRootSettlement in
 * bitgraph-verify recomputes the output root, the history proof and the
 * Ethereum inclusion, so a reader trusts the math, not this route. It is
 * written once and never replaced, so once present it is served immutable.
 */
const BLOCK = /^[1-9][0-9]{0,11}$/;

export async function GET(_req: NextRequest, ctx: { params: Promise<{ block: string }> }) {
  const { block } = await ctx.params;
  let name: string;
  try {
    name = decodeURIComponent(block);
  } catch {
    name = "";
  }
  if (!BLOCK.test(name) || !Number.isSafeInteger(Number(name))) {
    return NextResponse.json({ error: "expected a Base block number: decimal digits, no leading zero" }, { status: 400 });
  }
  let bytes: Uint8Array | null;
  try {
    bytes = await getObjectBytes(`ceilings/settlements/output-root/${name}.json`);
  } catch {
    return NextResponse.json({ error: "the archive did not answer; try again" }, { status: 503 });
  }
  if (!bytes) {
    return NextResponse.json(
      { error: "no output-root settlement for that Base block yet" },
      { status: 404, headers: { "cache-control": "no-store" } },
    );
  }
  return new NextResponse(bytes as unknown as BodyInit, {
    headers: {
      "content-type": "application/json",
      "cache-control": "public, max-age=31536000, immutable",
    },
  });
}
