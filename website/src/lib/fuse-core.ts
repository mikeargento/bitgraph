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

/**
 * bitgraph-fuse/2 (2026-09-30): the commitment also binds the floor block, so
 * the file's content floor rests on the block hash alone. Same placements,
 * same payloads; only the commitment and this signed name differ. Must equal
 * FUSE2_ATTRIBUTION_NAME in @mikeargento/bitgraph-verify 1.15.0.
 */
export const FUSE2_ATTRIBUTION_NAME = "bitgraph-fuse/2";

/**
 * bitgraph-fuse/3 (2026-10-06, enclave v10): the commitment binds a Base
 * block, the floor the enclave fixes at allocation and signs as
 * commit.slotFloor. Same placements, same payloads as /2; only the domain and
 * the floor's chain differ. Must equal FUSE3_ATTRIBUTION_NAME in
 * @mikeargento/bitgraph-verify 1.17.0.
 */
export const FUSE3_ATTRIBUTION_NAME = "bitgraph-fuse/3";

/** True for any fused marker name. Never compare against one version's string. */
export function isFuseName(name: unknown): boolean {
  return name === FUSE_ATTRIBUTION_NAME || name === FUSE2_ATTRIBUTION_NAME || name === FUSE3_ATTRIBUTION_NAME;
}

/** The floor anchor an enclave v9 allocation hands back, exactly as it will sign it at commit. */
export interface AnchorMark {
  counter: string;
  blockNumber: number;
  blockHash: string;
}

/** Structural check only: the commit's signed slotAnchor is what makes it the floor. */
export function isAnchorMark(x: unknown): x is AnchorMark {
  if (x === null || typeof x !== "object" || Array.isArray(x)) return false;
  const a = x as Record<string, unknown>;
  return typeof a.counter === "string" && DECIMAL.test(a.counter)
    && typeof a.blockNumber === "number" && Number.isSafeInteger(a.blockNumber) && a.blockNumber >= 0
    && typeof a.blockHash === "string" && /^0x[0-9a-f]{64}$/.test(a.blockHash);
}

/** The Base floor an enclave v10 allocation hands back, exactly as it will sign it at commit (commit.slotFloor). */
export interface BaseFloorMark {
  chain: "base";
  evmChainId: 8453;
  blockNumber: number;
  blockHash: string;
  blockTimestamp: number;
}

/** Structural check only: the commit's signed slotFloor is what makes it the floor. */
export function isBaseFloorMark(x: unknown): x is BaseFloorMark {
  if (x === null || typeof x !== "object" || Array.isArray(x)) return false;
  const a = x as Record<string, unknown>;
  return a.chain === "base" && a.evmChainId === 8453
    && typeof a.blockNumber === "number" && Number.isSafeInteger(a.blockNumber) && a.blockNumber > 0
    && typeof a.blockHash === "string" && /^0x[0-9a-f]{64}$/.test(a.blockHash)
    && typeof a.blockTimestamp === "number" && Number.isSafeInteger(a.blockTimestamp);
}

/** Either floor an allocation can return: a Base block (v10, fuse/3) or an Ethereum anchor (v9, fuse/2). */
export type FloorMark = AnchorMark | BaseFloorMark;

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

/** The signed title of a tree/1 proof. Pinned; the suite checks it equals TREE_PLACEMENT_ID. */
export const TREE_TITLE = "tree/1";

/**
 * The origin digest a fused proof names in its SIGNED attribution, or null
 * when the proof is not fused or names no origin. The only field a ledger
 * index may trust for an origin: it is inside the Ed25519 signature.
 *
 * ⚠️ A tree/1 proof names NO origin, although its message is 32 bytes of
 * base64: it is the SHA-256 of SPEC.md, the spec the proof follows, and each
 * member's origin lives in its leaf. Reading it as an origin would index every
 * tree under the spec's hash, permanently (the bucket is under Object Lock),
 * and make SPEC.md itself, which travels beside every export, look like a file
 * on record wherever it was dropped.
 */
export function fusedOriginDigestOf(proof: Record<string, unknown>): string | null {
  const a = proof.attribution as { name?: unknown; title?: unknown; message?: unknown } | undefined;
  if (!a || !isFuseName(a.name) || typeof a.message !== "string") return null;
  if (a.title === TREE_TITLE) return null;
  if (!B64_32.test(a.message)) return null;
  const bytes = Buffer.from(a.message, "base64");
  return bytes.length === 32 && bytes.toString("base64") === a.message ? a.message : null;
}

