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
 *                 P-256 over SHA-256. Implemented with noble-curves.
 *                 ⚠️ It used to throw, on the reasoning that "agency proofs
 *                 are not produced by any current BitGraph surface" — true
 *                 when written, false from the moment /declare shipped, and
 *                 the throw did not degrade gracefully: it read as the proof
 *                 contradicting itself. An assumption about what the product
 *                 does not do yet is not a safe basis for a verifier's
 *                 behaviour, because the verifier outlives the assumption and
 *                 ships inside the Folder where it cannot be updated.
 *
 * Nothing on the ordinary file-proof path (Ed25519, SHA-256, keccak, RLP,
 * CBOR, X.509) touches this module: those run on noble and hand-rolled
 * code that is identical in Node and the browser.
 */

import { sha256 } from "@noble/hashes/sha256";
import { p256 } from "@noble/curves/nist.js";
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

/**
 * Node's createVerify, enough of it for agency signatures.
 *
 * ⚠️ This threw until 2026-08-18, and the throw was the bug. Every DECLARED
 * recording carries a P-256 agency signature, bitgraph-verify checks it
 * through this interface, and a throw here surfaced as "the proof does not
 * verify" — so the offline page told people that a valid declared proof
 * CONTRADICTED ITSELF. A verifier that cannot perform a check says
 * UNDETERMINED; it never says FALSE. Better still, it performs the check,
 * which is what this now does.
 *
 * Emulates exactly the shape verifier.ts uses:
 *   createVerify("SHA256").update(bytes).verify({key: spkiDer, ...}, sig)
 * with a DER signature and an SPKI-DER P-256 public key.
 *
 * ⚠️ prehash: false. noble-curves v2 hashes the message itself by default,
 * and the message handed over here is ALREADY the SHA-256 digest; leaving the
 * default on double-hashes and every real signature reads false.
 */
export function createVerify(_algorithm: string): {
  update(data: Uint8Array): unknown;
  verify(key: { key: Uint8Array } | Uint8Array, signature: Uint8Array): boolean;
} {
  const chunks: Uint8Array[] = [];
  return {
    update(data: Uint8Array) {
      chunks.push(data);
      return this;
    },
    verify(key, signature): boolean {
      try {
        const spki = key instanceof Uint8Array ? key : key.key;
        // An SPKI-wrapped P-256 key ends with the 65-byte uncompressed point
        // (0x04 ‖ X ‖ Y). Taking the tail avoids carrying a DER parser into a
        // page that must stay small; the 0x04 check is what makes it safe.
        const point = spki.subarray(spki.length - 65);
        if (point.length !== 65 || point[0] !== 0x04) return false;
        let total = 0;
        for (const c of chunks) total += c.length;
        const message = new Uint8Array(total);
        let at = 0;
        for (const c of chunks) { message.set(c, at); at += c.length; }
        return p256.verify(signature, sha256(message), point, { format: "der", prehash: false });
      } catch {
        // Malformed key or signature IS evidence about this proof, so false is
        // an answer here. The capability gap that used to live in this
        // function is gone; nothing in it can now fail for want of a
        // primitive.
        return false;
      }
    },
  };
}
