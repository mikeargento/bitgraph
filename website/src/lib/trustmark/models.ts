// Copyright (c) Argento Computing Inc. All rights reserved. See LICENSE.

/**
 * The two TrustMark models: Adobe's open-source variant Q (MIT), exported to ONNX and stored at half precision, served
 * with the site from public/trustmark. A browser checks each model against the SHA-256 below before running it.
 */

export const MODELS = {
  encoder: { url: "/trustmark/encoder_Q.fp16.onnx", bytes: 17_333_696, sha256: "1eb0b78be10ac3a23b3d8d11c52853b0961bc17c9650391fb114b5f452c471d4" },
  decoder: { url: "/trustmark/decoder_Q.fp16.onnx", bytes: 47_417_540, sha256: "58908a3fc31a8d79d1b6a4ef2d8c550647f74d62b7ee4f430423a06a89a67b8c" },
} as const;

export type ModelName = keyof typeof MODELS;
