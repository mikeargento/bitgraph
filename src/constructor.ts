// Copyright (c) Mike Argento. All rights reserved. See LICENSE.

/**
 * bitgraph-core Constructor
 *
 * The Constructor is the sole write path in bitgraph-core. It enforces a strict
 * atomic commit invariant:
 *
 *   authorize → bind → sign → (authorization consumed)
 *
 * No partial outputs are produced. If any step fails the entire commit
 * is aborted and an error is thrown without returning any proof fragment.
 *
 * Commit steps (in order):
 *   1. Obtain monotonic counter (if host supports it)
 *   2. Obtain fresh boundary nonce from host
 *   3. Obtain secure time (if host supports it)
 *   4. Compute SHA-256 of input bytes
 *   5. Retrieve enclave measurement and public key
 *   6. Build canonical signed body (includes enforcement + measurement +
 *      attestationFormat when present)
 *   7. Canonicalize signed body to UTF-8 bytes
 *   8. Sign canonical bytes via host
 *   9. Optionally obtain attestation report bound to this commit
 *  10. Assemble and return the complete BitGraphProof
 *
 * Steps 1-9 are performed inside a single async critical section; any
 * rejection causes the function to throw with no returned value.
 */

import { sha256 } from "@noble/hashes/sha256";
import { canonicalize } from "./canonical.js";
import type { HostCapabilities } from "./host.js";
import type { BitGraphPolicy, BitGraphProof, SignedBody, AgencyEnvelope, Attribution, PolicyBinding } from "./types.js";

// ---------------------------------------------------------------------------
// Constructor class
// ---------------------------------------------------------------------------

export class Constructor {
  readonly #host: HostCapabilities;
  readonly #policy: Required<BitGraphPolicy>;
  readonly #epochId: string | undefined;

  private constructor(
    host: HostCapabilities,
    policy: Required<BitGraphPolicy>,
    epochId: string | undefined,
  ) {
    this.#host = host;
    this.#policy = policy;
    this.#epochId = epochId;
  }

  /**
   * Initialize a Constructor bound to a host adapter.
   *
   * Performs a preflight check to confirm the host can produce a measurement
   * and a public key. If either fails the returned promise rejects and no
   * Constructor is created.
   *
   * @param opts.host     - Host capabilities implementation (TEE adapter)
   * @param opts.policy   - Optional policy constraints
   * @param opts.epochId  - Optional epoch identifier (generated at enclave boot).
   *                        When provided, included in every proof's commit.epochId field
   *                        (signed, tamper-evident). Verifiers use epochId to detect
   *                        enclave lifecycle boundaries.
   */
  static async initialize(opts: {
    host: HostCapabilities;
    policy?: BitGraphPolicy;
    epochId?: string;
  }): Promise<Constructor> {
    const { host, policy = {}, epochId } = opts;

    const resolvedPolicy: Required<BitGraphPolicy> = {
      requireCounter: policy.requireCounter ?? false,
      requireTime: policy.requireTime ?? false,
    };

    // Preflight: confirm the host can serve a measurement and a public key.
    await Promise.all([host.getMeasurement(), host.getPublicKey()]).catch(
      (cause: unknown) => {
        throw new Error(
          "bitgraph-core: host preflight failed — getMeasurement() or getPublicKey() rejected",
          { cause }
        );
      }
    );

    // Policy validation: if counter is required, confirm the host has it.
    if (resolvedPolicy.requireCounter && typeof host.nextCounter !== "function") {
      throw new Error(
        "bitgraph-core: policy requires a monotonic counter but host does not implement nextCounter()"
      );
    }

    if (resolvedPolicy.requireTime && typeof host.secureTime !== "function") {
      throw new Error(
        "bitgraph-core: policy requires secure time but host does not implement secureTime()"
      );
    }

    return new Constructor(host, resolvedPolicy, epochId);
  }

