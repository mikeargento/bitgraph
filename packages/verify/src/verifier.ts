// Copyright (c) 2024-2026 Mike Argento. Licensed under the MIT License. See LICENSE.

/**
 * bitgraph-core Verifier
 *
 * Deterministic, offline verification of BitGraphProof structures.
 *
 * Verification steps (in order):
 *   1. Structural validation — required fields present and typed correctly
 *   2. Artifact check        — SHA-256 of provided bytes matches proof digest
 *   3. Signed body reconstruction — reproduce the exact canonical bytes
 *   4. Signature verification — Ed25519 signature over canonical bytes
 *   5. Policy checks         — enforcement tier, measurement, key, counter,
 *                              time, attestation constraints
 *
 * Design constraints:
 *   - No network calls. All verification is local and deterministic.
 *   - Constant-time comparison for digests and signatures where possible.
 *   - Returns { valid: false, reason: "..." } rather than throwing for
 *     expected verification failures (invalid inputs throw).
 *   - attestation.reportB64 is stored in the proof but not interpreted here;
 *     platform-specific attestation verification belongs in adapter packages.
 *
 * Two entry points share one implementation of every check:
 *   - verify()               requires the original artifact bytes and runs
 *                            every check, including the artifact digest
 *                            comparison (step 2).
 *   - verifyProofIntegrity() runs every check EXCEPT the artifact digest
 *                            comparison. It never sees artifact bytes, and
 *                            its result type states artifactBinding:
 *                            "not-checked" so the distinction cannot be
 *                            missed by callers.
 *
 * Trust model:
 *   - environment.enforcement is tamper-evident (signed) but self-reported.
 *   - Verifiers requiring measured-tee guarantees MUST combine
 *     requireEnforcement with allowedMeasurements and requireAttestation.
 *   - The measurement allowlist is the primary cryptographic trust anchor.
 *
 * ## Compliant Verifier Requirements
 *
 * Any implementation that claims to verify BitGraph proofs MUST perform ALL of
 * the following steps:
 *
 *   1. **Ed25519 signature verification** — Reconstruct the canonical
 *      SignedBody from proof fields (version, artifact, commit, publicKeyB64,
 *      enforcement, measurement, attestationFormat, and optional actor,
 *      attribution, policy, principal). Canonicalize deterministically and
 *      verify signer.signatureB64 over those bytes using signer.publicKeyB64.
 *
 *   2. **Attestation binding** — If environment.attestation is present, the
 *      decoded attestation report MUST contain user_data equal to SHA-256 of
 *      the same canonical SignedBody bytes. This binds the TEE hardware
 *      attestation to the exact signed content. Platform-specific report
 *      parsing is out of scope for this library but MUST be performed by
 *      production verifiers.
 *
 *   3. **Slot allocation verification** — If slotAllocation is present:
 *      (a) verify Ed25519 signature over the canonical slot body,
 *      (b) verify commit.slotHashB64 == SHA-256(canonicalize(slotBody)),
 *      (c) verify slot.nonceB64 == commit.nonceB64,
 *      (d) verify slot.counter < commit.counter.
 *      The slot body includes chainId when present.
 *
 *   4. **Chain linking (prevB64)** — If commit.prevB64 is present, verify it
 *      equals SHA-256(canonicalize(previousProof)) of the immediately
 *      preceding proof in the same chain. Single-proof verifiers may skip
 *      this but MUST document that chain integrity is not verified.
 *
 *   5. **Measurement policy enforcement** — Maintain an allowlist of trusted
 *      measurements (PCR0 hashes). Proofs with unknown measurements MUST be
 *      rejected in production. The measurement is signed (inside SignedBody)
 *      so it is tamper-evident, but self-reported — attestation verification
 *      (step 2) makes it trustworthy.
 *
 *   6. **metadata is advisory and unsigned** — proof.metadata is NOT covered
 *      by the Ed25519 signature. It MUST NOT be treated as authenticated.
 *      Only fields inside the SignedBody are cryptographically bound.
 *      Attribution, policy, principal, and actor ARE in the signed body.
 */

import { createVerify, createHash } from "node:crypto";
import { verifyAsync as ed25519VerifyAsync } from "@noble/ed25519";
import { sha256 } from "@noble/hashes/sha256";
import { canonicalize, constantTimeEqual } from "./canonical.js";
import type { EnforcementTier, BitGraphProof, SignedBody, SlotAllocation, VerificationPolicy, AgencyEnvelope, AuthorizationPayload, WebAuthnAuthorization } from "./types.js";

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export interface VerifyResult {
  valid: boolean;
  /** Human-readable failure reason. Present only when `valid` is false. */
  reason?: string;
}

/**
 * Result of a bytes-free proof integrity check.
 *
 * The `artifactBinding` field is the literal string "not-checked" on every
 * result, success or failure. It exists so that no caller can mistake a
 * passing integrity check for full verification: the artifact digest was
 * never compared against any bytes, so nothing here says that a given file
 * is the committed artifact.
 */
