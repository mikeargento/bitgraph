import { NextResponse } from "next/server";

/**
 * BitGraph Fuse on the site: feature flag and the shapes the two proxy routes
 * accept. Off by default; with the flag off the routes answer 404 so nothing
 * about the profile is reachable on a deployment that has not opted in.
 */
export const FUSE_ENABLED = process.env.FUSE_ENABLED === "true";

/** Every Fuse slot is allocated on the anchored chain, or it has no floor. */
export const FUSE_CHAIN = "bitgraph:main";

/** The signed attribution name every fused proof carries (spec 6.5). */
export const FUSE_ATTRIBUTION_NAME = "BitGraph Fuse";

export const fuseDisabled = () =>
  NextResponse.json({ error: "BitGraph Fuse is not enabled on this site", code: "fuse-disabled" }, { status: 404 });

export interface SlotRecord {
  version: "bitgraph/slot/1";
  nonceB64: string;
  counter: string;
  epochId: string;
  publicKeyB64: string;
  chainId: string;
  signatureB64: string;
}

const B64_32 = /^[A-Za-z0-9+/]{43}=$/;
const B64_64 = /^[A-Za-z0-9+/]{86}==$/;
const DECIMAL = /^(0|[1-9][0-9]*)$/;

/** Structural check only; the enclave's signature is what makes it a slot. */
export function isSlotRecord(x: unknown): x is SlotRecord {
  if (x === null || typeof x !== "object" || Array.isArray(x)) return false;
  const s = x as Record<string, unknown>;
  return (
    s.version === "bitgraph/slot/1" &&
    typeof s.nonceB64 === "string" && B64_32.test(s.nonceB64) &&
    typeof s.counter === "string" && DECIMAL.test(s.counter) &&
    typeof s.epochId === "string" && B64_32.test(s.epochId) &&
    typeof s.publicKeyB64 === "string" && B64_32.test(s.publicKeyB64) &&
    s.chainId === FUSE_CHAIN &&
    typeof s.signatureB64 === "string" && B64_64.test(s.signatureB64)
  );
}

export const isDigestB64 = (x: unknown): x is string => typeof x === "string" && B64_32.test(x);

/** Retry-After from the parent survives the proxy hop on 429s. */
export function retryAfterHeaders(from: Response): Record<string, string> {
  const ra = from.headers.get("retry-after");
  return ra ? { "Retry-After": ra } : {};
}
