/**
 * The password on /three (Mike, 2026-10-09), and nothing else: the matcher below is /three only, so no other route
 * passes through here. Next 16's request hook (the "proxy" file convention, formerly middleware.ts).
 *
 * HTTP Basic Auth against the THREE_PASSWORD environment variable: any user name, the password must match. FAILS
 * CLOSED: with THREE_PASSWORD unset or empty, /three answers 404, so the page does not exist until the variable is set.
 * The comparison is constant time (both sides hashed to 32 bytes, then compared byte by byte without an early exit).
 */
import { NextResponse, type NextRequest } from "next/server";

async function digest(s: string): Promise<Uint8Array> {
  return new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s)));
}

/** Constant time in the inputs' content: two SHA-256 digests, every byte compared. */
async function sameSecret(a: string, b: string): Promise<boolean> {
  const [x, y] = await Promise.all([digest(a), digest(b)]);
  let diff = 0;
  for (let i = 0; i < 32; i++) diff |= x[i]! ^ y[i]!;
  return diff === 0;
}

/** The password from an "Authorization: Basic base64(user:password)" header, or null. */
function basicPassword(header: string | null): string | null {
  if (!header || !/^Basic\s+/i.test(header)) return null;
  let decoded: string;
  try {
    const bin = atob(header.replace(/^Basic\s+/i, "").trim());
    decoded = new TextDecoder().decode(Uint8Array.from(bin, (c) => c.charCodeAt(0)));
  } catch {
    return null;
  }
  const colon = decoded.indexOf(":");
  return colon < 0 ? null : decoded.slice(colon + 1);
}

const NO_STORE = { "Cache-Control": "no-store" };

export async function proxy(request: NextRequest): Promise<NextResponse> {
  const secret = process.env.THREE_PASSWORD;
  if (!secret) return new NextResponse("Not found", { status: 404, headers: { ...NO_STORE, "Content-Type": "text/plain; charset=utf-8" } });
  const given = basicPassword(request.headers.get("authorization"));
  if (given !== null && (await sameSecret(given, secret))) {
    const res = NextResponse.next();
    res.headers.set("Cache-Control", "private, no-store");
    return res;
  }
  return new NextResponse("Authentication required", {
    status: 401,
    headers: { ...NO_STORE, "Content-Type": "text/plain; charset=utf-8", "WWW-Authenticate": 'Basic realm="Three", charset="UTF-8"' },
  });
}

export const config = { matcher: ["/three", "/three/:path*"] };
