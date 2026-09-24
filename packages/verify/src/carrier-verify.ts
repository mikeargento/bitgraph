// Copyright (c) 2024-2026 Argento Computing Inc. Licensed under the MIT License. See LICENSE.

/**
 * verifyCarrier — the offline read path for a bitgraph-carrier/1 file.
 *
 * Given a carrier and nothing else, it strips the block by structure, hands
 * the committed bytes and every embedded proof to the EXISTING bitgraph/1
 * verifier (verify(), never a second implementation), checks the floor
 * against the proof's own signed slotAnchor by identity, recomputes the
 * block-header witnesses locally, and states the window:
 *
 *   TRUE          every check passed. `bounds.notAfter` may still be null,
 *                 which means NOT FETCHED — a valid floor is never downgraded
 *                 because the ceiling has not been stamped in yet.
 *   FALSE         evidence contradicts a claim: wrong bytes, bad signature,
 *                 a floor that is not the signed one, a ceiling that does not
 *                 follow the commit.
 *   UNDETERMINED  the block is unreadable (corrupted, not forged), or the
 *                 bytes carry no block at all (`carrier: "none"`).
 *
 * No network. Attestation depth (COSE, cert chain to the AWS root) is the
 * audit package's job, as it is for every other proof; this wrapper is the
 * verify()-level judgment plus the carrier bindings.
 */

import { verify, createVerificationContext } from "./verifier.js";
import type { BitGraphProof } from "./types.js";
import {
  parseCarrier, checkFloorBinding, checkCeilingBinding, anchorMessageBytes,
  verifyWitnessHeader, carrierBounds, innerDigestMatches,
  type CarrierBounds, type CarrierPayload,
} from "./carrier.js";

export interface CarrierVerifyResult {
  verdict: "TRUE" | "FALSE" | "UNDETERMINED";
  /** "ok" | "none" | "corrupt" — whether the bytes carried a readable block at all. */
  carrier: "ok" | "none" | "corrupt";
  /** Every failed or undetermined check, in the order met. Empty on a clean TRUE. */
  reasons: string[];
  /** Stated only when the block was readable. notAfter null = NOT FETCHED, in those words. */
  bounds: CarrierBounds | null;
  ceiling: "present" | "unfetched" | null;
  payload: CarrierPayload | null;
  /** The committed bytes, for callers that go on to placement or origin recovery. */
  inner: Uint8Array | null;
}

const FALSE_ = (carrier: "ok", reasons: string[], payload: CarrierPayload, inner: Uint8Array): CarrierVerifyResult => ({
  verdict: "FALSE", carrier, reasons, bounds: carrierBounds(payload), ceiling: payload.ceiling.status, payload, inner,
});

export async function verifyCarrier(bytes: Uint8Array): Promise<CarrierVerifyResult> {
  const parsed = parseCarrier(bytes);
  if (parsed.kind === "none") {
    return { verdict: "UNDETERMINED", carrier: "none", reasons: ["no carrier block: these bytes do not carry a proof inside"], bounds: null, ceiling: null, payload: null, inner: null };
  }
  if (parsed.kind === "corrupt") {
    return { verdict: "UNDETERMINED", carrier: "corrupt", reasons: [`carrier block found but unreadable: ${parsed.reason}. A corrupted block, not a forgery.`], bounds: null, ceiling: null, payload: null, inner: null };
  }
  const { inner, payload } = parsed;
  const reasons: string[] = [];

  // 1. The committed bytes are the ones the proof names.
  if (!innerDigestMatches(inner, payload)) {
    reasons.push("the committed bytes do not hash to the carried proof's artifact digest");
    return FALSE_("ok", reasons, payload, inner);
  }

  // 2. The proof itself, under the existing bitgraph/1 algorithm. A fresh
  //    context: a carrier is judged alone, not against this process's history.
  const proofResult = await verify({ proof: payload.proof as unknown as BitGraphProof, bytes: inner, context: createVerificationContext() });
  if (!proofResult.valid) reasons.push(`the carried proof does not verify: ${proofResult.reason ?? "unspecified"}`);

  // 3. The floor: the anchor proof verifies over its own signed message, and
  //    it is the anchor the enclave signed into the slot, matched by identity.
  const floorMsg = anchorMessageBytes(payload.floor.anchor);
  if (floorMsg.error !== null) reasons.push(`floor anchor: ${floorMsg.error}`);
  else {
    const floorResult = await verify({ proof: payload.floor.anchor as unknown as BitGraphProof, bytes: floorMsg.bytes, context: createVerificationContext() });
    if (!floorResult.valid) reasons.push(`the floor anchor proof does not verify: ${floorResult.reason ?? "unspecified"}`);
  }
  reasons.push(...checkFloorBinding(payload.proof, payload.floor));
  const floorWitness = verifyWitnessHeader(payload.floor.witness);
  if (!floorWitness.ok) reasons.push(`floor witness: ${floorWitness.error}`);

  // 4. The ceiling, only when the carrier claims one.
  if (payload.ceiling.status === "present") {
    const ceilMsg = anchorMessageBytes(payload.ceiling.anchor);
    if (ceilMsg.error !== null) reasons.push(`ceiling anchor: ${ceilMsg.error}`);
    else {
      const ceilResult = await verify({ proof: payload.ceiling.anchor as unknown as BitGraphProof, bytes: ceilMsg.bytes, context: createVerificationContext() });
      if (!ceilResult.valid) reasons.push(`the ceiling anchor proof does not verify: ${ceilResult.reason ?? "unspecified"}`);
    }
    reasons.push(...checkCeilingBinding(payload.proof, payload.ceiling));
    const ceilWitness = verifyWitnessHeader(payload.ceiling.witness);
    if (!ceilWitness.ok) reasons.push(`ceiling witness: ${ceilWitness.error}`);
  }

  if (reasons.length > 0) return FALSE_("ok", reasons, payload, inner);
  return { verdict: "TRUE", carrier: "ok", reasons: [], bounds: carrierBounds(payload), ceiling: payload.ceiling.status, payload, inner };
}
