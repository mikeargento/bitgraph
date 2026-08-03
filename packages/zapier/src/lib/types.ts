// Copyright (c) 2024-2026 Mike Argento. Licensed under the MIT License. See LICENSE.

/**
 * Wire types: minimal views of the bitgraph/1 schema and the bitgraph.ing API
 * responses. The canonical, fully documented schema lives in
 * @mikeargento/bitgraph-verify, which this connector depends on rather than
 * restating. Fields the connector does not read stay `unknown`, and proofs are
 * passed through verbatim in the `proof` output field.
 */

export interface ProofCommit {
  counter?: string;
  slotCounter?: string;
  epochId?: string;
  chainId?: string;
  nonceB64?: string;
  prevB64?: string;
  slotHashB64?: string;
  [k: string]: unknown;
}

export interface BitGraphProof {
  version?: string;
  artifact?: { hashAlg?: string; digestB64?: string };
  commit?: ProofCommit;
  signer?: { publicKeyB64?: string; signatureB64?: string };
  environment?: {
    enforcement?: string;
    measurement?: string;
    attestation?: { format?: string; reportB64?: string };
  };
  attribution?: { name?: string; title?: string; message?: string };
  slotAllocation?: Record<string, unknown>;
  proofHash?: string;
  [k: string]: unknown;
}

/** POST /api/proofs/batch response, keyed by the digest exactly as sent (URL-safe). */
export interface BatchCheckResponse {
  results: Record<string, { proofs: Array<{ proof: BitGraphProof }> }>;
}

export interface AnchorView {
  counter?: string;
  attrName?: string;
  blockNumber?: number | null;
  blockHash?: string | null;
  etherscanUrl?: string | null;
  blockTime?: string | null;
}

export interface PositionView {
  counter: string | null;
  epoch: string | null;
  lowerTime: string | null;
  upperTime: string | null;
}

/**
 * GET /api/proofs/digest/{digest} response.
 *
 * causalWindow naming inversion, which the whole product depends on:
 * anchorBefore is the EARLIER Ethereum block, so the proof was BitGraphed
 * after it and that is the LOWER time bound. anchorAfter is the LATER block,
 * the UPPER bound. Present as "BitGraphed between lower and upper", never as
 * a single timestamp.
 */
export interface ProofDetailResponse {
  proofs: Array<{ proof: BitGraphProof }>;
  positions?: PositionView[];
  causalWindow?: { anchorBefore: AnchorView | null; anchorAfter: AnchorView | null } | null;
  anchorBlock?: AnchorView | null;
}

/** GET /api/search response. */
export interface SearchResponse {
  found: boolean;
  digest?: string;
  counter?: string | null;
}

/** Self-attributed submitter's note, stored inside the signed proof. */
export interface Attribution {
  name?: string;
  title?: string;
  message?: string;
}
