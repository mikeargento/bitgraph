// Copyright (c) 2024-2026 Argento Computing Inc. Licensed under the MIT License. See LICENSE.

/**
 * Building the BitGraphed file (bitgraph-carrier/2) from the committed bytes
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
 *
 * /2 (2026-09-30) adds the ceiling in TIME (the Base sidecar the site serves
 * at /api/ceilings/<proofHash>, verified with verifyCeiling before it travels),
 * the attestation laid out as an openssl-checkable witness, and the declared
 * pins. A ZIP-family file keeps its block under the 64 KiB its end record can
 * be found behind: the witness is dropped first, and a block still too large
 * is refused rather than written into a file that would not open.
 *
 * /3 (2026-10-06, enclave v10) is built for a proof whose floor is a Base block
 * (commit.slotFloor): the floor is that block's header, from the caller or
 * from a Base node by height, checked against the signed floor (hash, number,
 * time) before it travels. No anchor is fetched on either side: there is no
 * anchor under a Base floor and no ceiling in position after it; the order
 * among BitGraphs is the chain of proof hashes. Ethereum-floor proofs are
 * still built as /2.
 */

import { createHash } from "node:crypto";
import {
  verify, createVerificationContext,
  buildCarrier, parseCarrier, completeCarrier as completeCarrierBlock, completeCarrierInTime, carrierVersionOf,
  checkFloorBinding, checkCeilingBinding, anchorMessageBytes, verifyWitnessHeader, anchorMarkOf,
  verifyCeiling, assembleCarrierV2Payload, assembleCarrierV3Payload, carrierBlockSize, CARRIER_BLOCK_ZIP_LIMIT, BITGRAPH_CEILING_WRITER, BASE_MAINNET_CHAIN_ID,
  computeProofHash, signedFloorOf, checkFloorHeader, headerRlpFromRpc, evmHexToBytes, evmBytesToHex,
  type CarrierPayload, type CarrierProof, type CarrierWitness, type CarrierCeiling, type CarrierCeilingInTime,
  type CarrierV2Parts, type CarrierV3Parts, type RpcBlockHeader, type SignedFloor,
} from "@mikeargento/bitgraph-verify";
import { settlementFromSidecar, completeCarrierSettlement } from "@mikeargento/bitgraph-verify";
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
  // The site's route answers with the bitgraph-anchor-witness/1 object itself.
  // 0.1.0 read it from a { witness } envelope that the route never sends, so
  // every build against bitgraph.ing failed here; the envelope stays accepted.
  const j = (await getJson(config, `/api/proofs/witness?block=${blockNumber}&hash=${encodeURIComponent(blockHash)}`, 20_000)) as
    | (Partial<CarrierWitness> & { witness?: CarrierWitness })
    | null;
  const w = j?.witness ?? (typeof j?.headerRlpHex === "string" ? (j as CarrierWitness) : undefined);
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
  // The block the anchor signed (its commit mark) names the witness to fetch;
  // the unsigned metadata copy is only the fallback for an anchor without one.
  const mark = anchorMarkOf(anchor);
  const a = anchor as { metadata?: { anchor?: { blockNumber?: number; blockHash?: string } } };
  const blockNumber = mark?.blockNumber ?? a.metadata?.anchor?.blockNumber;
  const blockHash = mark?.blockHash ?? a.metadata?.anchor?.blockHash;
  if (typeof blockNumber !== "number" || typeof blockHash !== "string") throw new ApiError(502, `the ${side} anchor names no block`);
  const witness = await fetchWitness(config, blockNumber, blockHash);
  return { found: { anchor, witness }, pending };
}

export interface BuiltCarrier {
  bytes: Uint8Array;
  fileName: string;
  /** The ceiling in position: the next anchor. "none" on a /3 file (a Base floor): none exists, order is the chain of proof hashes. */
  ceiling: "present" | "unfetched" | "none";
  /** The ceiling in time: the Base block the record existed by. */
  ceilingInTime: "present" | "unfetched";
  /** Whether the openssl attestation witness is inside (left out only to keep a ZIP-family file under its limit). */
  witness: boolean;
}

