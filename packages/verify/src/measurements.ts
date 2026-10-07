// Copyright (c) 2024-2026 Argento Computing Inc. Licensed under the MIT License. See LICENSE.

/**
 * The enclave images BitGraph has published (SPEC.md section 16), oldest
 * first: every PCR0 a real BitGraph proof can carry.
 *
 * An attestation that chains to the AWS Nitro root shows that SOME Nitro
 * enclave signed; anyone can run one. Which image is BitGraph's is a
 * measurement policy, and this list is that policy by default:
 * verifyExport and verifyCarrier judge `attestation.pins` against it when
 * the caller names no list of their own, and a proof from any other image is
 * not a BitGraph. A caller who rebuilt an image from its tagged source and
 * wants to accept exactly that passes their own list instead.
 *
 * Keep in step with SPEC.md section 16, the site's
 * website/src/lib/enclave-measurements.ts and the player's
 * KNOWN_ENCLAVE_MEASUREMENTS; a root test checks all of them against this.
 */

export interface PublishedMeasurement {
  /** The image's name in BitGraph's history: "genesis", "v2", ... */
  version: string;
  /** The UTC day it went live (YYYY-MM-DD). */
  since: string;
  /** PCR0, 96 lowercase hex characters. */
  pcr0: string;
}

export const PUBLISHED_ENCLAVE_MEASUREMENTS: readonly PublishedMeasurement[] = Object.freeze([
  { version: "genesis", since: "2026-05-15", pcr0: "8530a6399399c4f23d89f5a1faa2e8bf2e09a5959f117070fca08148377f92c902c695fc926c17f67f35f110327dca92" },
  { version: "v2", since: "2026-06-27", pcr0: "bb9dd158703603ec222fe565495ceaa7edc08f665da5c1cddad91442ac2211731390267036d79deb720d13fb704f648a" },
  { version: "v4", since: "2026-07-05", pcr0: "e2fccbae77ee40aac4830e84f195e05d69eb4547bbd961f4d3459feba10807140424aca42ad03810354982598c86b9cb" },
  { version: "v5", since: "2026-07-29", pcr0: "6483cedffed74680ffb287507744a398b288c3fb943eb3f2e4fe889f8b60b3d575ad8942350360b69a1bd7bf713df27f" },
  { version: "v6", since: "2026-09-05", pcr0: "cd8ba52d340fb1be78610b59953ded2ceca23be1cfcc7ab504a26b8fdcd7ba92090f49e28a32d008df046ec4212f77bf" },
  { version: "v7", since: "2026-09-06", pcr0: "394c3cf515651dc27187d85e4716c12dfeb99c1227f1fe0eacfaa427d80018e1a28ebba9469e99c7936601f901d74e1d" },
  { version: "v8", since: "2026-09-07", pcr0: "eccfc1c78006f4b74f929c992785575c908a0f60eca08ff638cd6c0842f993f182ebb002457b8ef3e732a6a10805c72b" },
  { version: "v9", since: "2026-09-30", pcr0: "934feb8bb6f4f7e2d2f85d902a7d5edd0981f706d9d2385638988ac096a05ea0583c3d00eef2a7947865ec66efc1fcf8" },
  { version: "v10", since: "2026-10-08", pcr0: "5a947cc66095adcceefa9e5ece5d1416dfe08c3470df1bcaa5b2bc5267b0480e6cdc172fe077cd06b0afb07614307973" },
].map((m) => Object.freeze(m)));

/** PUBLISHED_ENCLAVE_MEASUREMENTS as the bare PCR0 list a verifier's pins take. */
export const PUBLISHED_PCR0S: readonly string[] = Object.freeze(PUBLISHED_ENCLAVE_MEASUREMENTS.map((m) => m.pcr0));

/** The published image a PCR0 names, or null when it is not one of BitGraph's. Case-insensitive. */
export function publishedMeasurement(pcr0: unknown): PublishedMeasurement | null {
  if (typeof pcr0 !== "string") return null;
  const want = pcr0.toLowerCase();
  return PUBLISHED_ENCLAVE_MEASUREMENTS.find((m) => m.pcr0 === want) ?? null;
}
