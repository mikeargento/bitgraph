// Copyright (c) 2024-2026 Mike Argento. Licensed under the MIT License. See LICENSE.

/**
 * AWS Nitro Enclaves Root CA G1
 *
 * Source: https://aws-nitro-enclaves.amazonaws.com/AWS_NitroEnclaves_Root-G1.zip
 * Subject: CN=aws.nitro-enclaves, O=Amazon, OU=AWS, C=US
 * Validity: 2019-10-28 to 2049-10-28
 * SHA-256 fingerprint (DER):
 *   641a0321a3e244efe456463195d606317ed7cdcc3c1756e09893f3c68f79bb5b
 *
 * This is the trust anchor for all AWS Nitro Enclave attestations. It is
 * stable, well-known, and never changes, so it is safe to embed. The PEM
 * string below is byte-for-byte the same constant the website validator
 * embeds (website/src/lib/aws-nitro-root-ca.ts); the fingerprint above
 * matches the value AWS publishes for the Root G1 certificate.
 *
 * No network access: this constant exists precisely so the audit tool
 * never fetches trust material at runtime.
 */

export const AWS_NITRO_ROOT_CA_PEM = `-----BEGIN CERTIFICATE-----
MIICETCCAZagAwIBAgIRAPkxdWgbkK/hHUbMtOTn+FYwCgYIKoZIzj0EAwMwSTEL
MAkGA1UEBhMCVVMxDzANBgNVBAoMBkFtYXpvbjEMMAoGA1UECwwDQVdTMRswGQYD
VQQDDBJhd3Mubml0cm8tZW5jbGF2ZXMwHhcNMTkxMDI4MTMyODA1WhcNNDkxMDI4
MTQyODA1WjBJMQswCQYDVQQGEwJVUzEPMA0GA1UECgwGQW1hem9uMQwwCgYDVQQL
DANBV1MxGzAZBgNVBAMMEmF3cy5uaXRyby1lbmNsYXZlczB2MBAGByqGSM49AgEG
BSuBBAAiA2IABPwCVOumCMHzaHDimtqQvkY4MpJzbolL//Zy2YlES1BR5TSksfbb
48C8WBoyt7F2Bw7eEtaaP+ohG2bnUs990d0JX28TcPQXCEPZ3BABIeTPYwEoCWZE
h8l5YoQwTcU/9KNCMEAwDwYDVR0TAQH/BAUwAwEB/zAdBgNVHQ4EFgQUkCW1DdkF
R+eWw5b6cp3PmanfS5YwDgYDVR0PAQH/BAQDAgGGMAoGCCqGSM49BAMDA2kAMGYC
MQCjfy+Rocm9Xue4YnwWmNJVA44fA0P5W2OpYow9OYCVRaEevL8uO1XYru5xtMPW
rfMCMQCi85sWBbJwKKXdS6BptQFuZbT73o/gBh1qUxl/nNr12UO8Yfwr6wPLb+6N
IwLz3/Y=
-----END CERTIFICATE-----`;

/** Strip PEM headers/footers and whitespace, return base64 DER. */
export function rootCaDerB64(): string {
  return AWS_NITRO_ROOT_CA_PEM.replace(/-----BEGIN CERTIFICATE-----/, "")
    .replace(/-----END CERTIFICATE-----/, "")
    .replace(/\s+/g, "");
}

/** Decode the root CA PEM to raw DER bytes. */
export function rootCaDerBytes(): Uint8Array {
  return new Uint8Array(Buffer.from(rootCaDerB64(), "base64"));
}
