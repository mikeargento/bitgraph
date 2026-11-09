import { NextResponse } from "next/server";

// Public epoch export is DISABLED.
//
// This route previously streamed an entire epoch's proofs as a bundle. That
// made an unauthenticated caller able to read the S3 ledger through the site,
// which is an attack surface with no public need, so the route is turned off:
// every request returns 404, as if the endpoint does not exist.
//
// The site has no export assembly. The bundle format (docs/BUNDLE-FORMAT.md)
// and its reference builder, buildBundleArchive in packages/audit, are
// unaffected. An export, if one is ever served again, sits behind an operator
// authentication check, never an open public GET.

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
