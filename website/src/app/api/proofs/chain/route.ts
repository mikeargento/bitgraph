import { NextResponse } from "next/server";

// Proofs by position is DISABLED (Mike, 2026-10-09: "We don't want that ledger.").
//
// GET /api/proofs/chain?epoch=&counter= returned every proof around a counter,
// recordings included, with their digests. Counters run from 1 each day, so
// walking them read out every record on the ledger and opened every proof page,
// the paintings among them. A record is found only by someone who already holds
// its file, its digest or a link its maker shared; nothing on the site lists or
// walks them. Nothing called this route (site, packages, verifier), so it
// answers 404 to every method, as if it did not exist, the same way the epoch
// export does (app/api/export/epoch). Its reader, getProofsAroundCounter in
// lib/s3.ts, is deleted with it.

export const dynamic = "force-dynamic";

function notFound(): NextResponse {
  return NextResponse.json({ error: "not found" }, { status: 404 });
}

export const GET = notFound;
export const POST = notFound;
export const PUT = notFound;
export const PATCH = notFound;
export const DELETE = notFound;
export const HEAD = notFound;
export const OPTIONS = notFound;
