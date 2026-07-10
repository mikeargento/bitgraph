/**
 * Shared mock proof fixture.
 *
 * Extracted verbatim from proof-hash.test.ts (values unchanged, byte for
 * byte) so other suites can import the fixture without importing a test
 * file (which would re-register its suites under node:test).
 *
 * Placeholder values throughout: the digest, keys, and signatures are not
 * real base64 crypto material. It is a canonical-hash and ingest fixture;
 * it fails full verification by design, always for a precise non-version
 * reason (the placeholder digest is not strict base64), never as a pass.
 */

import type { BitGraphProof } from "../index.js";

export const MOCK_PROOF: BitGraphProof = {
  version: "bitgraph/1",
  artifact: { hashAlg: "sha256", digestB64: "abc123==" },
  commit: {
    nonceB64: "nonce==",
    counter: "42",
    slotCounter: "41",
    epochId: "epoch==",
    prevB64: "prev==",
  },
  signer: {
    publicKeyB64: "pubkey==",
    signatureB64: "sig==",
  },
  environment: {
    enforcement: "measured-tee",
    measurement: "pcr0hash",
    attestation: { format: "aws-nitro", reportB64: "report==" },
  },
  attribution: { name: "test", message: "hello" },
};
