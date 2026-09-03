# Fuse fixtures

Minted through the LOCAL enclave harness (server/commit-service/local-enclave):
the unmodified enclave app.ts with a software NSM. Signatures and slot bindings
are real, under a per-run key; the measurement is the harness's fake PCR0
(ab repeated). These proofs exist on no ledger. Regenerate with
make-fuse-fixtures.mts; every proof and every commitment changes when you do.

No fixture file contains the "nonce" colon marker line that the legacy file-02.txt recordings carry.
