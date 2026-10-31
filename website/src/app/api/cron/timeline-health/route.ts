import { NextRequest, NextResponse } from "next/server";
import { timingSafeEqual } from "node:crypto";
import { GetObjectCommand, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { PublishCommand, SNSClient } from "@aws-sdk/client-sns";
import { decideWatch, judgeHealth, INITIAL_WATCH_STATE, WATCH_STATE_KEY, type WatchState } from "@/lib/timeline-watch";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

/**
 * GET /api/cron/timeline-health: the outside check of the block timeline (lib/timeline-watch.ts), every five
 * minutes from vercel.json. Closed unless CRON_SECRET is set and given; quiet unless TIMELINE_ALERT_SNS_TOPIC_ARN is
 * set. TIMELINE_HEALTH_URL defaults to the enclave host's public /health.
 */

function authorized(req: NextRequest): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  const a = Buffer.from(req.headers.get("authorization") ?? "");
  const b = Buffer.from(`Bearer ${secret}`);
  return a.length === b.length && timingSafeEqual(a, b);
}

export async function GET(req: NextRequest) {
  if (!process.env.CRON_SECRET) return NextResponse.json({ error: "CRON_SECRET is not set" }, { status: 503 });
  if (!authorized(req)) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const topic = process.env.TIMELINE_ALERT_SNS_TOPIC_ARN;
  const bucket = process.env.LEDGER_BUCKET || "occ-ledger-prod";
  const region = process.env.LEDGER_REGION || "us-east-2";
  const url = process.env.TIMELINE_HEALTH_URL || "https://nitro.occproof.com/health";
  const now = Date.now();

  let answer: { status: number; body: unknown } | Error;
  try {
    const r = await fetch(url, { cache: "no-store", signal: AbortSignal.timeout(10_000) });
    answer = { status: r.status, body: await r.json().catch(() => null) };
  } catch (e) {
    answer = e instanceof Error ? e : new Error(String(e));
  }
  const verdict = judgeHealth(answer, now);

  const s3 = new S3Client({ region });
  let prev: WatchState = INITIAL_WATCH_STATE;
  try {
    const o = await s3.send(new GetObjectCommand({ Bucket: bucket, Key: WATCH_STATE_KEY }));
    prev = JSON.parse(await o.Body!.transformToString()) as WatchState;
  } catch { /* first run, or unreadable: start from up */ }
  const { next, email } = decideWatch(prev, verdict, now);

  let sent = false;
  if (email && topic) {
    await new SNSClient({ region }).send(new PublishCommand({ TopicArn: topic, Subject: email.subject, Message: email.body }));
    sent = true;
  }
  if (JSON.stringify(next) !== JSON.stringify(prev)) {
    await s3.send(new PutObjectCommand({ Bucket: bucket, Key: WATCH_STATE_KEY, Body: JSON.stringify(next), ContentType: "application/json" }));
  }
  return NextResponse.json({ verdict, state: next, emailed: sent, wouldEmail: email !== null });
}
