// Copyright (c) 2024-2026 Mike Argento. Licensed under the MIT License. See LICENSE.

/**
 * Verify BitGraph: does this proof hold, and does it belong to this file?
 *
 * Verification runs inside the Zapier step using @mikeargento/bitgraph-verify,
 * the same MIT-licensed verifier anyone can run offline, rather than asking
 * bitgraph.ing for a verdict. That is deliberate. A verification that consists
 * of a service saying "trust me, it is valid" is worth much less than one the
 * asker performs themselves, and the package exists precisely so nobody has to
 * ask permission. No verification logic is reimplemented here; this step
 * marshals inputs into that library and reports what it returns.
 *
 * Two things are checked, and they are reported separately because they fail
 * for different reasons:
 *
 *   - proof integrity: the object is internally consistent, the Ed25519
 *     signature is the enclave's, the slot binding holds. Needs no bytes.
 *   - artifact binding: SHA-256 of the file equals the digest inside the
 *     proof. Needs the file, or a digest computed from it.
 *
 * Both together are exactly what verify({proof, bytes}) does. Only the first
 * is possible when the caller has a proof but not the file, and the output
 * says so rather than implying the file was checked.
 */

import type { Bundle, ZObject } from "zapier-platform-core";
import { BitGraphClient, resolveFileDigest } from "../lib/client";
import { digestForms, normalizeDigest } from "../lib/digest";
import { PROOF_OUTPUT_FIELDS, causalTimeOf, emptyProofFields, proofFields } from "../lib/fields";
import type { BitGraphProof, ProofDetailResponse } from "../lib/types";
import { SAMPLE_VERIFY } from "../lib/sample";

interface InputData {
  file?: string;
  digest?: string;
  proof?: string;
  allowedMeasurements?: string;
  [k: string]: unknown;
}

/**
 * Trust anchors applied to every verification.
 *
 * Both hold for every proof the live boundary has ever minted, and together
 * they are what separates a BitGraph proof from something merely shaped like
 * one: `requireSlot` demands the nonce-first slot allocation that makes the
 * position causal rather than asserted, and `requireEpochId` demands the proof
 * name the epoch whose key signed it. Verifying without them would accept
 * proofs the product itself does not consider complete.
 */
const BASE_TRUST_ANCHORS = { requireSlot: true, requireEpochId: true } as const;

