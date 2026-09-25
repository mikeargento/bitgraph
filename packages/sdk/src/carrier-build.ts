// Copyright (c) 2024-2026 Argento Computing Inc. Licensed under the MIT License. See LICENSE.

/**
 * Building the BitGraphed file (bitgraph-carrier/1) from the committed bytes
 * in hand: the proof is fetched by digest, the floor anchor is matched BY
 * IDENTITY to the anchor the enclave signed into the slot, the first later
 * anchor closes the window when it exists, and every anchor is verified
 * (its proof over its own signed message, its block-header witness) before
 * it is embedded. Nothing unvetted travels.
 *
 * The ceiling can only ever be carried, never fused: it does not exist when
 * the bytes are committed. A file whose ceiling has not landed yet says so
 * in those words ("unfetched") and can be completed later from public data;
 * completion never overwrites a ceiling already inside.
 */

import { createHash } from "node:crypto";
import {
  verify, createVerificationContext,
  buildCarrier, parseCarrier, completeCarrier as completeCarrierBlock,
  checkFloorBinding, checkCeilingBinding, anchorMessageBytes, verifyWitnessHeader,
  type CarrierPayload, type CarrierProof, type CarrierWitness, type CarrierCeiling,
} from "@mikeargento/bitgraph-verify";
import { ApiError, getProofDetail, type ApiConfig } from "./api.js";
import { toUrlSafeB64 } from "./encoding.js";
import type { BitGraphProof } from "./types.js";

interface AnchorSide {
  anchor: CarrierProof;
  witness: CarrierWitness;
}

async function getJson(config: ApiConfig, path: string, timeoutMs: number): Promise<unknown> {
  const res = await fetch(`${config.baseUrl}${path}`, { headers: { accept: "application/json" }, signal: AbortSignal.timeout(timeoutMs) });
  if (res.status !== 200) throw new ApiError(res.status, `GET ${path} answered ${res.status}`);
  return (await res.json()) as unknown;
}

/** Verify an anchor proof over its own signed block-hash message, plus its header witness. Throws on any failure: unvetted evidence is never embedded. */
async function vetAnchor(anchor: CarrierProof, witness: CarrierWitness, label: string): Promise<void> {
  const msg = anchorMessageBytes(anchor);
  if (msg.error !== null) throw new ApiError(502, `${label} anchor: ${msg.error}`);
  const r = await verify({ proof: anchor as unknown as Parameters<typeof verify>[0]["proof"], bytes: msg.bytes, context: createVerificationContext() });
  if (!r.valid) throw new ApiError(502, `${label} anchor proof does not verify: ${r.reason ?? "unspecified"}`);
  const w = verifyWitnessHeader(witness);
  if (!w.ok) throw new ApiError(502, `${label} witness: ${w.error}`);
}

async function fetchWitness(config: ApiConfig, blockNumber: number, blockHash: string): Promise<CarrierWitness> {
  const j = (await getJson(config, `/api/proofs/witness?block=${blockNumber}&hash=${encodeURIComponent(blockHash)}`, 20_000)) as { witness?: CarrierWitness } | null;
  const w = j?.witness;
  if (!w || typeof w !== "object") throw new ApiError(502, `no witness for block ${blockNumber}`);
  return w;
}

async function fetchAnchorSide(
  config: ApiConfig, counter: string, epochId: string, side: "before" | "after"
): Promise<{ found: AnchorSide | null; pending: boolean }> {
  const q = side === "before" ? "before=1" : "limit=1";
  const j = (await getJson(config, `/api/proofs/anchors?counter=${encodeURIComponent(counter)}&epoch=${encodeURIComponent(epochId)}&${q}`, 20_000)) as
    | { anchors?: CarrierProof[]; bound?: { state?: string } }
    | null;
  const pending = j?.bound?.state === "pending";
  const anchor = j?.anchors?.[0];
  if (!anchor) return { found: null, pending };
  const a = anchor as { metadata?: { anchor?: { blockNumber?: number; blockHash?: string } } };
  const blockNumber = a.metadata?.anchor?.blockNumber;
  const blockHash = a.metadata?.anchor?.blockHash;
  if (typeof blockNumber !== "number" || typeof blockHash !== "string") throw new ApiError(502, `the ${side} anchor names no block`);
  const witness = await fetchWitness(config, blockNumber, blockHash);
  return { found: { anchor, witness }, pending };
}

export interface BuiltCarrier {
  bytes: Uint8Array;
  fileName: string;
  ceiling: "present" | "unfetched";
}

/** photo.jpg -> photo.bitgraph.jpg; a name with no extension gets ".bitgraph" appended. */
export function carrierFileName(name: string): string {
  const dot = name.lastIndexOf(".");
  return dot > 0 ? `${name.slice(0, dot)}.bitgraph${name.slice(dot)}` : `${name}.bitgraph`;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * The committed bytes in hand become the file that carries its own proof.
 * The proof is fetched by the bytes' digest (they must already be on
 * record); the floor is the anchor the slot names, matched by identity; the
 * ceiling is the first later anchor, waited for up to `waitForCeilingMs`
 * only while the window is genuinely pending.
 */
