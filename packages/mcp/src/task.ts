// Copyright (c) 2024-2026 Mike Argento. Licensed under the MIT License. See LICENSE.

/**
 * A position BEFORE the work: the task form of the stdio server.
 *
 * bitgraph_open with no files asks the site's own /api/fuse/allocate for a
 * slot and returns its commitment, and nothing else. The caller puts the
 * commitment into the task it is about to run (the prompt, the request, a
 * seed, a line in the document) and, within the slot's life, commits the
 * digest of those task bytes under the slot with the inline marker
 * (bitgraph-fuse/1, title base64url): a verifier recomputes the commitment
 * from the slot record and finds its base64url text inside the bytes.
 * Outputs are recorded afterwards with bitgraph_record and sit later.
 *
 * The slot allocation and the commit go through the same two site routes
 * the core package's fuse() uses; the recovery rule is the core's (read back
 * by digest, refuse a proof under any other slot).
 */
import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { bytesToBase64, computeSlotCommitment, findCommitment, inlineAttribution, verifyProofIntegrity, ENCODING_BASE64URL } from "@mikeargento/bitgraph-verify";
import type { BitGraphProof, SlotAllocation } from "@mikeargento/bitgraph-verify";
import { ApiError, type ApiConfig } from "./api.js";
import { toUrlSafeB64 } from "./encoding.js";

export const SLOT_TTL_SECONDS = 120;
const CHAIN = "bitgraph:main";
const B64_32 = /^[A-Za-z0-9+/]{43}=$/;
const B64_64 = /^[A-Za-z0-9+/]{86}==$/;

export interface TaskState {
  v: 1;
  task: true;
  slot: SlotAllocation;
}

function isSlotRecord(x: unknown): x is SlotAllocation {
  if (x === null || typeof x !== "object" || Array.isArray(x)) return false;
  const s = x as Record<string, unknown>;
  return s.version === "bitgraph/slot/1" && typeof s.nonceB64 === "string" && B64_32.test(s.nonceB64) && typeof s.counter === "string" && /^(0|[1-9][0-9]*)$/.test(s.counter)
    && typeof s.epochId === "string" && typeof s.publicKeyB64 === "string" && typeof s.signatureB64 === "string" && B64_64.test(s.signatureB64) && s.chainId === CHAIN;
}

export function encodeTaskToken(state: TaskState): string {
  return Buffer.from(JSON.stringify(state), "utf8").toString("base64url");
}

export function decodeTaskToken(token: string): TaskState | null {
  let parsed: unknown;
  try { parsed = JSON.parse(Buffer.from(token, "base64url").toString("utf8")); } catch { return null; }
  if (typeof parsed !== "object" || parsed === null) return null;
  const s = parsed as Record<string, unknown>;
  if (s.v !== 1 || s.task !== true || !isSlotRecord(s.slot)) return null;
  return { v: 1, task: true, slot: s.slot };
}

async function post(config: ApiConfig, path: string, body: unknown, timeoutMs: number): Promise<{ status: number; json: unknown; retryAfterSec: number | null }> {
  const headers: Record<string, string> = { "content-type": "application/json", accept: "application/json" };
  if (config.apiKey) headers["authorization"] = `Bearer ${config.apiKey}`;
  const res = await fetch(`${config.baseUrl}${path}`, { method: "POST", headers, body: JSON.stringify(body), signal: AbortSignal.timeout(timeoutMs) });
  let json: unknown = null;
  try { json = await res.json(); } catch { /* non-JSON */ }
  const raw = res.headers.get("retry-after");
  const retry = raw !== null ? Number.parseInt(raw, 10) : NaN;
  return { status: res.status, json, retryAfterSec: Number.isFinite(retry) ? retry : null };
}

const messageOf = (json: unknown, fallback: string): string => {
  const e = (json as { error?: unknown } | null)?.error;
  return typeof e === "string" ? e : fallback;
};

export interface Begun {
  token: string;
  /** Unpadded base64url: the string to put into the task. */
  commitment: string;
  commitmentB64: string;
  slotCounter: string;
  epoch: string;
  floor: { block: number } | null;
}

/** Step one of the task form: a held slot and its commitment, before any work exists. */
export async function beginTask(config: ApiConfig): Promise<Begun> {
  const r = await post(config, "/api/fuse/allocate", {}, 20_000);
  if (r.status !== 200) throw new ApiError(r.status, messageOf(r.json, `allocation refused (${r.status})`), r.retryAfterSec);
  const slot = (r.json as { slot?: unknown } | null)?.slot;
  if (!isSlotRecord(slot)) throw new ApiError(502, "the allocation response is not a slot record on bitgraph:main");
  const commitmentB64 = bytesToBase64(computeSlotCommitment(slot));
  let floor: Begun["floor"] = null;
  try {
    const res = await fetch(`${config.baseUrl}/api/proofs/anchors?counter=${encodeURIComponent(slot.counter)}&epoch=${encodeURIComponent(slot.epochId)}&before=1`, { headers: { accept: "application/json" }, signal: AbortSignal.timeout(10_000) });
    const data = res.status === 200 ? ((await res.json()) as { anchors?: Array<{ commit?: { anchor?: { blockNumber?: number } } }> }) : null;
    const b = data?.anchors?.[0]?.commit?.anchor?.blockNumber;
    if (typeof b === "number") floor = { block: b };
  } catch { floor = null; }
  return { token: encodeTaskToken({ v: 1, task: true, slot }), commitment: toUrlSafeB64(commitmentB64), commitmentB64, slotCounter: slot.counter, epoch: toUrlSafeB64(slot.epochId), floor };
}

