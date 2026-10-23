/**
 * The enclave images BitGraph has published, oldest first: every PCR0 in
 * `server/commit-service/reproducible-build/PINS.md`. The proof page hands this
 * list to the verifier as its allowlist, so "the image is one the verifier
 * accepts" is judged against the measurements BitGraph publishes rather than
 * left open. A proof always carries its own measurement; a retired value stays
 * correct for the proofs minted under it.
 *
 * Keep in step with PINS.md, /docs/self-host-tee and the player's
 * KNOWN_ENCLAVE_MEASUREMENTS: an enclave rebuild is not finished until all of
 * them agree.
 */
export const PUBLISHED_ENCLAVE_MEASUREMENTS: ReadonlyArray<{ pcr0: string; since: string; note: string }> = [
  { pcr0: "8530a6399399c4f23d89f5a1faa2e8bf2e09a5959f117070fca08148377f92c902c695fc926c17f67f35f110327dca92", since: "2026-05-15", note: "genesis" },
  { pcr0: "bb9dd158703603ec222fe565495ceaa7edc08f665da5c1cddad91442ac2211731390267036d79deb720d13fb704f648a", since: "2026-06-27", note: "v2" },
  { pcr0: "e2fccbae77ee40aac4830e84f195e05d69eb4547bbd961f4d3459feba10807140424aca42ad03810354982598c86b9cb", since: "2026-07-05", note: "v4" },
  { pcr0: "6483cedffed74680ffb287507744a398b288c3fb943eb3f2e4fe889f8b60b3d575ad8942350360b69a1bd7bf713df27f", since: "2026-07-29", note: "v5" },
  { pcr0: "cd8ba52d340fb1be78610b59953ded2ceca23be1cfcc7ab504a26b8fdcd7ba92090f49e28a32d008df046ec4212f77bf", since: "2026-09-05", note: "v6" },
  { pcr0: "394c3cf515651dc27187d85e4716c12dfeb99c1227f1fe0eacfaa427d80018e1a28ebba9469e99c7936601f901d74e1d", since: "2026-09-06", note: "v7, authenticated anchors" },
  { pcr0: "eccfc1c78006f4b74f929c992785575c908a0f60eca08ff638cd6c0842f993f182ebb002457b8ef3e732a6a10805c72b", since: "2026-09-07", note: "v8, floor gate" },
  { pcr0: "934feb8bb6f4f7e2d2f85d902a7d5edd0981f706d9d2385638988ac096a05ea0583c3d00eef2a7947865ec66efc1fcf8", since: "2026-09-30", note: "v9, floor returned at allocation" },
  { pcr0: "5a947cc66095adcceefa9e5ece5d1416dfe08c3470df1bcaa5b2bc5267b0480e6cdc172fe077cd06b0afb07614307973", since: "2026-10-08", note: "v10, Base floor at allocation" },
  { pcr0: "d9128d67c406a30f988f74ece8b5cced5c9a96491289037f50bddb5f10aac2bc9d1d315dd7bf65428899ccde72b95b86", since: "2026-10-17", note: "v11, bind: nonce and payload in one action" },
  { pcr0: "cf1ca497e1c3f678cce99ec2215f3991c72fd1b54f083a1f58563e88f5fe742e5190c7ebaf27f3aa98622605687e27c9", since: "2026-10-18", note: "v12, bind only: two counts, one atomic action, nothing else" },
  { pcr0: "adaad0bef62292d35197ae8db19e40685229f1a1e6070a7c77a148c4ada88ee66a1ca50819eebc2017c6716a49f2692f", since: "2026-10-19", note: "v13, epochs independent (each starts with a Base block read), no bind before init, key seeded from NSM" },
];

export const PUBLISHED_PCR0S: readonly string[] = PUBLISHED_ENCLAVE_MEASUREMENTS.map((m) => m.pcr0);

/** The newest published measurement: the one production runs. */
export const PUBLISHED_PCR0: string = PUBLISHED_ENCLAVE_MEASUREMENTS[PUBLISHED_ENCLAVE_MEASUREMENTS.length - 1]!.pcr0;
