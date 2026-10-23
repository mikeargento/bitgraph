# Pinned build inputs — BitGraph enclave EIF

Every value below is fixed so that two people building from identical source
re-derive the **identical PCR0**. Change any one of these and the PCR0 changes.
This file is the authoritative record; the `Dockerfile.enclave`, `build-eif.sh`,
and `eif-builder.Dockerfile` all reference these exact pins.

Last resolved: 2026-10-19 (resolved on the production Nitro host, linux/amd64).
Source: ref `enclave-v13`, a branch in this repository holding exactly one standalone commit: the exact tree that built v13 (the same tree as commit `fd281844` in the project's private history). Build it with `GIT_REF=enclave-v13`.

## Published measurement

```
PCR0 = adaad0bef62292d35197ae8db19e40685229f1a1e6070a7c77a148c4ada88ee66a1ca50819eebc2017c6716a49f2692f
```

Built **2026-10-19**, and **verified by two independent builds on that date**
(the deliverable build agreed as well). The change since `enclave-v12`, from
the 2026-10-18 audit: epochs are independent (no lineage is read in or
signed; the host binds a read of the latest Base block as each epoch's first
BitGraph), `bind` is refused until the host has called `init`, and the
Ed25519 key's seed is SHA-256 of NSM randomness and Node's CSPRNG together.
`bind(digest)` is unchanged: a fresh nonce at count N and the payload digest
at N+1, signed and released together. `/key` reports `"only": "bind"`.

Note on what "reproducible" means precisely: **PCR0 reproduces, the `.eif` file
does not.** The two verification builds produced different file hashes
(`8c3d55d2…` and `bf5943ab…`) because the EIF header embeds a `BuildTime`.
PCR0 measures the enclave *contents*, not that header, which is why it is
stable. Any claim of a byte-identical EIF is wrong; the claim is a byte-identical
measurement.

Companion measurements of this build:

```
PCR1 = 4b4d5b3661b3efc12920900c80e126e4ce783c522de6c02a2a5bf7af3a2b9327b86776f188e4be1c1c404a129dbda493
PCR2 = cac82b1c2eefa3f10ad8ae1dc64cf1330f1bf25074daadea458af43b13d98025fce3b0946093334a911131b5a08622d0
```

PCR1 measures AWS's signed kernel, which the nitro-cli 1.4.4 pin holds fixed.
PCR2 (the application) changed, as expected.

### Retired measurements

Each remains correct for verifying proofs minted during its own epochs. A proof
always carries its own measurement, so nothing below needs to be "current" for
old proofs to verify.

| PCR0 | Period | Note |
|------|--------|------|
| `cf1ca497e1c3f678cce99ec2215f3991c72fd1b54f083a1f58563e88f5fe742e5190c7ebaf27f3aa98622605687e27c9` | 2026-10-18 → 2026-10-19 | v12-repro (`enclave-v12`, `885aff66`). Verified by two clean builds 2026-10-17. PCR2 `a9813e39…`. Bind only; init could link a self-signed predecessor (never used in production). |
| `d9128d67c406a30f988f74ece8b5cced5c9a96491289037f50bddb5f10aac2bc9d1d315dd7bf65428899ccde72b95b86` | 2026-10-17 → 2026-10-18 | v11-repro (`enclave-v11`, `477fb51b`). Verified by two clean builds 2026-10-17. PCR2 `db5cae39…`. Bind as one atomic action; held slots (Fuse) on `bitgraph:fuse`; a Base floor signed into every proof. |
| `5a947cc66095adcceefa9e5ece5d1416dfe08c3470df1bcaa5b2bc5267b0480e6cdc172fe077cd06b0afb07614307973` | 2026-10-07 → 2026-10-17 | v10-repro (`enclave-v10`, `93f9504d`). Verified by two clean builds 2026-10-07. PCR2 `a41dd86d…`. The Base floor fixed at allocation (bitgraph-fuse/3). |
| `934feb8bb6f4f7e2d2f85d902a7d5edd0981f706d9d2385638988ac096a05ea0583c3d00eef2a7947865ec66efc1fcf8` | 2026-09-30 → 2026-10-07 | v9-repro (`enclave-v9`, `b32c6c74`). Verified by two clean builds 2026-09-30. PCR2 `2770eeef…`. The allocation returned the floor anchor (bitgraph-fuse/2). |
| `eccfc1c78006f4b74f929c992785575c908a0f60eca08ff638cd6c0842f993f182ebb002457b8ef3e732a6a10805c72b` | 2026-09-07 → 2026-09-30 | v8-repro (`enclave-v8`, `3b3568d4`). Verified by two clean builds 2026-09-07. PCR2 `36974f9a…`. |
| `394c3cf515651dc27187d85e4716c12dfeb99c1227f1fe0eacfaa427d80018e1a28ebba9469e99c7936601f901d74e1d` | 2026-09-06 → 2026-09-07 | v7-repro (`enclave-v7`, `448e2fdb`). Verified by two clean builds 2026-09-06. |
| `cd8ba52d340fb1be78610b59953ded2ceca23be1cfcc7ab504a26b8fdcd7ba92090f49e28a32d008df046ec4212f77bf` | 2026-09-05 → 2026-09-06 | v6-repro (`enclave-v6`, `30a97c60`). Verified by two clean builds 2026-09-05. |
| `6483cedffed74680ffb287507744a398b288c3fb943eb3f2e4fe889f8b60b3d575ad8942350360b69a1bd7bf713df27f` | 2026-07-29 → 2026-09-05 | v5-repro (`enclave-v5`, `f8fa324d`). Verified by two clean builds 2026-07-29. |
| `e2fccbae77ee40aac4830e84f195e05d69eb4547bbd961f4d3459feba10807140424aca42ad03810354982598c86b9cb` | 2026-07-05 → 2026-07-29 | v4-repro, the value production actually ran until this rebuild. **This file did not record it at the time** — see the warning below. |
| `bb9dd158703603ec222fe565495ceaa7edc08f665da5c1cddad91442ac2211731390267036d79deb720d13fb704f648a` | 2026-06-27 → 2026-07-05 | v2-repro. Verified by two clean-room builds 2026-06-27. |
| `8530a6399399c4f23d89f5a1faa2e8bf2e09a5959f117070fca08148377f92c902c695fc926c17f67f35f110327dca92` | 2026-05-15 → 2026-06-27 | Genesis. Built by an unpinned pipeline and **cannot be re-derived**; its EIF is retained only to verify proofs from that period. |

> **⚠ THIS FILE DRIFTED ONCE. DO NOT LET IT AGAIN.**
> Between 2026-07-05 and 2026-07-29 this file published `bb9dd158…` while
> production actually ran `e2fccbae…` — two rebuilds went by without the
> published value being updated. `/docs/self-host-tee` was correct throughout,
> so the two disagreed and this file was the wrong one.
>
> The rule: **an enclave rebuild is not finished until this file, the
> `/docs/self-host-tee` PCR0, and the deployed enclave all agree.** Check the
> live value with `curl -s https://nitro.occproof.com/key` before believing any
> document, including this one.

The genesis pipeline did not pin its inputs — floating `node:20-alpine`,
unpinned apk packages, and an `npm install sharp` that fetched whatever was
newest at build time — which is why that measurement cannot be re-derived.

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
