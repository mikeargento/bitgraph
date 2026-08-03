// Copyright (c) 2024-2026 Mike Argento. Licensed under the MIT License. See LICENSE.

/**
 * Proof to Zap step output.
 *
 * Every value here is read straight off the proof or the ledger's response;
 * nothing is derived, inferred, or computed about the protocol. Output keys
 * mirror the proof's own field names (camelCase, `epochId` and `chainId` as
 * the schema spells them) so that someone reading a proof and someone reading
 * a Zap are reading the same words.
 *
 * Scalars are flattened to the top level because Zapier's field mapper can
 * only offer flat values to later steps. The whole proof object rides along
 * under `proof` for anyone who needs a field this mapping does not surface,
 * and it is passed through verbatim: a proof that has been reshaped no longer
 * verifies.
 */

import { digestForms, toUrlSafeB64 } from "./digest";
import { proofUrl } from "./client";
import type { AnchorView, BitGraphProof, ProofDetailResponse } from "./types";

/**
 * The two-sided Ethereum bracket, named the way the product says it out loud.
 *
 * The API's own naming is inverted relative to the user-facing statement:
 * `anchorBefore` is the EARLIER block, which is the moment the proof was
 * BitGraphed *after*. Exposing the API's names here would invert the meaning
 * for everyone downstream, so the output fields carry the reading, not the
 * internal name.
 */
export interface CausalTime {
  /** ISO time of the earlier anchor: the proof was BitGraphed after this. */
  bitgraphedAfter: string | null;
  /** ISO time of the later anchor: the proof was BitGraphed before this. */
  bitgraphedBefore: string | null;
  /** Ethereum block of the lower bound, the one BitGraphed after. */
  bitgraphedAfterBlock: number | null;
  /** Ethereum block of the upper bound, the one BitGraphed before. */
  bitgraphedBeforeBlock: number | null;
  bitgraphedAfterUrl: string | null;
  bitgraphedBeforeUrl: string | null;
  /** One sentence a Slack or email step can use as-is. */
  causalWindow: string | null;
  /** True once the upper anchor has landed and the window is fixed. */
  anchorSettled: boolean;
}

function anchorTime(a: AnchorView | null | undefined): string | null {
  return a?.blockTime ?? null;
}

export function causalTimeOf(detail: ProofDetailResponse | null): CausalTime {
  const w = detail?.causalWindow ?? null;
  const lower = anchorTime(w?.anchorBefore);
  const upper = anchorTime(w?.anchorAfter);

  // The lower bound alone is still a true statement and is available the
  // instant a proof is minted, because the anchor-first gate guarantees the
  // epoch already has an anchor. The upper bound arrives with the next
  // Ethereum anchor, usually within a minute. Saying so beats a blank field.
  let window: string | null = null;
  if (lower !== null && upper !== null) window = `BitGraphed between ${lower} and ${upper}`;
  else if (lower !== null) window = `BitGraphed after ${lower}, waiting on the next Ethereum anchor for the upper bound`;

  // anchorBefore is the EARLIER block throughout, hence the lower bound.
  return {
    bitgraphedAfter: lower,
    bitgraphedBefore: upper,
    bitgraphedAfterBlock: w?.anchorBefore?.blockNumber ?? null,
    bitgraphedBeforeBlock: w?.anchorAfter?.blockNumber ?? null,
    bitgraphedAfterUrl: w?.anchorBefore?.etherscanUrl ?? null,
    bitgraphedBeforeUrl: w?.anchorAfter?.etherscanUrl ?? null,
    causalWindow: window,
    anchorSettled: upper !== null,
  };
}

export interface ProofFields {
  id: string;
  proofUrl: string;
  artifactHash: string;
  artifactHashHex: string;
  artifactHashUrlSafe: string;
  counter: string | null;
  slotCounter: string | null;
  epochId: string | null;
  epochIdUrlSafe: string | null;
  chainId: string | null;
  proofHash: string | null;
  publicKey: string | null;
  signature: string | null;
  enforcement: string | null;
  measurement: string | null;
  attestationFormat: string | null;
  attributionName: string | null;
  attributionTitle: string | null;
  attributionMessage: string | null;
  proof: BitGraphProof;
}

/**
 * Flatten one proof. `id` is epoch plus counter because that pair, not the
 * digest, names a single recording: the same bytes can be BitGraphed more
 * than once and each time occupies its own causal position.
 */
