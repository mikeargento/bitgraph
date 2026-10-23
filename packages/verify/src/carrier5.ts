// Copyright (c) Argento Computing Inc. All rights reserved. See LICENSE.

/**
 * The BitGraphed file, version 5 (2026-10-20): a file that carries its own proof, for proofs made in one atomic action
 * (enclave v11 on). The bytes are the file exactly as it was bound, then the block (carrier.ts framing) holding:
 *
 *   { carrier: "bitgraph-carrier/5", proof, ceilingInTime }
 *
 *   proof          the bitgraph/1 proof as the ledger serves it for these bytes. For a file of a tree (every drop on
 *                  bitgraph.ing from 2026-10-20) it carries, in its unsigned metadata, the file's bitgraph-tree-member/1
 *                  block: its path to the bound root, and the tree's floor leaf, base-block.json (the latest Base block
 *                  read just before the bind).
 *   ceilingInTime  the proof's Base ceiling (bitgraph-ceiling/1: the batch transaction, its block header, the trie and
 *                  Merkle paths), or "unfetched".
 *
 * Checked offline, in this order: the bytes before the block are the bound bytes (directly, or as the member the tree
 * names); the proof is BitGraph's (verifyAttested: signature, atomic counts, AWS Nitro attestation, published image);
 * the floor block is a leaf of the very tree the proof binds, and the attested bind time is after its timestamp; the
 * ceiling's batch holds this proof and its transaction is in the Base block it names. Whether those two Base blocks are
 * on Base's canonical chain is a check against Base (Basescan), not one a file can carry.
 */

import { sha256 } from "@noble/hashes/sha256";
import { CARRIER_VERSION_5, buildCarrier, type CarrierPayload, type CarrierBounds } from "./carrier.js";
import { verifyAttested } from "./attested.js";
import { verifyCeiling, type CeilingSidecar } from "./ceiling.js";
import { checkTreeFloor, treeMemberOf } from "./tree-member.js";
import type { BitGraphProof } from "./types.js";
import type { CarrierClaim, CarrierVerifyResult, ClaimResult } from "./carrier-verify.js";

export const BITGRAPH_CEILING_WRITER_V5 = "0xf3972408D853c975F86351C311f4310220bbF2a3";
const BASE_CHAIN_ID = 8453;

export interface CarrierV5Payload {
  carrier: typeof CARRIER_VERSION_5;
  proof: Record<string, unknown>;
  ceilingInTime: { status: "unfetched" } | { status: "present"; sidecar: Record<string, unknown> };
}

/** The v5 payload for a proof (as the ledger serves it for these bytes) and its ceiling sidecar, if written yet. */
export function assembleCarrierV5Payload(proof: Record<string, unknown>, ceilingSidecar: Record<string, unknown> | null): CarrierV5Payload {
  return { carrier: CARRIER_VERSION_5, proof, ceilingInTime: ceilingSidecar ? { status: "present", sidecar: ceilingSidecar } : { status: "unfetched" } };
}

/** The BitGraphed file: the bound bytes, unchanged, followed by the v5 block. */
export function buildBitGraphedFileV5(bytes: Uint8Array, proof: Record<string, unknown>, ceilingSidecar: Record<string, unknown> | null): Uint8Array {
  return buildCarrier(bytes, assembleCarrierV5Payload(proof, ceilingSidecar) as unknown as CarrierPayload);
}

const hex = (b: Uint8Array) => Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("");
const iso = (s: number) => new Date(s * 1000).toISOString().replace(".000Z", "Z");

