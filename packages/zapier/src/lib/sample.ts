// Copyright (c) 2024-2026 Mike Argento. Licensed under the MIT License. See LICENSE.

/**
 * Samples shown in the Zap editor before a step has run.
 *
 * These are the real values of the public example proof at
 * bitgraph.ing/proof/mYNezUiNnzhS3V0xqDsGUWCg2ZsKshiftAI016JPBUc, not invented
 * ones, so what a builder maps in the editor is shaped exactly like what the
 * step will return. The attestation report is the one field abbreviated: it is
 * several kilobytes of CBOR and its length is not informative here.
 */

const EXAMPLE_DIGEST_B64 = "mYNezUiNnzhS3V0xqDsGUWCg2ZsKshiftAI016JPBUc=";
const EXAMPLE_DIGEST_URLSAFE = "mYNezUiNnzhS3V0xqDsGUWCg2ZsKshiftAI016JPBUc";
const EXAMPLE_DIGEST_HEX = "99835ecd488d9f3852dd5d31a83b065160a0d99b0ab2189fb40234d7a24f0547";
const EXAMPLE_EPOCH_B64 = "EQmlm7sZsGZeYmKlgVU6k0qd6cj79bsmhzhlzxlMF7o=";
const EXAMPLE_EPOCH_URLSAFE = "EQmlm7sZsGZeYmKlgVU6k0qd6cj79bsmhzhlzxlMF7o";

const EXAMPLE_PROOF = {
  version: "bitgraph/1",
  artifact: { hashAlg: "sha256", digestB64: EXAMPLE_DIGEST_B64 },
  commit: {
    nonceB64: "rKW0X5fzncKtU5avAornJ3xetXRrS0S6J/nuNf+GTx4=",
    counter: "7910",
    slotCounter: "7909",
    slotHashB64: "AGC5XCMaBHFqJYeEEe9aFhZr6r+A55g69Xy+bac18mY=",
    epochId: EXAMPLE_EPOCH_B64,
    prevB64: "aCg0e0hIcEl8pHugN3/kUJXzTT2FiBdyiQItbYaC4QA=",
    chainId: "bitgraph:main",
  },
  signer: {
    publicKeyB64: "r0RCAh/beCKOpLCtY+yXEG4LixW3xhI1jadMar5n9lE=",
    signatureB64:
      "IUdaOEwAhDIEfkykc0QFAjh1smb6S9fdk2ItP3JOPj3gnLssiGmmY8YgPJvOMFXLFbN0PWkc87HPEOhmVspHCQ==",
  },
  environment: {
    enforcement: "measured-tee",
    measurement:
      "6483cedffed74680ffb287507744a398b288c3fb943eb3f2e4fe889f8b60b3d575ad8942350360b69a1bd7bf713df27f",
    attestation: { format: "aws-nitro", reportB64: "hEShATgioFkRHb9pbW9kdWxlX2lk..." },
  },
  proofHash: "SMbMMy9xjCjUiJWETtBjTDDp4qDOXwisRE6JDHU1DfU=",
};

const COMMON = {
  id: `${EXAMPLE_EPOCH_URLSAFE}:7910`,
  proofUrl: `https://bitgraph.ing/proof/${EXAMPLE_DIGEST_URLSAFE}?counter=7910&epoch=${EXAMPLE_EPOCH_URLSAFE}`,
  artifactHash: EXAMPLE_DIGEST_B64,
  artifactHashHex: EXAMPLE_DIGEST_HEX,
  artifactHashUrlSafe: EXAMPLE_DIGEST_URLSAFE,
  counter: "7910",
  slotCounter: "7909",
  epochId: EXAMPLE_EPOCH_B64,
  epochIdUrlSafe: EXAMPLE_EPOCH_URLSAFE,
  chainId: "bitgraph:main",
  proofHash: "SMbMMy9xjCjUiJWETtBjTDDp4qDOXwisRE6JDHU1DfU=",
  publicKey: "r0RCAh/beCKOpLCtY+yXEG4LixW3xhI1jadMar5n9lE=",
  signature:
    "IUdaOEwAhDIEfkykc0QFAjh1smb6S9fdk2ItP3JOPj3gnLssiGmmY8YgPJvOMFXLFbN0PWkc87HPEOhmVspHCQ==",
  enforcement: "measured-tee",
  measurement:
    "6483cedffed74680ffb287507744a398b288c3fb943eb3f2e4fe889f8b60b3d575ad8942350360b69a1bd7bf713df27f",
  attestationFormat: "aws-nitro",
  attributionName: null,
  attributionTitle: null,
  attributionMessage: null,
  bitgraphedAfter: "2026-07-29T16:54:11.000Z",
  bitgraphedBefore: "2026-07-29T16:54:23.000Z",
  bitgraphedAfterBlock: 25639816,
  bitgraphedBeforeBlock: 25639817,
  bitgraphedAfterUrl: "https://etherscan.io/block/25639816",
  bitgraphedBeforeUrl: "https://etherscan.io/block/25639817",
  causalWindow: "BitGraphed between 2026-07-29T16:54:11.000Z and 2026-07-29T16:54:23.000Z",
  anchorSettled: true,
  totalPositions: 3,
  proof: EXAMPLE_PROOF,
};

export const SAMPLE_CREATE = {
  ...COMMON,
  outcome: "recorded",
  recorded: true,
  fileBytes: 4609150,
};

export const SAMPLE_VERIFY = {
  ...COMMON,
  verified: true,
  status: "valid",
  reason: null,
  onRecord: true,
  artifactBinding: "checked" as const,
  checkedAgainst: "ledger",
};

export const SAMPLE_RETRIEVE = {
  ...COMMON,
  onRecord: true,
  positions: [
    { counter: "7910", epoch: EXAMPLE_EPOCH_URLSAFE, lowerTime: "2026-07-29T16:54:11.000Z", upperTime: "2026-07-29T16:54:23.000Z" },
    { counter: "14224", epoch: EXAMPLE_EPOCH_URLSAFE, lowerTime: "2026-07-30T03:51:59.000Z", upperTime: "2026-07-30T03:52:11.000Z" },
  ],
};
