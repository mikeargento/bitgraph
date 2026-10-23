import { NextResponse } from "next/server";

// Public epoch export is DISABLED.
//
// This route previously streamed an entire epoch's proofs as a bundle. That
// made an unauthenticated caller able to read the S3 ledger through the site,
// which is an attack surface with no public need, so the route is turned off:
// every request returns 404, as if the endpoint does not exist.
//
// The implementation is intentionally preserved for future INTERNAL/operator
// use in website/src/lib/export-epoch.ts (spec: docs/BUNDLE-FORMAT.md). To
// re-enable, restore a handler that calls exportEpoch behind an operator
// authentication check, never as an open public GET.
//
// Nothing else changes: proof creation, verification, the audit tooling, the
// bundle format, S3 ledger storage, the explorer, and the TEE are untouched.

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