export interface ProofIntegrityResult {
  valid: boolean;
  /**
   * Always the literal "not-checked". verifyProofIntegrity() never sees
   * artifact bytes and never compares them against artifact.digestB64.
   * A valid result means the proof object is internally consistent and
   * correctly signed. It does NOT mean any particular file matches the
   * committed digest. Use verify() with the original bytes to establish
   * artifact binding.
   */
  artifactBinding: "not-checked";
  /** Human-readable failure reason. Present only when `valid` is false. */
  reason?: string;
}

/**
 * Verify a BitGraphProof against the original input bytes.
 *
 * @param opts.proof        - The proof to verify
 * @param opts.bytes        - The original input bytes that were committed
 * @param opts.trustAnchors - Optional policy constraints
 *
 * @throws {TypeError}  if `proof` or `bytes` are not the expected types
 * @returns             `{ valid: true }` on success, `{ valid: false, reason }` on failure
 */
export async function verify(opts: {
  proof: BitGraphProof;
  bytes: Uint8Array;
  trustAnchors?: VerificationPolicy;
}): Promise<VerifyResult> {
  const { proof, bytes, trustAnchors } = opts;
  const reason = await runChecks(proof, bytes, trustAnchors);
  return reason === null ? { valid: true } : fail(reason);
}

/**
 * Check a BitGraphProof's cryptographic integrity WITHOUT the artifact bytes.
 *
 * Runs every check that verify() runs, in the same order, with the single
 * exception of the artifact digest comparison (verify() step 2). Checks
 * performed:
 *
 *   - Structural validation, including strict version === "bitgraph/1"
 *   - artifact.digestB64 base64 well-formedness (the digest string itself,
 *     never compared against bytes)
 *   - Canonical SignedBody reconstruction
 *   - Ed25519 signature over the canonical bytes
 *   - Agency envelope (P-256 device signature) when present
 *   - Slot allocation (slot signature, slotHash binding, nonce binding,
 *     slot counter ordering, key and epoch match) when present
 *   - Epoch link (structure, successor binding, single-successor invariant)
 *     when present
 *   - Policy constraints when trustAnchors is provided
 *
 * NOT performed: the artifact-digest-versus-bytes comparison. A valid
 * result proves the proof object is internally consistent and correctly
 * signed. It does NOT prove that any particular file is the committed
 * artifact. When the original bytes are available, use verify() instead;
 * the result type here carries the literal artifactBinding: "not-checked"
 * so this limitation is visible at every call site.
 *
 * Intended for auditors and indexers that hold proofs without the original
 * artifacts (bytes-free ingest, chain reconstruction, ledger sweeps).
 *
 * @param opts.proof        - The proof to check
 * @param opts.trustAnchors - Optional policy constraints
 *
 * @throws {TypeError}  if `proof` is not the expected type
 * @returns             `{ valid: true, artifactBinding: "not-checked" }` on
 *                      success, `{ valid: false, artifactBinding:
 *                      "not-checked", reason }` on failure
 */
export async function verifyProofIntegrity(opts: {
  proof: BitGraphProof;
  trustAnchors?: VerificationPolicy;
}): Promise<ProofIntegrityResult> {
  const { proof, trustAnchors } = opts;
  const reason = await runChecks(proof, undefined, trustAnchors);
  return reason === null
    ? { valid: true, artifactBinding: "not-checked" }
    : { valid: false, artifactBinding: "not-checked", reason };
}

// ---------------------------------------------------------------------------
// Shared check pipeline
// ---------------------------------------------------------------------------

/**
 * Single implementation of every verification check, shared by verify()
 * and verifyProofIntegrity().
 *
 * When `bytes` is a Uint8Array, the artifact digest comparison runs
 * (verify() semantics). When `bytes` is undefined, that comparison is
 * skipped and everything else runs unchanged (verifyProofIntegrity()
 * semantics). Check order and failure strings are identical in both modes.
 *
 * @returns null on success, or the failure reason string.
 */
