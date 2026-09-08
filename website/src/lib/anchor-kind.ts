/**
 * What makes a proof an Ethereum anchor.
 *
 * ⚠️ A MIRROR, NOT THE ORIGINAL. The canonical version is
 * `packages/verify/src/anchor.ts`, exported as `anchorKindOf` / `anchorMarkOf`
 * / `isAnchorProof`. This site installs @mikeargento/bitgraph-verify from the
 * registry rather than the workspace, so it cannot import them until verify is
 * next published. Delete this file then and import from the package; the two
 * must not be allowed to drift in the meantime.
 *
 * Why it exists at all: this test was a bare string literal repeated in the
 * ledger feed, the anchor lookup and the digest route, and again in the audit
 * package and the published proof-format page. Five copies, all testing
 * `attribution.name`.
 *
 * ⚠️ THE NAME IS THE WEAK TEST AND IT IS IN THE WAY. `attribution` holds one
 * name, so a proof cannot say "Ethereum Anchor" and carry the
 * `bitgraph-fuse/1` marker at once — which is what stops an anchor being fused
 * like every other artifact. The strong test already existed: the enclave
 * writes `commit.anchor` only after verifying the anchor service's signature
 * over the claim, and refuses the reserved name to anyone who cannot produce
 * one.
 *
 * ⚠️ AND THE NAME CANNOT BE DROPPED. `commit.anchor` arrived with enclave v7
 * on 2026-09-06; the ledger holds anchors from months before it, carrying the
 * name and nothing else. Testing only the signed field would un-anchor the
 * whole history, and the Ledger view would go blank for everything before that
 * date.
 */

/** The reserved attribution name. Signed, and refused by the enclave without a valid claim. */
export const ANCHOR_ATTRIBUTION_NAME = "Ethereum Anchor";

export type AnchorKind =
  /** `commit.anchor` is present: the enclave verified the anchor service's signature. */
  | "authenticated"
  /** Pre-v7. Only the signed attribution name says so. */
  | "legacy-attribution";

/** The block an authenticated anchor commits to, as the enclave signed it. */
export interface AnchorMark {
  blockNumber: number;
  blockHash: string;
}

function record(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

/** How this proof claims to be an anchor, or null. Prefers the authenticated form. */
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

/**
 * The authenticated anchor mark, or null.
 *
 * Where an anchor's block should be read from. The same block also appears in
 * `attribution.message` and `attribution.title`, but only by convention, and
 * that convention is what keeps attribution occupied.
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

/** Whether this proof is an Ethereum anchor, in either form. */
export function isAnchorProof(proof: unknown): boolean {
  return anchorKindOf(proof) !== null;
}
