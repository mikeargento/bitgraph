import { NextResponse } from "next/server";

/* Gone (2026-10-17, enclave v12): a BitGraph is made one way, one atomic
   action in the enclave (a fresh nonce, then the digest at the next count).
   Held slots ("Fuse") are not part of it. POST /api/commit with the digest. */

const gone = () =>
  NextResponse.json(
    { error: "Gone: a BitGraph is made one way. POST /api/commit with the SHA-256 of your file.", code: "bind-only" },
    { status: 410 },
  );

export const POST = gone;
export const GET = gone;