/** photo.jpg -> photo.bitgraph.jpg; a name with no extension gets ".bitgraph" appended. */
export function carrierFileName(name: string): string {
  const dot = name.lastIndexOf(".");
  return dot > 0 ? `${name.slice(0, dot)}.bitgraph${name.slice(dot)}` : `${name}.bitgraph`;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** PK\x03\x04: a ZIP-family file (zip, docx, xlsx, pptx, jar), whose reader must find its end record within the last 64 KiB. */
function isZipFamily(bytes: Uint8Array): boolean {
  return bytes.length >= 4 && bytes[0] === 0x50 && bytes[1] === 0x4b && bytes[2] === 0x03 && bytes[3] === 0x04;
}

/**
 * The ceiling in time for a proof, from the site, verified before it travels.
 * null with pending=true when the writer has not written one yet (404, or a
 * sidecar still without a transaction).
 */
async function fetchCeilingInTime(config: ApiConfig, proof: BitGraphProof): Promise<{ sidecar: Record<string, unknown> | null; pending: boolean }> {
  const ph = (proof as { proofHash?: string }).proofHash ?? computeProofHash(proof);
  const res = await fetch(`${config.baseUrl}/api/ceilings/${encodeURIComponent(toUrlSafeB64(ph))}`, { headers: { accept: "application/json" }, signal: AbortSignal.timeout(20_000) });
  if (res.status === 404) return { sidecar: null, pending: true };
  if (res.status !== 200) throw new ApiError(res.status, `the ceiling read answered ${res.status}`);
  const sidecar = (await res.json()) as Record<string, unknown>;
  const r = await verifyCeiling(proof as never, sidecar as never, { writerAddress: BITGRAPH_CEILING_WRITER, chainId: BASE_MAINNET_CHAIN_ID });
  if (!r.ok) {
    if (r.status === "pending") return { sidecar: null, pending: true };
    throw new ApiError(502, `ceiling in time: ${r.reason ?? "does not verify"}`);
  }
  return { sidecar, pending: false };
}

/** The block for these parts (/2, or /3 for a Base floor), under the ZIP limit when the bytes are a ZIP-family file. Throws when it cannot be. */
function payloadWithinLimits(committedBytes: Uint8Array, parts: { v: 2; parts: CarrierV2Parts } | { v: 3; parts: CarrierV3Parts }): { payload: CarrierPayload; witness: boolean } {
  const assemble = (withAttestationWitness?: boolean) => {
    const extra = withAttestationWitness === undefined ? {} : { withAttestationWitness };
    return parts.v === 3 ? assembleCarrierV3Payload({ ...parts.parts, ...extra }) : assembleCarrierV2Payload({ ...parts.parts, ...extra });
  };
  let payload = assemble();
  let witness = payload.attestation !== undefined;
  if (isZipFamily(committedBytes) && carrierBlockSize(payload) > CARRIER_BLOCK_ZIP_LIMIT) {
    payload = assemble(false);
    witness = false;
    if (carrierBlockSize(payload) > CARRIER_BLOCK_ZIP_LIMIT) {
      throw new ApiError(413, `the proof block (${carrierBlockSize(payload)} bytes) would pass the 64 KiB a ZIP-family file can carry after its end record; keep the proof beside the file instead`);
    }
  }
  return { payload, witness };
}

/**
 * The committed bytes in hand become the file that carries its own proof.
 * The proof is fetched by the bytes' digest (they must already be on
 * record); the floor is the anchor the slot names, matched by identity; the
 * ceilings (the first later anchor, and the Base block) are waited for up to
 * `waitForCeilingMs` only while genuinely pending.
 */
/**
 * A Base floor's header, checked against the floor the proof signs: the
 * caller's own (0x hex), else the Base node's block at the signed height,
 * rebuilt from its JSON and kept only when it hashes to the signed hash.
 * Throws when neither is that block: an unchecked floor never travels.
 */
async function baseFloorHeader(signed: SignedFloor, opts: { floorHeader?: string; baseRpcUrl?: string }): Promise<string> {
  let hex = opts.floorHeader ?? null;
  if (hex === null) {
    const url = opts.baseRpcUrl ?? DEFAULT_BASE_RPC;
    const res = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json", accept: "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "eth_getBlockByNumber", params: [`0x${signed.blockNumber.toString(16)}`, false] }),
      signal: AbortSignal.timeout(20_000),
    });
    if (res.status !== 200) throw new ApiError(502, `the Base node answered ${res.status} for floor block ${signed.blockNumber}`);
    const block = ((await res.json()) as { result?: RpcBlockHeader | null } | null)?.result ?? null;
    const rlp = headerRlpFromRpc(block, signed.blockHash);
    if (rlp === null) throw new ApiError(502, `the Base node's block ${signed.blockNumber} is not the floor block the proof signs`);
    hex = evmBytesToHex(rlp);
  }
  let raw: Uint8Array;
  try { raw = evmHexToBytes(hex); } catch { throw new ApiError(400, "the floor header is not hex"); }
  const r = checkFloorHeader(signed, raw, "base");
  if (!r.ok) throw new ApiError(502, `floor header: ${r.reason}`);
  return hex.toLowerCase().startsWith("0x") ? hex.toLowerCase() : `0x${hex.toLowerCase()}`;
}

const DEFAULT_BASE_RPC = "https://mainnet.base.org";

