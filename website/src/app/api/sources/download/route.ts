// Copyright (c) Argento Computing Inc. All rights reserved. See LICENSE.

import { createHash } from "node:crypto";
import { NextResponse } from "next/server";
import { LedgerUnavailableError, getSourceNote, putSourceNote } from "@/lib/s3";
import { fromUrlSafeB64 } from "@/lib/explorer";
import { openSource } from "@/lib/source-url";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * GET /api/sources/download?digest=&epoch=&counter=: the hosted original, streamed from its host through a hash. The
 * viewer never fetches the host's address: the bytes come through here, and if what the host serves does not hash to
 * the bound digest the stream is cut, so the download fails rather than completing with a wrong file. The browser
 * hashes what it received as well before saving it.
 */
export async function GET(req: Request) {
  const q = new URL(req.url).searchParams;
  const digest = fromUrlSafeB64(q.get("digest") ?? ""), epochId = fromUrlSafeB64(q.get("epoch") ?? ""), counter = q.get("counter") ?? "";
  if (!digest || !epochId || !/^\d+$/.test(counter)) return NextResponse.json({ error: "digest, epoch and counter are required" }, { status: 400 });
  try {
    const note = await getSourceNote(digest, epochId, counter);
    if (!note || (note.failedAt ?? 0) > note.verifiedAt) return NextResponse.json({ error: "No hosted original on record." }, { status: 404 });
    const o = await openSource(note.url);
    if (!o.ok) {
      // the host no longer serves the file (gone, or shut to the public): the link is marked failed at once, so the
      // page stops offering it and a new link may be offered, rather than waiting for the daily re-check
      if (/\((404|410|401|403)\)/.test(o.error)) void putSourceNote(digest, epochId, counter, { ...note, failedAt: Date.now() }).catch(() => false);
      return NextResponse.json({ error: o.error }, { status: 502 });
    }
    const hash = createHash("sha256");
    let bytes = 0;
    const body = o.res.body!.pipeThrough(new TransformStream<Uint8Array, Uint8Array>({
      transform(chunk, controller) { hash.update(chunk); bytes += chunk.byteLength; if (bytes > note.bytes) controller.error(new Error("more bytes than the original")); else controller.enqueue(chunk); },
      flush(controller) {
        if (hash.digest("base64") !== digest || bytes !== note.bytes) {
          void putSourceNote(digest, epochId, counter, { ...note, failedAt: Date.now() }).catch(() => false);
          controller.error(new Error("the host served different bytes"));
        }
      },
    }));
    const name = (note.name ?? "original").replace(/[^\w.() -]+/g, "_");
    return new Response(body, { headers: {
      "content-type": note.contentType ?? "application/octet-stream",
      "content-length": String(note.bytes),
      "content-disposition": `attachment; filename="${name}"`,
      "cache-control": "private, no-store",
      "x-bitgraph-digest": digest,
    } });
  } catch (e) {
    if (e instanceof LedgerUnavailableError) return NextResponse.json({ error: "ledger unavailable" }, { status: 503 });
    throw e;
  }
}
