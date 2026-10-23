/**
 * BitGraph Ledger — Immutable Causal Storage Types
 *
 * These types define the storage layer for BitGraph.
 * The ledger is the source of truth. Everything else is an index.
 *
 * The user keeps only their file. The ledger stores everything else.
 */

// ---------------------------------------------------------------------------
// Stored Proof — the canonical immutable record
// ---------------------------------------------------------------------------

/** A proof as stored in the immutable ledger (S3 Object Lock). */
export interface StoredProof {
  /** Schema version. */
  version: "bitgraph/1";

  /** What was proven — the artifact hash. */
  artifact: {
    hashAlg: "sha256";
    digestB64: string;
  };

  /** Causal position in the chain. */
  commit: {
    counter: string;
    epochId: string;
    /** Hash of the previous proof. Links the chain. */
    prevB64?: string;
    /** Counter of the consumed slot (must be < counter). */
    slotCounter?: string;
    /** SHA-256 of canonical slot body. Binds commit to slot. */
    slotHashB64?: string;
    /** Slot nonce — the entropy that existed before the artifact. */
    nonceB64?: string;
  };

  /** The pre-allocated origin slot (embedded for self-contained verification). */
  slotAllocation?: {
    version: "bitgraph/slot/1";
    counter: string;
    epochId: string;
    nonceB64: string;
    publicKeyB64: string;
    signatureB64: string;
  };

  /** Ed25519 signer. */
  signer: {
    publicKeyB64: string;
    signatureB64: string;
  };

  /** Hardware environment. */
  environment: {
    enforcement: string;
    measurement: string;
    attestation?: {
      format: string;
      reportB64: string;
    };
  };

  /** Optional attribution (sealed in signed body). */
  attribution?: {
    name?: string;
    title?: string;
    message?: string;
  };

  /** Optional metadata (NOT in signed body — informational). */
  metadata?: Record<string, unknown>;

  /** TSA timestamps (added outside enclave signature boundary). */
  timestamps?: Record<string, unknown>;

  /** SHA-256 of canonicalize(signedBody). Deterministic address. */
  proofHash: string;
}

// ---------------------------------------------------------------------------
// Stored Anchor — Ethereum front anchor
// ---------------------------------------------------------------------------

/** An Ethereum front anchor as stored in the immutable ledger. */
export interface StoredAnchor {
  /** The proof that committed the Ethereum block hash. */
  proof: StoredProof;

  /** Ethereum block data. */
  ethereum: {
    blockNumber: number;
    blockHash: string;
  };

  /** Which epoch and counter this anchor sits at. */
  epochId: string;
  counter: string;

  /** Hash of this anchor record for deterministic addressing. */
  anchorHashB64: string;
}

// ---------------------------------------------------------------------------
// Finalization — proof bounded between two anchors
// ---------------------------------------------------------------------------

/** A finalization record — proves a proof is bounded in a causal window. */
export interface Finalization {
  /** The proof that was bounded. */
  proofHash: string;

  /** The anchor AFTER this proof (front anchor / forward seal). */
  anchorAfterHashB64: string;
  anchorAfterBlockNumber: number;

  /** The anchor BEFORE this proof (previous front anchor, if any). */
  anchorBeforeHashB64?: string;
  anchorBeforeBlockNumber?: number;

  /** Epoch this finalization belongs to. */
  epochId: string;
}

// ---------------------------------------------------------------------------
// S3 Key Helpers
// ---------------------------------------------------------------------------

/** Deterministic S3 key for a proof. */
export function proofKey(epochId: string, counter: string, proofHash: string): string {
  const safeEpoch = toSafeId(epochId);
  const safeHash = toSafeId(proofHash);
  return `proofs/${safeEpoch}/${counter.padStart(12, "0")}-${safeHash}.json`;
}

/** Deterministic S3 key for an anchor. */
export function anchorKey(epochId: string, counter: string, anchorHash: string): string {
  const safeEpoch = toSafeId(epochId);
  const safeHash = toSafeId(anchorHash);
  return `anchors/${safeEpoch}/${counter.padStart(12, "0")}-${safeHash}.json`;
}

/** Deterministic S3 key for a finalization. */
export function finalizationKey(proofHash: string): string {
  return `finalizations/${toSafeId(proofHash)}.json`;
}

/** Convert base64 to URL-safe filesystem-safe string. */
function toSafeId(b64: string): string {
  return b64.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
