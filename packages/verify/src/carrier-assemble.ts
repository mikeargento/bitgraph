// Copyright (c) 2024-2026 Argento Computing Inc. Licensed under the MIT License. See LICENSE.

/**
 * Assemble a bitgraph-carrier/2 payload from vetted parts. The caller has
 * already verified every part (the anchors over their messages, the headers
 * by hash, the Base sidecar with verifyCeiling); this lays them out, derives
 * the attestation witness from the proof's own document, and declares the
 * pins the file was made under. It computes nothing that a verifier would
 * later trust: the witness is recomputed on read, the pins compared.
 */

import { CARRIER_VERSION_2, encodeCarrierBlock, type CarrierPayload, type CarrierFloor, type CarrierCeiling, type CarrierCeilingInTime, type CarrierSettlement, type CarrierPins, type CarrierProof } from "./carrier.js";
import { attestationWitness } from "./nitro.js";
import { computeProofHash, computeSignedBodyHash } from "./proof-hash.js";
import { BITGRAPH_CEILING_WRITER, BASE_MAINNET_CHAIN_ID } from "./carrier-verify.js";
import type { BitGraphProof } from "./types.js";

export interface CarrierV2Parts {
  proof: CarrierProof;
  floor: CarrierFloor;
  ceiling: CarrierCeiling;
  ceilingInTime: CarrierCeilingInTime;
  settlement?: CarrierSettlement;
  /** Overrides for the declared pins; defaults to the proof's measurement, BitGraph's ceiling writer, Ethereum mainnet and Base mainnet. */
  pins?: Partial<CarrierPins>;
  /** Set false to leave the openssl witness out (a ZIP-family file whose block would pass the limit). Default true when the proof carries an aws-nitro attestation. */
  withAttestationWitness?: boolean;
}

/**
 * A ZIP-family file (docx, xlsx, pptx, zip) stops opening once the trailing
 * block passes about 65,300 bytes, because its end-of-archive record must sit
 * within the last 64 KiB. Builders keep every block under this, dropping the
 * attestation witness first (it is derivable from the proof) and refusing the
 * carrier otherwise.
 */
export const CARRIER_BLOCK_ZIP_LIMIT = 60_000;

export function assembleCarrierV2Payload(parts: CarrierV2Parts): CarrierPayload {
  const proof = parts.proof as unknown as BitGraphProof;
  const att = proof.environment?.attestation;
  const wantWitness = parts.withAttestationWitness ?? (att?.format === "aws-nitro" && typeof att.reportB64 === "string");
  const pins: CarrierPins = {
    pcr0: proof.environment?.measurement,
    ceilingWriter: BITGRAPH_CEILING_WRITER,
    chains: { ethereum: 1, base: BASE_MAINNET_CHAIN_ID },
    ...(parts.pins ?? {}),
  };
  const payload: CarrierPayload = {
    carrier: CARRIER_VERSION_2,
    proof: parts.proof,
    floor: parts.floor,
    ceiling: parts.ceiling,
    ceilingInTime: parts.ceilingInTime,
    ...(parts.settlement ? { settlement: parts.settlement } : {}),
    pins,
  };
  if (wantWitness && att && typeof att.reportB64 === "string") {
    const signedBodyHashB64 = computeSignedBodyHash(proof);
    const proofHashB64 = computeProofHash(proof);
    payload.attestation = attestationWitness(att.reportB64, {
      pcr0: proof.environment.measurement,
      signedBodyHashB64,
      ...(proofHashB64 === signedBodyHashB64 ? { proofHashB64 } : {}),
    }) as unknown as Record<string, unknown>;
  }
  return payload;
}

/** The size the block will have on disk for this payload. */
export function carrierBlockSize(payload: CarrierPayload): number {
  return encodeCarrierBlock(payload).length;
}
