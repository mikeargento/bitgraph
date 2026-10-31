// Copyright (c) Argento Computing Inc. All rights reserved. See LICENSE.

/**
 * The daily Base audit (src/audit/base-day.ts): a UTC day's Base reads against the real chain.
 *
 *   node --import tsx/esm scripts/timeline-audit.ts --day 2026-11-01
 *        [--bucket occ-ledger-prod] [--region us-east-2]   the timeline batches in the ledger bucket (default)
 *        [--dir path]                                       or batches (.jsonl.gz / .jsonl) in a local folder
 *        [--rpc URL,URL]                                    Base nodes, all must agree (default: publicnode, mainnet.base.org)
 *        [--json] [--alert]                                 --alert: email a FAIL through TIMELINE_ALERT_SNS_TOPIC_ARN
 *
 * The day defaults to yesterday (UTC). Batches uploaded from two hours before the day to two hours after it are read
 * (reads of the day's blocks can be bound late, during a catch-up). Exit 0 PASS, 1 FAIL, 2 could not run.
 */

import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { gunzipSync } from "node:zlib";
import { auditBaseDay, baseBlocksOfDay, formatBaseDayReport, type AuditRead } from "../src/audit/base-day.js";
import { canonicalBlocks } from "../src/audit/canonical-fetch.js";
import { snsAlertSend } from "../src/parent/timeline-alerts.js";

const argv = process.argv.slice(2);
const flag = (k: string): string | undefined => { const i = argv.indexOf(`--${k}`); return i >= 0 && argv[i + 1] && !argv[i + 1]!.startsWith("--") ? argv[i + 1] : undefined; };
const has = (k: string) => argv.includes(`--${k}`);

const day = flag("day") ?? new Date(Date.now() - 86_400_000).toISOString().slice(0, 10);
const rpcs = (flag("rpc") ?? "https://base-rpc.publicnode.com,https://mainnet.base.org").split(",").map((s) => s.trim()).filter(Boolean);
const region = flag("region") ?? "us-east-2";

/** The Base reads in a batch's text. */
function readsOf(text: string): AuditRead[] {
  const out: AuditRead[] = [];
  for (const raw of text.split("\n")) {
    if (!raw.trim()) continue;
    let l: { kind?: string; proof?: { commit?: { counter?: string; epochId?: string } }; blockFile?: string };
    try { l = JSON.parse(raw); } catch { continue; }
    if (l.kind !== "block" || !l.blockFile) continue;
    let f: { chain?: string; number?: number; hash?: string; timestamp?: number };
    try { f = JSON.parse(l.blockFile); } catch { continue; }
    if (f.chain !== "base" || typeof f.number !== "number" || typeof f.hash !== "string" || typeof f.timestamp !== "number") continue;
    out.push({ epochId: l.proof?.commit?.epochId ?? "?", counter: Number(l.proof?.commit?.counter ?? 0), number: f.number, hash: f.hash.toLowerCase(), timestamp: f.timestamp });
  }
  return out;
}

async function readsFromS3(bucket: string): Promise<AuditRead[]> {
  const sdk = (await import("@aws-sdk/client-s3" as string)) as {
    S3Client: new (c: { region: string }) => { send: (cmd: unknown) => Promise<unknown> };
    ListObjectsV2Command: new (p: Record<string, unknown>) => unknown;
    GetObjectCommand: new (p: Record<string, unknown>) => unknown;
  };
  const s3 = new sdk.S3Client({ region });
  const from = Date.parse(`${day}T00:00:00Z`) - 2 * 3_600_000;
  const to = from + 28 * 3_600_000;
  const keys: string[] = [];
  let token: string | undefined;
  do {
    const r = (await s3.send(new sdk.ListObjectsV2Command({ Bucket: bucket, Prefix: "timeline/", ...(token ? { ContinuationToken: token } : {}) }))) as { Contents?: { Key?: string; LastModified?: Date }[]; NextContinuationToken?: string };
    for (const o of r.Contents ?? []) {
      const t = o.LastModified?.getTime() ?? 0;
      if (o.Key?.endsWith(".jsonl.gz") && t >= from && t <= to) keys.push(o.Key);
    }
    token = r.NextContinuationToken;
  } while (token);
  const reads: AuditRead[] = [];
  for (const key of keys) {
    const o = (await s3.send(new sdk.GetObjectCommand({ Bucket: bucket, Key: key }))) as { Body?: { transformToByteArray(): Promise<Uint8Array> } };
    if (o.Body) reads.push(...readsOf(gunzipSync(await o.Body.transformToByteArray()).toString("utf8")));
  }
  console.error(`[audit] ${keys.length} batches from s3://${bucket}/timeline/, ${reads.length} Base reads`);
  return reads;
}

function readsFromDir(dir: string): AuditRead[] {
  const reads: AuditRead[] = [];
  for (const f of readdirSync(dir)) {
    const p = join(dir, f);
    if (f.endsWith(".jsonl.gz")) reads.push(...readsOf(gunzipSync(readFileSync(p)).toString("utf8")));
    else if (f.endsWith(".jsonl")) reads.push(...readsOf(readFileSync(p, "utf8")));
  }
  console.error(`[audit] ${reads.length} Base reads from ${dir}`);
  return reads;
}

try {
  const dir = flag("dir");
  const reads = dir ? readsFromDir(dir) : await readsFromS3(flag("bucket") ?? process.env["LEDGER_BUCKET"] ?? "occ-ledger-prod");
  const { first, last } = baseBlocksOfDay(day);
  console.error(`[audit] asking ${rpcs.length} node(s) for Base blocks ${first}..${last}`);
  const { blocks, disagreements } = await canonicalBlocks({ urls: rpcs, first, last, log: (m) => console.error(m) });
  const report = auditBaseDay({ day, reads, canonical: blocks });
  const out = { ...report, nodes: rpcs.map((u) => new URL(u).origin), nodesDisagreed: disagreements.length };
  if (has("json")) console.log(JSON.stringify(out, null, 2));
  else console.log(formatBaseDayReport(report) + (disagreements.length ? `\n  the nodes disagreed on ${disagreements.length} block(s); those are unchecked` : ""));
  const topic = process.env["TIMELINE_ALERT_SNS_TOPIC_ARN"];
  if (!report.ok && has("alert") && topic) {
    await snsAlertSend(topic, process.env["TIMELINE_ALERT_REGION"] || region)(`[BitGraph timeline] DAILY AUDIT FAIL ${day}`, formatBaseDayReport(report));
  }
  process.exit(report.ok ? 0 : 1);
} catch (e) {
  console.error(`[audit] could not run: ${e instanceof Error ? e.message : String(e)}`);
  process.exit(2);
}