  /**
   * Produce a tamper-evident, signed commit proof for a pre-computed digest.
   *
   * Same atomic guarantees as `commit()`, but accepts a Base64-encoded
   * SHA-256 digest instead of raw bytes. This enables digest-only mode
   * where the raw data never leaves the caller (e.g. an iPhone sending
   * only the SHA-256 of a photo to the enclave).
   *
   * @param input.digestB64        - Base64-standard SHA-256 digest of the data
   * @param input.metadata         - Advisory metadata (NOT signed)
   * @param input.prevProofHashB64 - Optional base64 hash of a prior proof for chaining
   * @param input.agency           - Optional agency envelope (actor + authorization)
   */
  async commitDigest(input: {
    digestB64: string;
    metadata?: Record<string, unknown>;
    prevProofHashB64?: string;
    agency?: AgencyEnvelope;
    attribution?: Attribution;
    policy?: PolicyBinding;
  }): Promise<BitGraphProof> {
    const { digestB64, metadata, prevProofHashB64 } = input;

    // Validate the provided digest
    const digestBytes = fromBase64Digest(digestB64);
    if (digestBytes.length !== 32) {
      throw new RangeError(
        `bitgraph-core: digestB64 decodes to ${digestBytes.length} bytes; expected 32 (SHA-256)`
      );
    }

    // Delegate to the internal commit flow, skipping step 4 (hashing)
    return this.#commitInternal({ digestB64, metadata, prevProofHashB64, agency: input.agency, attribution: input.attribution, policy: input.policy });
  }

  /**
   * Produce a tamper-evident, signed commit proof for `input.bytes`.
   *
   * The call is atomic: it either returns a complete BitGraphProof or throws.
   * No partial proof is ever returned.
   *
   * @param input.bytes            - The raw bytes to commit
   * @param input.metadata         - Advisory metadata (NOT signed)
   * @param input.prevProofHashB64 - Optional base64 hash of a prior proof for chaining
   * @param input.agency           - Optional agency envelope (actor + authorization)
   */
  async commit(input: {
    bytes: Uint8Array;
    metadata?: Record<string, unknown>;
    prevProofHashB64?: string;
    agency?: AgencyEnvelope;
    attribution?: Attribution;
    policy?: PolicyBinding;
  }): Promise<BitGraphProof> {
    const { bytes, metadata, prevProofHashB64 } = input;

    // Step 4: SHA-256 digest of input bytes
    const digest = sha256(bytes);
    const digestB64 = toBase64(digest);

    // Delegate to shared internal flow (steps 1-3, 5-10)
    return this.#commitInternal({ digestB64, metadata, prevProofHashB64, agency: input.agency, attribution: input.attribution, policy: input.policy });
  }

  // ------------------------------------------------------------------
  // Internal shared commit flow (steps 1-3, 5-10)
  // ------------------------------------------------------------------