export async function buildBitGraphedFile(
  config: ApiConfig,
  committedBytes: Uint8Array,
  fileName: string,
  opts?: {
    waitForCeilingMs?: number;
    proof?: BitGraphProof;
    /** A Base floor's header (0x hex RLP) in hand; checked against the signed floor like any other. */
    floorHeader?: string;
    /** The Base node asked for a Base floor's header when none is given. Default https://mainnet.base.org. */
    baseRpcUrl?: string;
  }
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
  let signed: SignedFloor | null;
  try {
    signed = signedFloorOf(proof as unknown as Parameters<typeof signedFloorOf>[0]);
  } catch (e) {
    throw new ApiError(502, (e as Error).message);
  }
  if (signed?.chain === "base") return buildBaseFloorFile(config, committedBytes, fileName, proof, signed, opts ?? {});

  // The floor is the anchor the enclave fixed when it allocated the position, so it is
  // the anchor before the RESERVED position, never the one before the commit. For
  // a position held while an anchor landed they differ, and 0.1.0 asked with the
  // commit counter, fetched the later anchor, and checkFloorBinding refused it.
  const floorAt = typeof commit?.slotCounter === "string" ? commit.slotCounter : counter;
  const floor = (await fetchAnchorSide(config, floorAt, epochId, "before")).found;
  if (floor === null) throw new ApiError(502, "no floor anchor is available for this position");
  await vetAnchor(floor.anchor, floor.witness, "floor");
  const floorProblems = checkFloorBinding(proof as unknown as CarrierPayload["proof"], { status: "present", anchor: floor.anchor, witness: floor.witness });
  if (floorProblems.length > 0) throw new ApiError(502, `floor binding: ${floorProblems.join("; ")}`);

  let ceiling: CarrierCeiling = { status: "unfetched" };
  let ceilingInTime: CarrierCeilingInTime = { status: "unfetched" };
  const waitMs = opts?.waitForCeilingMs ?? 0;
  const deadline = Date.now() + waitMs;
  for (;;) {
    if (ceiling.status !== "present") {
      const { found: after, pending } = await fetchAnchorSide(config, counter, epochId, "after");
      if (after !== null) {
        await vetAnchor(after.anchor, after.witness, "ceiling");
        const candidate: CarrierCeiling = { status: "present", basis: "counter-order", anchor: after.anchor, witness: after.witness };
        const problems = checkCeilingBinding(proof as unknown as CarrierPayload["proof"], candidate);
        if (problems.length > 0) throw new ApiError(502, `ceiling binding: ${problems.join("; ")}`);
        ceiling = candidate;
      } else if (!pending) ceiling = { status: "unfetched" };
    }
    if (ceilingInTime.status !== "present") {
      const { sidecar, pending } = await fetchCeilingInTime(config, proof);
      if (sidecar !== null) ceilingInTime = { status: "present", sidecar };
      else if (!pending) ceilingInTime = { status: "unfetched", searched: { at: new Date().toISOString() } };
    }
    if ((ceiling.status === "present" && ceilingInTime.status === "present") || Date.now() + 2_000 > deadline) break;
    await sleep(2_000);
  }
  if (ceilingInTime.status === "unfetched" && !ceilingInTime.searched) ceilingInTime = { status: "unfetched", searched: { at: new Date().toISOString() } };

  // The Ethereum settlement rides with the ceiling it settles, once the writer has attached it.
  const settlement = settlementFromSidecar(ceilingInTime.status === "present" ? ceilingInTime.sidecar : null);
  const { payload, witness } = payloadWithinLimits(committedBytes, { v: 2, parts: {
    proof: proof as unknown as CarrierProof,
    floor: { status: "present", anchor: floor.anchor, witness: floor.witness },
    ceiling,
    ceilingInTime,
    ...(settlement ? { settlement } : {}),
  } });
  return { bytes: buildCarrier(committedBytes, payload), fileName: carrierFileName(fileName), ceiling: ceiling.status === "present" ? "present" : "unfetched", ceilingInTime: ceilingInTime.status, witness };
}

/** /3: a Base floor. The header is checked against the signed floor; only the ceiling in time is waited for. */
async function buildBaseFloorFile(
  config: ApiConfig, committedBytes: Uint8Array, fileName: string, proof: BitGraphProof, signed: SignedFloor,
  opts: { waitForCeilingMs?: number; floorHeader?: string; baseRpcUrl?: string },
): Promise<BuiltCarrier> {
  const header = await baseFloorHeader(signed, opts);
  let ceilingInTime: CarrierCeilingInTime = { status: "unfetched" };
  const deadline = Date.now() + (opts.waitForCeilingMs ?? 0);
  for (;;) {
    const { sidecar, pending } = await fetchCeilingInTime(config, proof);
    if (sidecar !== null) ceilingInTime = { status: "present", sidecar };
    else if (!pending) ceilingInTime = { status: "unfetched", searched: { at: new Date().toISOString() } };
    if (ceilingInTime.status === "present" || Date.now() + 2_000 > deadline) break;
    await sleep(2_000);
  }
  if (ceilingInTime.status === "unfetched" && !ceilingInTime.searched) ceilingInTime = { status: "unfetched", searched: { at: new Date().toISOString() } };
  const settlement = settlementFromSidecar(ceilingInTime.status === "present" ? ceilingInTime.sidecar : null);
  const { payload, witness } = payloadWithinLimits(committedBytes, { v: 3, parts: {
    proof: proof as unknown as CarrierProof,
    floor: { status: "present", basis: "base-header", header },
    ceilingInTime,
    ...(settlement ? { settlement } : {}),
  } });
  return { bytes: buildCarrier(committedBytes, payload), fileName: carrierFileName(fileName), ceiling: "none", ceilingInTime: ceilingInTime.status, witness };
}