async function runChecks(
  proof: BitGraphProof,
  bytes: Uint8Array | undefined,
  trustAnchors: VerificationPolicy | undefined
): Promise<string | null> {
  // ------------------------------------------------------------------
  // 1. Structural validation
  // ------------------------------------------------------------------
  const structureError = validateStructure(proof);
  if (structureError !== null) {
    return structureError;
  }

  // ------------------------------------------------------------------
  // 2. Artifact check: SHA-256 of provided bytes must match proof digest
  //    (bytes mode only). The committed digest string must decode as
  //    valid base64 in both modes; in bytes-free mode the comparison is
  //    skipped, so artifact binding is NOT established.
  // ------------------------------------------------------------------
  const computedDigest = bytes === undefined ? undefined : sha256(bytes);
  let proofDigest: Uint8Array;
  try {
    proofDigest = fromBase64(proof.artifact.digestB64);
  } catch {
    return "artifact.digestB64 is not valid base64";
  }

  if (computedDigest !== undefined && !constantTimeEqual(computedDigest, proofDigest)) {
    return "artifact digest mismatch: the provided bytes do not match the committed digest";
  }

  // ------------------------------------------------------------------
  // 3. Reconstruct canonical signed body
  // ------------------------------------------------------------------
  let publicKeyBytes: Uint8Array;
  try {
    publicKeyBytes = fromBase64(proof.signer.publicKeyB64);
  } catch {
    return "signer.publicKeyB64 is not valid base64";
  }

  if (publicKeyBytes.length !== 32) {
    return `signer.publicKeyB64 decodes to ${publicKeyBytes.length} bytes; expected 32 (Ed25519)`;
  }

  const signedBody: SignedBody = {
    version: proof.version as "bitgraph/1",
    artifact: proof.artifact,
    commit: proof.commit,
    publicKeyB64: proof.signer.publicKeyB64,
    enforcement: proof.environment.enforcement,
    measurement: proof.environment.measurement,
  };

  // Include attestationFormat in signed body when present
  if (proof.environment.attestation !== undefined) {
    signedBody.attestationFormat = proof.environment.attestation.format;
  }

  // Include actor in signed body when agency is present
  if (proof.agency !== undefined) {
    signedBody.actor = proof.agency.actor;
  }

  // Include policy binding in signed body when present
  if (proof.policy !== undefined) {
    signedBody.policy = proof.policy;
  }

  // Include attribution in signed body when present
  if (proof.attribution !== undefined) {
    signedBody.attribution = proof.attribution;
  }

  const canonicalBytes = canonicalize(signedBody);

  // ------------------------------------------------------------------
  // 4. Signature verification
  // ------------------------------------------------------------------
  let signatureBytes: Uint8Array;
  try {
    signatureBytes = fromBase64(proof.signer.signatureB64);
  } catch {
    return "signer.signatureB64 is not valid base64";
  }

  if (signatureBytes.length !== 64) {
    return `signer.signatureB64 decodes to ${signatureBytes.length} bytes; expected 64 (Ed25519)`;
  }

  let signatureValid: boolean;
  try {
    signatureValid = await ed25519VerifyAsync(
      signatureBytes,
      canonicalBytes,
      publicKeyBytes
    );
  } catch (err: unknown) {
    return `signature verification error: ${err instanceof Error ? err.message : String(err)}`;
  }

  if (!signatureValid) {
    return "signature verification failed: signature does not match";
  }

  // ------------------------------------------------------------------
  // 4b. Agency verification (P-256 device signature)
  // ------------------------------------------------------------------
  if (proof.agency !== undefined) {
    const agencyError = verifyAgency(proof);
    if (agencyError !== null) {
      return agencyError;
    }
  }

  // ------------------------------------------------------------------
  // 4c. Slot allocation verification (BitGraph causal ordering)
  // ------------------------------------------------------------------
  if (proof.slotAllocation !== undefined) {
    const slotError = await verifySlotAllocation(proof);
    if (slotError !== null) {
      return slotError;
    }
  }

  // ------------------------------------------------------------------
  // 4d. Epoch link verification (cross-epoch lineage)
  // ------------------------------------------------------------------
  if (proof.commit.epochLink !== undefined) {
    const epochLinkError = verifyEpochLink(proof);
    if (epochLinkError !== null) {
      return epochLinkError;
    }
  }

  // ------------------------------------------------------------------
  // 5. Policy checks
  // ------------------------------------------------------------------
  if (trustAnchors !== undefined) {
    const policyError = checkPolicy(proof, trustAnchors);
    if (policyError !== null) {
      return policyError;
    }
  }

  return null;
}

// ---------------------------------------------------------------------------
// Structural validation
// ---------------------------------------------------------------------------

const VALID_ENFORCEMENT_TIERS: ReadonlySet<string> = new Set([
  "stub",
  "hw-key",
  "measured-tee",
]);

function validateStructure(proof: unknown): string | null {
  if (proof === null || typeof proof !== "object") {
    return "proof must be an object";
  }
  const p = proof as Record<string, unknown>;

  if (p["version"] !== "bitgraph/1") {
    return `unsupported proof version: ${String(p["version"])}`;
  }

  // artifact
  if (!isObject(p["artifact"])) return "proof.artifact is missing or not an object";
  const artifact = p["artifact"] as Record<string, unknown>;
  if (artifact["hashAlg"] !== "sha256") {
    return `unsupported hashAlg: ${String(artifact["hashAlg"])}`;
  }
  if (typeof artifact["digestB64"] !== "string" || artifact["digestB64"].length === 0) {
    return "proof.artifact.digestB64 must be a non-empty string";
  }

  // commit
  if (!isObject(p["commit"])) return "proof.commit is missing or not an object";
  const commit = p["commit"] as Record<string, unknown>;
  if (typeof commit["nonceB64"] !== "string" || commit["nonceB64"].length === 0) {
    return "proof.commit.nonceB64 must be a non-empty string";
  }
  if (commit["counter"] !== undefined && typeof commit["counter"] !== "string") {
    return "proof.commit.counter must be a string when present";
  }
  if (commit["time"] !== undefined) {
    if (typeof commit["time"] !== "number" || !Number.isFinite(commit["time"]) || commit["time"] < 0) {
      return "proof.commit.time must be a non-negative finite number when present";
    }
  }
  if (commit["prevB64"] !== undefined && typeof commit["prevB64"] !== "string") {
    return "proof.commit.prevB64 must be a string when present";
  }
  if (commit["epochId"] !== undefined && typeof commit["epochId"] !== "string") {
    return "proof.commit.epochId must be a string when present";
  }

  // signer
  if (!isObject(p["signer"])) return "proof.signer is missing or not an object";
  const signer = p["signer"] as Record<string, unknown>;
  if (typeof signer["publicKeyB64"] !== "string" || signer["publicKeyB64"].length === 0) {
    return "proof.signer.publicKeyB64 must be a non-empty string";
  }
  if (typeof signer["signatureB64"] !== "string" || signer["signatureB64"].length === 0) {
    return "proof.signer.signatureB64 must be a non-empty string";
  }

  // environment
  if (!isObject(p["environment"])) return "proof.environment is missing or not an object";
  const env = p["environment"] as Record<string, unknown>;
  if (typeof env["enforcement"] !== "string" || !VALID_ENFORCEMENT_TIERS.has(env["enforcement"])) {
    return `proof.environment.enforcement must be one of: stub, hw-key, measured-tee`;
  }
  if (typeof env["measurement"] !== "string" || env["measurement"].length === 0) {
    return "proof.environment.measurement must be a non-empty string";
  }

  // environment.attestation (optional)
  if (env["attestation"] !== undefined) {
    if (!isObject(env["attestation"])) {
      return "proof.environment.attestation must be an object when present";
    }
    const att = env["attestation"] as Record<string, unknown>;
    if (typeof att["format"] !== "string" || att["format"].length === 0) {
      return "proof.environment.attestation.format must be a non-empty string";
    }
    if (typeof att["reportB64"] !== "string" || att["reportB64"].length === 0) {
      return "proof.environment.attestation.reportB64 must be a non-empty string";
    }
  }

  return null;
}

