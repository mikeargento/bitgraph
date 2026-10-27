// Copyright (c) Argento Computing Inc. All rights reserved. See LICENSE.

/**
 * The watermark models, exported to ONNX with their weights stored at half precision (the maths stays float32),
 * served with the site from public/trustmark. A browser checks each model against the SHA-256 below before running it.
 *
 *   embedder, extractor  Meta's Pixel Seal (videoseal, MIT): every new pointer is written and read with these.
 *   decoder              Adobe's TrustMark variant Q (MIT): read only, for copies marked before Pixel Seal.
 */

export const MODELS = {
  embedder: { url: "/trustmark/pixelseal_embedder.fp16.onnx", bytes: 87_659_893, sha256: "b1717e840bb772ffedf71a911e6552239c54f05f2a25a1dddf209c178f0e7c7f" },
  extractor: { url: "/trustmark/pixelseal_extractor.fp16.onnx", bytes: 66_897_475, sha256: "32a3c25526522d5a644c5a0cce8370642bd0775508266c53cd059e2fbd58ba3f" },
  decoder: { url: "/trustmark/decoder_Q.fp16.onnx", bytes: 47_417_540, sha256: "58908a3fc31a8d79d1b6a4ef2d8c550647f74d62b7ee4f430423a06a89a67b8c" },
} as const;

export type ModelName = keyof typeof MODELS;
