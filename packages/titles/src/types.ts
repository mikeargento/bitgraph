// Copyright (c) 2024-2026 Mike Argento. Licensed under the MIT License. See LICENSE.

/**
 * @mikeargento/bitgraph-titles
 *
 * Shared vocabulary. The normative semantics live in SPEC-PM.md.
 *
 * A possession message is a small file that states a claim about another
 * file, proves its author held that file, is signed by a key, and — once
 * recorded — occupies a position in the BitGraph causal order. It is
 * sealed by default and readable only when presented.
 *
 * Four properties, each grounded:
 *   HELD    the possession hash, derivable only from the subject's bytes
 *   SIGNED  a key's signature over the canonical message bytes
 *   PLACED  the message file's own BitGraph recording (outside this package)
 *   SEALED  only digests travel; the mandatory salt makes a sealed
 *           message unconfirmable by guessing its contents
 *
 * A message proves SAID, HELD, and PLACED. It never proves that its
 * statement is true, who the person behind the key is, or who holds
 * anything now. Truth stays with people; events, never states.
 */

import type { SigAlg } from "@mikeargento/bitgraph-player";

/**
 * Claim kinds.
 *
 *   "held"          the base claim: the signer held the subject bytes
 *   "give"          offers the subject onward; names the recipient key.
 *                   The claim every conveyance starts with.
 *   "take"          accepts a give; only meaningful threaded to one
 *   "controls-key"  key identity/continuity: the body names what the
 *                   signer asserts about key control
 *   "supersedes"    the subject replaces the file named by `re`
 *
 * Every kind is "held" plus a word: all carry the possession hash.
 */
export type PmClaim = "held" | "give" | "take" | "controls-key" | "supersedes";

/** A public key reference: the recipient of a give, spelled like a trusted key. */
export interface PmKeyRef {
  alg: SigAlg;
  /** ed25519: raw 32-byte key, standard base64. es256: SPKI DER, base64. */
  publicKey: string;
}

/**
 * A parsed bitgraph-pm/1 possession message. Field order here is the
 * canonical serialization order (SPEC-PM.md section 3).
 */
export interface Pm {
  pm: "bitgraph-pm/1";
  /** Digest of the subject bytes, canonical "sha256:<lowercase hex>". */
  about: string;
  claim: PmClaim;
  /** Digest of the predecessor message file, "sha256:<hex>". Threads only. */
  re?: string;
  /** The recipient key. Required for "give", absent otherwise. */
  to?: PmKeyRef;
  /** Free text. The human layer; never evaluated. */
  body?: string;
  /** 32 lowercase hex chars: 128 bits that make sealed messages unconfirmable and identical statements distinct. */
  salt: string;
  /**
   * Lowercase hex SHA-256 over "bitgraph-pm-possession/1\n" + the subject's
   * raw bytes. Only a holder of every byte can compute it; a scraped
   * public digest cannot. Authoring requires holding.
   */
  possession: string;
  alg: SigAlg;
  /** The signer's key, spelled per alg (see PmKeyRef). */
  publicKey: string;
  /** Signature over the canonical bytes of this object with `signature` absent. */
  signature: string;
}

/** Everything checkable about one message without any other context. */
export interface PmCheck {
  /** The parse succeeded and every structural rule held. */
  structure: boolean;
  /** The signature verifies over the canonical message bytes. */
  signature: boolean;
  /**
   * Possession verification is three-valued by nature: TRUE with the
   * subject bytes in hand, UNDETERMINED without them ("unverifiable
   * here" is not a failure), FALSE when supplied bytes refute the hash.
   */
  possession: "verified" | "unverifiable" | "refuted";
  issues: string[];
}

/** One link of a reconstructed custody thread. */
export interface ThreadLink {
  /** Lowercase hex SHA-256 of the message file bytes: the message's identity. */
  sha256Hex: string;
  pm: Pm;
}

/**
 * A structurally valid custody thread: held origin, then zero or more
 * give/take pairs. Structure only — causal positions, and therefore
 * first-wins adjudication between competing threads, come from the
 * generated Player rule over a proof bundle, never from this package.
 */
export interface Thread {
  /** Subject digest, canonical "sha256:<hex>". */
  about: string;
  links: ThreadLink[];
  /** The current head: the last link. */
  head: ThreadLink;
  /**
   * The key that holds the thread: the origin signer until a take, then
   * the most recent taker. Only a give signed by this key can extend the
   * thread.
   */
  holderKey: PmKeyRef;
  issues: string[];
}
