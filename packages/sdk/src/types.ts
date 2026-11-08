// Copyright (c) 2025-2026 Argento Computing Inc. Licensed under the MIT License. See LICENSE.

/**
 * Wire types: minimal views of the bitgraph/1 proof and the bitgraph.ing API
 * responses. The canonical, fully documented schema lives in
 * @mikeargento/bitgraph-verify. Fields not needed here are kept as unknown;
 * proofs are passed through verbatim.
 */

export interface ProofCommit {
  /** The fresh nonce the enclave drew for this BitGraph (standard base64). */
  nonceB64?: string;
  /** The count the content was bound at (N+1): the BitGraph's number. */
  counter?: string;
  /** The nonce's count (N). */
  slotCounter?: string;
  epochId?: string;
  /** The enclave's signed time, Unix milliseconds. */
  time?: number;
  /** The hash of the previous proof this one chains to. */
  prevB64?: string;
  atomic?: true;
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
  metadata?: unknown;
  proofHash?: string;
  [k: string]: unknown;
}

/** A member's row as the site reports it: which row of N these bytes are. */
export interface SetMemberView {
  index: number;
  count: number;
  role?: "origin" | "fused";
}

/** POST /api/proofs/batch response. Keyed by the digest exactly as sent (URL-safe). */
export interface BatchCheckResponse {
  results: Record<
    string,
    {
      proofs: Array<{ proof: BitGraphProof; kind?: string; member?: SetMemberView; setDigest?: string; envRef?: string; writeTime?: number | null }>;
      /** True when this digest's part of the ledger could not be read: not a "no". */
      unavailable?: boolean;
    }
  >;
  /** Attestation environments shared by several proofs, referenced by envRef. */
  environments?: Record<string, Record<string, unknown>>;
}

export interface PositionView {
  counter: string | null;
  epoch: string | null;
  kind?: string;
  placement?: string | null;
  member?: SetMemberView;
}

/** GET /api/proofs/digest/{digest} response. */
export interface ProofDetailResponse {
  proofs: Array<{ proof: BitGraphProof }>;
  positions?: PositionView[];
  [k: string]: unknown;
}

/** GET /api/search response. */
export interface SearchResponse {
  found: boolean;
  digest?: string;
  counter?: string | null;
}
