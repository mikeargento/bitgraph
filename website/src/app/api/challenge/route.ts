import { NextResponse } from "next/server";

const TEE_URL = "https://nitro.occproof.com";

export const dynamic = "force-dynamic";

/**
 * A nonce for a declaration, straight from the enclave.
 *
 * The challenge is the reason a declaration means anything. The enclave mints
 * it from the NSM hardware RNG, holds it for 60 seconds, and consumes it on
 * first use, so an authorization signed at leisure cannot be presented later
 * as fresh. That is enforced inside the enclave (verifyAgencyEnvelope), not
 * here: this route only carries it.
 *
 * ⚠️ It follows that this MUST NOT invent one. The page that used to do
 * biometric authorship generated its own with crypto.getRandomValues, and
 * every commit it made was refused by the enclave with "challenge not found
 * or expired" — correctly, since a nonce the caller chose proves nothing
 * about when they chose it.
 *
 * Deliberately unauthenticated, like /api/commit. A challenge is worth
 * nothing on its own: it can only be spent by a signature from a key the
 * enclave will check, and the pending pool is capped (500) with a 60s TTL, so
 * requesting them in bulk exhausts nothing but the requester's patience.
 */
export async function POST() {
  try {
    const res = await fetch(`${TEE_URL}/challenge`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "{}",
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) {
      // The enclave restarts daily at 23:59 UTC; the same retryable shape the
      // commit proxy uses, so one client loop covers both.
      return NextResponse.json(
        { error: "The camera is restarting; try again shortly.", code: "tee-restarting" },
        { status: 503 }
      );
    }
    const data = (await res.json()) as { challenge?: string };
    if (typeof data.challenge !== "string" || data.challenge.length === 0) {
      return NextResponse.json({ error: "No challenge" }, { status: 502 });
    }
    return NextResponse.json({ challenge: data.challenge });
  } catch (e) {
    console.error("[api/challenge]", (e as Error).message);
    return NextResponse.json(
      { error: "The camera is restarting; try again shortly.", code: "tee-restarting" },
      { status: 503 }
    );
  }
}
