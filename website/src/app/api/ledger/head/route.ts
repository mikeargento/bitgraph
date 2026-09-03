import { NextResponse } from "next/server";
import { S3Client, ListObjectsV2Command } from "@aws-sdk/client-s3";

// The ledger's heartbeat: the current epoch and its highest counter, nothing
// else. The live Ledger polls this every few seconds and fetches the (heavier,
// long-SWR) feed page only when the head actually advances, so this response
// must never be served stale for long: short s-maxage, NO stale-while-
// revalidate. Kept cheap enough to be polled: after a cold binary search,
// each check is a single incremental S3 LIST from the last known head.

export const dynamic = "force-dynamic";

const region = (process.env.LEDGER_REGION || "us-east-2").trim();
const bucket = (process.env.LEDGER_BUCKET || "occ-ledger-prod").trim();
const s3 = new S3Client({ region });

const pad = (n: number) => String(n).padStart(12, "0");

let epochCache: { epoch: string; at: number } | null = null;
let known: { epoch: string; head: number; at: number } | null = null;
const EPOCH_TTL = 60_000;
const HEAD_TTL = 1_500; // absorb same-instance bursts; the CDN handles the rest

async function currentEpoch(now: number): Promise<string | null> {
  if (epochCache && now - epochCache.at < EPOCH_TTL) return epochCache.epoch;
  try {
    const r = await fetch("https://nitro.occproof.com/key", { signal: AbortSignal.timeout(4000) });
    if (r.ok) {
      const k = (await r.json()) as { epochId?: string };
      if (k.epochId) {
        const epoch = k.epochId.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
        epochCache = { epoch, at: now };
        return epoch;
      }
    }
  } catch { /* rotating or unreachable */ }
  // During the rotation window, keep answering with the last epoch we saw:
  // the client treats an unchanged head as "nothing new", which is true.
  return epochCache?.epoch ?? known?.epoch ?? null;
}

async function hasKeyAfter(prefix: string, n: number): Promise<boolean> {
  const r = await s3.send(new ListObjectsV2Command({
    Bucket: bucket, Prefix: prefix, StartAfter: `${prefix}${pad(n)}`, MaxKeys: 1,
  }));
  return (r.Contents?.length ?? 0) > 0;
}

/** Cold path: highest counter via StartAfter binary search (~log2, bounded). */
async function coldHead(prefix: string): Promise<number> {
  let lo = 0, cur = 1024, hi = 1_000_000_000;
  while (cur < hi && (await hasKeyAfter(prefix, cur))) { lo = cur; cur *= 4; }
  hi = Math.min(hi, cur);
  while (hi - lo > 1) { const mid = (lo + hi) >> 1; if (await hasKeyAfter(prefix, mid)) lo = mid; else hi = mid; }
  return Math.max(lo, 1);
}

/** Warm path: walk forward from the last known head; one LIST when idle. */
async function advanceHead(prefix: string, from: number): Promise<number> {
  let head = from;
  for (let page = 0; page < 5; page++) {
    const r = await s3.send(new ListObjectsV2Command({
      Bucket: bucket, Prefix: prefix, StartAfter: `${prefix}${pad(head)}`, MaxKeys: 1000,
    }));
    const keys = r.Contents || [];
    if (keys.length === 0) return head;
    const last = keys[keys.length - 1]?.Key || "";
    const m = last.slice(prefix.length).match(/^(\d{12})-/);
    if (!m) return head;
    head = parseInt(m[1], 10);
    if (!r.IsTruncated) return head;
  }
  return head;
}

export async function GET() {
  const now = Date.now();
  try {
    const epoch = await currentEpoch(now);
    if (!epoch) {
      return NextResponse.json({ error: "rotating" }, { status: 503, headers: { "Cache-Control": "no-store" } });
    }
    if (known && known.epoch === epoch && now - known.at < HEAD_TTL) {
      return NextResponse.json({ epoch, head: known.head }, { headers: { "Cache-Control": "public, s-maxage=2, must-revalidate" } });
    }
    const prefix = `proofs/${epoch}/`;
    const head = known && known.epoch === epoch
      ? await advanceHead(prefix, known.head)
      : await coldHead(prefix);
    known = { epoch, head, at: now };
    return NextResponse.json({ epoch, head }, { headers: { "Cache-Control": "public, s-maxage=2, must-revalidate" } });
  } catch (e) {
    console.error("[api/day/head]", (e as Error).message);
    return NextResponse.json({ error: "failed" }, { status: 500, headers: { "Cache-Control": "no-store" } });
  }
}
