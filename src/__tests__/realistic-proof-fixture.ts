/**
 * Shared realistic proof fixture.
 *
 * Extracted verbatim from proof-hash-regression.test.ts (values unchanged,
 * byte for byte) so other suites can import the fixture without importing
 * a test file (which would re-register its suites under node:test).
 *
 * This mirrors what the TEE actually produces: a real-shaped Ethereum
 * anchor proof with a TRUNCATED attestation blob and placeholder
 * signatures. It is a canonical-hash and ingest fixture; it fails full
 * verification by design and its attestation document must honestly
 * report as present-but-unvalidatable (parse error), never as a pass.
 */

// Realistic proof: mirrors what the TEE actually produces
export const REALISTIC_PROOF = {
  version: "bitgraph/1" as const,
  artifact: {
    hashAlg: "sha256" as const,
    digestB64: "NkYJQ1Gi0hE0SIhv6c46MlqJdurmKHtbScOprDfoL6A=",
  },
  commit: {
    nonceB64: "z1272XEvkMtibuBP0qG3oY37cewo6cJ/o1AuigOSVOk=",
    counter: "1370",
    slotCounter: "1369",
    slotHashB64: "8IyrBOGB64ppP/RETEZTYyYesF5bfcwJ5dI9+u7r2yY=",
    epochId: "7jU4N9703cm6A2t8YNoGsyOvbdePDpoaD8AKCFs7wko=",
    prevB64: "KsJfA3MinpSwF+t4GuxU9vLmmaqAK8FhzhaepEnJBDc=",
    chainId: "bitgraph:main",
  },
  signer: {
    publicKeyB64: "9XjqKDS+e8NhhNoBqbisCKHpaR/HK6hH0x5AKdwc56w=",
    signatureB64: "wbhAtN1dcF2nESBDB0sCQ4ebuZCav8ziLivYgofh7cXeupw5H97VyovHN4I/R9uS0vNaoPIP8js8uTkZnn/IBA==",
  },
  environment: {
    enforcement: "measured-tee",
    measurement: "638d655ad6091bed5c358628b7780de0cdbe138a37fe09d52bf8021a720680a2b3c730fee9f6bef79c1dbe68ef3cdd94",
    attestation: {
      format: "aws-nitro",
      reportB64: "hEShATgioFkR...(truncated for test)",
    },
  },
  slotAllocation: {
    version: "bitgraph/slot/1" as const,
    nonceB64: "z1272XEvkMtibuBP0qG3oY37cewo6cJ/o1AuigOSVOk=",
    counter: "1369",
    epochId: "7jU4N9703cm6A2t8YNoGsyOvbdePDpoaD8AKCFs7wko=",
    publicKeyB64: "9XjqKDS+e8NhhNoBqbisCKHpaR/HK6hH0x5AKdwc56w=",
    chainId: "bitgraph:main",
    signatureB64: "yO34pHfmkjGY6HgDxcPIaFd/lnt/UFZuHQa10LmUvTHgsQP3S3bIEJX/xcXPRENKZ9duVe7c+81rAWdmhiRMBg==",
  },
  attribution: {
    name: "Ethereum Anchor",
    title: "https://etherscan.io/block/24800448",
    message: "0x28ed3639cd705fb8cb2b915c1991e9f808b40e775bc8eb540702942729fec2c0",
  },
};