export function proofFields(base: string, proof: BitGraphProof): ProofFields {
  const digestB64 = proof.artifact?.digestB64 ?? "";
  const forms = digestB64.length > 0 ? digestForms(digestB64) : { digestB64: "", digestUrlSafe: "", digestHex: "" };
  const counter = proof.commit?.counter ?? null;
  const epochId = proof.commit?.epochId ?? null;

  return {
    id: `${epochId !== null ? toUrlSafeB64(epochId) : "unknown"}:${counter ?? "unknown"}`,
    proofUrl: proofUrl(base, digestB64, counter ?? undefined, epochId ?? undefined),
    artifactHash: forms.digestB64,
    artifactHashHex: forms.digestHex,
    artifactHashUrlSafe: forms.digestUrlSafe,
    counter,
    slotCounter: proof.commit?.slotCounter ?? null,
    epochId,
    epochIdUrlSafe: epochId !== null ? toUrlSafeB64(epochId) : null,
    chainId: proof.commit?.chainId ?? null,
    proofHash: proof.proofHash ?? null,
    publicKey: proof.signer?.publicKeyB64 ?? null,
    signature: proof.signer?.signatureB64 ?? null,
    enforcement: proof.environment?.enforcement ?? null,
    measurement: proof.environment?.measurement ?? null,
    attestationFormat: proof.environment?.attestation?.format ?? null,
    attributionName: proof.attribution?.name ?? null,
    attributionTitle: proof.attribution?.title ?? null,
    attributionMessage: proof.attribution?.message ?? null,
    proof,
  };
}

/**
 * The same field set with nothing in it, for outcomes that have no proof
 * (a file that was never recorded).
 *
 * A step whose output keys change shape with the outcome is a trap: a later
 * step maps `counter` from a successful run, then the day a file turns out not
 * to be on record the field vanishes rather than arriving empty, and the Zap
 * breaks at the mapping instead of at the branch the builder wrote. Every path
 * out of these actions returns the same keys.
 */
export function emptyProofFields(digestB64: string): ProofFields {
  const forms = digestB64.length > 0 ? digestForms(digestB64) : { digestB64: "", digestUrlSafe: "", digestHex: "" };
  return {
    id: `${forms.digestUrlSafe}:none`,
    proofUrl: "",
    artifactHash: forms.digestB64,
    artifactHashHex: forms.digestHex,
    artifactHashUrlSafe: forms.digestUrlSafe,
    counter: null,
    slotCounter: null,
    epochId: null,
    epochIdUrlSafe: null,
    chainId: null,
    proofHash: null,
    publicKey: null,
    signature: null,
    enforcement: null,
    measurement: null,
    attestationFormat: null,
    attributionName: null,
    attributionTitle: null,
    attributionMessage: null,
    proof: null as unknown as BitGraphProof,
  };
}

/**
 * Static output field definitions, shown in the Zap editor so a builder can
 * see and map fields before the step has ever run. Zapier merges these with
 * whatever a live sample contains.
 */
export const PROOF_OUTPUT_FIELDS = [
  { key: "proofUrl", label: "Proof URL", type: "string" },
  { key: "artifactHash", label: "Artifact hash (SHA-256, base64)", type: "string" },
  { key: "artifactHashHex", label: "Artifact hash (SHA-256, hex)", type: "string" },
  { key: "counter", label: "Counter (causal position in the epoch)", type: "string" },
  { key: "slotCounter", label: "Slot counter (the position reserved before the hash was known)", type: "string" },
  { key: "epochId", label: "Epoch ID", type: "string" },
  { key: "chainId", label: "Chain ID", type: "string" },
  { key: "proofHash", label: "Proof hash", type: "string" },
  { key: "publicKey", label: "Signing public key", type: "string" },
  { key: "signature", label: "Signature", type: "string" },
  { key: "enforcement", label: "Enforcement tier", type: "string" },
  { key: "measurement", label: "Enclave measurement (PCR0)", type: "string" },
  { key: "attestationFormat", label: "Attestation format", type: "string" },
  {
    key: "bitgraphedAfter",
    label: "BitGraphed after",
    type: "datetime",
    // Deliberately not called a timestamp. A BitGraph proof contains no clock
    // reading; time comes from the Ethereum blocks that bracket it.
  },
  { key: "bitgraphedBefore", label: "BitGraphed before", type: "datetime" },
  { key: "bitgraphedAfterBlock", label: "Lower bound Ethereum block", type: "integer" },
  { key: "bitgraphedBeforeBlock", label: "Upper bound Ethereum block", type: "integer" },
  { key: "causalWindow", label: "Causal window (one sentence)", type: "string" },
  { key: "anchorSettled", label: "Anchor settled (upper bound has landed)", type: "boolean" },
  { key: "totalPositions", label: "Total causal positions for these bytes", type: "integer" },
] as const;
