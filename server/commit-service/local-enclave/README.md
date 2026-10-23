# Local enclave harness

Runs the UNMODIFIED `src/enclave/app.ts` as a process on this machine so the
parent's slot protocol (allocate, commit under a client-held slot, TTL,
refusals) can be exercised end to end without the Nitro box, S3, or the ledger.

`run-local-enclave.mjs` copies `app.ts` into `.build/` and patches exactly two
things in the copy: the NSM client (a software stand-in for /dev/nsm answering
DescribePCR, GetRandom and Attestation) and the listen call (a loopback TCP port
instead of `/app/enclave.sock`, so no socat relay is needed). Everything else,
the slot map, the counters, the signing, the dispatcher, is the enclave's own
code, byte for byte.

The mock under `src/mock/` cannot serve this purpose: it has no `allocateSlot`
and no `commitDigest`, and its proofs carry no `slotAllocation`.

Proofs minted here are signature-valid under a per-run key with a fake PCR0;
bitgraph-verify accepts them (it allowlists measurements, it does not open the
attestation document), so they make honest fixtures.

Usage (three terminals, or `smoke.mts` which does all of it):

    node run-local-enclave.mjs            # ENCLAVE_PORT=59000
    node run-local-parent.mjs             # PORT=58080, VSOCK_BRIDGE_PORT=59000, no ledger
    node --import tsx/esm smoke.mts       # allocate, limits, commit, commit under a held slot

The `*.reference.*` files are earlier scratch versions kept for reference only.