// ---------------------------------------------------------------------------
// Policy enforcement
// ---------------------------------------------------------------------------

function checkPolicy(proof: BitGraphProof, policy: VerificationPolicy): string | null {
  // Enforcement tier check
  if (policy.requireEnforcement !== undefined) {
    if (proof.environment.enforcement !== policy.requireEnforcement) {
      return `enforcement tier "${proof.environment.enforcement}" does not meet required tier "${policy.requireEnforcement}"`;
    }
  }

  // Measurement allowlist
  if (
    policy.allowedMeasurements !== undefined &&
    policy.allowedMeasurements.length > 0
  ) {
    if (!policy.allowedMeasurements.includes(proof.environment.measurement)) {
      return `measurement "${proof.environment.measurement}" is not in the allowed set`;
    }
  }

  // Public key allowlist
  if (
    policy.allowedPublicKeys !== undefined &&
    policy.allowedPublicKeys.length > 0
  ) {
    if (!policy.allowedPublicKeys.includes(proof.signer.publicKeyB64)) {
      return "proof public key is not in the allowed set";
    }
  }

  // Attestation required
  if (policy.requireAttestation === true) {
    if (proof.environment.attestation === undefined) {
      return "policy requires attestation but proof has none";
    }
  }

  // Attestation format allowlist
  if (
    policy.requireAttestationFormat !== undefined &&
    policy.requireAttestationFormat.length > 0
  ) {
    if (proof.environment.attestation === undefined) {
      return "policy requires attestation format but proof has no attestation";
    }
    if (!policy.requireAttestationFormat.includes(proof.environment.attestation.format)) {
      return `attestation format "${proof.environment.attestation.format}" is not in the required set`;
    }
  }

  // Counter checks
  if (policy.minCounter !== undefined || policy.maxCounter !== undefined) {
    if (proof.commit.counter === undefined) {
      return "policy requires a counter but proof has none";
    }
    let proofCounter: bigint;
    try {
      proofCounter = BigInt(proof.commit.counter);
    } catch {
      return "could not parse proof counter value as integer";
    }
    if (policy.minCounter !== undefined) {
      let minCounter: bigint;
      try {
        minCounter = BigInt(policy.minCounter);
      } catch {
        return "could not parse policy minCounter as integer";
      }
      if (proofCounter < minCounter) {
        return `counter ${proof.commit.counter} is below minimum ${policy.minCounter}`;
      }
    }
    if (policy.maxCounter !== undefined) {
      let maxCounter: bigint;
      try {
        maxCounter = BigInt(policy.maxCounter);
      } catch {
        return "could not parse policy maxCounter as integer";
      }
      if (proofCounter > maxCounter) {
        return `counter ${proof.commit.counter} is above maximum ${policy.maxCounter}`;
      }
    }
  }

  // Time checks
  if (policy.minTime !== undefined || policy.maxTime !== undefined) {
    if (proof.commit.time === undefined) {
      return "policy requires a time field but proof has none";
    }
    if (policy.minTime !== undefined && proof.commit.time < policy.minTime) {
      return `commit time ${proof.commit.time} is before minimum ${policy.minTime}`;
    }
    if (policy.maxTime !== undefined && proof.commit.time > policy.maxTime) {
      return `commit time ${proof.commit.time} is after maximum ${policy.maxTime}`;
    }
  }

  // Epoch ID check
  if (policy.requireEpochId === true) {
    if (proof.commit.epochId === undefined || proof.commit.epochId.length === 0) {
      return "policy requires epochId but proof has none";
    }
  }

  // Actor required check
  if (policy.requireActor === true) {
    if (proof.agency === undefined) {
      return "policy requires actor (agency) but proof has none";
    }
  }

  // Actor key ID allowlist
  if (
    policy.allowedActorKeyIds !== undefined &&
    policy.allowedActorKeyIds.length > 0
  ) {
    if (proof.agency === undefined) {
      return "policy requires allowed actor key ID but proof has no agency";
    }
    if (!policy.allowedActorKeyIds.includes(proof.agency.actor.keyId)) {
      return "actor key ID is not in the allowed set";
    }
  }

  // Actor provider allowlist
  if (
    policy.allowedActorProviders !== undefined &&
    policy.allowedActorProviders.length > 0
  ) {
    if (proof.agency === undefined) {
      return "policy requires allowed actor provider but proof has no agency";
    }
    if (!policy.allowedActorProviders.includes(proof.agency.actor.provider)) {
      return `actor provider "${proof.agency.actor.provider}" is not in the allowed set`;
    }
  }

  // Slot allocation required (BitGraph causal ordering)
  if (policy.requireSlot === true) {
    if (proof.slotAllocation === undefined) {
      return "policy requires slotAllocation (BitGraph causal slot) but proof has none";
    }
    // Slot verification itself is handled in step 4c (before policy checks),
    // so by this point the slot has already been validated if present.
  }

  return null;
}

