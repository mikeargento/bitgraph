/**
 * BitGraph Run (profile bitgraph-run/1): an artifact that was MADE with its
 * slot commitment inside it, rather than wrapped around an original afterwards.
 *
 * Fuse and Run are the two ways an artifact can carry its commitment, and they
 * differ in what a verifier can do about it:
 *
 *   fuse  the commitment was written into the bytes of an existing file, in a
 *         registered placement, so a verifier holding the ORIGINAL can rebuild
 *         the committed artifact byte for byte. The placement is the recipe.
 *   run   there is no original and no recipe. The producer asked for a slot,
 *         put the commitment into the thing it was about to make, and committed
 *         the digest of what came out. A model prompt, a build id, a commit
 *         message, a signed payload: the commitment is an ingredient, not a
 *         wrapper, so there is nothing to rebuild from.
 *
 * What this file checks, and only this:
 *
 *   1. the underlying bitgraph/1 proof verifies against these exact bytes
 *   2. the marker is present and names an encoding this build knows
 *   3. the commitment recomputed from the proof's own slot record equals the
 *      one the signed marker declares
 *   4. that commitment, in the declared encoding, appears in the artifact's
 *      bytes, and where
 *
 * Together those establish that the bytes were assembled after the enclave
 * signed the slot, because they contain a value the enclave generated and
 * nobody could predict. They do NOT establish that the commitment was an INPUT
 * to the production rather than inserted at the end: a producer who appends the
 * string to a finished file passes every check here, and that producer has
 * really just done a hand-rolled fuse. The distinction matters for how it reads
 * to a human (an acrostic on the commitment is evidence of conditioning; a
 * trailing line is not), and this file says so rather than implying otherwise.
 * `statements` carries the bound; `limits` carries what is not shown.
 */
import { sha256 } from "@noble/hashes/sha256";
import type { BitGraphProof, VerificationPolicy } from "./types.js";
import { verify } from "./verifier.js";
import { computeSlotCommitment } from "./fuse.js";
import { spanOf, type FuseSpan } from "./fuse-verify.js";

/** The signed profile id: attribution.name on a run proof. */
export const RUN_PROFILE = "bitgraph-run/1";

/**
 * The only encoding this build registers: the commitment as unpadded base64url
 * ASCII, the form a producer pastes into a prompt, a message or a header. It is
 * attribution.title on a run proof.
 */
export const RUN_ENCODING_BASE64URL = "base64url";

export type RunCategory =
  | "RUN_CONFIRMED"
  | "COMMITMENT_ABSENT"
  | "INVALID_SLOT_COMMITMENT"
  | "INVALID_UNDERLYING_PROOF"
  | "UNDETERMINED_ENCODING"
  | "NOT_A_RUN";

export interface RunMarker {
  /** attribution.title: how the commitment appears in the bytes. */
  encoding: string | null;
  /** attribution.message: the commitment the producer declared, as written. */
  declaredCommitment: string | null;
}

export interface RunVerifyResult {
  category: RunCategory;
  /** The underlying bitgraph/1 verification, reported on its own. */
  proof: { valid: boolean; reason?: string };
  marker: RunMarker | null;
  /** Recomputed from the proof's slot record; null when the proof carries none. */
  slotCommitmentB64u: string | null;
  /** Byte offset of the first occurrence in the artifact, or null when absent. */
  offset: number | null;
  /** How many times it appears. One is the ordinary case; more is not an error. */
  occurrences: number;
  artifactDigestB64: string;
  fileDigestB64: string;
  span: FuseSpan | null;
  /** What this result establishes, bounded. */
  statements: string[];
  /** What it does not establish, stated so nothing has to be inferred. */
  limits: string[];
  reason: string | null;
}

export interface RunVerifyOptions {
  proof: BitGraphProof;
  bytes: Uint8Array;
  trustAnchors?: VerificationPolicy;
}

const b64 = (b: Uint8Array): string => Buffer.from(b).toString("base64");
const b64u = (b: Uint8Array): string => b64(b).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

/** The marker a run proof carries, or null when it is not a run proof. */
export function readRunAttribution(proof: BitGraphProof): RunMarker | null {
  const a = proof.attribution;
  if (a === undefined || a.name !== RUN_PROFILE) return null;
  return {
    encoding: typeof a.title === "string" && a.title.length > 0 ? a.title : null,
    declaredCommitment: typeof a.message === "string" && a.message.length > 0 ? a.message : null,
  };
}

