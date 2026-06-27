# Reproducible enclave EIF — rebuild it yourself, trust no one

Every BitGraph proof embeds a TEE attestation whose `PCR0` is the measurement of
the enclave image. That measurement is only meaningful if you can confirm it
corresponds to the open source you can read. This directory lets you do exactly
that: rebuild the enclave from source and re-derive the **identical PCR0** that
production publishes, on your own machine, trusting no one.

## Why the old build wasn't reproducible

`PCR0` is a SHA-384 measurement of the whole EIF (AWS kernel/init + the app
filesystem). A plain `docker build` + `nitro-cli build-enclave` is not
deterministic: floating base-image tags, unpinned OS packages, layer timestamps,
and (worst of all) a `npm install sharp` that fetched whatever was newest at
build time all make two people get different bytes, hence different PCR0s.

## How this pipeline fixes it

See [PINS.md](./PINS.md) for the exact digests/versions. In short:

1. **Pinned everything** — base image by digest, apk packages by version, sharp
   by lockfile integrity hash, nitro-cli to 1.4.4 (which fixes the AWS kernel
   blobs measured into PCR0).
2. **kaniko `--reproducible`** — canonicalizes layer timestamps and image config
   so the app image tar is byte-stable.
3. **nitro-cli in a pinned container** — the EIF packing toolchain and its kernel
   blobs are identical for everyone.
4. **Clean-room context** — the build context is produced with `git archive`, so
   only committed source is used; stray `node_modules` or local edits can't leak in.

The one input you still trust AWS for is their signed enclave **kernel** (the
nitro-cli blobs). That is inherent to Nitro and is exactly what **PCR1**
independently measures. Everything else folded into PCR0 is built from auditable source.

## Rebuild and verify

Requirements: any **linux/amd64** host with Docker + git. Nitro hardware is **not**
required to build or verify the EIF — only to run the enclave.

```bash
git clone https://github.com/mikeargento/bitgraph.git
cd bitgraph

# Build once and print the PCR0:
./server/commit-service/reproducible-build/build-eif.sh

# Or prove determinism: build twice and assert identical PCR0, and (optionally)
# that it equals the published value R:
./server/commit-service/reproducible-build/verify-pcr0.sh HEAD <R>
```

If your PCR0 equals the value published at `/docs/self-host-tee` and embedded in
every proof's attestation, you have independently confirmed the enclave runs the
code in this repository — no assertion required.

## Files

| File | Purpose |
|------|---------|
| `PINS.md` | Authoritative list of every pinned input + the published PCR0 |
| `build-eif.sh` | Deterministic build: kaniko → docker image → pinned nitro-cli → EIF + PCR0 |
| `eif-builder.Dockerfile` | Pinned `amazonlinux` + `nitro-cli 1.4.4` container that packs the EIF |
| `verify-pcr0.sh` | Builds twice, asserts identical PCR0 (clean-room determinism proof) |

## If a build ever fails to reproduce

Use [`diffoci`](https://github.com/reproducible-containers/diffoci) on the two
`docker.tar` images, or `diffoscope` on the two `enclave.eif` files, to locate the
non-deterministic bytes. The usual culprits: an unpinned dependency slipped in, or
a new nitro-cli version changed the kernel blobs (check `PINS.md` blob hashes).