export interface SealedTask {
  proof: BitGraphProof;
  artifactDigestB64: string;
  /** Byte offsets of the commitment string inside the task bytes, when the bytes were given. */
  offsets: number[] | null;
}

/**
 * Step two: the task bytes (a path, or the bytes themselves) sealed under
 * the held slot with the inline marker. When the bytes are in hand the
 * commitment is looked for BEFORE the commit, so a task that does not carry
 * it is refused without spending the slot.
 */
export async function sealTask(config: ApiConfig, state: TaskState, task: { path: string } | { bytes: Uint8Array } | { digestB64: string }): Promise<SealedTask> {
  const { slot } = state;
  const commitment = computeSlotCommitment(slot);
  let bytes: Uint8Array | null = null;
  let artifactDigestB64: string;
  if ("digestB64" in task) {
    if (!B64_32.test(task.digestB64)) throw new ApiError(400, "artifact digest must be a base64 SHA-256");
    artifactDigestB64 = task.digestB64;
  } else {
    bytes = "path" in task ? new Uint8Array(await readFile(task.path)) : task.bytes;
    artifactDigestB64 = createHash("sha256").update(bytes).digest("base64");
  }
  const offsets = bytes === null ? null : findCommitment(bytes, commitment, ENCODING_BASE64URL);
  if (offsets !== null && offsets.length === 0) {
    throw new ApiError(400, `the task bytes do not contain the commitment string ${toUrlSafeB64(bytesToBase64(commitment))}; put it in before sealing. Nothing was committed and the slot is still held.`);
  }
  const attribution = inlineAttribution();
  const r = await post(config, "/api/fuse/commit", { digests: [{ digestB64: artifactDigestB64, hashAlg: "sha256" }], slotId: slot.nonceB64, slot, chainId: CHAIN, attribution }, 40_000);
  let proof: BitGraphProof | null = null;
  if (r.status === 200) proof = ((r.json as { proof?: BitGraphProof } | null)?.proof ?? null);
  else if (r.status === 409 || r.status === 503) proof = await recover(config, artifactDigestB64, slot);
  if (proof === null) throw new ApiError(r.status, messageOf(r.json, `commit refused (${r.status})`), r.retryAfterSec);
  if (proof.artifact?.digestB64 !== artifactDigestB64 || proof.commit?.nonceB64 !== slot.nonceB64 || proof.slotAllocation?.nonceB64 !== slot.nonceB64) throw new ApiError(502, "the boundary returned a proof under a different slot; nothing is labelled sealed");
  const a = proof.attribution;
  if (a?.name !== attribution.name || a?.title !== attribution.title || a?.message !== undefined) throw new ApiError(502, "the returned proof does not carry the inline marker that was sent; nothing is labelled sealed");
  const integrity = await verifyProofIntegrity({ proof });
  if (!integrity.valid) throw new ApiError(502, `the returned proof does not verify: ${integrity.reason ?? "unknown reason"}`);
  return { proof, artifactDigestB64, offsets };
}

async function recover(config: ApiConfig, artifactDigestB64: string, slot: SlotAllocation): Promise<BitGraphProof | null> {
  for (let attempt = 0; attempt < 4; attempt++) {
    if (attempt > 0) await new Promise((r) => setTimeout(r, 1500));
    try {
      const res = await fetch(`${config.baseUrl}/api/proofs/${encodeURIComponent(toUrlSafeB64(artifactDigestB64))}`, { headers: { accept: "application/json" }, signal: AbortSignal.timeout(15_000) });
      if (res.status !== 200) continue;
      const j = (await res.json()) as { proofs?: Array<{ proof?: BitGraphProof }> } | null;
      for (const e of j?.proofs ?? []) {
        const p = e.proof;
        if (p && p.artifact?.digestB64 === artifactDigestB64 && p.commit?.nonceB64 === slot.nonceB64) return p;
      }
    } catch { /* try again */ }
  }
  return null;
}

export const TASK_INSTRUCTIONS =
  "You hold a position and its commitment, and no work exists yet. Put the commitment string into the task before you run it: in the prompt or request you are about to send, as a seed, as a line in the document, as text that must appear in the output. " +
  `Then call bitgraph_commit with this fuse_token and the path of the task file (or the SHA-256 of its bytes), within ${SLOT_TTL_SECONDS} seconds of opening: that seals the task under the position before its output exists. ` +
  "Keep those exact bytes: a verifier recomputes the commitment from the proof and looks for the string inside them. " +
  "When the output exists, record it with bitgraph_record; it will sit at a later position. What a stranger can then check: the task could not have existed before the position's floor block, and the output was recorded after it.";