/** The attribution a producer sends when committing a run. */
export function runAttribution(commitment: Uint8Array | string): { name: string; title: string; message: string } {
  return {
    name: RUN_PROFILE,
    title: RUN_ENCODING_BASE64URL,
    message: typeof commitment === "string" ? commitment : b64u(commitment),
  };
}

/** Every byte offset at which `needle` occurs in `haystack`. */
function findAll(haystack: Uint8Array, needle: Uint8Array): number[] {
  const out: number[] = [];
  if (needle.length === 0 || needle.length > haystack.length) return out;
  outer: for (let i = 0; i + needle.length <= haystack.length; i++) {
    for (let j = 0; j < needle.length; j++) if (haystack[i + j] !== needle[j]) continue outer;
    out.push(i);
  }
  return out;
}

function statementsFor(category: RunCategory, span: FuseSpan | null, offset: number | null): string[] {
  if (span === null || category !== "RUN_CONFIRMED") return [];
  return [
    `The enclave signed the slot at position ${span.slotCounter} before this artifact's digest reached it.`,
    `These exact bytes contain that slot's commitment, first at byte ${offset}, so they were assembled after the slot existed and were committed at position ${span.commitCounter}.`,
  ];
}

const LIMITS = [
  "Containing the commitment does not show it was an input to the artifact's production: bytes appended to a finished file pass the same check. What the commitment was to the work is the producer's claim, not this result's.",
  "Nothing here bounds the artifact from above in wall-clock time. The position bound is the commit position; a clock comes only from an anchor.",
];

/**
 * Verify a bitgraph-run/1 artifact from its own bytes. Nothing here touches the
 * network, and nothing is rebuilt: a run has no original to rebuild from.
 */
export async function verifyRun(opts: RunVerifyOptions): Promise<RunVerifyResult> {
  const { proof, bytes, trustAnchors } = opts;
  const fileDigestB64 = b64(sha256(bytes));
  const artifactDigestB64 = proof.artifact?.digestB64 ?? "";
  const span = spanOf(proof);
  const marker = readRunAttribution(proof);

  const base = (category: RunCategory, extra: Partial<RunVerifyResult>, reason: string | null): RunVerifyResult => ({
    category,
    proof: extra.proof ?? { valid: false, reason: "not run" },
    marker,
    slotCommitmentB64u: extra.slotCommitmentB64u ?? null,
    offset: extra.offset ?? null,
    occurrences: extra.occurrences ?? 0,
    artifactDigestB64,
    fileDigestB64,
    span,
    statements: statementsFor(category, span, extra.offset ?? null),
    limits: category === "RUN_CONFIRMED" ? LIMITS : [],
    reason,
  });

  if (marker === null) {
    return base("NOT_A_RUN", {}, `the proof carries no ${RUN_PROFILE} attribution`);
  }

  let pv: { valid: boolean; reason?: string };
  try {
    pv = await verify(trustAnchors === undefined ? { proof, bytes } : { proof, bytes, trustAnchors });
  } catch (e) {
    pv = { valid: false, reason: (e as Error).message };
  }
  if (!pv.valid) {
    return base("INVALID_UNDERLYING_PROOF", { proof: pv }, pv.reason ?? "the underlying proof does not verify against these bytes");
  }

  if (marker.encoding !== RUN_ENCODING_BASE64URL) {
    return base("UNDETERMINED_ENCODING", { proof: pv }, `the marker names encoding "${marker.encoding ?? "none"}", which this build does not register`);
  }

  const slot = proof.slotAllocation;
  if (slot === undefined) {
    return base("INVALID_SLOT_COMMITMENT", { proof: pv }, "the proof carries no slot record, so the commitment cannot be recomputed");
  }
  const slotCommitmentB64u = b64u(computeSlotCommitment(slot));
  if (marker.declaredCommitment !== slotCommitmentB64u) {
    return base(
      "INVALID_SLOT_COMMITMENT",
      { proof: pv, slotCommitmentB64u },
      `the signed marker declares commitment ${marker.declaredCommitment ?? "none"}, but this proof's slot record commits to ${slotCommitmentB64u}`,
    );
  }

  const hits = findAll(bytes, new TextEncoder().encode(slotCommitmentB64u));
  if (hits.length === 0) {
    return base(
      "COMMITMENT_ABSENT",
      { proof: pv, slotCommitmentB64u },
      "the artifact's bytes do not contain the commitment in the declared encoding",
    );
  }
  return base("RUN_CONFIRMED", { proof: pv, slotCommitmentB64u, offset: hits[0] ?? null, occurrences: hits.length }, null);
}