// ---------------------------------------------------------------------------
// Agency verification (P-256 device signature)
// ---------------------------------------------------------------------------

/**
 * Verify the agency envelope: P-256 signature, structural consistency,
 * and artifact binding.
 *
 * Checks:
 *   1. Structural validation of agency fields
 *   2. actor.keyId == hex(SHA-256(SPKI DER pubkey bytes))
 *   3. authorization.actorKeyId == actor.keyId
 *   4. authorization.artifactHash == proof.artifact.digestB64
 *   5. authorization.purpose == "bitgraph/commit-authorize/v1"
 *   6. P-256 signature over canonical authorization payload
 */
function verifyAgency(proof: BitGraphProof): string | null {
  const agency = proof.agency!;
  const { actor, authorization } = agency;
  const isWebAuthn = "format" in authorization && authorization.format === "webauthn";

  // 1. Structural validation
  if (typeof actor.keyId !== "string" || actor.keyId.length === 0) {
    return "agency.actor.keyId must be a non-empty string";
  }
  if (typeof actor.publicKeyB64 !== "string" || actor.publicKeyB64.length === 0) {
    return "agency.actor.publicKeyB64 must be a non-empty string";
  }
  if (actor.algorithm !== "ES256") {
    return `agency.actor.algorithm must be "ES256", got "${String(actor.algorithm)}"`;
  }
  if (typeof actor.provider !== "string" || actor.provider.length === 0) {
    return "agency.actor.provider must be a non-empty string";
  }
  if (authorization.purpose !== "bitgraph/commit-authorize/v1") {
    return `agency.authorization.purpose must be "bitgraph/commit-authorize/v1", got "${String(authorization.purpose)}"`;
  }
  if (typeof authorization.signatureB64 !== "string" || authorization.signatureB64.length === 0) {
    return "agency.authorization.signatureB64 must be a non-empty string";
  }

  // 2. Verify keyId matches public key
  let pubKeyDer: Buffer;
  try {
    pubKeyDer = Buffer.from(actor.publicKeyB64, "base64");
  } catch {
    return "agency.actor.publicKeyB64 is not valid base64";
  }
  const computedKeyId = createHash("sha256").update(pubKeyDer).digest("hex");
  if (computedKeyId !== actor.keyId) {
    return "agency: actor.keyId does not match SHA-256 of public key";
  }

  // 3. Verify actorKeyId matches actor.keyId
  if (authorization.actorKeyId !== actor.keyId) {
    return "agency: authorization.actorKeyId does not match actor.keyId";
  }

  // 4. Verify artifactHash matches proof.artifact.digestB64
  //    For batch proofs, the P-256 signature binds to the first digest in the
  //    batch. batchContext (set by the enclave) lists all digests so we can
  //    verify this proof's digest is part of the authorized batch.
  if (authorization.artifactHash !== proof.artifact.digestB64) {
    const bc = agency.batchContext;
    if (
      !bc ||
      !Array.isArray(bc.batchDigests) ||
      !bc.batchDigests.includes(proof.artifact.digestB64) ||
      bc.batchDigests[0] !== authorization.artifactHash
    ) {
      return "agency: authorization.artifactHash does not match proof.artifact.digestB64";
    }
  }

  // 5. Signature verification (format-dependent)
  let sigBytes: Buffer;
  try {
    sigBytes = Buffer.from(authorization.signatureB64, "base64");
  } catch {
    return "agency.authorization.signatureB64 is not valid base64";
  }

  try {
    if (isWebAuthn) {
      // ── WebAuthn assertion verification ──
      const webauthn = authorization as WebAuthnAuthorization;

      if (typeof webauthn.clientDataJSON !== "string" || !webauthn.clientDataJSON) {
        return "agency: WebAuthn authorization missing clientDataJSON";
      }
      if (typeof webauthn.authenticatorDataB64 !== "string" || !webauthn.authenticatorDataB64) {
        return "agency: WebAuthn authorization missing authenticatorDataB64";
      }

      // Parse clientDataJSON
      let clientData: { type?: string; challenge?: string; origin?: string };
      try {
        clientData = JSON.parse(webauthn.clientDataJSON);
      } catch {
        return "agency: clientDataJSON is not valid JSON";
      }

      if (clientData.type !== "webauthn.get") {
        return `agency: clientDataJSON.type must be "webauthn.get", got "${clientData.type}"`;
      }

      // Verify challenge in clientDataJSON (base64url → base64)
      if (!clientData.challenge) {
        return "agency: clientDataJSON missing challenge field";
      }
      let clientChallenge = clientData.challenge
        .replace(/-/g, "+")
        .replace(/_/g, "/");
      while (clientChallenge.length % 4) clientChallenge += "=";
      if (clientChallenge !== authorization.challenge) {
        return "agency: clientDataJSON challenge does not match authorization.challenge";
      }

      // Check authenticatorData flags
      const authData = Buffer.from(webauthn.authenticatorDataB64, "base64");
      if (authData.length < 37) {
        return "agency: authenticatorData too short";
      }
      const flags = authData[32]!;
      if (!(flags & 0x01)) return "agency: authenticatorData UP flag not set";
      if (!(flags & 0x04)) return "agency: authenticatorData UV flag not set";

      // Build signed data: authenticatorData || SHA-256(clientDataJSON)
      const clientDataHash = createHash("sha256")
        .update(Buffer.from(webauthn.clientDataJSON, "utf8"))
        .digest();
      const signedData = Buffer.concat([authData, clientDataHash]);

      // P-256 signature verification over WebAuthn signed data
      const verifier = createVerify("SHA256");
      verifier.update(signedData);
      const valid = verifier.verify(
        { key: pubKeyDer, format: "der", type: "spki" },
        sigBytes
      );
      if (!valid) {
        return "agency: WebAuthn P-256 signature verification failed";
      }
    } else {
      // ── Direct P-256 signature verification ──
      const canonicalPayload: Record<string, unknown> = {
        purpose: authorization.purpose,
        actorKeyId: authorization.actorKeyId,
        artifactHash: authorization.artifactHash,
        challenge: authorization.challenge,
        timestamp: authorization.timestamp,
      };
      // Include protocolVersion when present (backward-compatible)
      if ("protocolVersion" in authorization && authorization.protocolVersion !== undefined) {
        canonicalPayload.protocolVersion = authorization.protocolVersion;
      }
      const payloadBytes = Buffer.from(
        JSON.stringify(canonicalPayload, Object.keys(canonicalPayload).sort()),
        "utf8"
      );

      const verifier = createVerify("SHA256");
      verifier.update(payloadBytes);
      const valid = verifier.verify(
        { key: pubKeyDer, format: "der", type: "spki" },
        sigBytes
      );
      if (!valid) {
        return "agency: P-256 signature verification failed";
      }
    }
  } catch (err: unknown) {
    return `agency: P-256 signature verification error: ${err instanceof Error ? err.message : String(err)}`;
  }

  return null;
}

