import { NextResponse } from "next/server";

/**
 * BitGraph Fuse on the site: feature flag and route helpers. Pure helpers
 * live in fuse-core.ts. Off by default; with the flag off the routes answer
 * 404 so nothing about the profile is reachable on a deployment that has not
 * opted in.
 */
export const FUSE_ENABLED = process.env.FUSE_ENABLED === "true";

export {
  FUSE_CHAIN,
  FUSE_ATTRIBUTION_NAME,
  isSlotRecord,
  isDigestB64,
  fusedOriginDigestOf,
  isFusedProof,
  secondsUntilRotation,
  rotationGuardActive,
  ROTATION_GUARD_SECONDS,
  ROTATION_UTC,
} from "@/lib/fuse-core";
export type { SlotRecord } from "@/lib/fuse-core";

export const fuseDisabled = () =>
  NextResponse.json({ error: "BitGraph Fuse is not enabled on this site", code: "fuse-disabled" }, { status: 404 });

/** Retry-After from the parent survives the proxy hop on 429s. */
export function retryAfterHeaders(from: Response): Record<string, string> {
  const ra = from.headers.get("retry-after");
  return ra ? { "Retry-After": ra } : {};
}
