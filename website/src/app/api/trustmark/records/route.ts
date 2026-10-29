// Copyright (c) Argento Computing Inc. All rights reserved. See LICENSE.

import { NextResponse } from "next/server";
import { findKey, getObjectText, getProofsByDigest, ledgerWritesOn, listKeysUnderPrefix, putFindKeyOnce, putTrustmarkRecord, putTrustmarkRecordOnce, trustmarkRecordKey, trustmarkRecordPrefix, LedgerUnavailableError } from "@/lib/s3";
import { fromUrlSafeB64 } from "@/lib/explorer";
import { checkMember, memberOf } from "@/lib/tree-member";
import { epochRef, MAX_COUNTER, tag as tagOf, TAG_BITS } from "@/lib/trustmark/payload";
import { parseRecord } from "@/lib/trustmark/record";
import { MAX_MANIFEST_BYTES } from "@/lib/trustmark/c2pa-leaf";
import { forgetFindIndex } from "@/app/api/find/route";

export const dynamic = "force-dynamic";

const MAX_RECORD_BYTES = 4096;
const MAX_CANDIDATES = 16;
const MAX_THUMB_BYTES = 300_000;
const b64 = (u: Uint8Array) => Buffer.from(u).toString("base64");
const digest = async (u: Uint8Array) => b64(new Uint8Array(await crypto.subtle.digest("SHA-256", u as BufferSource)));

/**
 * POST /api/trustmark/records { recordB64, c2paB64?, thumbB64? }: publish a photo's fingerprint record, so a TrustMark pointing to the
 * photo's BitGraph can be checked by anyone holding only a copy, and so a copy with no pointer at all can find the
 * record by what it looks like (lib/trustmark/check, over app/api/find). Sent when a photo is exported with a TrustMark, and by Make for each photo
 * of a drop once its tree is indexed.
 *
 * Nothing is taken on trust. The record must be a file of a tree on the ledger (found by its own hash, where the
 * tree's members are indexed), its hash must walk up to the root that tree's proof signs, and the photo it names must
 * be a member of the same BitGraph. The record is then kept under the position its pointer names.
 */
export async function POST(req: Request) {
  if (!ledgerWritesOn()) return NextResponse.json({ error: "Ledger writes are off." }, { status: 503 });
  let body: { recordB64?: unknown; c2paB64?: unknown; thumbB64?: unknown };
  try { body = await req.json(); } catch { return NextResponse.json({ error: "Invalid JSON." }, { status: 400 }); }
  if (typeof body.recordB64 !== "string" || body.recordB64.length > MAX_RECORD_BYTES * 2) return NextResponse.json({ error: "recordB64 is required." }, { status: 400 });
  const bytes = new Uint8Array(Buffer.from(body.recordB64, "base64"));
  const record = parseRecord(bytes);
  if (!record) return NextResponse.json({ error: "Not a TrustMark fingerprint record." }, { status: 400 });
  const recordDigest = await digest(bytes);
  try {
    const mine = (await getProofsByDigest(recordDigest)).find((e) => e.kind === "recorded" && memberOf(e.proof) && checkMember(e.proof, recordDigest));
    // A tree's members are indexed a moment after it is bound; until then the caller retries.
    if (!mine) return NextResponse.json({ error: "This record is not a file of a BitGraph on the ledger (yet)." }, { status: 404 });
    const at = mine.proof.commit as { epochId?: unknown; counter?: unknown } | undefined;
    const epochId = String(at?.epochId ?? ""), counter = Number(at?.counter);
    const bound = (mine.proof.artifact as { digestB64?: unknown } | undefined)?.digestB64;
    const photoInSameTree = (await getProofsByDigest(record.photo)).some((e) => {
      const c = e.proof.commit as { epochId?: unknown; counter?: unknown } | undefined;
      return e.kind === "recorded" && (e.proof.artifact as { digestB64?: unknown } | undefined)?.digestB64 === bound
        && String(c?.epochId) === epochId && Number(c?.counter) === counter && checkMember(e.proof, record.photo);
    });
    if (!photoInSameTree) return NextResponse.json({ error: "The photo this record names is not in the same BitGraph." }, { status: 400 });
    if (!epochId || !Number.isSafeInteger(counter) || counter < 0 || counter > MAX_COUNTER) return NextResponse.json({ error: "This position cannot carry a TrustMark." }, { status: 400 });
    // The photo's Content Credentials, when sent, must be a file of the same BitGraph too.
    let c2pa: { c2paB64: string; c2paProof: Record<string, unknown> } | null = null;
    if (body.c2paB64 !== undefined) {
      if (typeof body.c2paB64 !== "string" || body.c2paB64.length > MAX_MANIFEST_BYTES * 1.4) return NextResponse.json({ error: "c2paB64 is not a manifest store." }, { status: 400 });
      const m = new Uint8Array(Buffer.from(body.c2paB64, "base64")), md = await digest(m);
      const at = (await getProofsByDigest(md)).find((e) => e.kind === "recorded" && checkMember(e.proof, md)
        && (e.proof.artifact as { digestB64?: unknown } | undefined)?.digestB64 === bound
        && String((e.proof.commit as { epochId?: unknown } | undefined)?.epochId) === epochId && Number((e.proof.commit as { counter?: unknown } | undefined)?.counter) === counter);
      if (!at) return NextResponse.json({ error: "These Content Credentials are not a file of the same BitGraph." }, { status: 400 });
      c2pa = { c2paB64: body.c2paB64, c2paProof: at.proof };
    }
    // The BitGraphed file's thumbnail, when sent, must be a file of a BitGraph on the ledger (the file's own, bound after
    // this one). Whether it shows this photo is for the reader to check against the bound fingerprint; the original's
    // page shows it only when it matches (lib/trustmark/bound-thumbnail.ts).
    let thumb: { thumbB64: string; thumbProof: Record<string, unknown> } | null = null;
    if (body.thumbB64 !== undefined) {
      if (typeof body.thumbB64 !== "string" || body.thumbB64.length > MAX_THUMB_BYTES * 1.4) return NextResponse.json({ error: "thumbB64 is not a thumbnail." }, { status: 400 });
      const t = new Uint8Array(Buffer.from(body.thumbB64, "base64")), td = await digest(t);
      const at = (await getProofsByDigest(td)).find((e) => e.kind === "recorded" && memberOf(e.proof) && checkMember(e.proof, td));
      // indexed a moment after its bind, like the record: the caller retries
      if (!at) return NextResponse.json({ error: "This thumbnail is not a file of a BitGraph on the ledger (yet)." }, { status: 404 });
      thumb = { thumbB64: body.thumbB64, thumbProof: at.proof };
    }
    const eref = await epochRef(epochId);
    const key = trustmarkRecordKey(eref, counter, epochId, recordDigest);
    let written = await putTrustmarkRecordOnce(key, JSON.stringify({ format: "bitgraph-trustmark-published/1", recordB64: body.recordB64, proof: mine.proof, ...(c2pa ?? {}), ...(thumb ?? {}) }, null, 1));
    // A record published before thumbnails were bound (2026-10-29) takes one later, once: the thumbnail checked above.
    if (!written && thumb) {
      let prev: Record<string, unknown> | null = null;
      try { const t = await getObjectText(key); prev = t ? (JSON.parse(t) as Record<string, unknown>) : null; } catch { prev = null; }
      if (prev && typeof prev.thumbB64 !== "string") { await putTrustmarkRecord(key, JSON.stringify({ ...prev, ...thumb }, null, 1)); written = true; }
    }
    // and its pHash in the find index (app/api/find), so a stripped copy can reach this record by what it looks like
    await putFindKeyOnce(findKey(record.phash, eref, counter, epochId, recordDigest));
    forgetFindIndex();
    return NextResponse.json({ written, eref, counter });
  } catch (e) {
    if (e instanceof LedgerUnavailableError) return NextResponse.json({ error: "ledger unavailable" }, { status: 503 });
    throw e;
  }
}

