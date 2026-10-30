// Copyright (c) Argento Computing Inc. All rights reserved. See LICENSE.

import { NextResponse } from "next/server";
import { LedgerUnavailableError, getLineageNote, getObjectText, getProofsByDigest, ledgerWritesOn, listKeysUnderPrefix, putLineageNoteOnce, trustmarkRecordPrefix, type LineageNote } from "@/lib/s3";
import { fromUrlSafeB64 } from "@/lib/explorer";
import { recordedMsOf } from "@/lib/recorded-time";
import { parseRecord } from "@/lib/trustmark/record";
import { epochRef } from "@/lib/trustmark/payload";

export const dynamic = "force-dynamic";

/** The find's own bound (app/api/find): two records this close are the same picture to the find, so they are to the note. */
const MAX_DISTANCE = 20;
const hamming = (a: string, b: string) => { let n = 0; for (let i = 0; i < 16; i++) { let x = parseInt(a[i]!, 16) ^ parseInt(b[i]!, 16); while (x) { n += x & 1; x >>= 1; } } return n; };

type Position = { digest: string; epochId: string; counter: string };
function position(q: Record<string, unknown>, prefix = ""): Position | null {
  const get = (k: string) => q[prefix ? `${prefix}${k[0]!.toUpperCase()}${k.slice(1)}` : k];
  const digest = fromUrlSafeB64(String(get("digest") ?? "")), epochId = fromUrlSafeB64(String(get("epoch") ?? "")), counter = String(get("counter") ?? "");
  return digest && epochId && /^\d+$/.test(counter) ? { digest, epochId, counter } : null;
}
const safe = (b64: string) => b64.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const shown = (n: LineageNote) => ({ digest: safe(n.first.digestB64), epoch: safe(n.first.epochId), counter: n.first.counter, recordedMs: n.first.recordedMs });

/** GET /api/lineage?digest=&epoch=&counter=: the earliest BitGraph of the same picture, when this one points to it. */
export async function GET(req: Request) {
  const at = position(Object.fromEntries(new URL(req.url).searchParams));
  if (!at) return NextResponse.json({ error: "digest, epoch and counter are required" }, { status: 400 });
  try {
    const note = await getLineageNote(at.digest, at.epochId, at.counter);
    return NextResponse.json({ first: note ? shown(note) : null }, { headers: { "cache-control": "private, max-age=60" } });
  } catch (e) {
    if (e instanceof LedgerUnavailableError) return NextResponse.json({ error: "ledger unavailable" }, { status: 503 });
    throw e;
  }
}

/** The recorded proof at a position and the pHash its published record binds for this photo, or null for either. */
async function recordAt(p: Position): Promise<{ recordedMs: number | null; phash: string } | null> {
  const mine = (await getProofsByDigest(p.digest)).find((e) => {
    const c = e.proof.commit as { epochId?: unknown; counter?: unknown } | undefined;
    return e.kind === "recorded" && String(c?.epochId) === p.epochId && String(c?.counter) === p.counter;
  });
  if (!mine) return null;
  const keys = await listKeysUnderPrefix(trustmarkRecordPrefix(await epochRef(p.epochId), Number(p.counter)), 2000);
  for (const k of keys) {
    const text = await getObjectText(k).catch(() => null);
    let published: { recordB64?: unknown } | null = null;
    try { published = text ? JSON.parse(text) : null; } catch { continue; }
    const rec = typeof published?.recordB64 === "string" ? parseRecord(new Uint8Array(Buffer.from(published.recordB64, "base64"))) : null;
    if (rec && rec.photo === p.digest) return { recordedMs: recordedMsOf(mine.proof), phash: rec.phash };
  }
  return null;
}

/**
 * POST /api/lineage { digest, epoch, counter, firstDigest, firstEpoch, firstCounter }: this BitGraph is a later record of
 * the picture first recorded at `first`. Kept only when both positions are recorded photos with published records,
 * the records are within the find's distance of each other, and the first was recorded earlier. Once per position.
 */
export async function POST(req: Request) {
  if (!ledgerWritesOn()) return NextResponse.json({ error: "Ledger writes are off." }, { status: 503 });
  let body: Record<string, unknown>;
  try { body = await req.json(); } catch { return NextResponse.json({ error: "Invalid JSON." }, { status: 400 }); }
  const at = position(body), first = position(body, "first");
  if (!at || !first) return NextResponse.json({ error: "digest, epoch, counter and the first position are required" }, { status: 400 });
  if (at.digest === first.digest && at.epochId === first.epochId && at.counter === first.counter) return NextResponse.json({ error: "A BitGraph cannot point to itself." }, { status: 400 });
  try {
    if (await getLineageNote(at.digest, at.epochId, at.counter)) return NextResponse.json({ error: "This BitGraph already names its first." }, { status: 409 });
    const [mine, theirs] = await Promise.all([recordAt(at), recordAt(first)]);
    // the later record is published a moment after its tree is bound; the caller retries
    if (!mine) return NextResponse.json({ error: "This BitGraph's picture has no published record (yet)." }, { status: 404 });
    if (!theirs) return NextResponse.json({ error: "The first BitGraph's picture has no published record." }, { status: 400 });
    const distance = hamming(mine.phash, theirs.phash);
    if (distance > MAX_DISTANCE) return NextResponse.json({ error: "Not the same picture." }, { status: 400 });
    if (theirs.recordedMs === null || mine.recordedMs === null || theirs.recordedMs > mine.recordedMs) return NextResponse.json({ error: "The first BitGraph must be the earlier one." }, { status: 400 });
    const note: LineageNote = { format: "bitgraph-lineage/1", first: { digestB64: first.digest, epochId: first.epochId, counter: first.counter, recordedMs: theirs.recordedMs }, distance, addedAt: Date.now() };
    const written = await putLineageNoteOnce(at.digest, at.epochId, at.counter, note);
    return NextResponse.json({ written, first: shown(note) });
  } catch (e) {
    if (e instanceof LedgerUnavailableError) return NextResponse.json({ error: "ledger unavailable" }, { status: 503 });
    throw e;
  }
}
