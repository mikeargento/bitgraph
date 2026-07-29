# Pinned build inputs — BitGraph enclave EIF

Every value below is fixed so that two people building from identical source
re-derive the **identical PCR0**. Change any one of these and the PCR0 changes.
This file is the authoritative record; the `Dockerfile.enclave`, `build-eif.sh`,
and `eif-builder.Dockerfile` all reference these exact pins.

Last resolved: 2026-06-27 (resolved on the production Nitro host, linux/amd64).

## Published measurement

> **⚠ STALE AS OF 2026-07-29 — REBUILD PENDING.**
> The enclave source changed on 2026-07-29 (`convertBW` and `principal`
> removed, `sharp` dropped from the image). **PCR0 below is the value for the
> PREVIOUS source and no longer matches what a rebuild produces.** It remains
> correct for verifying every proof minted before the redeploy.
>
> Until the rebuild runs on the production Nitro host, this file, the
> `/proof/[digest]` page's "you can rebuild it and re-derive this exact PCR0"
> copy, and any verifier allowlist are all out of date together. Re-derive on
> `linux/amd64`, replace the value below, record the previous one in the
> retired list, and update the site copy in the same commit.

```
PCR0 = bb9dd158703603ec222fe565495ceaa7edc08f665da5c1cddad91442ac2211731390267036d79deb720d13fb704f648a
```

This value was produced by the pinned pipeline below and **verified by two
independent clean-room builds** (2026-06-27). It is the measurement reported by
the production enclave at `nitro.occproof.com` for proofs minted between
2026-06-27 and the 2026-07-29 rebuild.

The previous value `8530a6399399c4f23d89f5a1faa2e8bf2e09a5959f117070fca08148377f92c902c695fc926c17f67f35f110327dca92`
(genesis 2026-05-15) was built by a pipeline that did NOT pin its inputs (floating
`node:20-alpine`, unpinned apk packages, and a `npm install sharp` that fetched
the newest build at build time) and cannot be re-derived. It is retired; its EIF
is kept only for verifying proofs minted under that epoch.

Companion PCR measurements of the published EIF (informational; PCR1 is AWS's
kernel, PCR2 is the app):

```
PCR1 = 4b4d5b3661b3efc12920900c80e126e4ce783c522de6c02a2a5bf7af3a2b9327b86776f188e4be1c1c404a129dbda493
PCR2 = 561ec327532d8742b93bb4c93127531e94533c38224a936bb32b38dc01f81f9668bb7ed52835fe0cd4fdfe755d698810
```

## Container images (pinned by digest)

| Role | Image | Digest |
|------|-------|--------|
| App build base (Dockerfile.enclave, both stages) | `node:20-alpine` | `sha256:fb4cd12c85ee03686f6af5362a0b0d56d50c58a04632e6c0fb8363f609372293` |
| Reproducible image builder | `gcr.io/kaniko-project/executor:v1.23.2` | `sha256:9e69fd4330ec887829c780f5126dd80edc663df6def362cd22e79bcdf00ac53f` |
| EIF builder base (eif-builder.Dockerfile) | `amazonlinux:2023` | `sha256:32f61af6a24e178e8142fb7b0079f4af3a5cda6816cd53d2c611a921ef029ca0` |

`node:20-alpine@fb4cd12c…` is Alpine **3.23.4**.

## Toolchain versions

| Tool | Version | Notes |
|------|---------|-------|
| nitro-cli | **1.4.4-0.amzn2023** | Pinned in `eif-builder.Dockerfile`. This package ships the kernel/init blobs measured into PCR0 (see below), so its version is load-bearing. |
| Alpine apk: gcc | `15.2.0-r2` | nsm_ioctl helper compiler |
| Alpine apk: musl-dev | `1.2.5-r23` | |
| Alpine apk: socat | `1.8.1.3-r0` | vsock bridge in the enclave image |

**`sharp` was removed from the enclave on 2026-07-29** and is no longer a build
input. It existed only for the `convertBW` transform endpoint, which was
rejected on design grounds (a transform in the base commit path binds an
artifact the caller never held; see the pure pass-through note at the top of
`src/enclave/app.ts`). Removing it drops `@img/sharp-linuxmusl-x64` and
`@img/sharp-libvips-linuxmusl-x64` from the image, taking a large native
image-decoding surface out of the measured boundary — and, per the retired-PCR0
note above, removing what was historically the least reproducible input to this
pipeline. Do not reintroduce it.

## nitro-cli 1.4.4 kernel/init blobs (the AWS-provided trusted input)

PCR0 measures the whole EIF, which includes AWS's kernel + bootstrap shipped by
the `aws-nitro-enclaves-cli` RPM. Pinning nitro-cli 1.4.4 pins these bytes.
These sha256s were captured from the production host's installed 1.4.4 and are
re-checked inside the pinned `eif-builder` container by `build-eif.sh`:

```
210eda749c1308eb60671a579d24db5e8a3477cb7a247cf313c286b09fe2d857  bzImage
9378dea490ed6c698c3d23b346ed08e49dae52d74a59cee2673b8a7b1951fc5b  bzImage.config
10d7d9dd205d4596d45997d17434f26207525f129d171a51f9859b1af9f4a07a  cmdline
c4acb866e8925c171b43517f3a88a6989f5a2da3a6d3e6594f75bedc6d116a27  init
e57bb1779b348da7eae118a8e0a034d2aa4c28205c07db07dea8285ff206bb69  linuxkit
6bd2b09422c2f2f58c6ecf1cfd55216bea9b99a6d591261a9eca40027291316b  nsm.ko
```

This is the one input you trust AWS for: their signed enclave kernel. It is what
PCR1 independently measures. Everything else in PCR0 is built from published source you can audit.

## Re-deriving R

Run `reproducible-build/verify-pcr0.sh` on any linux/amd64 host with Docker. It
builds the EIF twice from clean state and asserts both PCR0 values are identical
(and equal to the published `R` once recorded above). Nitro hardware is NOT
required to build/verify the EIF — only to run the enclave.
