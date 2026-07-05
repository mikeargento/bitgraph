// Copyright (c) Mike Argento. All rights reserved. See LICENSE.

/**
 * bitgraph-core host abstraction
 *
 * `HostCapabilities` is the sole interface between this library and any
 * Trusted Execution Environment. All TEE-specific behavior (attestation,
 * key management, monotonic counters, secure clocks) is supplied by a
 * caller-provided implementation of this interface.
 *
 * Design goals:
 *   - TEE-agnostic: no vendor types leak into this file
 *   - Fail-closed: every capability is async and may reject
 *   - Extensible: optional capabilities use the ? modifier so that
 *     adapters can be progressively enhanced without breaking the core
 *   - Self-describing: enforcementTier declares the adapter's trust class
 *
 * Adapters (e.g. aws-nitro, sgx-dcap, sev-snp) live in separate packages
 * and implement this interface. A minimal in-process stub for testing is
 * provided in @bitgraph/stub.
 *
 * IMPORTANT — adapter authors:
 *   enforcementTier is self-reported and signed into every proof.
 *   Claiming "measured-tee" requires that ALL of the following execute
 *   inside the attested enclave boundary:
 *     - key generation and sealing
 *     - nonce generation (getFreshNonce)
 *     - monotonic counter (nextCounter)
 *     - commit gate logic
 *     - signing (sign)
 *   If any of these run outside the boundary, the correct tier is "hw-key"
 *   or "stub". Misrepresenting the tier is an architectural violation of
 *   BitGraph's atomic causality invariant.
 */

import type { EnforcementTier } from "./types.js";

// ---------------------------------------------------------------------------
// Core interface
// ---------------------------------------------------------------------------

export interface HostCapabilities {
  /**
   * Declares the enforcement tier of this adapter.
   *
   * This value is written into every proof's environment.enforcement field
   * and is included in the signed body — making it tamper-evident in transit.
   *
   * Must be one of: "stub" | "hw-key" | "measured-tee"
   * See EnforcementTier in types.ts for full semantics.
   *
   * This is a plain property (not async) because it is a static adapter
   * declaration, not a runtime capability.
   */
  readonly enforcementTier: EnforcementTier;

  /**
   * Return the current enclave measurement as an opaque string.
   *
   * The format is adapter-defined (e.g. hex-encoded PCR0 for Nitro,
   * MRENCLAVE for SGX). The verifier stores and compares this value
   * verbatim; it does not parse or interpret it.
   *
   * Must not return a cached value from outside the TEE boundary.
   *
   * Tier expectations:
   *   stub:         MAY return a synthetic sentinel
   *   hw-key:       SHOULD return a string identifying the key environment
   *   measured-tee: MUST return the attested enclave image identifier
   */
  getMeasurement(): Promise<string>;

  /**
   * Generate a fresh, boundary-local nonce.
   *
   * The nonce MUST be:
   *   - generated inside the TEE boundary (not passed in from the host OS)
   *   - at least 128 bits of entropy
   *   - never reused across calls
   *
   * Returns raw bytes; the library base64-encodes them for the proof.
   */
  getFreshNonce(): Promise<Uint8Array>;

  /**
   * Sign `data` with the enclave's private signing key.
   *
   * The key MUST be:
   *   - generated or provisioned inside the TEE boundary
   *   - an Ed25519 key pair
   *   - not exportable from the TEE
   *
   * Adapter note: when using @noble/ed25519, prefer signAsync() over sign()
   * to avoid requiring a synchronous SHA-512 shim in Node.js environments.
   *
   * Returns the raw 64-byte Ed25519 signature.
   */
  sign(data: Uint8Array): Promise<Uint8Array>;

  /**
   * Return the Ed25519 public key corresponding to the signing key.
   *
   * Returns raw 32-byte compressed public key bytes.
   * Must be stable across calls within a single enclave lifecycle.
   */
  getPublicKey(): Promise<Uint8Array>;

  // -------------------------------------------------------------------------
  // Optional capabilities
  // -------------------------------------------------------------------------

  /**
   * Atomically advance and return a monotonic counter.
   *
   * The counter MUST be:
   *   - monotonically increasing across restarts (hardware-backed preferred)
   *   - returned as a decimal string (no leading zeros unless "0", ASCII digits only)
   *   - never the same value twice (even after a crash/restart)
   *
   * Compared as BigInt by the verifier to avoid IEEE-754 precision loss.
   * Absence of this capability degrades ordering guarantees to nonce-only.
   */
  nextCounter?(): Promise<string>;

  /**
   * Return a TEE-local attestation report that binds the current enclave
   * state to an optional nonce or arbitrary user data.
   *
   * `userData` is adapter-defined; typically a hash of the canonical proof
   * body so the report is bound to this specific commit.
   *
   * The returned object includes:
   *   - format  — adapter-defined format identifier (e.g. "aws-nitro", "sgx-dcap")
   *   - report  — raw attestation report bytes; the library does not parse them
   *
   * format is stored in environment.attestation.format and IS signed.
   * report is stored in environment.attestation.reportB64 and is NOT signed
   * (it is vendor-signed and self-authenticating).
   */
  getAttestation?(userData?: Uint8Array): Promise<{ format: string; report: Uint8Array }>;

  /**
   * Return the current time as Unix epoch milliseconds from a TEE-trusted
   * source.
   *
   * Software clocks inside TEEs can be skewed or forged by a malicious host.
   * This capability is marked optional because not all TEE platforms provide
   * a trusted clock. When absent, commit.time is omitted from the proof.
   *
   * Callers must not use time as the sole ordering mechanism.
   */
  secureTime?(): Promise<number>;
}
