#!/bin/bash
# Everything, in the order that fails fastest.
#
#   ./test.sh          the core's unit tests, the surface's tests, and both
#                      end-to-end suites against a local enclave
#   ./test.sh --app    the above, plus the BUILT APP end to end (runs build.sh)
#
# ⚠️ NOTHING HERE TOUCHES PRODUCTION. The end-to-end suites run the unmodified
# enclave as a local process with a stubbed NSM, so proofs are real proofs
# under a per-run key with a deliberately fake PCR0. No position on the live
# ledger is ever consumed by a test.
set -euo pipefail
here="$(cd "$(dirname "$0")" && pwd)"

echo "── the core, on its own ──────────────────────────────────────────────"
( cd "$here/core" && npm test )

echo
echo "── the surface ──────────────────────────────────────────────────────"
( cd "$here/mac" && swift test 2>&1 | grep -E "Executed .* tests, with|error:" | head -2 )

echo
echo "── the core, against a real enclave ─────────────────────────────────"
( cd "$here/core" && npm run test:e2e )

if [ "${1:-}" = "--app" ]; then
  echo
  echo "── the built app ────────────────────────────────────────────────────"
  "$here/mac/build.sh"
  ( cd "$here/core" && npm run test:app )
fi