export async function buildBitGraphedFile(
  config: ApiConfig,
  committedBytes: Uint8Array,
  fileName: string,
  opts?: { waitForCeilingMs?: number; proof?: BitGraphProof }
): Promise<BuiltCarrier> {
  const digestB64 = createHash("sha256").update(committedBytes).digest("base64");
  let proof = opts?.proof ?? null;
  if (proof === null) {
    const detail = await getProofDetail(config, toUrlSafeB64(digestB64));
    proof = detail.proofs.find((p) => p.proof.artifact?.digestB64 === digestB64)?.proof ?? detail.proofs[0]?.proof ?? null;
  }
  if (proof === null) throw new ApiError(404, `these bytes are not on record (digest ${toUrlSafeB64(digestB64)}); record them first`);
  if (proof.artifact?.digestB64 !== digestB64) throw new ApiError(400, "the fetched proof names a different artifact than these bytes");
  const commit = proof.commit;
  const counter = commit?.counter;
  const epochId = commit?.epochId;
  if (typeof counter !== "string" || typeof epochId !== "string") throw new ApiError(502, "the proof carries no position to bracket");

  const floor = (await fetchAnchorSide(config, counter, epochId, "before")).found;
  if (floor === null) throw new ApiError(502, "no floor anchor is available for this position");
  await vetAnchor(floor.anchor, floor.witness, "floor");
  const floorProblems = checkFloorBinding(proof as unknown as CarrierPayload["proof"], { status: "present", anchor: floor.anchor, witness: floor.witness });
  if (floorProblems.length > 0) throw new ApiError(502, `floor binding: ${floorProblems.join("; ")}`);

  let ceiling: CarrierCeiling = { status: "unfetched" };
  const waitMs = opts?.waitForCeilingMs ?? 0;
  const deadline = Date.now() + waitMs;
  for (;;) {
    const { found: after, pending } = await fetchAnchorSide(config, counter, epochId, "after");
    if (after !== null) {
      await vetAnchor(after.anchor, after.witness, "ceiling");
      const candidate: CarrierCeiling = { status: "present", basis: "counter-order", anchor: after.anchor, witness: after.witness };
      const problems = checkCeilingBinding(proof as unknown as CarrierPayload["proof"], candidate);
      if (problems.length > 0) throw new ApiError(502, `ceiling binding: ${problems.join("; ")}`);
      ceiling = candidate;
      break;
    }
    if (!pending || Date.now() + 2_000 > deadline) break;
    await sleep(2_000);
  }

  const payload: CarrierPayload = {
    carrier: "bitgraph-carrier/1",
    proof: proof as unknown as CarrierPayload["proof"],
    floor: { status: "present", anchor: floor.anchor, witness: floor.witness },
    ceiling,
  };
  return { bytes: buildCarrier(committedBytes, payload), fileName: carrierFileName(fileName), ceiling: ceiling.status };
}

export interface CompletedCarrier {
  bytes: Uint8Array;
  changed: boolean;
  ceiling: "present" | "unfetched";
}

/**
 * Fetch the closing anchor into an existing BitGraphed file. A ceiling
 * already inside is never overwritten; a window still open comes back
 * unchanged with its state stated.
 */
export async function completeBitGraphedFile(config: ApiConfig, carrierBytes: Uint8Array, opts?: { waitForCeilingMs?: number }): Promise<CompletedCarrier> {
  const parsed = parseCarrier(carrierBytes);
  if (parsed.kind !== "carrier") throw new ApiError(400, parsed.kind === "corrupt" ? `unreadable carrier block: ${parsed.reason}` : "these bytes carry no proof inside");
  if (parsed.payload.ceiling.status === "present") return { bytes: carrierBytes, changed: false, ceiling: "present" };
  const commit = (parsed.payload.proof as { commit?: { counter?: string; epochId?: string } }).commit;
  if (typeof commit?.counter !== "string" || typeof commit?.epochId !== "string") throw new ApiError(400, "the carried proof carries no position");

  const waitMs = opts?.waitForCeilingMs ?? 0;
  const deadline = Date.now() + waitMs;
  for (;;) {
    const { found: after, pending } = await fetchAnchorSide(config, commit.counter, commit.epochId, "after");
    if (after !== null) {
      await vetAnchor(after.anchor, after.witness, "ceiling");
      const problems = checkCeilingBinding(parsed.payload.proof, { status: "present", basis: "counter-order", anchor: after.anchor, witness: after.witness });
      if (problems.length > 0) throw new ApiError(502, `ceiling binding: ${problems.join("; ")}`);
      const done = completeCarrierBlock(carrierBytes, { anchor: after.anchor, witness: after.witness });
      return { bytes: done.bytes, changed: done.changed, ceiling: "present" };
    }
    if (!pending || Date.now() + 2_000 > deadline) break;
    await sleep(2_000);
  }
  return { bytes: carrierBytes, changed: false, ceiling: "unfetched" };
}