  async #commitInternal(input: {
    digestB64: string;
    metadata: Record<string, unknown> | undefined;
    prevProofHashB64: string | undefined;
    agency: AgencyEnvelope | undefined;
    attribution: Attribution | undefined;
    policy: PolicyBinding | undefined;
  }): Promise<BitGraphProof> {
    const { digestB64, metadata, prevProofHashB64, agency, attribution, policy } = input;

    // ------------------------------------------------------------------
    // Step 1: Monotonic counter (optional, policy-gated)
    // ------------------------------------------------------------------
    let counter: string | undefined;
    if (typeof this.#host.nextCounter === "function") {
      counter = await this.#host.nextCounter().catch((cause: unknown) => {
        throw new Error("bitgraph-core: host.nextCounter() rejected", { cause });
      });
      assertNonEmptyString(counter, "counter");
    }

    // ------------------------------------------------------------------
    // Step 2: Fresh boundary nonce
    // ------------------------------------------------------------------
    const nonceBytes = await this.#host.getFreshNonce().catch((cause: unknown) => {
      throw new Error("bitgraph-core: host.getFreshNonce() rejected", { cause });
    });
    assertUint8Array(nonceBytes, "nonce", 16); // minimum 128-bit entropy

    // ------------------------------------------------------------------
    // Step 3: Secure time (optional, policy-gated)
    // ------------------------------------------------------------------
    let time: number | undefined;
    if (typeof this.#host.secureTime === "function") {
      time = await this.#host.secureTime().catch((cause: unknown) => {
        throw new Error("bitgraph-core: host.secureTime() rejected", { cause });
      });
      if (typeof time !== "number" || !Number.isFinite(time) || time < 0) {
        throw new TypeError(
          "bitgraph-core: host.secureTime() returned an invalid value; expected a non-negative finite number"
        );
      }
    }

    // ------------------------------------------------------------------
    // Step 5: Enclave identity (measurement + public key)
    // ------------------------------------------------------------------
    const [measurement, publicKeyBytes] = await Promise.all([
      this.#host.getMeasurement().catch((cause: unknown) => {
        throw new Error("bitgraph-core: host.getMeasurement() rejected", { cause });
      }),
      this.#host.getPublicKey().catch((cause: unknown) => {
        throw new Error("bitgraph-core: host.getPublicKey() rejected", { cause });
      }),
    ]);

    assertNonEmptyString(measurement, "measurement");
    assertUint8Array(publicKeyBytes, "publicKey", 32); // Ed25519 public key

    // ------------------------------------------------------------------
    // Step 6: Build canonical signed body
    // ------------------------------------------------------------------
    const commitFields: BitGraphProof["commit"] = {
      nonceB64: toBase64(nonceBytes),
    };
    if (counter !== undefined) commitFields.counter = counter;
    if (time !== undefined) commitFields.time = time;
    if (prevProofHashB64 !== undefined) commitFields.prevB64 = prevProofHashB64;
    if (this.#epochId !== undefined) commitFields.epochId = this.#epochId;

    const signedBody: SignedBody = {
      version: "bitgraph/1",
      artifact: {
        hashAlg: "sha256",
        digestB64,
      },
      commit: commitFields,
      publicKeyB64: toBase64(publicKeyBytes),
      enforcement: this.#host.enforcementTier,
      measurement,
    };

    // Include actor identity in signed body when agency is present
    if (agency !== undefined) {
      signedBody.actor = agency.actor;
    }

    // Include policy binding in signed body when present (cryptographically sealed)
    if (policy !== undefined) {
      signedBody.policy = policy;
    }

    // Include attribution in signed body when present (cryptographically sealed)
    if (attribution !== undefined) {
      signedBody.attribution = attribution;
    }

    // ------------------------------------------------------------------
    // Step 7: Canonicalize
    // ------------------------------------------------------------------
    const canonicalBytes = canonicalize(signedBody);

    // ------------------------------------------------------------------
    // Step 8: Sign
    // ------------------------------------------------------------------
    const signatureBytes = await this.#host.sign(canonicalBytes).catch(
      (cause: unknown) => {
        throw new Error("bitgraph-core: host.sign() rejected", { cause });
      }
    );
    assertUint8Array(signatureBytes, "signature", 64); // Ed25519 signature

    // ------------------------------------------------------------------
    // Step 9: Optional attestation report bound to this commit
    // ------------------------------------------------------------------
    let attestation: BitGraphProof["environment"]["attestation"];
    if (typeof this.#host.getAttestation === "function") {
      // Bind the attestation to the canonical body hash so that a verifier
      // can confirm the report covers this specific commit.
      const bodyHash = sha256(canonicalBytes);
      const result = await this.#host.getAttestation(bodyHash).catch(
        (cause: unknown) => {
          throw new Error("bitgraph-core: host.getAttestation() rejected", { cause });
        }
      );
      if (
        typeof result !== "object" ||
        result === null ||
        typeof result.format !== "string" ||
        result.format.length === 0 ||
        !(result.report instanceof Uint8Array) ||
        result.report.length === 0
      ) {
        throw new TypeError(
          "bitgraph-core: host.getAttestation() must return { format: string, report: Uint8Array }"
        );
      }
      attestation = {
        format: result.format,
        reportB64: toBase64(result.report),
      };
      // Also add attestationFormat to the signed body (already canonicalized
      // above without it — we must add it BEFORE signing. Re-do steps 6-8
      // with attestationFormat included so the format is covered by the sig.
      signedBody.attestationFormat = result.format;
      const canonicalBytesWithAttestation = canonicalize(signedBody);
      const signatureBytesWithAttestation = await this.#host.sign(canonicalBytesWithAttestation).catch(
        (cause: unknown) => {
          throw new Error("bitgraph-core: host.sign() rejected (attestation body)", { cause });
        }
      );
      assertUint8Array(signatureBytesWithAttestation, "signature", 64);

      // ------------------------------------------------------------------
      // Step 10: Assemble proof (with attestation)
      // ------------------------------------------------------------------
      const proof: BitGraphProof = {
        version: "bitgraph/1",
        artifact: signedBody.artifact,
        commit: signedBody.commit,
        signer: {
          publicKeyB64: signedBody.publicKeyB64,
          signatureB64: toBase64(signatureBytesWithAttestation),
        },
        environment: {
          enforcement: this.#host.enforcementTier,
          measurement: signedBody.measurement,
          attestation,
        },
      };

      if (agency !== undefined) proof.agency = agency;
      if (policy !== undefined) proof.policy = policy;
      if (attribution !== undefined) proof.attribution = attribution;
      if (metadata !== undefined) proof.metadata = metadata;
      return proof;
    }

    // ------------------------------------------------------------------
    // Step 10: Assemble proof (without attestation)
    // ------------------------------------------------------------------
    const proof: BitGraphProof = {
      version: "bitgraph/1",
      artifact: signedBody.artifact,
      commit: signedBody.commit,
      signer: {
        publicKeyB64: signedBody.publicKeyB64,
        signatureB64: toBase64(signatureBytes),
      },
      environment: {
        enforcement: this.#host.enforcementTier,
        measurement: signedBody.measurement,
      },
    };

    if (agency !== undefined) proof.agency = agency;
    if (policy !== undefined) proof.policy = policy;
    if (attribution !== undefined) proof.attribution = attribution;
    if (metadata !== undefined) proof.metadata = metadata;
    return proof;
  }
}

