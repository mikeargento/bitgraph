// Copyright (c) Argento Computing Inc. All rights reserved. See LICENSE.

import { NextResponse } from "next/server";
import { LedgerUnavailableError, getProofsByDigest, getSourceNote, ledgerWritesOn, putSourceNote, type SourceNote } from "@/lib/s3";
import { fromUrlSafeB64 } from "@/lib/explorer";
import { fetchAndHash, rewriteShareLink } from "@/lib/source-url";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** A link verified longer ago than this is checked again before it is shown. */
const STALE_MS = 24 * 3600 * 1000;

function position(q: URLSearchParams | Record<string, unknown>): { digest: string; epochId: string; counter: string } | null {
  const get = (k: string) => (q instanceof URLSearchParams ? q.get(k) : (q as Record<string, unknown>)[k]);
  const digest = fromUrlSafeB64(String(get("digest") ?? "")), epochId = fromUrlSafeB64(String(get("epoch") ?? "")), counter = String(get("counter") ?? "");
  return digest && epochId && /^\d+$/.test(counter) ? { digest, epochId, counter } : null;
}

/** What the page shows: the host to credit, the size, and when the bytes were last seen to match. Never the address. */
const shown = (n: SourceNote) => ({ host: n.host, name: n.name ?? null, bytes: n.bytes, verifiedAt: n.verifiedAt });

/**
 * GET /api/sources?digest=&epoch=&counter=: the file's hosted source, when one is on record and still serves the exact
 * bytes. A note older than a day is fetched and hashed again first; one that no longer matches is kept as failed and
 * not shown.
 */
export async function GET(req: Request) {
  const at = position(new URL(req.url).searchParams);
  if (!at) return NextResponse.json({ error: "digest, epoch and counter are required" }, { status: 400 });
  try {
    const note = await getSourceNote(at.digest, at.epochId, at.counter);
    if (!note || (note.failedAt ?? 0) > note.verifiedAt) return NextResponse.json({ source: null, ...(note ? { note: "The hosted copy no longer matches the original." } : {}) });
    if (Date.now() - note.verifiedAt > STALE_MS) {
      const r = await fetchAndHash(note.url);
      if (!r.ok || r.digestB64 !== at.digest) {
        await putSourceNote(at.digest, at.epochId, at.counter, { ...note, failedAt: Date.now() }).catch(() => false);
        return NextResponse.json({ source: null, note: "The hosted copy no longer matches the original." });
      }
      note.verifiedAt = Date.now(); note.bytes = r.bytes;
      await putSourceNote(at.digest, at.epochId, at.counter, note).catch(() => false);
    }
    return NextResponse.json({ source: shown(note) }, { headers: { "cache-control": "private, max-age=60" } });
  } catch (e) {
    if (e instanceof LedgerUnavailableError) return NextResponse.json({ error: "ledger unavailable" }, { status: 503 });
    throw e;
  }
}

/**
 * POST /api/sources { digest, epoch, counter, url, name?, among? }: say where the original is. The address is fetched
 * and hashed here, and kept only when what it serves is bound bytes: this position's, or one of `among` (up to 8 other
 * positions, the other BitGraphs of the same picture a copy matched), so a link offered on one of them lands on the
 * BitGraph that recorded those exact bytes; the response says which. Anyone may call it, because nothing is taken on
 * trust: a wrong file, a web page, a login wall or a spam link fails the hash and nothing is stored.
 */
export async function POST(req: Request) {
  if (!ledgerWritesOn()) return NextResponse.json({ error: "Ledger writes are off." }, { status: 503 });
  let body: Record<string, unknown>;
  try { body = await req.json(); } catch { return NextResponse.json({ error: "Invalid JSON." }, { status: 400 }); }
  const at = position(body);
  if (!at) return NextResponse.json({ error: "digest, epoch and counter are required" }, { status: 400 });
  if (typeof body.url !== "string" || body.url.length > 2048) return NextResponse.json({ error: "url is required" }, { status: 400 });
  const rewritten = rewriteShareLink(body.url);
  if ("error" in rewritten) return NextResponse.json({ error: rewritten.error }, { status: 400 });
  const among = (Array.isArray(body.among) ? body.among.slice(0, 8) : []).map((x) => position(x as Record<string, unknown>)).filter((x): x is NonNullable<typeof x> => !!x);
  try {
    const r = await fetchAndHash(rewritten.url);
    if (!r.ok) return NextResponse.json({ error: r.error }, { status: 422 });
    const target = [at, ...among].find((x) => x.digest === r.digestB64);
    if (!target) return NextResponse.json({ error: among.length ? "The file at that address is not any of these originals. It was probably re-saved, resized or converted; link the exact file." : "The file at that address is not this original. It was probably re-saved, resized or converted; link the exact file." }, { status: 422 });
    const bound = (await getProofsByDigest(target.digest)).some((e) => {
      const c = e.proof.commit as { epochId?: unknown; counter?: unknown } | undefined;
      return e.kind === "recorded" && String(c?.epochId) === target.epochId && String(c?.counter) === target.counter;
    });
    if (!bound) return NextResponse.json({ error: "This file is not a BitGraph at that position." }, { status: 404 });
    // a verified link is never replaced: once the original is linked, it stays linked; only a link that has since
    // stopped serving the bytes (failed) can be succeeded by another
    const standing = await getSourceNote(target.digest, target.epochId, target.counter);
    if (standing && (standing.failedAt ?? 0) <= standing.verifiedAt) return NextResponse.json({ error: "This original is already linked." }, { status: 409 });
    const name = typeof body.name === "string" && body.name.length <= 255 ? body.name : undefined;
    const note: SourceNote = { format: "bitgraph-source/1", url: rewritten.url, host: r.host, name, bytes: r.bytes, contentType: r.contentType, addedAt: Date.now(), verifiedAt: Date.now() };
    await putSourceNote(target.digest, target.epochId, target.counter, note);
    const safe = (b64: string) => b64.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
    return NextResponse.json({ ok: true, source: shown(note), at: { digest: safe(target.digest), epoch: safe(target.epochId), counter: target.counter } });
  } catch (e) {
    if (e instanceof LedgerUnavailableError) return NextResponse.json({ error: "ledger unavailable" }, { status: 503 });
    throw e;
  }
}
