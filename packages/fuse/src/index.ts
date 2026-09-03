// Copyright (c) Mike Argento. All rights reserved. See LICENSE.

/**
 * fuse(builder, options): the producer interface of the bitgraph-fuse/1
 * profile (working name; outwardly this is simply BitGraph).
 *
 * The four beats, in order, with nothing else in between:
 *   1. nonce:  allocate a slot; the enclave signs a record that contains no
 *              artifact data and hands back a nonce that is a bearer ticket
 *              until it is consumed.
 *   2. fuse:   hand the COMMITMENT to that record (never the raw nonce) to the
 *              builder, which writes it into the artifact it is producing and
 *              returns the finished bytes.
 *   3. hash:   SHA-256 of the fused bytes.
 *   4. fill:   commit that digest under the same slot, with the placement id
 *              and the origin digest in the signed attribution.
 *
 * What this module never does: write the nonce anywhere but process memory,
 * put it in a message, or fall back to an ordinary recording when the fused
 * commit fails. A failure is reported as a failure and the slot expires on
 * its own.
 *
 * Transport: the site's proxy routes by default (POST /api/fuse/allocate and
 * /api/fuse/commit, behind the anchor-first gate), configurable so a licensee
 * can point it at a parent directly.
 */

import { sha256 } from "@noble/hashes/sha256";
import {
  buildFrame,
  bytesToBase64,
  bytesToHex,
  computeSlotCommitment,
  computeSlotRecordHash,
  fuseAttribution,
  getPlacement,
  verifyFuse,
  base64ToBytes,
} from "@mikeargento/bitgraph-verify";
import type { BitGraphProof, FuseFrame, PlacementId, SlotAllocation, FuseVerifyResult } from "@mikeargento/bitgraph-verify";

export type { FuseFrame, PlacementId, SlotAllocation, BitGraphProof } from "@mikeargento/bitgraph-verify";

/** What the builder receives. The raw nonce is deliberately absent. */
export interface BuilderInput {
  /** 32-byte commitment to the signed slot record. Write this into the artifact. */
  commitment: Uint8Array;
  commitmentHex: string;
  /** The origin digest, when the fused artifact names a source. */
  originDigest?: Uint8Array;
  /** The signed slot record, for producers that want to embed its fields. Contains the nonce: do not copy it into the artifact. */
  slot: SlotAllocation;
}

/** Produces the finished (fused) bytes from the commitment. */
export type FuseBuilder = (input: BuilderInput) => Uint8Array | Promise<Uint8Array>;

export interface FuseTransport {
  /** Origin of the commit surface. Default "https://bitgraph.ing". */
  baseUrl?: string;
  /** Default "/api/fuse/allocate". A parent-direct licensee uses "/allocate-slot". */
  allocatePath?: string;
  /** Default "/api/fuse/commit". A parent-direct licensee uses "/commit". */
  commitPath?: string;
  /** Default "/api/proofs/": the by-digest lookup used to recover a lost commit response. */
  lookupPath?: string;
  apiKey?: string;
  fetch?: typeof fetch;
  /** Per-request timeout. Default 30 s. */
  timeoutMs?: number;
  /** Lost-response recovery: how many by-digest reads to attempt, and the wait between them. */
  recoveryAttempts?: number;
  recoveryDelayMs?: number;
}

export interface FuseOptions {
  /** A registered placement id: "trailer/1", "container/1", or "produced/1". */
  placement: PlacementId;
  /** Forms A and B: the original bytes. Never modified. Absent for Form C. */
  original?: Uint8Array;
  /** Form C only: a source the produced artifact references, if any. */
  originDigest?: Uint8Array;
  /** Filename recorded in the Frame manifest (advisory). */
  fusedFile?: string | null;
  /** Return the fused bytes in the result. Default: true for placements that are not byte-exact, false otherwise. */
  keepFused?: boolean;
  /** Actor-bound commits: an agency envelope passed through untouched. */
  agency?: unknown;
  transport?: FuseTransport;
}