export interface CompletedCarrier {
  bytes: Uint8Array;
  changed: boolean;
  /** "none" on a /3 file: no ceiling in position exists for a Base floor. */
  ceiling: "present" | "unfetched" | "none";
  /** "n/a" on a bitgraph-carrier/1 file, which has no such field. */
  ceilingInTime: "present" | "unfetched" | "n/a";
}

/**
 * Fetch what followed the commit into an existing BitGraphed file: the
 * closing anchor, and (on a /2 file) the Base block. Whatever is already
 * inside is never overwritten; a window still open comes back unchanged with
 * its state stated.
 */
export async function completeBitGraphedFile(config: ApiConfig, carrierBytes: Uint8Array, opts?: { waitForCeilingMs?: number }): Promise<CompletedCarrier> {
  let parsed = parseCarrier(carrierBytes);
  if (parsed.kind !== "carrier") throw new ApiError(400, parsed.kind === "corrupt" ? `unreadable carrier block: ${parsed.reason}` : "these bytes carry no proof inside");
  // v2 and v3 both carry the ceiling in time; v3 has no ceiling in position to fetch.
  const v2 = carrierVersionOf(parsed.payload) >= 2;
  const commit = (parsed.payload.proof as { commit?: { counter?: string; epochId?: string } }).commit;
  if (typeof commit?.counter !== "string" || typeof commit?.epochId !== "string") throw new ApiError(400, "the carried proof carries no position");

  let bytes = carrierBytes;
  let changed = false;
  const waitMs = opts?.waitForCeilingMs ?? 0;
  const deadline = Date.now() + waitMs;
  for (;;) {
    let stillPending = false;
    if (parsed.payload.ceiling.status === "unfetched") {
      const { found: after, pending } = await fetchAnchorSide(config, commit.counter, commit.epochId, "after");
      if (after !== null) {
        await vetAnchor(after.anchor, after.witness, "ceiling");
        const problems = checkCeilingBinding(parsed.payload.proof, { status: "present", basis: "counter-order", anchor: after.anchor, witness: after.witness });
        if (problems.length > 0) throw new ApiError(502, `ceiling binding: ${problems.join("; ")}`);
        const done = completeCarrierBlock(bytes, { anchor: after.anchor, witness: after.witness });
        if (done.error) throw new ApiError(409, done.error);
        bytes = done.bytes; changed ||= done.changed;
      } else stillPending ||= pending;
    }
    if (v2 && (parsed.payload.ceilingInTime?.status !== "present" || !parsed.payload.settlement)) {
      const needsTime = parsed.payload.ceilingInTime?.status !== "present";
      const { sidecar, pending } = await fetchCeilingInTime(config, parsed.payload.proof as unknown as BitGraphProof);
      if (sidecar !== null) {
        if (needsTime) {
          const done = completeCarrierInTime(bytes, sidecar);
          if (done.error) throw new ApiError(409, done.error);
          bytes = done.bytes; changed ||= done.changed;
        }
        // A settlement missing is not pending: the writer attaches it when the batch is found on Ethereum.
        const st = settlementFromSidecar(sidecar);
        if (st) {
          const done = completeCarrierSettlement(bytes, st.pointer);
          if (!done.error) { bytes = done.bytes; changed ||= done.changed; }
        }
      } else if (needsTime) stillPending ||= pending;
    }
    const again = parseCarrier(bytes);
    if (again.kind !== "carrier") throw new ApiError(500, "the completed block does not parse");
    parsed = again;
    const complete = parsed.payload.ceiling.status !== "unfetched" && (!v2 || parsed.payload.ceilingInTime?.status === "present");
    if (complete || !stillPending || Date.now() + 2_000 > deadline) break;
    await sleep(2_000);
  }
  return {
    bytes,
    changed,
    ceiling: parsed.payload.ceiling.status,
    ceilingInTime: v2 ? (parsed.payload.ceilingInTime?.status === "present" ? "present" : "unfetched") : "n/a",
  };
}