// ---------------------------------------------------------------------------
// Slot allocation verification (BitGraph causal ordering)
// ---------------------------------------------------------------------------

/**
 * Verify the embedded slot allocation record for BitGraph atomic causality.
 *
 * Checks (in order):
 *   1. Slot signature valid (enclave created it independently)
 *   2. Slot body has no artifact data (causal independence)
 *   3. SHA-256(canonicalize(slotBody)) === commit.slotHashB64 (signed binding)
 *   4. slotAllocation.nonceB64 === commit.nonceB64 (nonce binding)
 *   5. slotAllocation.counter < commit.counter (ordering)
 *   6. slotAllocation.publicKeyB64 === signer.publicKeyB64 (same enclave)
 *   7. slotAllocation.epochId === commit.epochId (same lifecycle)
 *
 * Check 3 is critical: it proves the Ed25519 commit signature covers the
 * exact slot allocation record (via the hash in the signed body). Without
 * this, the slot record would be advisory data that could be swapped.
 */
async function verifySlotAllocation(proof: BitGraphProof): Promise<string | null> {
  const slot = proof.slotAllocation!;

  // 1. Validate slot structure
  if (slot.version !== "bitgraph/slot/1") {
    return `slotAllocation.version must be "bitgraph/slot/1", got "${String(slot.version)}"`;
  }
  if (typeof slot.nonceB64 !== "string" || slot.nonceB64.length === 0) {
    return "slotAllocation.nonceB64 must be a non-empty string";
  }
  if (typeof slot.counter !== "string" || slot.counter.length === 0) {
    return "slotAllocation.counter must be a non-empty string";
  }
  if (typeof slot.time !== "number" || !Number.isFinite(slot.time) || slot.time < 0) {
    return "slotAllocation.time must be a non-negative finite number";
  }
  if (typeof slot.epochId !== "string" || slot.epochId.length === 0) {
    return "slotAllocation.epochId must be a non-empty string";
  }
  if (typeof slot.publicKeyB64 !== "string" || slot.publicKeyB64.length === 0) {
    return "slotAllocation.publicKeyB64 must be a non-empty string";
  }
  if (typeof slot.signatureB64 !== "string" || slot.signatureB64.length === 0) {
    return "slotAllocation.signatureB64 must be a non-empty string";
  }

  // 2. Verify slot signature (Ed25519 over canonical slot body)
  const slotBody = {
    version: slot.version,
    nonceB64: slot.nonceB64,
    counter: slot.counter,
    time: slot.time,
    epochId: slot.epochId,
    publicKeyB64: slot.publicKeyB64,
    ...(slot.chainId ? { chainId: slot.chainId } : {}),
  };
  const slotCanonicalBytes = canonicalize(slotBody);

  let slotSigBytes: Uint8Array;
  let slotPubKeyBytes: Uint8Array;
  try {
    slotSigBytes = fromBase64(slot.signatureB64);
    slotPubKeyBytes = fromBase64(slot.publicKeyB64);
  } catch {
    return "slotAllocation contains invalid base64";
  }

  if (slotSigBytes.length !== 64) {
    return `slotAllocation.signatureB64 decodes to ${slotSigBytes.length} bytes; expected 64 (Ed25519)`;
  }
  if (slotPubKeyBytes.length !== 32) {
    return `slotAllocation.publicKeyB64 decodes to ${slotPubKeyBytes.length} bytes; expected 32 (Ed25519)`;
  }

  let slotSigValid: boolean;
  try {
    slotSigValid = await ed25519VerifyAsync(slotSigBytes, slotCanonicalBytes, slotPubKeyBytes);
  } catch (err: unknown) {
    return `slotAllocation signature verification error: ${err instanceof Error ? err.message : String(err)}`;
  }
  if (!slotSigValid) {
    return "slotAllocation signature verification failed";
  }

  // 3. Confirm slot body has no artifact data (causal independence)
  // The slot body contains: version, nonceB64, counter, time, epochId, publicKeyB64,
  // and optionally chainId. If any artifact-related field were present, it would
  // break the causal argument. We reject known artifact fields defensively.
  const forbiddenKeys = new Set(["digestB64", "artifact", "hashAlg", "signatureB64"]);
  const slotBodyKeys = Object.keys(slotBody);
  for (const key of slotBodyKeys) {
    if (forbiddenKeys.has(key)) {
      return `slotAllocation body contains forbidden field '${key}' — causal independence violated`;
    }
  }

  // 4. Verify signed binding: SHA-256(canonicalize(slotBody)) === commit.slotHashB64
  // This proves the Ed25519 commit signature covers the exact slot record.
  if (typeof proof.commit.slotHashB64 !== "string" || proof.commit.slotHashB64.length === 0) {
    return "commit.slotHashB64 must be present when slotAllocation is present";
  }
  const computedSlotHash = sha256(slotCanonicalBytes);
  let proofSlotHash: Uint8Array;
  try {
    proofSlotHash = fromBase64(proof.commit.slotHashB64);
  } catch {
    return "commit.slotHashB64 is not valid base64";
  }
  if (!constantTimeEqual(computedSlotHash, proofSlotHash)) {
    return "commit.slotHashB64 does not match SHA-256 of canonical slot body — slot binding broken";
  }

  // 5. Verify nonce binding: slot nonce === commit nonce
  if (slot.nonceB64 !== proof.commit.nonceB64) {
    return "slotAllocation.nonceB64 does not match commit.nonceB64";
  }

  // 6. Verify ordering: slot counter < commit counter
  if (typeof proof.commit.slotCounter !== "string" || proof.commit.slotCounter.length === 0) {
    return "commit.slotCounter must be present when slotAllocation is present";
  }
  if (proof.commit.slotCounter !== slot.counter) {
    return "commit.slotCounter does not match slotAllocation.counter";
  }
  if (proof.commit.counter === undefined) {
    return "commit.counter must be present for slot ordering verification";
  }
  try {
    const slotCounter = BigInt(slot.counter);
    const commitCounter = BigInt(proof.commit.counter);
    if (slotCounter >= commitCounter) {
      return `slotAllocation.counter (${slot.counter}) must be less than commit.counter (${proof.commit.counter})`;
    }
  } catch {
    return "could not parse slot or commit counter as integer";
  }

  // 7. Verify same enclave: same public key
  if (slot.publicKeyB64 !== proof.signer.publicKeyB64) {
    return "slotAllocation.publicKeyB64 does not match signer.publicKeyB64 — different enclave";
  }

  // 8. Verify same lifecycle: same epochId
  if (proof.commit.epochId !== undefined && slot.epochId !== proof.commit.epochId) {
    return "slotAllocation.epochId does not match commit.epochId — different lifecycle";
  }

  return null;
}

