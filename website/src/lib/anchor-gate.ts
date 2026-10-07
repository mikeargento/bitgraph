import { NextResponse } from "next/server";
import { listKeysUnderPrefix } from "@/lib/s3";

/** The enclave host: the cloudflared tunnel to the EC2 parent. */
export const TEE_URL = "https://nitro.occproof.com";

// ── Anchor-first gate (enclaves before v10) ─────────────────────────────────
// Enclave v10 fixes a Base block as every position's floor and refuses a
// position on the anchored chain without one, so commitsMayProceed() lets
// commits through at once when the enclave says so. What follows is the gate
// for earlier enclaves, whose floor was the epoch's latest Ethereum anchor.
// The boundary restarts daily (epoch rotation). A commit accepted in the
// seconds between the new epoch coming up and its FIRST anchor landing would
// mint a proof with no same-epoch lower bound: a one-sided bracket. This gate
// holds user commits until the current epoch has at least one anchor, so
// "every recording is preceded by an anchor in its own epoch" is an invariant
// of everything that commits through this site (web, MCP, API, Fuse). The
// anchor service itself commits TEE-direct and is deliberately not gated, or
// the first anchor could never land.
//
// Lifted out of api/commit/route.ts so the Fuse routes sit behind the SAME
// gate. It is chain-blind (anchors live only on bitgraph:main and the anchor
// index has no chain segment), so a caller that allocates on any other chain
// gets no floor from it; the Fuse routes pin the chain for that reason.
//
// Restarting and not-yet-anchored both surface as the same retryable 503
// (code "tee-restarting"), so one client retry loop covers the whole window.

export const TEE_RESTARTING_BODY = { error: "The camera is restarting", code: "tee-restarting" } as const;

export const teeRestarting503 = (headers?: Record<string, string>) =>
  NextResponse.json(TEE_RESTARTING_BODY, { status: 503, ...(headers ? { headers } : {}) });

let cachedKey: { epochId: string; floor: string | null; at: number } | null = null;
const anchoredEpochs = new Set<string>();

export function toSafeEpoch(epochId: string): string {
  return epochId.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/**
 * The enclave's current epoch, from GET /key, cached 10 s per instance.
 * Null means the enclave could not be asked (down, rotating, or slow).
 */
export async function currentEpochId(): Promise<string | null> {
  try {
    if (!cachedKey || Date.now() - cachedKey.at > 10_000) {
      const r = await fetch(`${TEE_URL}/key`, { signal: AbortSignal.timeout(5000) });
      if (!r.ok) return null;
      const k = (await r.json()) as { epochId?: string; floor?: unknown };
      if (!k.epochId) return null;
      cachedKey = { epochId: k.epochId, floor: typeof k.floor === "string" ? k.floor : null, at: Date.now() };
    }
    return cachedKey.epochId;
  } catch {
    return null;
  }
}

/**
 * Whether user commits may go ahead now. An enclave that fixes a Base floor at
 * every allocation (v10, its /key says floor "base") refuses a floorless
 * position itself, so there is nothing to wait for. An earlier enclave takes
 * its floor from the Ethereum anchors, so commits wait for the epoch's first.
 */
export async function commitsMayProceed(): Promise<"yes" | "no" | "tee-down"> {
  const epochId = await currentEpochId();
  if (epochId === null) return "tee-down";
  if (cachedKey?.floor === "base") return "yes";
  return currentEpochHasAnchor();
}

export async function currentEpochHasAnchor(): Promise<"yes" | "no" | "tee-down"> {
  const epochId = await currentEpochId();
  if (epochId === null) return "tee-down";
  if (anchoredEpochs.has(epochId)) return "yes";
  const keys = await listKeysUnderPrefix(`anchors/${toSafeEpoch(epochId)}/`, 1);
  if (keys.length > 0) {
    anchoredEpochs.add(epochId);
    return "yes";
  }
  return "no";
}
