// Copyright (c) 2024-2026 Mike Argento. Licensed under the MIT License. See LICENSE.

/**
 * @mikeargento/bitgraph-mcp: wire types.
 *
 * Minimal views of the bitgraph/1 schema and the bitgraph.ing API responses.
 * The canonical, fully documented schema lives in @mikeargento/bitgraph-verify.
 * Fields not needed for display are kept as unknown; proofs are passed through
 * verbatim when the caller asks for JSON.
 */

export interface ProofCommit {
  counter?: string;
  epochId?: string;
  time?: number;
  slotCounter?: string;
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

/** A set member's row as the site reports it: which row of N these bytes are, and whether as the original or the new file. */
export interface SetMemberView {
  index: number;
  count: number;
  role?: "origin" | "fused";
}

/** POST /api/proofs/batch response. Keyed by the digest exactly as sent (URL-safe). */
export interface BatchCheckResponse {
  results: Record<
    string,
    { proofs: Array<{ proof: BitGraphProof; kind?: "recorded" | "fused"; member?: SetMemberView; setDigest?: string }> }
  >;
}

/** POST /api/fuse/set-index response: how many members' evidence the site wrote. */
export interface SetIndexResponse {
  count?: number;
  written: number;
  failed: number;
  rejected: number;
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
  kind?: "recorded" | "fused";
  placement?: string | null;
  member?: SetMemberView;
}

/**
 * GET /api/proofs/digest/{digest} response.
 * causalWindow naming note: anchorBefore is the EARLIER Ethereum block (the
 * proof was BitGraphed after it, the lower time bound); anchorAfter is the
 * LATER block (the upper bound). Present time as "between lower and upper".
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