export async function verifyCarrierV5(payloadIn: CarrierPayload, inner: Uint8Array | null, opts: { pcr0?: readonly string[]; rootDer?: Uint8Array } = {}): Promise<CarrierVerifyResult> {
  const payload = payloadIn as unknown as CarrierV5Payload;
  const proof = payload.proof as unknown as BitGraphProof;
  const claims: CarrierClaim[] = [];
  const add = (id: string, name: string, result: ClaimResult, restsOn: string, detail: string) => claims.push({ id, name, result, restsOn, detail, level: "offline" });
  const member = treeMemberOf(proof);

  // 1 + 2. The bytes, and the proof: verifyAttested walks a member's hash up its path first, then checks the proof
  // against the root text it signs; plain bytes are checked against the proof's digest.
  const r = await verifyAttested({ proof, ...(inner ? { bytes: inner } : {}), ...(opts.pcr0 ? { pcr0: opts.pcr0 } : {}), ...(opts.rootDer ? { rootDer: opts.rootDer } : {}) });
  if (!inner) add("bytes.digest", "The file is the bound bytes", "NOT_CARRIED", "SHA-256", "no file in hand");
  else if (member) add("tree.member", "The file is in the tree the proof binds", r.treeMember ? "TRUE" : "FALSE", "SHA-256", r.treeMember ? `file ${r.treeMember.index + 1} of ${r.treeMember.files}: its hash walks up the tree to the root the proof binds` : (r.reason ?? "its hash does not reach the root"));
  else add("bytes.digest", "The file is the bound bytes", r.valid || !/digest/.test(r.reason ?? "") ? "TRUE" : "FALSE", "SHA-256", "the bytes before the block hash to the proof's digest");
  for (const c of r.checks) add(`attestation.${c.name.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`, c.name, c.pass ? "TRUE" : "FALSE", "the AWS Nitro attestation", c.detail);
  add("attestation.pins", "The image is one BitGraph published", r.image ? "TRUE" : "FALSE", "BitGraph's published enclave images", r.image ? `PCR0 ${String(r.pcr0).slice(0, 16)}… is the ${r.image.version} image` : `PCR0 ${String(r.pcr0 ?? "").slice(0, 16)}… is not one of BitGraph's`);
  add("proof.signature", "The signature, the nonce's record and the two consecutive counts", r.valid ? "TRUE" : "FALSE", "Ed25519", r.valid ? "the enclave's key signed this body" : (r.reason ?? "did not verify"));

  // 3. The floor: a leaf of the very tree the proof binds, and before the attested bind time.
  let notBefore: CarrierBounds["notBefore"] | null = null;
  if (member?.floor) {
    const f = checkTreeFloor(proof, member);
    const after = f !== null && r.attestedAtMs !== null && r.attestedAtMs >= f.timestamp * 1000;
    add("floor.leaf", "The floor block is a leaf of the tree the proof binds", f ? "TRUE" : "FALSE", "SHA-256", f ? `Base block ${f.number} (${f.hash.slice(0, 12)}…): base-block.json walks up the tree to the bound root, so the bind came after this block existed` : "base-block.json does not reach the bound root");
    if (f) {
      add("floor.time", "The bind came after the floor block's time", after ? "TRUE" : "FALSE", "the AWS Nitro attestation's time", after ? `bound ${iso(Math.floor(r.attestedAtMs! / 1000))}, block ${iso(f.timestamp)}` : "the attested bind time is not after the block's time");
      notBefore = { chain: "base", blockNumber: f.number, blockHash: f.hash, timestamp: f.timestamp };
    }
  }

  // 4. The ceiling: this proof's hash is in the batch the Base transaction carries, and that transaction is in its block.
  let existedBy: CarrierBounds["existedBy"] = null;
  if (payload.ceilingInTime.status === "present") {
    const c = await verifyCeiling(proof, payload.ceilingInTime.sidecar as unknown as CeilingSidecar, { writerAddress: BITGRAPH_CEILING_WRITER_V5, chainId: BASE_CHAIN_ID, proofAlreadyVerified: r.valid });
    const w = c.window?.ceiling;
    add("ceiling.time", "Written to Base, in a batch from BitGraph's writer", c.ok ? "TRUE" : "FALSE", "Base: the batch root, the transaction and the block header", c.ok && w ? `Base block ${w.blockNumber} (${iso(w.blockTimestamp)}): the proof existed by then` : (c.reason ?? "the ceiling does not verify"));
    if (c.ok && w) existedBy = { chain: "base", blockNumber: w.blockNumber, blockHash: w.blockHash, timestamp: w.blockTimestamp };
  } else add("ceiling.time", "Written to Base", "NOT_CARRIED", "", "this file was made before the Base write landed; the ceiling can be looked up by the proof's hash");

  const failed = claims.filter((c) => c.result === "FALSE");
  const verdict: CarrierVerifyResult["verdict"] = failed.length > 0 ? "FALSE" : r.valid ? "TRUE" : "UNDETERMINED";
  const where = member ? `file ${member.index + 1} of a tree of ${member.files}` : "these exact bytes";
  const reading = verdict === "TRUE"
    ? `BitGraph #${proof.commit?.counter}: ${where}, bound by BitGraph's published enclave image ${r.image?.version ?? ""}${notBefore ? ` after Base block ${notBefore.blockNumber}` : ""}${existedBy ? ` and written to Base by block ${existedBy.blockNumber}` : ""}. Check those blocks on Base to place it in real time.`
    : `This BitGraphed file does not check: ${failed.map((c) => c.detail).join("; ") || "the proof did not verify"}.`;
  return {
    verdict, carrier: "ok", version: 5, reasons: claims.filter((c) => c.result !== "TRUE" && c.result !== "NOT_CARRIED").map((c) => c.detail),
    bounds: notBefore ? { notBefore, notAfter: null, existedBy, settledBy: null } : null,
    ceiling: null, claims, reading, payload: payloadIn, inner,
  };
}

/** The bound bytes' SHA-256 as hex (for callers printing the envelope rule). */
export const innerHex = (inner: Uint8Array) => hex(sha256(inner));
