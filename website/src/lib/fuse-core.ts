/**
 * BitGraph Fuse (working name): pure helpers shared by the proxy routes, the
 * ledger index, and tests. No Next.js imports here so node can run the tests
 * directly.
 */

/** Every Fuse slot is allocated on the anchored chain, or it has no floor. */
export const FUSE_CHAIN = "bitgraph:main";

/**
 * The signed attribution name every fused proof carries (spec 6.5): the
 * profile id, the stable wire identifier of this construction (ruled
 * 2026-09-03). Must equal FUSE_ATTRIBUTION_NAME in @mikeargento/bitgraph-verify
 * 1.4.0; the site pins the value itself so these pure helpers stay free of
 * package imports, and the test suite checks that the two agree.
 */
export const FUSE_ATTRIBUTION_NAME = "bitgraph-fuse/1";

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

/**
 * The origin digest a fused proof names in its SIGNED attribution, or null
 * when the proof is not fused or names no origin. The only field a ledger
 * index may trust for an origin: it is inside the Ed25519 signature.
 */
export function fusedOriginDigestOf(proof: Record<string, unknown>): string | null {
  const a = proof.attribution as { name?: unknown; message?: unknown } | undefined;
  if (!a || a.name !== FUSE_ATTRIBUTION_NAME || typeof a.message !== "string") return null;
  if (!B64_32.test(a.message)) return null;
  const bytes = Buffer.from(a.message, "base64");
  return bytes.length === 32 && bytes.toString("base64") === a.message ? a.message : null;
}

/** True when the proof's signed attribution marks it fused (origin declared or not). */
export function isFusedProof(proof: Record<string, unknown>): boolean {
  const a = proof.attribution as { name?: unknown } | undefined;
  return !!a && a.name === FUSE_ATTRIBUTION_NAME;
}

/**
 * The boundary restarts every day at a fixed UTC time (23:59, the epoch
 * rotation), and a restart voids every pending slot. A slot allocated inside
 * the slot TTL before that moment can never be committed, so allocation is
 * refused in that window with the same retryable 503 the rotation itself
 * produces. Both values are overridable for tests and for a licensee's own
 * schedule.
 */
export const ROTATION_UTC = process.env.FUSE_ROTATION_UTC ?? "23:59";
export const ROTATION_GUARD_SECONDS = Number(process.env.FUSE_ROTATION_GUARD_SECONDS ?? 150);

/** Seconds from `now` until the next rotation instant (HH:MM UTC). */
export function secondsUntilRotation(now: Date = new Date(), rotationUtc: string = ROTATION_UTC): number {
  const m = /^([01]?\d|2[0-3]):([0-5]\d)$/.exec(rotationUtc);
  const hh = m ? Number(m[1]) : 23;
  const mm = m ? Number(m[2]) : 59;
  const nowSec = now.getUTCHours() * 3600 + now.getUTCMinutes() * 60 + now.getUTCSeconds();
  const rotSec = hh * 3600 + mm * 60;
  const delta = rotSec - nowSec;
  return delta >= 0 ? delta : delta + 86_400;
}

/** True inside the pre-rotation blackout: a slot allocated now would expire in the restart. */
export function rotationGuardActive(now: Date = new Date(), guardSeconds: number = ROTATION_GUARD_SECONDS, rotationUtc: string = ROTATION_UTC): boolean {
  return secondsUntilRotation(now, rotationUtc) < guardSeconds;
}