// ---------------------------------------------------------------------------
// Epoch link verification (cross-epoch lineage)
// ---------------------------------------------------------------------------

/**
 * Single-successor tracking.
 *
 * Maps successorKey → the epochId that consumed it.
 * successorKey = SHA-256(prevEpochId || prevCounter || prevProofHashB64)
 *
 * If a DIFFERENT successor epoch attempts to consume the same predecessor,
 * the verifier detects a fork and rejects.
 *
 * This is an in-memory registry scoped to the verifier's lifecycle.
 * For persistent fork detection across processes, callers should maintain
 * an external store and pass consumed predecessors via the
 * `consumedPredecessors` option.
 */
const consumedPredecessors = new Map<string, string>(); // successorKey → toEpochId

/**
 * Compute the unique key for a consumed predecessor.
 * successorKey = BASE64(SHA-256(prevEpochId + "|" + prevCounter + "|" + prevProofHashB64))
 */
function computeSuccessorKey(link: NonNullable<BitGraphProof["commit"]["epochLink"]>): string {
  const input = `${link.prevEpochId}|${link.prevCounter}|${link.prevProofHashB64}`;
  const hash = sha256(new TextEncoder().encode(input));
  return Buffer.from(hash).toString("base64");
}

/**
 * Verify epoch link correctness and single-successor invariant.
 *
 * Checks:
 *   1. Structural validation of epochLink fields
 *   2. Successor binding: toEpochId === proof's epochId
 *   3. Successor binding: toPublicKeyB64 === proof's signer key
 *   4. Single-successor: no other epoch has consumed this predecessor
 *
 * Note: Validating the predecessor proof's signature requires the predecessor
 * proof itself, which is not embedded in the current proof. The enclave
 * performs this validation at init time. The verifier checks structural
 * consistency and fork detection.
 */
