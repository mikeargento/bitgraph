# SPDX-License-Identifier: Apache-2.0
# Pinned nitro-cli container that turns a (reproducibly built) Docker image into
# an EIF. Running nitro-cli inside a digest-pinned base with a version-pinned
# package fixes BOTH the EIF-packing toolchain AND the kernel/init blobs that get
# measured into PCR0. See reproducible-build/PINS.md.
#
# amazonlinux:2023 pinned by digest (see PINS.md):
FROM amazonlinux@sha256:32f61af6a24e178e8142fb7b0079f4af3a5cda6816cd53d2c611a921ef029ca0

# nitro-cli pinned to an exact NEVRA. If this version ever disappears from the
# AL2023 repo the build fails loudly rather than silently drifting to new blobs.
RUN dnf install -y aws-nitro-enclaves-cli-1.4.4 aws-nitro-enclaves-cli-devel-1.4.4 \
    && dnf clean all

RUN mkdir /output

# Build the EIF, then emit its measurements. The PCR0 in eif-info.txt is the
# value third parties compare against the published R.
ENTRYPOINT ["/bin/bash", "-c", "\
  nitro-cli build-enclave --docker-uri ${DOCKER_IMAGE_TAG}:latest --output-file /output/enclave.eif \
  && nitro-cli describe-eif --eif-path /output/enclave.eif > /output/eif-info.txt \
  && cat /output/eif-info.txt"]