export interface FuseResult {
  frame: FuseFrame;
  proof: BitGraphProof;
  artifactDigestB64: string;
  originDigestB64: string | null;
  /** Present when keepFused is true (or defaulted to true). */
  fusedBytes?: Uint8Array;
  /** True when the commit response was lost and the proof was read back by digest. */
  recovered: boolean;
  /** The local verification of the returned proof against the fused bytes. Always FUSED_DIRECT on success. */
  verification: FuseVerifyResult;
}

export type FuseErrorCode =
  | "bad-placement"
  | "bad-input"
  | "allocate-failed"
  | "builder-failed"
  | "commitment-missing"
  | "commit-refused"
  | "slot-unavailable"
  | "tee-restarting"
  | "network"
  | "slot-mismatch"
  | "verification-failed"
  | "transport";

export class FuseError extends Error {
  readonly code: FuseErrorCode;
  readonly status: number | null;
  constructor(code: FuseErrorCode, message: string, status: number | null = null) {
    super(message);
    this.name = "FuseError";
    this.code = code;
    this.status = status;
  }
}

/** A builder for a registered placement over an existing original (Forms A and B), or for a bare Form C payload. */
export function builderFor(placement: PlacementId, original?: Uint8Array): FuseBuilder {
  const p = getPlacement(placement);
  if (p === undefined) throw new FuseError("bad-placement", `placement "${placement}" is not registered`);
  return ({ commitment, originDigest }) => {
    if (original !== undefined) return p.build({ original, originDigest: originDigest ?? sha256(original), commitment });
    return p.build(originDigest !== undefined ? { originDigest, commitment } : { commitment });
  };
}

const DEFAULTS = {
  baseUrl: "https://bitgraph.ing",
  allocatePath: "/api/fuse/allocate",
  commitPath: "/api/fuse/commit",
  lookupPath: "/api/proofs/",
  timeoutMs: 30_000,
  recoveryAttempts: 5,
  recoveryDelayMs: 1_500,
} as const;

const B64_32 = /^[A-Za-z0-9+/]{43}=$/;
const B64_64 = /^[A-Za-z0-9+/]{86}==$/;

function isSlotRecord(x: unknown): x is SlotAllocation {
  if (x === null || typeof x !== "object" || Array.isArray(x)) return false;
  const s = x as Record<string, unknown>;
  return (
    s.version === "bitgraph/slot/1" &&
    typeof s.nonceB64 === "string" && B64_32.test(s.nonceB64) &&
    typeof s.counter === "string" && /^(0|[1-9][0-9]*)$/.test(s.counter) &&
    typeof s.epochId === "string" && typeof s.publicKeyB64 === "string" &&
    typeof s.signatureB64 === "string" && B64_64.test(s.signatureB64)
  );
}