function verifyEpochLink(proof: BitGraphProof): string | null {
  const link = proof.commit.epochLink!;

  // 1. Structural validation
  if (typeof link.prevEpochId !== "string" || link.prevEpochId.length === 0) {
    return "epochLink.prevEpochId must be a non-empty string";
  }
  if (typeof link.prevPublicKeyB64 !== "string" || link.prevPublicKeyB64.length === 0) {
    return "epochLink.prevPublicKeyB64 must be a non-empty string";
  }
  if (typeof link.prevCounter !== "string" || link.prevCounter.length === 0) {
    return "epochLink.prevCounter must be a non-empty string";
  }
  if (typeof link.prevProofHashB64 !== "string" || link.prevProofHashB64.length === 0) {
    return "epochLink.prevProofHashB64 must be a non-empty string";
  }
  if (typeof link.toEpochId !== "string" || link.toEpochId.length === 0) {
    return "epochLink.toEpochId must be a non-empty string";
  }
  if (typeof link.toPublicKeyB64 !== "string" || link.toPublicKeyB64.length === 0) {
    return "epochLink.toPublicKeyB64 must be a non-empty string";
  }

  // Validate prevCounter is a valid decimal string
  try {
    BigInt(link.prevCounter);
  } catch {
    return "epochLink.prevCounter is not a valid decimal string";
  }

  // 2. Successor binding: toEpochId must match proof's commit.epochId
  if (proof.commit.epochId !== undefined && link.toEpochId !== proof.commit.epochId) {
    return `epochLink.toEpochId "${link.toEpochId}" does not match proof commit.epochId "${proof.commit.epochId}" — successor binding broken`;
  }

  // 3. Successor binding: toPublicKeyB64 must match proof's signer
  if (link.toPublicKeyB64 !== proof.signer.publicKeyB64) {
    return `epochLink.toPublicKeyB64 does not match proof signer.publicKeyB64 — successor binding broken`;
  }

  // 4. Predecessor must be from a DIFFERENT epoch (same epoch = not an epoch link)
  if (link.prevEpochId === link.toEpochId) {
    return "epochLink.prevEpochId equals toEpochId — epoch link must cross epoch boundary";
  }

  // 5. Predecessor signer must differ from successor signer
  //    (new epoch = new keypair, so keys must be different)
  if (link.prevPublicKeyB64 === link.toPublicKeyB64) {
    return "epochLink.prevPublicKeyB64 equals toPublicKeyB64 — epochs must have different keys";
  }

  // 6. Single-successor invariant: detect forks
  const successorKey = computeSuccessorKey(link);
  const existingSuccessor = consumedPredecessors.get(successorKey);

  if (existingSuccessor !== undefined) {
    if (existingSuccessor !== link.toEpochId) {
      return (
        `FORK DETECTED: predecessor (epoch=${link.prevEpochId.slice(0, 12)}..., counter=${link.prevCounter}) ` +
        `already consumed by epoch ${existingSuccessor.slice(0, 12)}..., ` +
        `but this proof claims consumption by epoch ${link.toEpochId.slice(0, 12)}... — ` +
        `single-successor invariant violated`
      );
    }
    // Same successor — idempotent (re-verifying same proof)
  } else {
    // Record this consumption
    consumedPredecessors.set(successorKey, link.toEpochId);
  }

  return null;
}

/**
 * Reset the in-memory single-successor tracking state.
 * Use this when starting a fresh verification context.
 */
export function resetEpochLinkState(): void {
  consumedPredecessors.clear();
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function fail(reason: string): VerifyResult {
  return { valid: false, reason };
}

function isObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function fromBase64(b64: string): Uint8Array {
  const buf = Buffer.from(b64, "base64");
  if (buf.toString("base64") !== b64) {
    throw new Error(`invalid base64 string: "${b64}"`);
  }
  return new Uint8Array(buf);
}
