import { NextResponse } from "next/server";
import { createHash } from "node:crypto";
import { getObjectText } from "@/lib/s3";
import { checkEpochGenesisOnBase, parseEpochGenesisFile } from "@/lib/epoch-genesis";

/**
 * GET /api/epoch-floors/<epoch>: an epoch's first BitGraph's content, epoch-floor.json (bitgraph-epoch-floor/1).
 *
 * From enclave v13 (2026-10-19) the host binds a read of the latest Base block as each epoch's first BitGraph
 * (server/commit-service/src/parent/epoch-floor.ts) and keeps the file at epoch-floors/<epoch>.json beside the
 * ledger. Mike, 2026-10-19: "how can you tell that it read a base block?" This serves the file, so anyone can hash it
 * against the proof's digest and look the block up on Base. The answer also says whether Base has that block with
 * that hash and time (checked here against Base's RPC), as a convenience: the file and Basescan are the evidence.
 *
 * <epoch> is the epoch id in URL-safe base64, as in ledger keys.
 */

const RPC = "https://mainnet.base.org";
export const revalidate = 3600;

export async function GET(req: Request, ctx: { params: Promise<{ epoch: string }> }) {
  const { epoch } = await ctx.params;
  if (!/^[A-Za-z0-9_-]{20,64}$/.test(epoch)) return NextResponse.json({ error: "not an epoch id" }, { status: 400 });
  const text = await getObjectText(`epoch-floors/${epoch}.json`);
  if (!text) return NextResponse.json({ error: "no epoch floor for this epoch" }, { status: 404 });
  // ?file: the file itself, byte for byte, as a download (Mike, 2026-10-20: the button opened this answer's JSON
  // wrapper, so there was no file to drop on the proof).
  if (new URL(req.url).searchParams.has("file")) {
    return new Response(text, { headers: { "content-type": "application/json; charset=utf-8", "content-disposition": `attachment; filename="${parseEpochGenesisFile(text) ? "epoch-genesis.json" : "epoch-floor.json"}"`, "cache-control": "public, s-maxage=3600, stale-while-revalidate=86400" } });
  }
  const digestB64 = createHash("sha256").update(text, "utf8").digest("base64");
  const headers = { "cache-control": "public, s-maxage=3600, stale-while-revalidate=86400" };
  // From 2026-10-23 an epoch opens with a Base write (bitgraph-epoch-genesis/1, lib/epoch-genesis.ts): the file
  // names the writer's transaction carrying the epoch id and the block that mined it. Checked against Base here.
  const genesis = parseEpochGenesisFile(text);
  if (genesis) {
    const baseChecked = await checkEpochGenesisOnBase(genesis, RPC);
    return NextResponse.json(
      {
        format: genesis.format, file: text, digestB64, epochId: genesis.epochId,
        block: { number: genesis.blockNumber, hash: genesis.blockHash, timestamp: genesis.blockTimestamp },
        tx: { hash: genesis.txHash, writer: genesis.writer }, baseChecked,
      },
      { headers },
    );
  }
  let block: { format?: string; epochId?: string; number?: number; hash?: string; timestamp?: number };
  try { block = JSON.parse(text); } catch { return NextResponse.json({ error: "the stored file is not JSON" }, { status: 500 }); }
  let baseChecked: boolean | null = null;
  try {
    const res = await fetch(RPC, {
      method: "POST", headers: { "content-type": "application/json" }, signal: AbortSignal.timeout(8000),
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "eth_getBlockByNumber", params: [`0x${Number(block.number).toString(16)}`, false] }),
    });
    const r = ((await res.json()) as { result?: { hash?: string; timestamp?: string } }).result;
    baseChecked = !!r?.hash && r.hash.toLowerCase() === String(block.hash).toLowerCase() && parseInt(r.timestamp ?? "0x0", 16) === block.timestamp;
  } catch { baseChecked = null; }
  return NextResponse.json(
    { format: block.format ?? null, file: text, digestB64, block: { number: block.number, hash: block.hash, timestamp: block.timestamp }, epochId: block.epochId ?? null, tx: null, baseChecked },
    { headers },
  );
}
