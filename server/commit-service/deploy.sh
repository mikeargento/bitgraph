#!/usr/bin/env bash
# Copyright (c) Mike Argento. All rights reserved. See LICENSE.
# Deploy BitGraph enclave to a Nitro-enabled EC2 instance.
#
# Run this ON the EC2 parent instance after pulling the latest code.
#
# Prerequisites:
#   - EC2 instance with Nitro Enclave support enabled
#   - Docker installed
#   - nitro-cli installed (amazon-linux: yum install aws-nitro-enclaves-cli)
#   - Enclave allocator configured (/etc/nitro_enclaves/allocator.yaml)
#
# Usage:
#   cd occ/server/commit-service
#   ./deploy.sh
#
# Environment variables:
#   ENCLAVE_CPU    — vCPUs for enclave (default: 2)
#   ENCLAVE_MEM    — Memory in MB for enclave (default: 512)
#   API_KEYS       — Comma-separated API keys for the parent HTTP server
#   PORT           — Parent HTTP server port (default: 8080)

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"

ENCLAVE_CPU="${ENCLAVE_CPU:-2}"
ENCLAVE_MEM="${ENCLAVE_MEM:-1024}"
EIF_OUT_DIR="$SCRIPT_DIR/reproducible-build/eif-out"
EIF_PATH="$EIF_OUT_DIR/enclave.eif"

echo "=== BitGraph Enclave Deploy ==="
echo "Repo root: $REPO_ROOT"
echo "Enclave CPU: $ENCLAVE_CPU, Memory: ${ENCLAVE_MEM}MB"
echo ""

# Steps 1-2: Reproducible build of the Docker image + EIF.
# This replaces the old non-deterministic `docker build` + bare `nitro-cli
# build-enclave` with the pinned, kaniko-based pipeline so the resulting PCR0 is
# re-derivable by anyone. See reproducible-build/PINS.md and README.md.
echo "[1/5] Building reproducible enclave image (EIF)..."
"$SCRIPT_DIR/reproducible-build/build-eif.sh" HEAD "$EIF_OUT_DIR"

echo ""
echo "EIF built: $EIF_PATH"
echo "PCR0 (measurement): $(cat "$EIF_OUT_DIR/pcr0.txt" 2>/dev/null || echo '<see output above>')"
echo "Confirm it matches the published value with: reproducible-build/verify-pcr0.sh"
echo ""

# Step 3: Terminate any running enclave
echo "[3/5] Stopping existing enclave (if any)..."
EXISTING=$(nitro-cli describe-enclaves | python3 -c "
import sys, json
enclaves = json.load(sys.stdin)
for e in enclaves:
    if e.get('State') == 'RUNNING':
        print(e['EnclaveID'])
" 2>/dev/null || true)

if [ -n "$EXISTING" ]; then
  echo "  Terminating enclave: $EXISTING"
  nitro-cli terminate-enclave --enclave-id "$EXISTING" || echo "  (terminate returned non-zero — enclave may already be stopped)"
else
  echo "  No running enclave found."
fi

# Step 4: Launch new enclave
echo "[4/5] Launching enclave..."
nitro-cli run-enclave \
  --eif-path "$EIF_PATH" \
  --cpu-count "$ENCLAVE_CPU" \
  --memory "$ENCLAVE_MEM"

echo ""
nitro-cli describe-enclaves
echo ""

# Step 5: Start parent HTTP server
echo "[5/5] Starting parent HTTP server..."

# Kill existing parent server and socat bridge if running
pkill -f "node.*dist/parent/server.js" 2>/dev/null || true
pkill -f "socat.*VSOCK-CONNECT" 2>/dev/null || true
sleep 1

# Build parent server TypeScript (parent-only — avoids enclave/mock deps)
echo "  Installing dependencies & building parent server..."
cd "$REPO_ROOT"
npm ci --ignore-scripts 2>/dev/null || npm install --ignore-scripts
npx tsc
cd "$SCRIPT_DIR"
npm install
npx tsc -p tsconfig.parent.json

# Start socat bridge: local TCP port → enclave vsock
BRIDGE_PORT="${VSOCK_BRIDGE_PORT:-9000}"
ENCLAVE_CID=$(nitro-cli describe-enclaves | python3 -c "
import sys, json
enclaves = json.load(sys.stdin)
for e in enclaves:
    if e.get('State') == 'RUNNING':
        print(e['EnclaveCID'])
        break
" 2>/dev/null || echo "")

if [ -z "$ENCLAVE_CID" ]; then
  echo "  WARNING: Could not determine enclave CID — socat bridge not started"
else
  echo "  Starting vsock bridge: TCP :${BRIDGE_PORT} → vsock ${ENCLAVE_CID}:5000"
  nohup socat TCP-LISTEN:"$BRIDGE_PORT",fork,reuseaddr VSOCK-CONNECT:"$ENCLAVE_CID":5000 > ~/occ-bridge.log 2>&1 &
  echo "  Bridge PID: $!"
fi

# Start parent server in background
echo "  Starting server on port ${PORT:-8080}..."
nohup env PORT="${PORT:-8080}" VSOCK_BRIDGE_PORT="$BRIDGE_PORT" node dist/parent/server.js > ~/occ-parent.log 2>&1 &
echo "  Parent PID: $!"

echo ""
echo "=== Deploy complete ==="
echo "  Enclave: running (vsock port 5000)"
echo "  Bridge:  TCP :${BRIDGE_PORT} → vsock ${ENCLAVE_CID:-?}:5000"
echo "  Parent:  http://0.0.0.0:${PORT:-8080}"
echo "  Logs:    ~/occ-parent.log"
echo "           ~/occ-bridge.log"
echo "           nitro-cli console --enclave-id \$(nitro-cli describe-enclaves | jq -r '.[0].EnclaveID')"
