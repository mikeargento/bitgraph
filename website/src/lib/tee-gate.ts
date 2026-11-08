import { NextResponse } from "next/server";
import { restartMessage } from "@/lib/restart-message";

/** The enclave host: the cloudflared tunnel to the EC2 parent. */
export const TEE_URL = "https://nitro.occproof.com";

// Each BitGraph is one atomic step in the enclave and needs nothing from outside before it, so commits go ahead
// whenever the enclave answers. While it does not (the daily epoch rotation, or a restart) every commit surface on
// this site answers with the same retryable 503 (code "tee-restarting"), so one client retry loop covers the window.
// Nothing has been made when that fires, so an automatic retry cannot record twice.

export const teeRestartingBody = () => ({ error: restartMessage(), code: "tee-restarting" as const });

export const teeRestarting503 = (headers?: Record<string, string>) =>
  NextResponse.json(teeRestartingBody(), { status: 503, ...(headers ? { headers } : {}) });

let cachedKey: { epochId: string; at: number } | null = null;

/**
 * The enclave's current epoch, from GET /key, cached 10 s per instance.
 * Null means the enclave could not be asked (down, rotating, or slow).
 */
export async function currentEpochId(): Promise<string | null> {
  try {
    if (!cachedKey || Date.now() - cachedKey.at > 10_000) {
      const r = await fetch(`${TEE_URL}/key`, { signal: AbortSignal.timeout(5000) });
      if (!r.ok) return null;
      const k = (await r.json()) as { epochId?: string };
      if (!k.epochId) return null;
      cachedKey = { epochId: k.epochId, at: Date.now() };
    }
    return cachedKey.epochId;
  } catch {
    return null;
  }
}