// ---------------------------------------------------------------------------
// Internal guards
// ---------------------------------------------------------------------------

function assertUint8Array(
  value: unknown,
  name: string,
  minLength: number
): asserts value is Uint8Array {
  if (!(value instanceof Uint8Array)) {
    throw new TypeError(
      `bitgraph-core: host returned non-Uint8Array for ${name}`
    );
  }
  if (value.length < minLength) {
    throw new RangeError(
      `bitgraph-core: host returned ${name} with insufficient length ` +
        `(got ${value.length}, expected >= ${minLength})`
    );
  }
}

function assertNonEmptyString(
  value: unknown,
  name: string
): asserts value is string {
  if (typeof value !== "string" || value.length === 0) {
    throw new TypeError(
      `bitgraph-core: host returned invalid ${name}: expected a non-empty string`
    );
  }
}

// ---------------------------------------------------------------------------
// Encoding utility
// ---------------------------------------------------------------------------

/**
 * Encode a Uint8Array as standard Base64 (RFC 4648 §4, with padding).
 */
function toBase64(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString("base64");
}

/**
 * Decode a Base64 string to Uint8Array, validating round-trip fidelity.
 * Used by commitDigest() to validate the caller-provided digest.
 */
function fromBase64Digest(b64: string): Uint8Array {
  if (typeof b64 !== "string" || b64.length === 0) {
    throw new TypeError("bitgraph-core: digestB64 must be a non-empty string");
  }
  const buf = Buffer.from(b64, "base64");
  if (buf.toString("base64") !== b64) {
    throw new TypeError(`bitgraph-core: digestB64 is not valid base64: "${b64}"`);
  }
  return new Uint8Array(buf);
}
