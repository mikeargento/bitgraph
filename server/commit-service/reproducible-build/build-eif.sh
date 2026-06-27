#!/usr/bin/env bash
# SPDX-License-Identifier: Apache-2.0
#
# Reproducible BitGraph enclave EIF build.
#
# Produces a bit-for-bit reproducible enclave.eif (and its PCR0) from pinned
# inputs, so anyone rebuilding from the same source re-derives the same PCR0.
# See PINS.md for every pinned digest/version and README.md for the rationale.
#
# Requirements: linux/amd64 host with Docker + git. Nitro hardware NOT required
# to build the EIF (only to run the enclave).
#
# Usage:
#   reproducible-build/build-eif.sh [GIT_REF] [OUTPUT_DIR]
#     GIT_REF     git ref to build from (default: HEAD). The context is produced
#                 with `git archive`, so ONLY committed/tracked files are used —
#                 stray node_modules or local edits cannot leak in.
#     OUTPUT_DIR  where enclave.eif + eif-info.txt land (default: ./eif-out)

set -euo pipefail

# ---- Pinned inputs (keep in sync with PINS.md) ----------------------------
KANIKO_IMAGE="gcr.io/kaniko-project/executor@sha256:9e69fd4330ec887829c780f5126dd80edc663df6def362cd22e79bcdf00ac53f" # v1.23.2
APP_IMAGE_TAG="bitgraph-enclave"
DOCKERFILE_REL="server/commit-service/Dockerfile.enclave"
EIF_BUILDER_TAG="bitgraph-eif-builder"
# Expected nitro-cli 1.4.4 kernel/init blob hashes (the AWS-provided PCR0 input):
read -r -d '' EXPECTED_BLOB_HASHES <<'EOF' || true
210eda749c1308eb60671a579d24db5e8a3477cb7a247cf313c286b09fe2d857  /usr/share/nitro_enclaves/blobs/bzImage
9378dea490ed6c698c3d23b346ed08e49dae52d74a59cee2673b8a7b1951fc5b  /usr/share/nitro_enclaves/blobs/bzImage.config
10d7d9dd205d4596d45997d17434f26207525f129d171a51f9859b1af9f4a07a  /usr/share/nitro_enclaves/blobs/cmdline
c4acb866e8925c171b43517f3a88a6989f5a2da3a6d3e6594f75bedc6d116a27  /usr/share/nitro_enclaves/blobs/init
e57bb1779b348da7eae118a8e0a034d2aa4c28205c07db07dea8285ff206bb69  /usr/share/nitro_enclaves/blobs/linuxkit
6bd2b09422c2f2f58c6ecf1cfd55216bea9b99a6d591261a9eca40027291316b  /usr/share/nitro_enclaves/blobs/nsm.ko
EOF

# ---- Args / paths ---------------------------------------------------------
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../../.." && pwd)"
GIT_REF="${1:-HEAD}"
OUTPUT_DIR="$(cd "$(dirname "${2:-$PWD/eif-out}")" 2>/dev/null && pwd || echo "$PWD")/$(basename "${2:-eif-out}")"

echo "=== Reproducible BitGraph EIF build ==="
echo "Repo root:   $REPO_ROOT"
echo "Git ref:     $GIT_REF ($(git -C "$REPO_ROOT" rev-parse --short "$GIT_REF"))"
echo "Output dir:  $OUTPUT_DIR"
echo ""

mkdir -p "$OUTPUT_DIR"

# Clean-room context: only tracked files at GIT_REF (no node_modules, no .git).
CTX_DIR="$(mktemp -d /tmp/bitgraph-ctx.XXXXXX)"
TAR_PATH="$(mktemp -u /tmp/bitgraph-docker.XXXXXX.tar)"
cleanup() { rm -rf "$CTX_DIR" "$TAR_PATH"; }
trap cleanup EXIT

echo "[1/4] Exporting clean build context from $GIT_REF ..."
git -C "$REPO_ROOT" archive --format=tar "$GIT_REF" | tar -x -C "$CTX_DIR"

echo "[2/4] Building app image with kaniko (--reproducible) ..."
# kaniko --reproducible canonicalizes layer timestamps and image config, so the
# resulting image tar is byte-stable. --custom-platform fixes the target arch.
docker run --rm \
  -v "$CTX_DIR":/workspace \
  "$KANIKO_IMAGE" \
    --dockerfile "$DOCKERFILE_REL" \
    --context dir:///workspace/ \
    --custom-platform=linux/amd64 \
    --cache=false \
    --reproducible \
    --no-push \
    --destination "${APP_IMAGE_TAG}:latest" \
    --tar-path /workspace/docker.tar

echo "[3/4] Loading app image and preparing pinned nitro-cli builder ..."
docker load < "$CTX_DIR/docker.tar"
docker build -t "$EIF_BUILDER_TAG" -f "$SCRIPT_DIR/eif-builder.Dockerfile" "$SCRIPT_DIR"

# Verify the pinned nitro-cli ships exactly the expected (AWS) kernel/init blobs.
echo "    Verifying nitro-cli 1.4.4 kernel blobs match PINS.md ..."
echo "$EXPECTED_BLOB_HASHES" | docker run --rm --entrypoint sha256sum -i "$EIF_BUILDER_TAG" \
  -c - >/dev/null 2>&1 \
  && echo "    OK: kernel/init blobs match the pinned AWS measurement." \
  || { echo "    FATAL: nitro-cli blobs differ from PINS.md — PCR0 would not match."; exit 1; }

echo "[4/4] Building EIF with pinned nitro-cli (in container) ..."
DOCKER_SOCK="$(docker context inspect --format '{{.Endpoints.docker.Host}}' 2>/dev/null | sed 's#^unix://##')"
DOCKER_SOCK="${DOCKER_SOCK:-/var/run/docker.sock}"
docker run --rm \
  -v "$DOCKER_SOCK":/var/run/docker.sock \
  -v "$OUTPUT_DIR":/output \
  -e DOCKER_IMAGE_TAG="$APP_IMAGE_TAG" \
  "$EIF_BUILDER_TAG"

PCR0="$(grep -o '"PCR0"[^,]*' "$OUTPUT_DIR/eif-info.txt" | head -1 | grep -oE '[0-9a-f]{96}')"
echo ""
echo "=== Build complete ==="
echo "EIF:  $OUTPUT_DIR/enclave.eif"
echo "Info: $OUTPUT_DIR/eif-info.txt"
echo "PCR0: $PCR0"
echo "$PCR0" > "$OUTPUT_DIR/pcr0.txt"
