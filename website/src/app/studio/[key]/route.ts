// Copyright (c) Argento Computing Inc. All rights reserved. See LICENSE.

/**
 * A page with no links to it, served only at an address that ends in the right key. The key is not in this
 * repository; only its SHA-256 is. Any other address under /studio answers 404.
 */
import { createHash, timingSafeEqual } from "node:crypto";
import { STUDIO_HTML } from "../studio-html";

const KEY_SHA256 = "f6f65b29185d6f341f0c354d76f8ebbd924f14b676b2ebdae9eb9cded7e6e935";

export const dynamic = "force-dynamic";

export async function GET(_req: Request, ctx: { params: Promise<{ key: string }> }) {
  const { key } = await ctx.params;
  const got = createHash("sha256").update(key).digest();
  if (!timingSafeEqual(got, Buffer.from(KEY_SHA256, "hex"))) return new Response("Not found", { status: 404 });
  return new Response(STUDIO_HTML, {
    headers: {
      "content-type": "text/html; charset=utf-8",
      "cache-control": "private, no-store",
      "x-robots-tag": "noindex, nofollow",
      "referrer-policy": "no-referrer",
    },
  });
}
