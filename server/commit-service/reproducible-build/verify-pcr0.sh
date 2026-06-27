#!/usr/bin/env bash
# SPDX-License-Identifier: Apache-2.0
#
# Clean-room determinism check: build the enclave EIF TWICE from the same source
# and assert both produce the identical PCR0. This is the proof that the build is
# reproducible. Optionally also assert the value equals a published PCR0.
#
# Usage:
#   reproducible-build/verify-pcr0.sh [GIT_REF] [EXPECTED_PCR0]
#     GIT_REF        ref to build (default: HEAD)
#     EXPECTED_PCR0  if given, both builds must also equal this (the published R)
#
# Between the two builds we remove the loaded app image and the EIF builder so
# the second run reconstructs them from scratch — approximating a second machine.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
GIT_REF="${1:-HEAD}"
EXPECTED_PCR0="${2:-}"
WORK="$(mktemp -d /tmp/bitgraph-verify.XXXXXX)"

run_build() {
  local out="$1"
  "$SCRIPT_DIR/build-eif.sh" "$GIT_REF" "$out" >"$out.log" 2>&1 || {
    echo "BUILD FAILED — see $out.log"; tail -30 "$out.log"; exit 1; }
  cat "$out/pcr0.txt"
}

echo "=== Reproducible PCR0 verification ==="
echo "Building (1/2) ..."
PCR0_1="$(run_build "$WORK/run1")"
echo "  run 1 PCR0: $PCR0_1"

# Tear down derived state to simulate a fresh machine for run 2.
docker rmi -f bitgraph-enclave:latest bitgraph-eif-builder >/dev/null 2>&1 || true

echo "Building (2/2) ..."
PCR0_2="$(run_build "$WORK/run2")"
echo "  run 2 PCR0: $PCR0_2"

echo ""
if [[ "$PCR0_1" != "$PCR0_2" ]]; then
  echo "FAIL: builds are NOT reproducible — PCR0 differs."
  echo "  run1: $PCR0_1"
  echo "  run2: $PCR0_2"
  echo "  Diagnose with: diffoci / diffoscope on the two docker.tar / enclave.eif"
  exit 1
fi
echo "PASS: two independent builds produced identical PCR0:"
echo "  $PCR0_1"

if [[ -n "$EXPECTED_PCR0" ]]; then
  if [[ "$PCR0_1" != "$EXPECTED_PCR0" ]]; then
    echo "FAIL: PCR0 does not match the published value:"
    echo "  built:     $PCR0_1"
    echo "  published: $EXPECTED_PCR0"
    exit 1
  fi
  echo "PASS: matches the published PCR0 ($EXPECTED_PCR0)."
fi

echo ""
echo "EIF artifacts: $WORK/run1/enclave.eif , $WORK/run2/enclave.eif"