/**
 * GET /api/trustmark/records?eref=&counter=&tag=[&epoch=&record=]: the published records a TrustMark's pointer means, each with the
 * proof that binds it. With epoch and record (url-safe, from a find), the one record is read by its key and no
 * listing is made: a tree's photos all sit at one position, more than a listing page holds. The tag is required and must fit each record (from its BitGraph's nonce and the photo's bound
 * pHash): a record carries a thumbnail and Content Credentials, so it opens only to someone holding the picture (its
 * pointer, or the original itself), never to a position read off the ledger. The reader still checks each itself
 * (the record's place in the tree, the proof); different epochs can share an epochRef.
 */
export async function GET(req: Request) {
  const q = new URL(req.url).searchParams;
  const eref = Number(q.get("eref")), counter = Number(q.get("counter")), want = Number(q.get("tag"));
  if (!Number.isSafeInteger(eref) || eref < 0 || eref > 0xffff || !Number.isSafeInteger(counter) || counter < 0 || counter > MAX_COUNTER) {
    return NextResponse.json({ error: "eref (0-65535) and counter are required" }, { status: 400 });
  }
  if (!q.get("tag") || !Number.isSafeInteger(want) || want < 0 || want >= 2 ** TAG_BITS) return NextResponse.json({ error: "tag is required" }, { status: 400 });
  try {
    const epochId = fromUrlSafeB64(q.get("epoch") ?? ""), recordDigest = fromUrlSafeB64(q.get("record") ?? "");
    const keys = epochId && recordDigest ? [trustmarkRecordKey(eref, counter, epochId, recordDigest)]
      : (await listKeysUnderPrefix(trustmarkRecordPrefix(eref, counter), MAX_CANDIDATES)).slice(0, MAX_CANDIDATES);
    const all = (await Promise.all(keys.map(async (k) => { const t = await getObjectText(k); try { return t ? JSON.parse(t) : null; } catch { return null; } }))).filter(Boolean) as Array<{ recordB64?: string; proof?: { commit?: { nonceB64?: string } } }>;
    const fits = await Promise.all(all.map(async (e) => {
      const rec = typeof e.recordB64 === "string" ? parseRecord(new Uint8Array(Buffer.from(e.recordB64, "base64"))) : null;
      const nonce = e.proof?.commit?.nonceB64;
      return !!rec && typeof nonce === "string" && (await tagOf(nonce, rec.phash, eref, counter)) === want;
    }));
    const entries = all.filter((_, i) => fits[i]);
    return NextResponse.json({ entries }, { headers: { "cache-control": "private, max-age=30" } });
  } catch (e) {
    if (e instanceof LedgerUnavailableError) return NextResponse.json({ error: "ledger unavailable" }, { status: 503 });
    throw e;
  }
}
