// Copyright (c) 2024-2026 Mike Argento. Licensed under the MIT License. See LICENSE.

/**
 * What makes a proof an Ethereum anchor.
 *
 * One definition, because this was five copies of a string literal: the
 * website's ledger feed, its anchor lookup and its digest route, the audit
 * package, and the published proof-format page all decided independently, and
 * all of them decided on `attribution.name`.
 *
 * ⚠️ THE NAME IS THE WEAK TEST, AND IT IS ALSO IN THE WAY. `attribution` holds
 * exactly one name, so a proof cannot say "Ethereum Anchor" and carry the
 * `bitgraph-fuse/1` marker at the same time — which is what blocks an anchor
 * from being fused like every other artifact on the ledger. The strong test
 * was already there: the enclave writes `commit.anchor` only after verifying
 * the anchor service's Ed25519 signature over the claim against a public key
 * baked into its image, and refuses the reserved attribution name to anyone
 * who cannot produce one. The proof-format docs already said as much: a proof
 * whose attribution says anchor but which lacks `commit.anchor` is not an
 * anchor.
 *
 * ⚠️ AND THE NAME CANNOT SIMPLY BE DROPPED. `commit.anchor` arrived with
 * enclave v7 on 2026-09-06, and the ledger holds anchors from months before
 * it — the oldest carry the attribution name and no `commit.anchor` at all.
 * Testing only the signed field would silently un-anchor the entire history.
 *
 * So both are accepted and they are told apart, because they are not equally
 * strong and a caller that cares should be able to say so.
 */
import type { BitGraphProof } from "./types.js";

/** The reserved attribution name. Signed, and refused by the enclave without a valid claim. */
export const ANCHOR_ATTRIBUTION_NAME = "Ethereum Anchor";

export type AnchorKind =
  /** `commit.anchor` is present: the enclave verified the anchor service's signature over the claim. */
  | "authenticated"
  /** Pre-v7. Only the signed attribution name says so, and nothing in the proof backs it. */
  | "legacy-attribution";

function record(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

/**
 * How this proof claims to be an anchor, or null if it does not.
 *
 * Prefers the authenticated form. A proof that satisfies both — every anchor
 * written since v7 — reports "authenticated", because that is the claim worth
 * acting on.
 */
export function anchorKindOf(proof: unknown): AnchorKind | null {
  const p = record(proof);
  if (p === null) return null;
  const commit = record(p["commit"]);
  if (commit !== null && commit["anchor"] !== undefined && commit["anchor"] !== null) {
    return "authenticated";
  }
  const attribution = record(p["attribution"]);
  if (attribution !== null && attribution["name"] === ANCHOR_ATTRIBUTION_NAME) {
    return "legacy-attribution";
  }
  return null;
}

/** The block an authenticated anchor commits to, as the enclave signed it. */
export interface AnchorMark {
  blockNumber: number;
  blockHash: string;
}

/**
 * The authenticated anchor mark, or null when there is none.
 *
 * This is where an anchor's block should be read from. The same block also
 * appears in `attribution.message` and `attribution.title`, but only by
 * convention, and that convention is what stops an anchor's attribution being
 * used for anything else. Reading `commit.anchor` frees it.
 */
export function anchorMarkOf(proof: unknown): AnchorMark | null {
  const p = record(proof);
  const commit = p === null ? null : record(p["commit"]);
  const mark = commit === null ? null : record(commit["anchor"]);
  if (mark === null) return null;
  const blockNumber = mark["blockNumber"];
  const blockHash = mark["blockHash"];
  return typeof blockNumber === "number" && Number.isFinite(blockNumber) && typeof blockHash === "string"
    ? { blockNumber, blockHash }
    : null;
}

/**
 * Whether this proof is an Ethereum anchor, in either form.
 *
 * Use this wherever a display or a lookup needs to know. Where the strength of
 * the claim matters — an audit, anything that reports on trust — call
 * `anchorKindOf` and treat the two differently.
 */
export function isAnchorProof(proof: unknown): proof is BitGraphProof {
  return anchorKindOf(proof) !== null;
}