const perform = async (z: ZObject, bundle: Bundle<InputData>) => {
  const client = new BitGraphClient(z, bundle);
  const { file, digest, proof: proofInput, allowedMeasurements } = bundle.inputData;

  const hasFile = typeof file === "string" && file.trim().length > 0;
  const hasDigest = typeof digest === "string" && digest.trim().length > 0;
  const hasProof = typeof proofInput === "string" && proofInput.trim().length > 0;

  if (!hasFile && !hasDigest && !hasProof) {
    throw new z.errors.Error(
      "Provide a File to verify, or a Digest, or a Proof. With a file or digest the proof is fetched from the ledger; " +
        "with a proof alone only the proof itself can be checked, not which file it belongs to.",
      "InvalidInput",
      400
    );
  }
  if (hasFile && hasDigest) {
    throw new z.errors.Error("Provide either a File or a Digest, not both.", "InvalidInput", 400);
  }

  // What the caller claims the file is. Absent when only a proof was supplied.
  let claimedDigestB64: string | null = null;
  let fileBytes: number | null = null;
  if (hasFile) {
    const hashed = await resolveFileDigest(client, file as string);
    claimedDigestB64 = hashed.digestB64;
    fileBytes = hashed.bytes;
  } else if (hasDigest) {
    claimedDigestB64 = normalizeDigest(digest as string);
  }

  // Where the proof came from changes what a valid result means, so it is
  // reported: a proof pulled from the ledger says the ledger holds this file,
  // a proof pasted in says only that the object itself checks out.
  let proof: BitGraphProof | null = null;
  let checkedAgainst: "ledger" | "supplied proof";
  let onRecord = false;

  if (hasProof) {
    try {
      proof = JSON.parse(proofInput as string) as BitGraphProof;
    } catch {
      throw new z.errors.Error(
        "The Proof field is not valid JSON. Map the whole proof object from an earlier BitGraph step, or paste the JSON from a proof page.",
        "InvalidInput",
        400
      );
    }
    checkedAgainst = "supplied proof";
  } else {
    const forms = digestForms(claimedDigestB64 as string);
    const checked = await client.batchCheck([forms.digestUrlSafe]);
    // Recordings of these bytes only; a fused descendant naming them as origin is not one.
    const priors = (checked.results[forms.digestUrlSafe]?.proofs ?? []).filter((p) => (p as { kind?: string }).kind !== "fused");
    onRecord = priors.length > 0;
    proof = priors[0]?.proof ?? null;
    checkedAgainst = "ledger";

    if (proof === null) {
      // Not a verification failure. The file is simply not in the ledger, and
      // conflating the two would tell a workflow a file failed verification
      // when it was never recorded. Same keys as every other path, so a Zap
      // that maps this step's output does not break on this outcome.
      return {
        ...emptyProofFields(forms.digestB64),
        ...causalTimeOf(null),
        verified: false,
        status: "not on record",
        reason: "These bytes have never been recorded in the BitGraph ledger, so there is no proof to verify.",
        onRecord: false,
        artifactBinding: "not-checked" as const,
        checkedAgainst,
        fileBytes,
        totalPositions: 0,
      };
    }
  }

  const trustAnchors: Record<string, unknown> = { ...BASE_TRUST_ANCHORS };
  const measurements = (allowedMeasurements ?? "")
    .split(/[\s,]+/)
    .map((m) => m.trim())
    .filter((m) => m.length > 0);
  if (measurements.length > 0) trustAnchors["allowedMeasurements"] = measurements;

  // Loaded dynamically: bitgraph-verify is ESM-only and this app builds to
  // CommonJS for the Zapier runtime. A dynamic import is how CJS reaches it.
  const { verifyProofIntegrity } = await import("@mikeargento/bitgraph-verify");
  const integrity = await verifyProofIntegrity({
    proof: proof as never,
    trustAnchors: trustAnchors as never,
  });

  // The artifact binding: does the proof's digest match the file we hashed?
  // Doing this comparison here, against a digest computed from the caller's
  // own bytes, is what makes the result equivalent to verify({proof, bytes}).
  const proofDigest = proof.artifact?.digestB64 ?? null;
  let artifactBinding: "checked" | "not-checked" | "mismatch" = "not-checked";
  if (claimedDigestB64 !== null && proofDigest !== null) {
    artifactBinding = proofDigest === claimedDigestB64 ? "checked" : "mismatch";
  }

  let verified = integrity.valid;
  let reason: string | null = integrity.valid ? null : (integrity.reason ?? "Proof failed verification.");
  let status: string;

  if (artifactBinding === "mismatch") {
    verified = false;
    reason =
      "This proof is for different bytes. The file's SHA-256 does not match the digest inside the proof, " +
      "so the proof does not describe this file.";
    status = "mismatch";
  } else if (!verified) {
    status = "invalid";
  } else if (artifactBinding === "checked") {
    status = "valid";
  } else {
    // Integrity holds but nothing tied it to a file. Saying "valid" flat would
    // let a workflow read it as "this file is proven", which it is not.
    status = "valid, file not checked";
  }

  const fields = proofFields(client.base, proof);

  let detail: ProofDetailResponse | null = null;
  if (fields.artifactHashUrlSafe.length > 0) {
    try {
      detail = await client.proofDetail(
        fields.artifactHashUrlSafe,
        fields.counter ?? undefined,
        fields.epochIdUrlSafe ?? undefined
      );
      if (!hasProof) onRecord = (detail.proofs?.length ?? 0) > 0;
    } catch {
      detail = null;
    }
  }

  return {
    ...fields,
    ...causalTimeOf(detail),
    verified,
    status,
    reason,
    onRecord: hasProof ? (detail?.proofs?.length ?? 0) > 0 : onRecord,
    artifactBinding,
    checkedAgainst,
    fileBytes,
    totalPositions: detail?.positions?.length ?? null,
  };
};

export default {
  key: "verify_bitgraph",
  noun: "Verification",

  display: {
    label: "Verify BitGraph",
    description:
      "Check that a file matches its BitGraph proof and that the proof is genuine. Verification runs inside this step " +
      "with the open-source BitGraph verifier, not by asking a server for a verdict. Read-only: nothing is recorded.",
  },

  operation: {
    inputFields: [
      {
        key: "file",
        label: "File",
        type: "file" as const,
        required: false,
        helpText:
          "The file to verify. It is hashed here and its proof is fetched from the ledger. Only the hash is sent.",
      },
      {
        key: "digest",
        label: "Digest",
        type: "string" as const,
        required: false,
        helpText: "Instead of a file: its SHA-256, as 64 hex characters or base64.",
      },
      {
        key: "proof",
        label: "Proof",
        type: "text" as const,
        required: false,
        helpText:
          "Optional. A proof object as JSON, usually mapped from the Proof field of an earlier BitGraph step. " +
          "Supply it to verify that exact proof rather than whatever the ledger currently holds. " +
          "With a proof but no file, the result confirms the proof is genuine but cannot confirm which file it belongs to.",
      },
      {
        key: "allowedMeasurements",
        label: "Allowed Enclave Measurements",
        type: "string" as const,
        required: false,
        helpText:
          "Advanced. Comma-separated PCR0 values. When set, a proof signed by any other enclave build fails verification. " +
          "Leave empty to accept any measurement the boundary has published.",
      },
    ],

    perform,

    sample: SAMPLE_VERIFY,

    outputFields: [
      { key: "verified", label: "Verified", type: "boolean" },
      { key: "status", label: "Status", type: "string" },
      { key: "reason", label: "Reason (when not verified)", type: "string" },
      { key: "onRecord", label: "On record in the ledger", type: "boolean" },
      { key: "artifactBinding", label: "Artifact binding (checked, not-checked, mismatch)", type: "string" },
      { key: "checkedAgainst", label: "Proof source", type: "string" },
      ...PROOF_OUTPUT_FIELDS,
    ],
  },
};
