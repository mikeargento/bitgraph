// Copyright (c) 2024-2026 Mike Argento. Licensed under the MIT License. See LICENSE.

/**
 * Retrieve Proof: fetch an existing proof without recording anything.
 *
 * Implemented as a Zapier search rather than an action, which is what makes
 * "find the proof, and create one if there isn't one" a single configurable
 * step instead of two steps and a filter. It still appears to the builder as
 * an ordinary action they can drop into a Zap.
 *
 * The file is the key. A proof can be retrieved by the file itself (hashed
 * here), by its digest, or by its BitGraph number. There is no other handle,
 * and that is a property of the system rather than a limitation of this step:
 * if you do not have the file or its hash, you cannot pull its proof, so a
 * file that stays private keeps its proof private too.
 */

import type { Bundle, ZObject } from "zapier-platform-core";
import { BitGraphClient, resolveFileDigest } from "../lib/client";
import { digestForms, normalizeDigest, toUrlSafeB64, fromUrlSafeB64 } from "../lib/digest";
import { PROOF_OUTPUT_FIELDS, causalTimeOf, proofFields } from "../lib/fields";
import { SAMPLE_RETRIEVE } from "../lib/sample";

interface InputData {
  file?: string;
  digest?: string;
  number?: string;
  counter?: string;
  epoch?: string;
  [k: string]: unknown;
}

const perform = async (z: ZObject, bundle: Bundle<InputData>) => {
  const client = new BitGraphClient(z, bundle);
  const { file, digest, number, counter, epoch } = bundle.inputData;

  const given = [file, digest, number].filter((v) => typeof v === "string" && v.trim().length > 0);
  if (given.length !== 1) {
    throw new z.errors.Error(
      "Provide exactly one of File, Digest, or BitGraph Number.",
      "InvalidInput",
      400
    );
  }

  let urlSafeDigest: string;
  let selCounter = counter !== undefined && counter.trim().length > 0 ? counter.trim() : undefined;

  if (typeof number === "string" && number.trim().length > 0) {
    const found = await client.search(number.trim());
    if (!found.found || found.digest === undefined) {
      // Numbers are per epoch and the epoch rotates daily, so a number that
      // resolves today may not tomorrow. Empty result, not an error: a search
      // that finds nothing is a normal outcome for Zapier.
      return [];
    }
    urlSafeDigest = found.digest;
    if (selCounter === undefined && found.counter != null) selCounter = String(found.counter);
  } else if (typeof file === "string" && file.trim().length > 0) {
    const hashed = await resolveFileDigest(client, file);
    urlSafeDigest = hashed.digestUrlSafe;
  } else {
    urlSafeDigest = digestForms(normalizeDigest(digest as string)).digestUrlSafe;
  }

  // The route compares epochs in URL-safe form; accept either form here.
  const selEpoch =
    epoch !== undefined && epoch.trim().length > 0 ? toUrlSafeB64(fromUrlSafeB64(epoch.trim())) : undefined;

  const detail = await client.proofDetail(urlSafeDigest, selCounter, selEpoch);
  const first = detail.proofs?.[0]?.proof;
  if (first === undefined) return [];

  const fields = proofFields(client.base, first);
  return [
    {
      ...fields,
      ...causalTimeOf(detail),
      onRecord: true,
      totalPositions: detail.positions?.length ?? 1,
      // Every causal position these bytes occupy. A file recorded more than
      // once has several, and they are not duplicates: each is a distinct
      // moment the same bytes were presented.
      positions: detail.positions ?? [],
    },
  ];
};

export default {
  key: "find_proof",
  noun: "Proof",

  display: {
    label: "Retrieve Proof",
    description:
      "Look up an existing BitGraph proof by file, digest, or BitGraph number, including its Ethereum anchor window. " +
      "Read-only: nothing is recorded.",
  },

  operation: {
    inputFields: [
      {
        key: "file",
        label: "File",
        type: "file" as const,
        required: false,
        helpText: "Look up by the file itself. It is hashed here; only the hash is sent.",
      },
      {
        key: "digest",
        label: "Digest",
        type: "string" as const,
        required: false,
        helpText: "Look up by SHA-256, as 64 hex characters or base64.",
      },
      {
        key: "number",
        label: "BitGraph Number",
        type: "string" as const,
        required: false,
        helpText:
          "Look up by the number shown on a proof page, for example 7910. Numbers are per epoch and epochs rotate daily, " +
          "so a number only resolves within its own epoch. Digest and file always work.",
      },
      {
        key: "counter",
        label: "Counter",
        type: "string" as const,
        required: false,
        helpText:
          "Optional. Select one specific causal position when the same bytes have been recorded more than once. " +
          "Without it, the earliest, that is the originating, position is returned.",
      },
      { key: "epoch", label: "Epoch ID", type: "string" as const, required: false, helpText: "Optional. Qualifies the counter." },
    ],

    perform,

    sample: SAMPLE_RETRIEVE,

    outputFields: [...PROOF_OUTPUT_FIELDS, { key: "onRecord", label: "On record", type: "boolean" }],
  },
};