/** True when the proof's signed attribution marks it fused (origin declared or not). */
export function isFusedProof(proof: Record<string, unknown>): boolean {
  const a = proof.attribution as { name?: unknown } | undefined;
  return !!a && isFuseName(a.name);
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

/* ── The floor a fused commit binds (fuse/2: an Ethereum anchor, fuse/3: a Base block) ── */

/** What a commit body names as the floor it bound, by its marker. */
export type BoundFloor =
  | { chain: "ethereum"; mark: AnchorMark }
  | { chain: "base"; mark: BaseFloorMark };

/**
 * The floor a fused commit names: body.anchor for bitgraph-fuse/2 (the
 * Ethereum anchor a v9 allocation returned), body.floor for bitgraph-fuse/3
 * (the Base block a v10 allocation returned), nothing for bitgraph-fuse/1.
 * An error sentence when the marker's floor is missing or malformed.
 */
export function boundFloorOf(name: unknown, body: { anchor?: unknown; floor?: unknown }): { ok: true; bound: BoundFloor | null } | { ok: false; error: string } {
  if (name === FUSE3_ATTRIBUTION_NAME) {
    if (!isBaseFloorMark(body.floor)) return { ok: false, error: "a bitgraph-fuse/3 commit carries body.floor: the Base floor /api/fuse/allocate returned with this position" };
    return { ok: true, bound: { chain: "base", mark: body.floor } };
  }
  if (name === FUSE2_ATTRIBUTION_NAME) {
    if (!isAnchorMark(body.anchor)) return { ok: false, error: "a bitgraph-fuse/2 commit carries body.anchor: the floor anchor /api/fuse/allocate returned with this position" };
    return { ok: true, bound: { chain: "ethereum", mark: body.anchor } };
  }
  return { ok: true, bound: null };
}

/**
 * After the enclave returns the proof: the floor it SIGNED must be the one the
 * file bound, or the file's commitment binds a block the proof does not, and
 * the file never verifies. fuse/3: commit.slotFloor, a Base block, with no
 * Ethereum anchor beside it; fuse/2: commit.slotAnchor, with no Base floor.
 * A proof signing both floors is ambiguous and never matches.
 */
export function signedFloorMatchesBound(proof: Record<string, unknown> | undefined, bound: BoundFloor): boolean {
  const commit = (proof?.commit ?? null) as { slotAnchor?: { blockHash?: unknown } | null; slotFloor?: { chain?: unknown; blockHash?: unknown } | null } | null;
  if (commit === null || typeof commit !== "object") return false;
  const anchor = commit.slotAnchor ?? null;
  const floor = commit.slotFloor ?? null;
  if (anchor !== null && floor !== null) return false;
  if (bound.chain === "base") {
    return floor !== null && floor.chain === "base" && typeof floor.blockHash === "string" && floor.blockHash.toLowerCase() === bound.mark.blockHash;
  }
  return anchor !== null && typeof anchor.blockHash === "string" && anchor.blockHash.toLowerCase() === bound.mark.blockHash;
}

/**
 * Enclave v10 refuses an allocation on the anchored chain that comes without
 * a Base header ("no-base-floor: ..."), which happens while the parent's Base
 * feed has no fresh head. It arrives through the parent as an error body; the
 * site answers it like a restart, with the retryable 503 "tee-restarting".
 */
export function isNoBaseFloorRefusal(body: unknown): boolean {
  const e = (body as { error?: unknown } | null)?.error;
  return typeof e === "string" && /\bno-base-floor\b/.test(e);
}

/**
 * The Base floor a proof signs (commit.slotFloor, enclave v10), or null: an
 * Ethereum floor (commit.slotAnchor), no floor, or a proof that signs both,
 * which is ambiguous and is read as neither. Structural only; the signature
 * over it is what makes it the proof's floor.
 */
export function baseFloorOf(proof: unknown): { blockNumber: number; blockHash: string; blockTimestamp: number } | null {
  const c = (proof as { commit?: { slotFloor?: { chain?: unknown; blockNumber?: unknown; blockHash?: unknown; blockTimestamp?: unknown } | null; slotAnchor?: unknown } } | null)?.commit;
  const f = c?.slotFloor;
  if (!f || c?.slotAnchor || f.chain !== "base" || typeof f.blockNumber !== "number" || typeof f.blockHash !== "string" || typeof f.blockTimestamp !== "number") return null;
  return { blockNumber: f.blockNumber, blockHash: f.blockHash, blockTimestamp: f.blockTimestamp };
}
