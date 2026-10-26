// Copyright (c) Argento Computing Inc. All rights reserved. See LICENSE.

import { NextResponse } from "next/server";
import { getObjectText, getProofsByDigest, ledgerWritesOn, listKeysUnderPrefix, putTrustmarkRecordOnce, trustmarkRecordKey, trustmarkRecordPrefix, LedgerUnavailableError } from "@/lib/s3";
import { checkMember, memberOf } from "@/lib/tree-member";
import { epochRef, MAX_COUNTER } from "@/lib/trustmark/payload";
import { parseRecord } from "@/lib/trustmark/record";
import { MAX_MANIFEST_BYTES } from "@/lib/trustmark/c2pa-leaf";

export const dynamic = "force-dynamic";

const MAX_RECORD_BYTES = 4096;
const MAX_CANDIDATES = 16;
const b64 = (u: Uint8Array) => Buffer.from(u).toString("base64");
const digest = async (u: Uint8Array) => b64(new Uint8Array(await crypto.subtle.digest("SHA-256", u as BufferSource)));

/**
 * POST /api/trustmark/records { recordB64 }: publish a photo's fingerprint record, so a TrustMark pointing to the
 * photo's BitGraph can be checked by anyone holding only a copy. Sent when a photo is exported with a TrustMark.
 *
 * Nothing is taken on trust. The record must be a file of a tree on the ledger (found by its own hash, where the
 * tree's members are indexed), its hash must walk up to the root that tree's proof signs, and the photo it names must
 * be a member of the same BitGraph. The record is then kept under the position its pointer names.
 */
export async function POST(req: Request) {
  if (!ledgerWritesOn()) return NextResponse.json({ error: "Ledger writes are off." }, { status: 503 });
  let body: { recordB64?: unknown; c2paB64?: unknown };
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
    const eref = await epochRef(epochId);
    const written = await putTrustmarkRecordOnce(trustmarkRecordKey(eref, counter, epochId, recordDigest), JSON.stringify({ format: "bitgraph-trustmark-published/1", recordB64: body.recordB64, proof: mine.proof, ...(c2pa ?? {}) }, null, 1));
    return NextResponse.json({ written, eref, counter });
  } catch (e) {
    if (e instanceof LedgerUnavailableError) return NextResponse.json({ error: "ledger unavailable" }, { status: 503 });
    throw e;
  }
}

/**
 * GET /api/trustmark/records?eref=&counter=: every published record a TrustMark's pointer could mean, each with the
 * proof that binds it. The reader checks each itself (the record's place in the tree, the proof, the tag) and keeps
 * the one that fits; different epochs can share an epochRef.
 */
export async function GET(req: Request) {
  const q = new URL(req.url).searchParams;
  const eref = Number(q.get("eref")), counter = Number(q.get("counter"));
  if (!Number.isSafeInteger(eref) || eref < 0 || eref > 0xffff || !Number.isSafeInteger(counter) || counter < 0 || counter > MAX_COUNTER) {
    return NextResponse.json({ error: "eref (0-65535) and counter are required" }, { status: 400 });
  }
  try {
    const keys = (await listKeysUnderPrefix(trustmarkRecordPrefix(eref, counter), MAX_CANDIDATES)).slice(0, MAX_CANDIDATES);
    const entries = (await Promise.all(keys.map(async (k) => { const t = await getObjectText(k); try { return t ? JSON.parse(t) : null; } catch { return null; } }))).filter(Boolean);
    return NextResponse.json({ entries }, { headers: { "cache-control": "public, max-age=30" } });
  } catch (e) {
    if (e instanceof LedgerUnavailableError) return NextResponse.json({ error: "ledger unavailable" }, { status: 503 });
    throw e;
  }
}
