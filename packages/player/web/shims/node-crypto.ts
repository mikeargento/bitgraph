// Copyright (c) 2024-2026 Mike Argento. Licensed under the MIT License. See LICENSE.

/**
 * Browser stand-in for the `node:crypto` symbols the bundled graph
 * imports. Three symbols are reached:
 *
 *   webcrypto     bitgraph-audit's attestation stage verifies the Nitro
 *                 leaf signature (ECDSA P-384) through webcrypto.subtle.
 *                 The browser's own crypto is the same interface.
 *   createHash    bitgraph-verify uses it only on the agency (WebAuthn /
 *                 P-256) path, for SHA-256. Implemented with noble.
 *   createVerify  bitgraph-verify uses it only on the agency path, for
 *                 P-256 over SHA-256. Not implemented here: agency proofs
 *                 are not produced by any current BitGraph surface, and
 *                 verify() catches the throw and reports the proof as
 *                 failing agency verification rather than crashing.
 *
 * Nothing on the ordinary file-proof path (Ed25519, SHA-256, keccak, RLP,
 * CBOR, X.509) touches this module: those run on noble and hand-rolled
 * code that is identical in Node and the browser.
 */

import { sha256 } from "@noble/hashes/sha256";
import { sha512 } from "@noble/hashes/sha2";

export const webcrypto: Crypto | undefined = globalThis.crypto;

type Encoding = "hex" | "base64" | "utf8" | "binary" | undefined;

class Hash {
  private readonly hasher: { update(data: Uint8Array): unknown; digest(): Uint8Array };
  constructor(algorithm: string) {
    const alg = algorithm.toLowerCase().replace("-", "");
    if (alg === "sha256") this.hasher = sha256.create();
    else if (alg === "sha512") this.hasher = sha512.create();
    else throw new Error(`createHash: unsupported algorithm ${algorithm} in the browser verifier`);
  }
  update(data: Uint8Array | string): this {
    this.hasher.update(typeof data === "string" ? new TextEncoder().encode(data) : data);
    return this;
  }
  digest(encoding?: Encoding): Uint8Array | string {
    const out = this.hasher.digest();
    // Buffer is injected globally by the build (see build-verify-html.mjs),
    // so callers that expect Node's Buffer-with-encodings get one.
    const buf = Buffer.from(out);
    return encoding === undefined ? buf : buf.toString(encoding);
  }
}

export function createHash(algorithm: string): Hash {
  return new Hash(algorithm);
}

export function createVerify(_algorithm: string): {
  update(data: Uint8Array): unknown;
  verify(): boolean;
} {
  return {
    update() {
      return this;
    },
    verify(): boolean {
      throw new Error("P-256 agency signature verification is not available in the browser verifier");
    },
  };
}
