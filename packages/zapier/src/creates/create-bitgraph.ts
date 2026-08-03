// Copyright (c) 2024-2026 Mike Argento. Licensed under the MIT License. See LICENSE.

/**
 * Create BitGraph: the one step this integration exists for.
 *
 * Give it a file, get back a proof that the file existed in exactly that form
 * at a specific causal position, bracketed by two Ethereum blocks. The file is
 * hashed inside the Zapier step and only its SHA-256 digest is sent; BitGraph
 * never receives the contents.
 *
 * The step follows the product's own recording semantics rather than inventing
 * automation-specific ones: identical bytes are not silently re-recorded,
 * because a second recording is a second causal position and means something
 * different from the first. A Zap that re-runs over the same file gets the
 * original proof back, not a duplicate.
 */

import type { Bundle, ZObject } from "zapier-platform-core";
import { BitGraphClient, PartialCommitError, resolveFileDigest } from "../lib/client";
import { digestForms, normalizeDigest } from "../lib/digest";
import { PROOF_OUTPUT_FIELDS, causalTimeOf, proofFields } from "../lib/fields";
import type { Attribution, BitGraphProof, ProofDetailResponse } from "../lib/types";
import { SAMPLE_CREATE } from "../lib/sample";

interface InputData {
  file?: string;
  digest?: string;
  recordAgain?: boolean;
  attributionName?: string;
  attributionTitle?: string;
  attributionMessage?: string;
  [k: string]: unknown;
}

const perform = async (z: ZObject, bundle: Bundle<InputData>) => {
  const client = new BitGraphClient(z, bundle);
  const { file, digest, recordAgain } = bundle.inputData;

  const hasFile = typeof file === "string" && file.trim().length > 0;
  const hasDigest = typeof digest === "string" && digest.trim().length > 0;
  if (hasFile === hasDigest) {
    throw new z.errors.Error(
      hasFile
        ? "Provide either a File or a Digest, not both. The digest is for files already hashed elsewhere."
        : "Provide a File to BitGraph, or a Digest if the file was already hashed elsewhere.",
      "InvalidInput",
      400
    );
  }

  // Bytes are hashed here and dropped. `fileBytes` is how much was hashed; it
  // is null for a digest that arrived already computed, since nothing was read.
  let digestB64: string;
  let fileBytes: number | null = null;
  if (hasFile) {
    const hashed = await resolveFileDigest(client, file as string);
    digestB64 = hashed.digestB64;
    fileBytes = hashed.bytes;
  } else {
    digestB64 = normalizeDigest(digest as string);
  }
  const forms = digestForms(digestB64);

  const attribution: Attribution = {};
  if (bundle.inputData.attributionName) attribution.name = bundle.inputData.attributionName;
  if (bundle.inputData.attributionTitle) attribution.title = bundle.inputData.attributionTitle;
  if (bundle.inputData.attributionMessage) attribution.message = bundle.inputData.attributionMessage;
  const hasAttribution = Object.keys(attribution).length > 0;

  const checked = await client.batchCheck([forms.digestUrlSafe]);
  const priors = checked.results[forms.digestUrlSafe]?.proofs ?? [];

  let proof: BitGraphProof;
  let recorded: boolean;

  if (priors.length > 0 && recordAgain !== true) {
    // Already on record. The earliest position is the originating proof, which
    // is the one a workflow asking "is this file proven?" wants.
    proof = priors[0]!.proof;
    recorded = false;
  } else {
    let minted: BitGraphProof[];
    try {
      minted = await client.commit([digestB64], hasAttribution ? attribution : undefined);
    } catch (err) {
      if (err instanceof PartialCommitError) {
        throw new z.errors.Error(err.message, "BitGraphCommitError", 502);
      }
      throw err;
    }
    const first = minted[0];
    if (first === undefined) {
      // A 200 carrying no proof is not a success. Saying so is the only honest
      // option: claiming a recording that may not exist is worse than failing.
      throw new z.errors.Error(
        "BitGraph accepted the request but returned no proof. Nothing can be confirmed as recorded. " +
          "Re-run this step: if the digest was in fact recorded, it will come back as already on record.",
        "BitGraphCommitError",
        502
      );
    }
    proof = first;
    recorded = true;
  }

  const fields = proofFields(client.base, proof);

  // Anchor context is a second, read-only call. It is best-effort on purpose:
  // once a recording is minted it is permanent, so failing the step because
  // the enrichment call timed out would push the user into re-running it and
  // minting a second position for the same bytes. A proof with unknown time
  // bounds is still a complete, verifiable proof.
  let detail: ProofDetailResponse | null = null;
  try {
    detail = await client.proofDetail(
      forms.digestUrlSafe,
      fields.counter ?? undefined,
      fields.epochIdUrlSafe ?? undefined
    );
  } catch {
    detail = null;
  }

  const totalPositions = detail?.positions?.length ?? (recorded ? priors.length + 1 : priors.length);

  return {
    ...fields,
    ...causalTimeOf(detail),
    outcome: recorded ? "recorded" : "on record",
    recorded,
    totalPositions,
    fileBytes,
  };
};

export default {
  key: "create_bitgraph",
  noun: "BitGraph",

  display: {
    label: "Create BitGraph",
    description:
      "Record a file in the BitGraph ledger and return its proof. The file is hashed inside this step and only the hash is sent; " +
      "the file's contents are never uploaded. Recordings are permanent.",
  },

  operation: {
    inputFields: [
      {
        key: "file",
        label: "File",
        type: "file" as const,
        required: false,
        helpText:
          "The file to BitGraph. Map a file from an earlier step (Google Drive, Dropbox, DocuSign, and so on). " +
          "It is hashed here and discarded; only the SHA-256 hash reaches BitGraph.",
      },
      {
        key: "digest",
        label: "Digest",
        type: "string" as const,
        required: false,
        helpText:
          "Only if the file was already hashed somewhere else. A SHA-256 as 64 hex characters or base64. " +
          "Leave empty when you have mapped a File above.",
      },
      {
        key: "recordAgain",
        label: "Record Again If Already Recorded",
        type: "boolean" as const,
        required: false,
        default: "false",
        helpText:
          "Off: a file already in the ledger comes back with its existing proof and nothing new is created, so a Zap that re-runs is safe. " +
          "On: record the same bytes at a new causal position anyway (BitGraph Again), which is how you show the same file appearing at a second moment.",
      },
      {
        key: "attributionName",
        label: "Submitter's Name",
        type: "string" as const,
        required: false,
        helpText:
          "Optional note stored inside the signed proof. Self-attributed: BitGraph binds the claim cryptographically but does not check it, " +
          "and it is shown as a submitter's note, never as verified identity.",
      },
      { key: "attributionTitle", label: "Title", type: "string" as const, required: false },
      { key: "attributionMessage", label: "Message", type: "string" as const, required: false },
    ],

    perform,

    sample: SAMPLE_CREATE,

    outputFields: [
      ...PROOF_OUTPUT_FIELDS,
      { key: "outcome", label: "Outcome (recorded or on record)", type: "string" },
      { key: "recorded", label: "Newly recorded by this step", type: "boolean" },
      { key: "fileBytes", label: "Bytes hashed", type: "integer" },
    ],
  },
};