function toUrlSafe(b64: string): string {
  return b64.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function request(
  t: Required<Pick<FuseTransport, "baseUrl" | "timeoutMs">> & FuseTransport,
  path: string,
  init: { method: "GET" | "POST"; body?: unknown },
): Promise<{ status: number; json: unknown; headers: Headers }> {
  const f = t.fetch ?? fetch;
  const headers: Record<string, string> = {};
  if (init.body !== undefined) headers["Content-Type"] = "application/json";
  if (t.apiKey) headers["Authorization"] = `Bearer ${t.apiKey}`;
  let res: Response;
  try {
    res = await f(`${t.baseUrl}${path}`, {
      method: init.method,
      headers,
      ...(init.body !== undefined ? { body: JSON.stringify(init.body) } : {}),
      signal: AbortSignal.timeout(t.timeoutMs),
    });
  } catch (err) {
    throw new FuseError("network", `request failed: ${err instanceof Error ? err.message : String(err)}`);
  }
  const text = await res.text();
  let json: unknown = null;
  try { json = text.length > 0 ? JSON.parse(text) : null; } catch { json = text; }
  return { status: res.status, json, headers: res.headers };
}

function messageOf(json: unknown, fallback: string): string {
  return json !== null && typeof json === "object" && typeof (json as { error?: unknown }).error === "string" ? (json as { error: string }).error : fallback;
}

function codeOf(json: unknown): string | null {
  return json !== null && typeof json === "object" && typeof (json as { code?: unknown }).code === "string" ? (json as { code: string }).code : null;
}

/**
 * Read the proof back by digest after a lost or refused commit: the ONE proof
 * whose commit.slotHashB64 is the hash of the slot record we hold. Any other
 * proof of the same digest is a different recording under a different slot.
 * Never allocates.
 */
async function recover(
  t: Required<Pick<FuseTransport, "baseUrl" | "timeoutMs" | "recoveryAttempts" | "recoveryDelayMs" | "lookupPath">> & FuseTransport,
  artifactDigestB64: string,
  slot: SlotAllocation,
): Promise<BitGraphProof | null> {
  const expectedSlotHash = bytesToBase64(computeSlotRecordHash(slot));
  for (let attempt = 0; attempt < t.recoveryAttempts; attempt++) {
    if (attempt > 0) await sleep(t.recoveryDelayMs);
    let r: { status: number; json: unknown };
    try {
      r = await request(t, `${t.lookupPath}${encodeURIComponent(toUrlSafe(artifactDigestB64))}`, { method: "GET" });
    } catch {
      continue;
    }
    if (r.status !== 200) continue;
    const proofs = (r.json as { proofs?: Array<{ proof?: BitGraphProof }> } | null)?.proofs;
    if (!Array.isArray(proofs)) continue;
    for (const entry of proofs) {
      const p = entry?.proof;
      if (p && p.commit?.slotHashB64 === expectedSlotHash && p.commit?.nonceB64 === slot.nonceB64) return p;
    }
  }
  return null;
}

/**
 * Allocate, fuse, hash, fill. Returns the Frame with the unchanged proof, or
 * throws a FuseError; it never returns an ordinary recording in place of a
 * fused one.
 */
export async function fuse(builder: FuseBuilder, options: FuseOptions): Promise<FuseResult> {
  const placement = getPlacement(options.placement);
  if (placement === undefined) throw new FuseError("bad-placement", `placement "${options.placement}" is not registered`);
  if (placement.form !== "C" && options.original === undefined) throw new FuseError("bad-input", `${placement.id} needs the original bytes`);
  if (placement.form === "C" && options.original !== undefined) throw new FuseError("bad-input", "produced/1 takes no original; pass originDigest to name a source");
  if (options.originDigest !== undefined && options.originDigest.length !== 32) throw new FuseError("bad-input", "originDigest must be 32 bytes");

  const t = { ...DEFAULTS, ...(options.transport ?? {}) };
  const originDigest = options.original !== undefined ? sha256(options.original) : options.originDigest;
  const originDigestB64 = originDigest !== undefined ? bytesToBase64(originDigest) : null;

  // 1. nonce
  const alloc = await request(t, t.allocatePath, { method: "POST", body: {} });
  if (alloc.status === 503 && codeOf(alloc.json) === "tee-restarting") throw new FuseError("tee-restarting", messageOf(alloc.json, "the boundary is restarting"), 503);
  if (alloc.status !== 200) throw new FuseError("allocate-failed", messageOf(alloc.json, `allocation failed (${alloc.status})`), alloc.status);
  const slotId = (alloc.json as { slotId?: unknown } | null)?.slotId;
  const slot = (alloc.json as { slot?: unknown } | null)?.slot;
  if (!isSlotRecord(slot) || slotId !== slot.nonceB64) throw new FuseError("allocate-failed", "the allocation response is not a slot record", alloc.status);
  if (slot.chainId !== "bitgraph:main") throw new FuseError("allocate-failed", "the slot is not on the anchored chain; a fused floor needs bitgraph:main");

  // 2. fuse
  const commitment = computeSlotCommitment(slot);
  let fused: Uint8Array;
  try {
    fused = await builder({ commitment, commitmentHex: bytesToHex(commitment), ...(originDigest !== undefined ? { originDigest } : {}), slot });
  } catch (err) {
    throw new FuseError("builder-failed", `the builder threw: ${err instanceof Error ? err.message : String(err)}`);
  }
  if (!(fused instanceof Uint8Array)) throw new FuseError("builder-failed", "the builder must return a Uint8Array");
  // Fail closed: never commit bytes that do not carry the commitment.
  const located = placement.locate(fused);
  if (located === null || bytesToHex(located.commitment) !== bytesToHex(commitment)) {
    throw new FuseError("commitment-missing", `the fused bytes do not carry the ${placement.id} commitment; nothing was committed and the slot will expire`);
  }

  // 3. hash
  const artifactDigest = sha256(fused);
  const artifactDigestB64 = bytesToBase64(artifactDigest);

  // 4. fill
  const attribution = fuseAttribution(placement.id, originDigest);
  const body: Record<string, unknown> = {
    digests: [{ digestB64: artifactDigestB64, hashAlg: "sha256" }],
    slotId: slot.nonceB64,
    slot,
    chainId: "bitgraph:main",
    attribution,
  };
  if (options.agency !== undefined) body.agency = options.agency;

  let proof: BitGraphProof | null = null;
  let recovered = false;
  let commit: { status: number; json: unknown } | null = null;
  try {
    commit = await request(t, t.commitPath, { method: "POST", body });
  } catch (err) {
    // The request may have reached the boundary. Read back before giving up; never allocate again.
    proof = await recover(t, artifactDigestB64, slot);
    if (proof === null) throw err;
    recovered = true;
  }
  if (proof === null && commit !== null) {
    if (commit.status === 200) {
      const j = commit.json as { proof?: BitGraphProof } | BitGraphProof[] | null;
      proof = Array.isArray(j) ? (j[0] ?? null) : (j?.proof ?? null);
      if (proof === null) throw new FuseError("commit-refused", "the commit response carried no proof", 200);
    } else if (commit.status === 409 && codeOf(commit.json) === "slot-unavailable") {
      proof = await recover(t, artifactDigestB64, slot);
      if (proof === null) throw new FuseError("slot-unavailable", messageOf(commit.json, "the slot is no longer available"), 409);
      recovered = true;
    } else if (commit.status === 503 && codeOf(commit.json) === "tee-restarting") {
      proof = await recover(t, artifactDigestB64, slot);
      if (proof === null) throw new FuseError("tee-restarting", messageOf(commit.json, "the boundary is restarting"), 503);
      recovered = true;
    } else {
      throw new FuseError("commit-refused", messageOf(commit.json, `commit refused (${commit.status})`), commit.status);
    }
  }
  if (proof === null) throw new FuseError("transport", "no proof");

  // Never label as fused a proof under any other slot.
  if (proof.slotAllocation?.nonceB64 !== slot.nonceB64 || proof.commit?.nonceB64 !== slot.nonceB64) {
    throw new FuseError("slot-mismatch", "the boundary returned a proof under a different slot; nothing is labelled fused");
  }
  // A minted proof is verified by a reader before it is called a proof.
  const verification = await verifyFuse({ proof, bytes: fused });
  if (verification.category !== "FUSED_DIRECT") {
    throw new FuseError("verification-failed", `the returned proof does not verify as fused: ${verification.category}${verification.reason ? ` (${verification.reason})` : ""}`);
  }

  const frame = buildFrame({
    proof,
    placement: placement.id,
    artifactDigest,
    ...(originDigest !== undefined ? { originDigest } : {}),
    fusedFile: options.fusedFile ?? null,
    ...(placement.form === "C" ? { fusePayload: fused } : {}),
  });
  const keep = options.keepFused ?? !placement.byteExact;
  return {
    frame,
    proof,
    artifactDigestB64,
    originDigestB64,
    ...(keep ? { fusedBytes: fused } : {}),
    recovered,
    verification,
  };
}

/** Decode a standard-base64 digest, for callers holding one as text. */
export function digestFromBase64(b64: string): Uint8Array {
  const d = base64ToBytes(b64);
  if (d === null || d.length !== 32) throw new FuseError("bad-input", "not a 32-byte base64 digest");
  return d;
}
