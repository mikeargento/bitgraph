// Copyright (c) Argento Computing Inc. All rights reserved. See LICENSE.

import { NextResponse } from "next/server";
import { FIND_PREFIX, LedgerUnavailableError, getObjectText, getSourceNote, listKeysUnderPrefix, parseFindKey, trustmarkRecordKey } from "@/lib/s3";
import { recordedMsOf } from "@/lib/recorded-time";
import { fromUrlSafeB64 } from "@/lib/explorer";
import { parseRecord } from "@/lib/trustmark/record";

export const dynamic = "force-dynamic";

/** Records whose pHash differs from the query's by at most this many of its 64 bits are read and returned. A copy
 *  (JPEG, resize, brightness, a screenshot) differs from its original by a few bits; unrelated pictures by about 32. */
const MAX_DISTANCE = 20;
const MAX_CANDIDATES = 8;
const INDEX_TTL_MS = 10_000;

const hamming = (a: string, b: string) => {
  let n = 0;
  for (let i = 0; i < 16; i++) { let x = parseInt(a[i]!, 16) ^ parseInt(b[i]!, 16); while (x) { n += x & 1; x >>= 1; } }
  return n;
};

// The index is the key listing, held a few seconds: at this size one LIST page, and the search itself touches nothing
// until a pHash is close. A record published on this instance drops it at once (forgetFindIndex), so an original
// checked a moment ago is found by the next copy. A larger index moves to an index object or a store; the keys stay the source.
let index: { at: number; keys: string[] } | null = null;
async function keys(): Promise<string[]> {
  if (index && Date.now() - index.at < INDEX_TTL_MS) return index.keys;
  const k = await listKeysUnderPrefix(FIND_PREFIX);
  index = { at: Date.now(), keys: k };
  return k;
}
export function forgetFindIndex() { index = null; }

/**
 * GET /api/find?phash=<16 hex>: the published fingerprint records nearest this pHash, each with the position of the
 * BitGraph that binds it and the photo it names. The caller then matches its own pixels against each record's
 * brightness grid (lib/trustmark/align) and opens the best one's proof; the picture itself never leaves its machine.
 * Only the record is returned, never a thumbnail or Content Credentials that were published with it.
 */
export async function GET(req: Request) {
  const phash = (new URL(req.url).searchParams.get("phash") ?? "").toLowerCase();
  if (!/^[0-9a-f]{16}$/.test(phash)) return NextResponse.json({ error: "phash (16 hex) is required" }, { status: 400 });
  try {
    const near = (await keys()).map(parseFindKey).filter((e): e is NonNullable<typeof e> => !!e)
      .map((e) => ({ ...e, distance: hamming(e.phash, phash) })).filter((e) => e.distance <= MAX_DISTANCE)
      .sort((a, b) => a.distance - b.distance).slice(0, MAX_CANDIDATES);
    const candidates = (await Promise.all(near.map(async (e) => {
      const epochId = fromUrlSafeB64(e.epochSafe), recordDigest = fromUrlSafeB64(e.recordSafe);
      if (!epochId || !recordDigest) return null;
      const text = await getObjectText(trustmarkRecordKey(e.eref, e.counter, epochId, recordDigest));
      let published: { recordB64?: unknown; proof?: unknown } | null = null;
      try { published = text ? JSON.parse(text) : null; } catch { return null; }
      const rec = typeof published?.recordB64 === "string" ? parseRecord(new Uint8Array(Buffer.from(published.recordB64, "base64"))) : null;
      if (!rec) return null;
      // hosted: a verified link to the original exists at this position (app/api/sources), the one that can give a
      // visitor the file; recordedMs: when the tree was bound, so the caller can put the earliest first
      const note = await getSourceNote(rec.photo, epochId, String(e.counter)).catch(() => null);
      const hosted = !!note && !note.failedAt;
      return { distance: e.distance, phash: rec.phash, photo: rec.photo, counter: String(e.counter), epoch: e.epochSafe, record: e.recordSafe, values: rec.blocks.values, hosted, recordedMs: recordedMsOf(published?.proof) };
    }))).filter(Boolean);
    return NextResponse.json({ candidates }, { headers: { "cache-control": "no-store" } });
  } catch (e) {
    if (e instanceof LedgerUnavailableError) return NextResponse.json({ error: "ledger unavailable" }, { status: 503 });
    throw e;
  }
}
